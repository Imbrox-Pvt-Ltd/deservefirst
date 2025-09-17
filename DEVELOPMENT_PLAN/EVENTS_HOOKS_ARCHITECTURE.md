# Events & Hooks Architecture

## 🎯 Overview
Events and Hooks are the **backbone of our modular architecture**, enabling loose coupling, extensibility, and real-time communication between modules.

## 🔄 **Events System**

### **1. Event Types**
```typescript
// Core Platform Events
export const CoreEvents = {
  // Tenant Events
  TENANT_CREATED: 'core.tenant.created',
  TENANT_UPDATED: 'core.tenant.updated',
  TENANT_SUSPENDED: 'core.tenant.suspended',
  
  // User Events
  USER_REGISTERED: 'core.user.registered',
  USER_LOGIN: 'core.user.login',
  USER_LOGOUT: 'core.user.logout',
  
  // Module Events
  MODULE_LOADED: 'core.module.loaded',
  MODULE_UNLOADED: 'core.module.unloaded',
  
  // System Events
  SYSTEM_STARTED: 'core.system.started',
  SYSTEM_STOPPED: 'core.system.stopped',
} as const;

// CMS Module Events
export const CMSEvents = {
  PAGE_CREATED: 'cms.page.created',
  PAGE_UPDATED: 'cms.page.updated',
  PAGE_DELETED: 'cms.page.deleted',
  BLOCK_CREATED: 'cms.block.created',
  CUSTOM_FIELD_ADDED: 'cms.custom_field.added',
} as const;

// E-commerce Events
export const EcommerceEvents = {
  PRODUCT_CREATED: 'ecommerce.product.created',
  ORDER_CREATED: 'ecommerce.order.created',
  PAYMENT_PROCESSED: 'ecommerce.payment.processed',
  CART_UPDATED: 'ecommerce.cart.updated',
} as const;
```

### **2. Event System Implementation**
```typescript
// src/core/events/event-system.service.ts
@Injectable()
export class EventSystemService {
  private eventBus = new EventBus();
  private eventStore = new EventStore();
  private eventReplay = new EventReplay();

  async dispatch(event: string, payload: any, options?: EventOptions) {
    // 1. Validate event
    await this.validateEvent(event, payload);
    
    // 2. Execute hooks
    await this.executeHooks('before_event', event, payload);
    
    // 3. Store event
    await this.eventStore.store(event, payload, options);
    
    // 4. Publish event
    await this.eventBus.publish(event, payload);
    
    // 5. Execute hooks
    await this.executeHooks('after_event', event, payload);
  }

  async subscribe(event: string, handler: EventHandler, options?: SubscriptionOptions) {
    return this.eventBus.subscribe(event, handler, options);
  }

  async replayEvents(tenantId: string, fromDate: Date) {
    return this.eventReplay.replay(tenantId, fromDate);
  }
}
```

### **3. Event-Driven Module Communication**
```typescript
// Example: CMS Module listening to User Events
export class CMSModule {
  constructor(private eventSystem: EventSystemService) {
    // Listen to user events
    this.eventSystem.subscribe(CoreEvents.USER_LOGIN, this.onUserLogin.bind(this));
    this.eventSystem.subscribe(CoreEvents.USER_LOGOUT, this.onUserLogout.bind(this));
  }

  private async onUserLogin(event: UserLoginEvent) {
    // Update user's last seen pages
    await this.updateUserActivity(event.userId, 'login');
  }

  private async onUserLogout(event: UserLogoutEvent) {
    // Clear user's session data
    await this.clearUserSession(event.userId);
  }
}
```

## 🪝 **Hooks System**

### **1. Hook Types**
```typescript
// Core Platform Hooks
export const CoreHooks = {
  // System Hooks
  BEFORE_SYSTEM_START: 'core.before.system.start',
  AFTER_SYSTEM_START: 'core.after.system.start',
  BEFORE_SYSTEM_STOP: 'core.before.system.stop',
  
  // Module Hooks
  BEFORE_MODULE_LOAD: 'core.before.module.load',
  AFTER_MODULE_LOAD: 'core.after.module.load',
  BEFORE_MODULE_UNLOAD: 'core.before.module.unload',
  
  // Request Hooks
  BEFORE_REQUEST: 'core.before.request',
  AFTER_REQUEST: 'core.after.request',
  ON_REQUEST_ERROR: 'core.on.request.error',
} as const;

// CMS Module Hooks
export const CMSHooks = {
  BEFORE_PAGE_CREATE: 'cms.before.page.create',
  AFTER_PAGE_CREATE: 'cms.after.page.create',
  BEFORE_PAGE_UPDATE: 'cms.before.page.update',
  AFTER_PAGE_UPDATE: 'cms.after.page.update',
  BEFORE_PAGE_DELETE: 'cms.before.page.delete',
  AFTER_PAGE_DELETE: 'cms.after.page.delete',
} as const;

// E-commerce Hooks
export const EcommerceHooks = {
  BEFORE_ORDER_CREATE: 'ecommerce.before.order.create',
  AFTER_ORDER_CREATE: 'ecommerce.after.order.create',
  BEFORE_PAYMENT_PROCESS: 'ecommerce.before.payment.process',
  AFTER_PAYMENT_PROCESS: 'ecommerce.after.payment.process',
} as const;
```

### **2. Hook System Implementation**
```typescript
// src/core/hooks/hook-system.service.ts
@Injectable()
export class HookSystemService {
  private hooks = new Map<string, HookHandler[]>();
  private hookPriorities = new Map<string, number>();

  async register(hook: string, handler: HookHandler, priority: number = 10) {
    if (!this.hooks.has(hook)) {
      this.hooks.set(hook, []);
    }
    
    this.hooks.get(hook)!.push(handler);
    this.hookPriorities.set(`${hook}_${handler.name}`, priority);
    
    // Sort by priority
    this.hooks.get(hook)!.sort((a, b) => 
      this.hookPriorities.get(`${hook}_${b.name}`) - 
      this.hookPriorities.get(`${hook}_${a.name}`)
    );
  }

  async execute(hook: string, context: any): Promise<any> {
    const handlers = this.hooks.get(hook) || [];
    let result = context;

    for (const handler of handlers) {
      try {
        result = await handler(result);
        
        // Stop execution if handler returns false
        if (result === false) {
          break;
        }
      } catch (error) {
        console.error(`Hook ${hook} failed:`, error);
        // Continue with other handlers
      }
    }

    return result;
  }

  async executeAsync(hook: string, context: any): Promise<void> {
    const handlers = this.hooks.get(hook) || [];
    
    // Execute all handlers in parallel
    await Promise.allSettled(
      handlers.map(handler => handler(context))
    );
  }
}
```

### **3. Hook-Driven Module Extension**
```typescript
// Example: Store-specific CMS customization
export class StoreCustomCMSModule {
  constructor(private hookSystem: HookSystemService) {
    this.registerHooks();
  }

  private registerHooks() {
    // Add custom validation before page creation
    this.hookSystem.register(
      CMSHooks.BEFORE_PAGE_CREATE, 
      this.validateCustomFields.bind(this),
      5 // High priority
    );

    // Add custom data after page creation
    this.hookSystem.register(
      CMSHooks.AFTER_PAGE_CREATE,
      this.addCustomData.bind(this),
      10 // Normal priority
    );
  }

  private async validateCustomFields(context: any) {
    const { data, tenantId, storeId } = context;
    
    // Custom validation for this store
    if (storeId === 'store1' && !data.customFields?.bannerImage) {
      throw new Error('Banner image required for this store');
    }
    
    return context;
  }

  private async addCustomData(context: any) {
    const { page, tenantId, storeId } = context;
    
    // Add store-specific data
    await this.addStoreSpecificData(page._id, storeId);
    
    return context;
  }
}
```

## 🔄 **Event-Hook Integration**

### **1. Event Triggers Hooks**
```typescript
// When an event is dispatched, it can trigger hooks
export class EventHookIntegration {
  async dispatchWithHooks(event: string, payload: any) {
    // Execute before hooks
    await this.hookSystem.execute(`before_${event}`, payload);
    
    // Dispatch event
    await this.eventSystem.dispatch(event, payload);
    
    // Execute after hooks
    await this.hookSystem.execute(`after_${event}`, payload);
  }
}
```

### **2. Hooks Can Dispatch Events**
```typescript
// Hooks can dispatch new events
export class PageService {
  async createPage(data: any, tenantId: string) {
    // Execute before hooks
    const validatedData = await this.hookSystem.execute(
      CMSHooks.BEFORE_PAGE_CREATE, 
      { data, tenantId }
    );
    
    // Create page
    const page = await this.database.create(PageModel, validatedData.data);
    
    // Dispatch event
    await this.eventSystem.dispatch(CMSEvents.PAGE_CREATED, { page, tenantId });
    
    // Execute after hooks
    await this.hookSystem.execute(
      CMSHooks.AFTER_PAGE_CREATE, 
      { page, tenantId }
    );
    
    return page;
  }
}
```

## 🏗️ **Module Integration Examples**

### **1. CMS Module with Events & Hooks**
```typescript
// packages/deservefirst/cms-module/src/index.ts
export default class CMSModule {
  static register() {
    ModuleRegistry.registerModule({
      name: 'CMSModule',
      services: { PageService, BlockService },
      events: CMSEvents,
      hooks: CMSHooks,
      // ... other config
    });
  }
}

// packages/deservefirst/cms-module/src/services/PageService.ts
export class PageService {
  async createPage(data: any, tenantId: string) {
    // Execute before hooks
    await Hooks.execute(CMSHooks.BEFORE_PAGE_CREATE, { data, tenantId });
    
    const page = await Database.create(PageModel, { ...data, tenantId });
    
    // Dispatch event
    await Events.dispatch(CMSEvents.PAGE_CREATED, { page, tenantId });
    
    // Execute after hooks
    await Hooks.execute(CMSHooks.AFTER_PAGE_CREATE, { page, tenantId });
    
    return page;
  }
}
```

### **2. E-commerce Module Integration**
```typescript
// packages/deservefirst/catalog-module/src/services/ProductService.ts
export class ProductService {
  async createProduct(data: any, tenantId: string) {
    // Execute before hooks
    await Hooks.execute(EcommerceHooks.BEFORE_PRODUCT_CREATE, { data, tenantId });
    
    const product = await Database.create(ProductModel, { ...data, tenantId });
    
    // Dispatch event
    await Events.dispatch(EcommerceEvents.PRODUCT_CREATED, { product, tenantId });
    
    // Execute after hooks
    await Hooks.execute(EcommerceHooks.AFTER_PRODUCT_CREATE, { product, tenantId });
    
    return product;
  }
}
```

## 📊 **Performance Optimizations**

### **1. Event Batching**
```typescript
// Batch multiple events for better performance
export class EventBatcher {
  private eventQueue: Event[] = [];
  private batchSize = 100;
  private batchTimeout = 1000; // 1 second

  async addEvent(event: string, payload: any) {
    this.eventQueue.push({ event, payload, timestamp: Date.now() });
    
    if (this.eventQueue.length >= this.batchSize) {
      await this.flush();
    }
  }

  async flush() {
    if (this.eventQueue.length === 0) return;
    
    const events = this.eventQueue.splice(0, this.batchSize);
    await this.eventSystem.dispatchBatch(events);
  }
}
```

### **2. Hook Caching**
```typescript
// Cache hook results for better performance
export class HookCache {
  private cache = new Map<string, any>();

  async executeWithCache(hook: string, context: any) {
    const cacheKey = this.generateCacheKey(hook, context);
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    const result = await this.hookSystem.execute(hook, context);
    this.cache.set(cacheKey, result);
    
    return result;
  }
}
```

## 🎯 **Benefits of Events & Hooks**

### **1. Loose Coupling**
- Modules don't need to know about each other
- Easy to add/remove modules
- No circular dependencies

### **2. Extensibility**
- Store owners can add custom hooks
- Third-party modules can extend functionality
- Easy to customize behavior

### **3. Real-time Communication**
- Events enable real-time updates
- WebSocket integration
- Live notifications

### **4. Debugging & Monitoring**
- Event logging for debugging
- Hook execution tracking
- Performance monitoring

## ✅ **Answer: Yes, Events & Hooks are Central**

**Events and Hooks are not just considered - they're the FOUNDATION of our architecture:**

1. **Every module** includes events and hooks
2. **Module communication** happens through events
3. **Customization** happens through hooks
4. **Real-time features** powered by events
5. **Performance optimized** with batching and caching

This makes our platform **more flexible than Magento** and **more powerful than Shopify** because store owners can customize behavior without touching core code.
