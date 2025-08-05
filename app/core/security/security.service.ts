import { injectable, inject } from 'inversify';
import type { ILogger } from '../logging';
import { TYPES } from '../container';
import { type ICryptoService, EncryptionResult } from './crypto.service';
import { type IRateLimiter, RateLimitConfig, RateLimitResult } from './rate-limiter';

export interface SecurityContext {
  userId?: string;
  apiKey?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export interface AuthenticationResult {
  success: boolean;
  userId?: string;
  error?: string;
  rateLimitInfo?: RateLimitResult;
}

export interface ISecurityService {
  authenticateApiKey(apiKey: string, hashedKey: EncryptionResult, context: SecurityContext): Promise<AuthenticationResult>;
  checkRateLimit(context: SecurityContext, config?: Partial<RateLimitConfig>): Promise<RateLimitResult>;
  hashApiKey(apiKey: string): Promise<EncryptionResult>;
  generateSecureApiKey(): string;
  validateRequestSignature(data: string, signature: string, secret: string): boolean;
  createRequestSignature(data: string, secret: string): string;
}

@injectable()
export class SecurityService implements ISecurityService {
  private readonly logger: ILogger;
  private readonly cryptoService: ICryptoService;
  private readonly rateLimiter: IRateLimiter;

  constructor(
    @inject(TYPES.Logger) logger: ILogger,
    @inject(TYPES.CryptoService) cryptoService: ICryptoService,
    @inject(TYPES.RateLimiter) rateLimiter: IRateLimiter
  ) {
    this.logger = logger.createChild('SecurityService');
    this.cryptoService = cryptoService;
    this.rateLimiter = rateLimiter;
  }

  async authenticateApiKey(
    apiKey: string, 
    hashedKey: EncryptionResult, 
    context: SecurityContext
  ): Promise<AuthenticationResult> {
    const startTime = Date.now();
    
    try {
      const rateLimitKey = this.generateRateLimitKey(context);
      const rateLimitResult = await this.rateLimiter.checkLimit(rateLimitKey, {
        points: 1000,
        duration: 3600,
        blockDuration: 3600
      });

      if (!rateLimitResult.allowed) {
        this.logger.warn('API key authentication blocked by rate limit', {
          metadata: {
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            remainingPoints: rateLimitResult.remainingPoints,
            msBeforeNext: rateLimitResult.msBeforeNext
          }
        });

        return {
          success: false,
          error: 'Rate limit exceeded',
          rateLimitInfo: rateLimitResult
        };
      }

      const isValid = await this.cryptoService.verifyApiKey(apiKey, hashedKey);
      const duration = Date.now() - startTime;

      if (isValid) {
        this.logger.info('API key authentication successful', {
          operation: 'api_key_auth',
          duration,
          metadata: {
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent
          }
        });

        return {
          success: true,
          userId: context.userId,
          rateLimitInfo: rateLimitResult
        };
      } else {
        this.logger.warn('API key authentication failed', {
          operation: 'api_key_auth_failed',
          duration,
          metadata: {
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent
          }
        });

        return {
          success: false,
          error: 'Invalid API key',
          rateLimitInfo: rateLimitResult
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.logger.error('API key authentication error', error as Error, {
        operation: 'api_key_auth_error',
        duration,
        metadata: {
          requestId: context.requestId,
          ipAddress: context.ipAddress
        }
      });

      return {
        success: false,
        error: 'Authentication service error'
      };
    }
  }

  async checkRateLimit(context: SecurityContext, config?: Partial<RateLimitConfig>): Promise<RateLimitResult> {
    try {
      const rateLimitKey = this.generateRateLimitKey(context);
      const result = await this.rateLimiter.checkLimit(rateLimitKey, config);
      
      this.logger.debug('Rate limit check completed', {
        metadata: {
          requestId: context.requestId,
          key: rateLimitKey,
          allowed: result.allowed,
          remainingPoints: result.remainingPoints
        }
      });

      return result;
    } catch (error) {
      this.logger.error('Rate limit check failed', error as Error, {
        metadata: {
          requestId: context.requestId,
          ipAddress: context.ipAddress
        }
      });

      return { allowed: true };
    }
  }

  async hashApiKey(apiKey: string): Promise<EncryptionResult> {
    try {
      const result = await this.cryptoService.hashApiKey(apiKey);
      
      this.logger.debug('API key hashed successfully');
      
      return result;
    } catch (error) {
      this.logger.error('Failed to hash API key', error as Error);
      throw new Error('API key hashing failed');
    }
  }

  generateSecureApiKey(): string {
    try {
      const prefix = 'sk';
      const randomPart = this.cryptoService.generateSecureToken(32);
      const apiKey = `${prefix}-${randomPart}`;
      
      this.logger.debug('Secure API key generated', {
        metadata: { keyLength: apiKey.length }
      });

      return apiKey;
    } catch (error) {
      this.logger.error('Failed to generate secure API key', error as Error);
      throw new Error('API key generation failed');
    }
  }

  validateRequestSignature(data: string, signature: string, secret: string): boolean {
    try {
      const isValid = this.cryptoService.verifyHmacSignature(data, signature, secret);
      
      this.logger.debug('Request signature validation completed', {
        metadata: { isValid }
      });

      return isValid;
    } catch (error) {
      this.logger.error('Request signature validation failed', error as Error);
      return false;
    }
  }

  createRequestSignature(data: string, secret: string): string {
    try {
      const signature = this.cryptoService.createHmacSignature(data, secret);
      
      this.logger.debug('Request signature created');
      
      return signature;
    } catch (error) {
      this.logger.error('Failed to create request signature', error as Error);
      throw new Error('Signature creation failed');
    }
  }

  private generateRateLimitKey(context: SecurityContext): string {
    const parts = [];
    
    if (context.userId) {
      parts.push(`user:${context.userId}`);
    }
    
    if (context.ipAddress) {
      parts.push(`ip:${context.ipAddress}`);
    }
    
    if (context.apiKey) {
      const keyHash = context.apiKey.substring(0, 8);
      parts.push(`key:${keyHash}`);
    }

    return parts.join('|') || 'anonymous';
  }
}