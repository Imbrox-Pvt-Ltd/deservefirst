import { Injectable, Logger, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import { SecurityConfig } from './security.config';

export interface User {
  id: string;
  email: string;
  password?: string;
  mfaEnabled: boolean;
  mfaSecret?: string;
  backupCodes?: string[];
  lastLoginAt?: Date;
  failedLoginAttempts: number;
  lockedUntil?: Date;
  passwordChangedAt: Date;
  passwordHistory: string[];
  roles: string[];
  permissions: string[];
  tenantId?: string;
}

export interface LoginAttempt {
  id: string;
  userId: string;
  email: string;
  ipAddress: string;
  userAgent: string;
  success: boolean;
  failureReason?: string;
  timestamp: Date;
  location?: {
    country: string;
    city: string;
    region: string;
  };
}

export interface SecurityEvent {
  id: string;
  type: 'login' | 'logout' | 'password_change' | 'mfa_enabled' | 'mfa_disabled' | 'account_locked' | 'suspicious_activity';
  userId: string;
  ipAddress: string;
  userAgent: string;
  details: Record<string, any>;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);
  private securityConfig: SecurityConfig;
  private loginAttempts = new Map<string, LoginAttempt[]>();
  private securityEvents: SecurityEvent[] = [];

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    this.securityConfig = this.configService.get<SecurityConfig>('security') || require('./security.config').defaultSecurityConfig;
  }

  /**
   * Hash password with salt
   */
  async hashPassword(password: string): Promise<string> {
    const saltRounds = this.securityConfig.encryption.saltRounds;
    return bcrypt.hash(password, saltRounds);
  }

  /**
   * Verify password against hash
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Validate password strength
   */
  validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const config = this.securityConfig.password;

    if (password.length < config.minLength) {
      errors.push(`Password must be at least ${config.minLength} characters long`);
    }

    if (config.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (config.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (config.requireNumbers && !/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    if (config.requireSpecialChars && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if password was recently used
   */
  async isPasswordRecentlyUsed(password: string, passwordHistory: string[]): Promise<boolean> {
    for (const oldHash of passwordHistory.slice(0, this.securityConfig.password.historyCount)) {
      if (await this.verifyPassword(password, oldHash)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Generate JWT token
   */
  generateToken(payload: any): string {
    return this.jwtService.sign(payload, {
      secret: this.securityConfig.jwt.secret,
      expiresIn: this.securityConfig.jwt.expiresIn,
      issuer: this.securityConfig.jwt.issuer,
      audience: this.securityConfig.jwt.audience,
    });
  }

  /**
   * Generate refresh token
   */
  generateRefreshToken(payload: any): string {
    return this.jwtService.sign(payload, {
      secret: this.securityConfig.jwt.refreshSecret,
      expiresIn: this.securityConfig.jwt.refreshExpiresIn,
    });
  }

  /**
   * Verify JWT token
   */
  verifyToken(token: string): any {
    try {
      return this.jwtService.verify(token, {
        secret: this.securityConfig.jwt.secret,
        issuer: this.securityConfig.jwt.issuer,
        audience: this.securityConfig.jwt.audience,
      });
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  /**
   * Verify refresh token
   */
  verifyRefreshToken(token: string): any {
    try {
      return this.jwtService.verify(token, {
        secret: this.securityConfig.jwt.refreshSecret,
      });
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  /**
   * Generate MFA secret
   */
  generateMFASecret(user: User): string {
    return speakeasy.generateSecret({
      name: `${user.email}`,
      issuer: this.securityConfig.mfa.totpIssuer,
      length: 32,
    }).base32;
  }

  /**
   * Generate MFA QR code
   */
  async generateMFAQRCode(secret: string, user: User): Promise<string> {
    const otpauthUrl = speakeasy.otpauthURL({
      secret,
      label: user.email,
      issuer: this.securityConfig.mfa.totpIssuer,
    });

    return QRCode.toDataURL(otpauthUrl);
  }

  /**
   * Verify MFA token
   */
  verifyMFAToken(token: string, secret: string): boolean {
    return speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window: 2, // Allow 2 time steps (60 seconds) of tolerance
    });
  }

  /**
   * Generate backup codes
   */
  generateBackupCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < this.securityConfig.mfa.backupCodesCount; i++) {
      codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
    }
    return codes;
  }

  /**
   * Verify backup code
   */
  verifyBackupCode(code: string, backupCodes: string[]): boolean {
    const index = backupCodes.indexOf(code);
    if (index !== -1) {
      backupCodes.splice(index, 1); // Remove used code
      return true;
    }
    return false;
  }

  /**
   * Check if account is locked
   */
  isAccountLocked(user: User): boolean {
    if (!user.lockedUntil) return false;
    return new Date() < user.lockedUntil;
  }

  /**
   * Record failed login attempt
   */
  recordFailedLoginAttempt(userId: string, email: string, ipAddress: string, userAgent: string, reason: string): void {
    const attempt: LoginAttempt = {
      id: crypto.randomUUID(),
      userId,
      email,
      ipAddress,
      userAgent,
      success: false,
      failureReason: reason,
      timestamp: new Date(),
    };

    if (!this.loginAttempts.has(userId)) {
      this.loginAttempts.set(userId, []);
    }
    this.loginAttempts.get(userId)!.push(attempt);

    // Log security event
    this.logSecurityEvent({
      type: 'login',
      userId,
      ipAddress,
      userAgent,
      details: { success: false, reason },
      severity: 'medium',
    });
  }

  /**
   * Record successful login attempt
   */
  recordSuccessfulLoginAttempt(userId: string, email: string, ipAddress: string, userAgent: string): void {
    const attempt: LoginAttempt = {
      id: crypto.randomUUID(),
      userId,
      email,
      ipAddress,
      userAgent,
      success: true,
      timestamp: new Date(),
    };

    if (!this.loginAttempts.has(userId)) {
      this.loginAttempts.set(userId, []);
    }
    this.loginAttempts.get(userId)!.push(attempt);

    // Log security event
    this.logSecurityEvent({
      type: 'login',
      userId,
      ipAddress,
      userAgent,
      details: { success: true },
      severity: 'low',
    });
  }

  /**
   * Check brute force protection
   */
  checkBruteForceProtection(userId: string, ipAddress: string): { allowed: boolean; lockoutDuration?: number } {
    if (!this.securityConfig.bruteForce.enabled) {
      return { allowed: true };
    }

    const attempts = this.loginAttempts.get(userId) || [];
    const recentAttempts = attempts.filter(
      attempt => Date.now() - attempt.timestamp.getTime() < this.securityConfig.bruteForce.resetAttemptsAfter
    );

    const failedAttempts = recentAttempts.filter(attempt => !attempt.success);

    if (failedAttempts.length >= this.securityConfig.bruteForce.maxAttempts) {
      const lockoutDuration = this.securityConfig.bruteForce.lockoutDuration;
      
      this.logSecurityEvent({
        type: 'account_locked',
        userId,
        ipAddress,
        userAgent: '',
        details: { 
          reason: 'brute_force_protection',
          failedAttempts: failedAttempts.length,
          lockoutDuration 
        },
        severity: 'high',
      });

      return { 
        allowed: false, 
        lockoutDuration 
      };
    }

    return { allowed: true };
  }

  /**
   * Encrypt sensitive data
   */
  encryptSensitiveData(data: string): string {
    const algorithm = this.securityConfig.encryption.algorithm;
    const key = crypto.scryptSync(this.securityConfig.jwt.secret, 'salt', this.securityConfig.encryption.keyLength);
    const iv = crypto.randomBytes(this.securityConfig.encryption.ivLength);
    const cipher = crypto.createCipher(algorithm, key);
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt sensitive data
   */
  decryptSensitiveData(encryptedData: string): string {
    const algorithm = this.securityConfig.encryption.algorithm;
    const key = crypto.scryptSync(this.securityConfig.jwt.secret, 'salt', this.securityConfig.encryption.keyLength);
    const [ivHex, encrypted] = encryptedData.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipher(algorithm, key);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Generate API key
   */
  generateApiKey(): string {
    return crypto.randomBytes(this.securityConfig.api.apiKeyLength).toString('hex');
  }

  /**
   * Generate request ID
   */
  generateRequestId(): string {
    return crypto.randomUUID();
  }

  /**
   * Log security event
   */
  logSecurityEvent(event: Omit<SecurityEvent, 'id' | 'timestamp'>): void {
    const securityEvent: SecurityEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      ...event,
    };

    this.securityEvents.push(securityEvent);

    // Log to console based on severity
    const logMessage = `Security Event [${event.severity.toUpperCase()}]: ${event.type} - User: ${event.userId} - IP: ${event.ipAddress}`;
    
    switch (event.severity) {
      case 'critical':
        this.logger.error(logMessage, event.details);
        break;
      case 'high':
        this.logger.warn(logMessage, event.details);
        break;
      case 'medium':
        this.logger.log(logMessage, event.details);
        break;
      case 'low':
        this.logger.debug(logMessage, event.details);
        break;
    }
  }

  /**
   * Get security events
   */
  getSecurityEvents(limit: number = 100, severity?: string): SecurityEvent[] {
    let events = this.securityEvents;
    
    if (severity) {
      events = events.filter(event => event.severity === severity);
    }
    
    return events
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Get login attempts for user
   */
  getLoginAttempts(userId: string, limit: number = 50): LoginAttempt[] {
    const attempts = this.loginAttempts.get(userId) || [];
    return attempts
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Clean up old security data
   */
  cleanupOldData(): void {
    const retentionDays = this.securityConfig.audit.retentionDays;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    // Clean up old security events
    this.securityEvents = this.securityEvents.filter(event => event.timestamp > cutoffDate);

    // Clean up old login attempts
    for (const [userId, attempts] of this.loginAttempts.entries()) {
      const recentAttempts = attempts.filter(attempt => attempt.timestamp > cutoffDate);
      if (recentAttempts.length === 0) {
        this.loginAttempts.delete(userId);
      } else {
        this.loginAttempts.set(userId, recentAttempts);
      }
    }

    this.logger.log(`Cleaned up security data older than ${retentionDays} days`);
  }

  /**
   * Get security statistics
   */
  getSecurityStats(): {
    totalEvents: number;
    eventsBySeverity: Record<string, number>;
    totalLoginAttempts: number;
    failedLoginAttempts: number;
    successfulLoginAttempts: number;
    lockedAccounts: number;
  } {
    const events = this.securityEvents;
    const allAttempts = Array.from(this.loginAttempts.values()).flat();

    const eventsBySeverity = events.reduce((acc, event) => {
      acc[event.severity] = (acc[event.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalEvents: events.length,
      eventsBySeverity,
      totalLoginAttempts: allAttempts.length,
      failedLoginAttempts: allAttempts.filter(attempt => !attempt.success).length,
      successfulLoginAttempts: allAttempts.filter(attempt => attempt.success).length,
      lockedAccounts: 0, // This would need to be tracked in the database
    };
  }
}
