import { Events } from '../events/Events';
import { Hooks } from '../hooks/Hooks';
import { Cache } from '../cache/Cache';

export interface ServiceDefinition {
  name: string;
  version: string;
  module: string;
  methods: string[];
  endpoint?: string;
  timeout?: number;
  retries?: number;
  circuitBreaker?: {
    failureThreshold: number;
    resetTimeout: number;
  };
}

export interface APIEndpoint {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  module: string;
  handler: string;
  middleware?: string[];
  rateLimit?: {
    requests: number;
    window: number; // seconds
  };
  auth?: {
    required: boolean;
    permissions?: string[];
  };
}

export interface MessageBusConfig {
  maxRetries: number;
  retryDelay: number;
  deadLetterQueue: boolean;
  persistence: boolean;
}

export class ModuleCommunicationHub {
  private static instance: ModuleCommunicationHub;
  private services = new Map<string, ServiceDefinition>();
  private apiEndpoints = new Map<string, APIEndpoint>();
  private serviceInstances = new Map<string, any>();
  private circuitBreakers = new Map<string, CircuitBreaker>();
  private messageQueues = new Map<string, MessageQueue>();
  private eventSubscriptions = new Map<string, Set<string>>(); // event -> modules

  private eventListeners = new Map<string, Function[]>();

  private constructor() {}

  static getInstance(): ModuleCommunicationHub {
    if (!ModuleCommunicationHub.instance) {
      ModuleCommunicationHub.instance = new ModuleCommunicationHub();
    }
    return ModuleCommunicationHub.instance;
  }

  // Service Discovery & Registration
  registerService(service: ServiceDefinition, instance: any): void {
    const serviceKey = `${service.name}@${service.version}`;
    
    if (this.services.has(serviceKey)) {
      throw new Error(`Service ${serviceKey} is already registered`);
    }

    this.services.set(serviceKey, service);
    this.serviceInstances.set(serviceKey, instance);

    // Setup circuit breaker if configured
    if (service.circuitBreaker) {
      this.circuitBreakers.set(serviceKey, new CircuitBreaker(service.circuitBreaker));
    }

    // Cache service registry for fast lookup
    Cache.set(`service:${serviceKey}`, service, 3600); // 1 hour TTL
  }

  async discoverService(name: string, version?: string): Promise<ServiceDefinition | null> {
    // Try exact version match first
    if (version) {
      const serviceKey = `${name}@${version}`;
      const cached = await Cache.get(`service:${serviceKey}`);
      if (cached) return cached;
      return this.services.get(serviceKey) || null;
    }

    // Find latest version if no version specified
    const matchingServices = Array.from(this.services.entries())
      .filter(([key]) => key.startsWith(`${name}@`))
      .sort(([a], [b]) => this.compareVersions(a.split('@')[1], b.split('@')[1]))
      .reverse();

    return matchingServices.length > 0 ? matchingServices[0][1] : null;
  }

  async callService(serviceName: string, method: string, params: any[], version?: string): Promise<any> {
    const service = await this.discoverService(serviceName, version);
    if (!service) {
      throw new Error(`Service ${serviceName} not found`);
    }

    const serviceKey = `${service.name}@${service.version}`;
    const instance = this.serviceInstances.get(serviceKey);
    if (!instance) {
      throw new Error(`Service instance ${serviceKey} not available`);
    }

    if (!service.methods.includes(method)) {
      throw new Error(`Method ${method} not available on service ${serviceName}`);
    }

    // Check circuit breaker
    const circuitBreaker = this.circuitBreakers.get(serviceKey);
    if (circuitBreaker && circuitBreaker.isOpen()) {
      throw new Error(`Service ${serviceKey} is currently unavailable (circuit breaker open)`);
    }

    try {
      const result = await this.executeWithTimeout(
        () => instance[method](...params),
        service.timeout || 5000
      );

      if (circuitBreaker) {
        circuitBreaker.recordSuccess();
      }

      return result;
    } catch (error) {
      if (circuitBreaker) {
        circuitBreaker.recordFailure();
      }
      throw error;
    }
  }

  // API Endpoint Management
  registerAPIEndpoint(endpoint: APIEndpoint): void {
    const endpointKey = `${endpoint.method}:${endpoint.path}`;
    
    if (this.apiEndpoints.has(endpointKey)) {
      throw new Error(`API endpoint ${endpointKey} is already registered`);
    }

    this.apiEndpoints.set(endpointKey, endpoint);
    
    // Cache endpoint for fast routing
    Cache.set(`api:${endpointKey}`, endpoint, 3600);
  }

  getAPIEndpoint(method: string, path: string): APIEndpoint | null {
    const endpointKey = `${method}:${path}`;
    return this.apiEndpoints.get(endpointKey) || null;
  }

  getAllAPIEndpoints(): APIEndpoint[] {
    return Array.from(this.apiEndpoints.values());
  }

  // Event-Driven Communication
  subscribeToEvent(moduleName: string, eventName: string, handler: Function): void {
    if (!this.eventSubscriptions.has(eventName)) {
      this.eventSubscriptions.set(eventName, new Set());
    }
    
    this.eventSubscriptions.get(eventName)!.add(moduleName);
    
    // Register with the internal event system
    this.on(eventName, async (payload: any) => {
      try {
        await handler(payload);
      } catch (error) {
        console.error(`Error in event handler for ${eventName} in module ${moduleName}:`, error);
        // Emit error event for monitoring
        this.emitEvent('module.event.error', {
          module: moduleName,
          event: eventName,
          error: (error as any).message
        });
      }
    });
  }

  async publishEvent(eventName: string, payload: any, options?: {
    targetModules?: string[];
    async?: boolean;
    persistent?: boolean;
  }): Promise<void> {
    const subscribers = this.eventSubscriptions.get(eventName);
    if (!subscribers || subscribers.size === 0) {
      return; // No subscribers
    }

    // Filter by target modules if specified
    const targetSubscribers = options?.targetModules 
      ? Array.from(subscribers).filter(module => options.targetModules!.includes(module))
      : Array.from(subscribers);

    if (options?.persistent) {
      // Store event for replay
      await Cache.set(`event:${eventName}:${Date.now()}`, {
        eventName,
        payload,
        timestamp: new Date(),
        subscribers: targetSubscribers
      }, 86400); // 24 hours
    }

    if (options?.async === false) {
      // Synchronous event processing
      this.emitEvent(eventName, payload);
    } else {
      // Asynchronous event processing (default)
      setTimeout(() => {
        this.emitEvent(eventName, payload);
      }, 0);
    }
  }

  // Message Queue System
  createMessageQueue(queueName: string, config: MessageBusConfig): void {
    if (this.messageQueues.has(queueName)) {
      throw new Error(`Message queue ${queueName} already exists`);
    }

    this.messageQueues.set(queueName, new MessageQueue(queueName, config));
  }

  async sendMessage(queueName: string, message: any, priority: number = 0): Promise<void> {
    const queue = this.messageQueues.get(queueName);
    if (!queue) {
      throw new Error(`Message queue ${queueName} not found`);
    }

    await queue.enqueue(message, priority);
  }

  async consumeMessage(queueName: string, handler: (message: any) => Promise<void>): Promise<void> {
    const queue = this.messageQueues.get(queueName);
    if (!queue) {
      throw new Error(`Message queue ${queueName} not found`);
    }

    queue.addConsumer(handler);
  }

  // Cross-Module Hook System
  registerHook(hookName: string, moduleName: string, handler: Function): void {
    Hooks.register(hookName, async (payload: any) => {
      try {
        return await handler(payload);
      } catch (error) {
        console.error(`Error in hook ${hookName} for module ${moduleName}:`, error);
        throw error;
      }
    });
  }

  async executeHook(hookName: string, payload: any): Promise<any[]> {
    await Hooks.execute(hookName, payload);
    return [];
  }

  // Module-to-Module Direct Communication
  async sendDirectMessage(fromModule: string, toModule: string, message: any): Promise<any> {
    const messageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Store message for potential retry
    await Cache.set(`direct_message:${messageId}`, {
      from: fromModule,
      to: toModule,
      message,
      timestamp: new Date()
    }, 300); // 5 minutes TTL

    // Emit direct message event
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Direct message timeout: ${fromModule} -> ${toModule}`));
      }, 10000); // 10 second timeout

      const responseHandler = (response: any) => {
        clearTimeout(timeout);
        resolve(response);
      };
      this.on(`direct_message_response:${messageId}`, responseHandler);

      this.emitEvent(`direct_message:${toModule}`, {
        messageId,
        from: fromModule,
        message
      });
    });
  }

  respondToDirectMessage(messageId: string, response: any): void {
    this.emitEvent(`direct_message_response:${messageId}`, response);
  }

  // Event system methods
  on(event: string, listener: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
  }

  private emitEvent(event: string, ...args: any[]): void {
    const listeners = this.eventListeners.get(event) || [];
    listeners.forEach(listener => {
      try {
        listener(...args);
      } catch (error) {
        console.error(`Error in event listener for ${event}:`, error);
      }
    });
  }

  // Utility Methods
  private compareVersions(a: string, b: string): number {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);
    
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aPart = aParts[i] || 0;
      const bPart = bParts[i] || 0;
      
      if (aPart > bPart) return 1;
      if (aPart < bPart) return -1;
    }
    
    return 0;
  }

  private async executeWithTimeout<T>(fn: () => Promise<T>, timeout: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Operation timeout'));
      }, timeout);

      fn().then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  // Monitoring & Metrics
  getServiceMetrics(): any {
    return {
      totalServices: this.services.size,
      totalEndpoints: this.apiEndpoints.size,
      totalQueues: this.messageQueues.size,
      circuitBreakers: Array.from(this.circuitBreakers.entries()).map(([name, cb]) => ({
        service: name,
        state: cb.getState(),
        failures: cb.getFailureCount()
      }))
    };
  }
}

// Circuit Breaker Implementation
class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  constructor(private config: { failureThreshold: number; resetTimeout: number }) {}

  recordSuccess(): void {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  isOpen(): boolean {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.config.resetTimeout) {
        this.state = 'HALF_OPEN';
        return false;
      }
      return true;
    }
    return false;
  }

  getState(): string {
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }
}

// Message Queue Implementation
class MessageQueue {
  private queue: Array<{ message: any; priority: number; timestamp: number }> = [];
  private consumers: Array<(message: any) => Promise<void>> = [];
  private processing = false;

  constructor(private name: string, private config: MessageBusConfig) {}

  async enqueue(message: any, priority: number = 0): Promise<void> {
    this.queue.push({
      message,
      priority,
      timestamp: Date.now()
    });

    // Sort by priority (higher priority first)
    this.queue.sort((a, b) => b.priority - a.priority);

    if (this.config.persistence) {
      await Cache.set(`queue:${this.name}`, this.queue, 86400);
    }

    this.processQueue();
  }

  addConsumer(handler: (message: any) => Promise<void>): void {
    this.consumers.push(handler);
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0 || this.consumers.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      
      for (const consumer of this.consumers) {
        try {
          await consumer(item.message);
        } catch (error) {
          console.error(`Error processing message in queue ${this.name}:`, error);
          
          // Retry logic
          if (this.config.maxRetries > 0) {
            setTimeout(() => {
              this.queue.unshift(item);
              this.processQueue();
            }, this.config.retryDelay);
          } else if (this.config.deadLetterQueue) {
            // Move to dead letter queue
            Cache.set(`dlq:${this.name}:${Date.now()}`, item, 86400 * 7); // 7 days
          }
        }
      }
    }

    this.processing = false;
  }
}

// Export singleton instance
export const communicationHub = ModuleCommunicationHub.getInstance();