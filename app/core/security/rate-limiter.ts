import { injectable, inject } from 'inversify';
import { RateLimiterRedis, RateLimiterMemory, IRateLimiterOptions } from 'rate-limiter-flexible';
import type { ILogger } from '../logging';
import { TYPES } from '../container';

export interface RateLimitConfig {
  keyPrefix?: string;
  points: number;
  duration: number;
  blockDuration?: number;
  execEvenly?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  remainingPoints?: number;
  msBeforeNext?: number;
  totalHits?: number;
}

export interface IRateLimiter {
  checkLimit(key: string, config?: Partial<RateLimitConfig>): Promise<RateLimitResult>;
  resetKey(key: string): Promise<void>;
  getStatus(key: string): Promise<{ remainingPoints: number; msBeforeNext: number } | null>;
}

@injectable()
export class RateLimiter implements IRateLimiter {
  private readonly logger: ILogger;
  private readonly limiters: Map<string, RateLimiterRedis | RateLimiterMemory> = new Map();
  private readonly defaultConfig: Required<RateLimitConfig> = {
    keyPrefix: 'rl',
    points: 100,
    duration: 60,
    blockDuration: 60,
    execEvenly: false
  };

  constructor(@inject(TYPES.Logger) logger: ILogger) {
    this.logger = logger.createChild('RateLimiter');
  }

  async checkLimit(key: string, config?: Partial<RateLimitConfig>): Promise<RateLimitResult> {
    const finalConfig = { ...this.defaultConfig, ...config };
    const limiterKey = this.generateLimiterKey(finalConfig);
    
    try {
      const limiter = this.getOrCreateLimiter(limiterKey, finalConfig);
      const result = await limiter.consume(key);
      
      this.logger.debug('Rate limit check passed', {
        metadata: {
          key,
          remainingPoints: result.remainingPoints,
          msBeforeNext: result.msBeforeNext
        }
      });

      return {
        allowed: true,
        remainingPoints: result.remainingPoints,
        msBeforeNext: result.msBeforeNext
      };
    } catch (rateLimiterRes) {
      if (rateLimiterRes instanceof Error) {
        this.logger.error('Rate limiter error', rateLimiterRes, {
          metadata: { key, config: finalConfig }
        });
        
        return { allowed: false };
      }

      const res = rateLimiterRes as any;
      
      this.logger.warn('Rate limit exceeded', {
        metadata: {
          key,
          remainingPoints: res.remainingPoints || 0,
          msBeforeNext: res.msBeforeNext || 0
        }
      });

      return {
        allowed: false,
        remainingPoints: res.remainingPoints || 0,
        msBeforeNext: res.msBeforeNext || 0
      };
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      const promises = Array.from(this.limiters.values()).map(limiter =>
        limiter.delete(key).catch(error =>
          this.logger.warn('Failed to reset key in limiter', { metadata: { key, error } })
        )
      );

      await Promise.allSettled(promises);
      
      this.logger.debug('Rate limit key reset', { metadata: { key } });
    } catch (error) {
      this.logger.error('Failed to reset rate limit key', error as Error, {
        metadata: { key }
      });
      throw new Error('Rate limit key reset failed');
    }
  }

  async getStatus(key: string): Promise<{ remainingPoints: number; msBeforeNext: number } | null> {
    try {
      for (const limiter of this.limiters.values()) {
        try {
          const result = await limiter.get(key);
          if (result) {
            return {
              remainingPoints: result.remainingPoints || 0,
              msBeforeNext: result.msBeforeNext || 0
            };
          }
        } catch (error) {
          continue;
        }
      }
      
      return null;
    } catch (error) {
      this.logger.error('Failed to get rate limit status', error as Error, {
        metadata: { key }
      });
      return null;
    }
  }

  private getOrCreateLimiter(limiterKey: string, config: Required<RateLimitConfig>): RateLimiterRedis | RateLimiterMemory {
    if (this.limiters.has(limiterKey)) {
      return this.limiters.get(limiterKey)!;
    }

    const options: IRateLimiterOptions = {
      keyPrefix: config.keyPrefix,
      points: config.points,
      duration: config.duration,
      blockDuration: config.blockDuration,
      execEvenly: config.execEvenly
    };

    let limiter: RateLimiterRedis | RateLimiterMemory;

    if (this.isRedisAvailable()) {
      limiter = new RateLimiterRedis({
        ...options,
        storeClient: this.getRedisClient()
      });
      
      this.logger.debug('Created Redis rate limiter', {
        metadata: { limiterKey, config }
      });
    } else {
      limiter = new RateLimiterMemory(options);
      
      this.logger.debug('Created memory rate limiter', {
        metadata: { limiterKey, config }
      });
    }

    this.limiters.set(limiterKey, limiter);
    return limiter;
  }

  private generateLimiterKey(config: Required<RateLimitConfig>): string {
    return `${config.keyPrefix}_${config.points}_${config.duration}_${config.blockDuration}`;
  }

  private isRedisAvailable(): boolean {
    return process.env.REDIS_HOST !== undefined;
  }

  private getRedisClient(): any {
    return null;
  }
}