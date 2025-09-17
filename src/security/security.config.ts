export interface SecurityConfig {
  // Authentication & Authorization
  jwt: {
    secret: string;
    expiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
    issuer: string;
    audience: string;
  };
  
  // Password Security
  password: {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSpecialChars: boolean;
    maxAge: number; // days
    historyCount: number; // prevent reuse of last N passwords
  };
  
  // Session Management
  session: {
    maxAge: number; // milliseconds
    secure: boolean;
    httpOnly: boolean;
    sameSite: 'strict' | 'lax' | 'none';
    rolling: boolean;
  };
  
  // Rate Limiting
  rateLimit: {
    windowMs: number;
    maxRequests: number;
    skipSuccessfulRequests: boolean;
    skipFailedRequests: boolean;
  };
  
  // CORS Configuration
  cors: {
    origin: string[];
    credentials: boolean;
    methods: string[];
    allowedHeaders: string[];
    exposedHeaders: string[];
  };
  
  // Content Security Policy
  csp: {
    enabled: boolean;
    directives: {
      defaultSrc: string[];
      scriptSrc: string[];
      styleSrc: string[];
      imgSrc: string[];
      connectSrc: string[];
      fontSrc: string[];
      objectSrc: string[];
      mediaSrc: string[];
      frameSrc: string[];
      workerSrc: string[];
      childSrc: string[];
      formAction: string[];
      frameAncestors: string[];
      baseUri: string[];
      manifestSrc: string[];
      upgradeInsecureRequests: boolean;
      blockAllMixedContent: boolean;
    };
  };
  
  // Security Headers
  headers: {
    hsts: {
      enabled: boolean;
      maxAge: number;
      includeSubDomains: boolean;
      preload: boolean;
    };
    xssProtection: boolean;
    noSniff: boolean;
    referrerPolicy: 'no-referrer' | 'no-referrer-when-downgrade' | 'origin' | 'origin-when-cross-origin' | 'same-origin' | 'strict-origin' | 'strict-origin-when-cross-origin' | 'unsafe-url';
    contentTypeOptions: boolean;
    frameOptions: 'DENY' | 'SAMEORIGIN' | 'ALLOW-FROM';
    permissionsPolicy: {
      camera: string[];
      microphone: string[];
      geolocation: string[];
      payment: string[];
      usb: string[];
      magnetometer: string[];
      gyroscope: string[];
      accelerometer: string[];
    };
  };
  
  // Encryption
  encryption: {
    algorithm: string;
    keyLength: number;
    ivLength: number;
    saltRounds: number;
  };
  
  // Audit & Logging
  audit: {
    enabled: boolean;
    logLevel: 'error' | 'warn' | 'info' | 'debug';
    logFailedAttempts: boolean;
    logSuccessfulAttempts: boolean;
    logSensitiveData: boolean;
    retentionDays: number;
  };
  
  // Multi-Factor Authentication
  mfa: {
    enabled: boolean;
    methods: ('totp' | 'sms' | 'email' | 'backup-codes')[];
    requiredForAdmin: boolean;
    backupCodesCount: number;
    totpIssuer: string;
  };
  
  // API Security
  api: {
    versioning: boolean;
    apiKeyRequired: boolean;
    apiKeyHeader: string;
    apiKeyLength: number;
    requestIdHeader: string;
    maxRequestSize: number; // bytes
    timeout: number; // milliseconds
  };
  
  // Database Security
  database: {
    encryptSensitiveData: boolean;
    encryptAtRest: boolean;
    auditQueries: boolean;
    queryTimeout: number;
    connectionLimit: number;
  };
  
  // File Upload Security
  fileUpload: {
    maxFileSize: number; // bytes
    allowedTypes: string[];
    scanForMalware: boolean;
    quarantineSuspicious: boolean;
    virusScanEndpoint: string;
  };
  
  // IP Whitelisting/Blacklisting
  ipFiltering: {
    enabled: boolean;
    whitelist: string[];
    blacklist: string[];
    allowPrivateIPs: boolean;
    allowLocalhost: boolean;
  };
  
  // Brute Force Protection
  bruteForce: {
    enabled: boolean;
    maxAttempts: number;
    lockoutDuration: number; // milliseconds
    resetAttemptsAfter: number; // milliseconds
    notifyOnLockout: boolean;
  };
  
  // Data Anonymization
  dataAnonymization: {
    enabled: boolean;
    anonymizeAfterDays: number;
    fieldsToAnonymize: string[];
    anonymizationMethod: 'hash' | 'mask' | 'replace';
  };
}

export const defaultSecurityConfig: SecurityConfig = {
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
    expiresIn: '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'your-super-secret-refresh-key-change-in-production',
    refreshExpiresIn: '7d',
    issuer: 'deservefirst-platform',
    audience: 'deservefirst-users',
  },
  
  password: {
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    maxAge: 90, // days
    historyCount: 5,
  },
  
  session: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',
    rolling: true,
  },
  
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 100,
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
  },
  
  cors: {
    origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:3001'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID', 'X-Rate-Limit-Remaining', 'X-Rate-Limit-Reset'],
  },
  
  csp: {
    enabled: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      connectSrc: ["'self'", 'https://api.deservefirst.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      workerSrc: ["'self'", 'blob:'],
      childSrc: ["'self'", 'blob:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      manifestSrc: ["'self'"],
      upgradeInsecureRequests: true,
      blockAllMixedContent: true,
    },
  },
  
  headers: {
    hsts: {
      enabled: process.env.NODE_ENV === 'production',
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
    xssProtection: true,
    noSniff: true,
    referrerPolicy: 'strict-origin-when-cross-origin',
    contentTypeOptions: true,
    frameOptions: 'DENY',
    permissionsPolicy: {
      camera: [],
      microphone: [],
      geolocation: [],
      payment: [],
      usb: [],
      magnetometer: [],
      gyroscope: [],
      accelerometer: [],
    },
  },
  
  encryption: {
    algorithm: 'aes-256-gcm',
    keyLength: 32,
    ivLength: 16,
    saltRounds: 12,
  },
  
  audit: {
    enabled: true,
    logLevel: 'info',
    logFailedAttempts: true,
    logSuccessfulAttempts: false,
    logSensitiveData: false,
    retentionDays: 90,
  },
  
  mfa: {
    enabled: true,
    methods: ['totp', 'backup-codes'],
    requiredForAdmin: true,
    backupCodesCount: 10,
    totpIssuer: 'Deservefirst Platform',
  },
  
  api: {
    versioning: true,
    apiKeyRequired: false,
    apiKeyHeader: 'X-API-Key',
    apiKeyLength: 32,
    requestIdHeader: 'X-Request-ID',
    maxRequestSize: 10 * 1024 * 1024, // 10MB
    timeout: 30000, // 30 seconds
  },
  
  database: {
    encryptSensitiveData: true,
    encryptAtRest: false, // handled by database
    auditQueries: true,
    queryTimeout: 30000,
    connectionLimit: 100,
  },
  
  fileUpload: {
    maxFileSize: 5 * 1024 * 1024, // 5MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'],
    scanForMalware: true,
    quarantineSuspicious: true,
    virusScanEndpoint: process.env.VIRUS_SCAN_ENDPOINT || '',
  },
  
  ipFiltering: {
    enabled: false,
    whitelist: [],
    blacklist: [],
    allowPrivateIPs: true,
    allowLocalhost: true,
  },
  
  bruteForce: {
    enabled: true,
    maxAttempts: 5,
    lockoutDuration: 15 * 60 * 1000, // 15 minutes
    resetAttemptsAfter: 60 * 60 * 1000, // 1 hour
    notifyOnLockout: true,
  },
  
  dataAnonymization: {
    enabled: true,
    anonymizeAfterDays: 365, // 1 year
    fieldsToAnonymize: ['email', 'phone', 'address'],
    anonymizationMethod: 'hash',
  },
};
