import { injectable, inject } from 'inversify';
import { TYPES } from '../../../core/container';
import type { ILogger } from '../../../core/logging';
import type { CryptoService } from '../../../core/security';
import type { ProviderRegistryService } from '../../../infrastructure/providers/registry';
import type { BaseProviderAdapter } from '../../../infrastructure/providers/base';
import type { SubProvider } from '../../entities';

export interface AdapterInstance {
  adapter: BaseProviderAdapter;
  subProviderId: string;
  createdAt: number;
  lastUsedAt: number;
  requestCount: number;
}

export interface IAdapterFactoryService {
  createAdapter(subProvider: SubProvider): Promise<BaseProviderAdapter>;
  getOrCreateAdapter(subProvider: SubProvider): Promise<BaseProviderAdapter>;
  releaseAdapter(subProviderId: string): Promise<void>;
  trackRequest(subProviderId: string): Promise<void>;
  releaseRequest(subProviderId: string): Promise<void>;
  getActiveRequestCount(subProviderId: string): number;
  cleanupIdleAdapters(): Promise<void>;
}

@injectable()
export class AdapterFactoryService implements IAdapterFactoryService {
  private readonly adapterCache = new Map<string, AdapterInstance>();
  private readonly activeRequests = new Map<string, number>();
  private readonly masterKey: string;
  private cleanupInterval: NodeJS.Timeout;

  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.CryptoService) private readonly cryptoService: CryptoService,
    @inject(TYPES.ProviderRegistryService) private readonly providerRegistry: ProviderRegistryService
  ) {
    this.logger = this.logger.createChild('AdapterFactoryService');
    this.masterKey = process.env.MASTER_ENCRYPTION_KEY || 'default-master-key-change-in-production';
    
    if (this.masterKey === 'default-master-key-change-in-production') {
      this.logger.warn('Using default master encryption key - THIS IS INSECURE FOR PRODUCTION');
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleAdapters().catch(error => {
        this.logger.error('Failed to cleanup idle adapters', error as Error);
      });
    }, 300000);
  }

  async createAdapter(subProvider: SubProvider): Promise<BaseProviderAdapter> {
    try {
      this.logger.debug('Creating new adapter instance', {
        metadata: {
          subProviderId: subProvider.getId(),
          providerId: subProvider.getProviderId()
        }
      });

      const adapterInfo = this.providerRegistry.getAdapter(subProvider.getProviderId());
      if (!adapterInfo) {
        throw new Error(`No adapter found for provider: ${subProvider.getProviderId()}`);
      }

      let decryptedApiKey: string | undefined;
      
      if (adapterInfo.needsSubProviders) {
        const primaryApiKey = subProvider.getPrimaryApiKey();
        if (!primaryApiKey) {
          throw new Error(`No API key found for sub-provider ${subProvider.getId()}`);
        }
        
        decryptedApiKey = this.cryptoService.decryptApiKey({
          encrypted: primaryApiKey.encrypted,
          iv: primaryApiKey.iv,
          algorithm: 'aes-256-cbc'
        }, primaryApiKey.masterKey);
      }

      const modelMapping = subProvider.getModelMapping();
      
      const adapter = this.providerRegistry.createAdapter(
        subProvider.getProviderId(),
        decryptedApiKey,
        modelMapping
      );

      if (!adapter) {
        throw new Error(`Failed to create adapter for provider: ${subProvider.getProviderId()}`);
      }

      this.logger.info('Adapter created successfully', {
        metadata: {
          subProviderId: subProvider.getId(),
          providerId: subProvider.getProviderId(),
          adapterType: adapter.constructor.name,
          hasApiKey: !!decryptedApiKey,
          hasModelMapping: Object.keys(modelMapping).length > 0
        }
      });

      return adapter;
    } catch (error) {
      this.logger.error('Failed to create adapter', error as Error, {
        metadata: {
          subProviderId: subProvider.getId(),
          providerId: subProvider.getProviderId()
        }
      });
      throw error;
    }
  }

  async getOrCreateAdapter(subProvider: SubProvider): Promise<BaseProviderAdapter> {
    const subProviderId = subProvider.getId();
    const existingInstance = this.adapterCache.get(subProviderId);

    if (existingInstance) {
      existingInstance.lastUsedAt = Date.now();
      existingInstance.requestCount++;
      
      this.logger.debug('Reusing cached adapter', {
        metadata: {
          subProviderId,
          requestCount: existingInstance.requestCount,
          cacheAge: Date.now() - existingInstance.createdAt
        }
      });

      return existingInstance.adapter;
    }

    const adapter = await this.createAdapter(subProvider);
    const instance: AdapterInstance = {
      adapter,
      subProviderId,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      requestCount: 1
    };

    this.adapterCache.set(subProviderId, instance);

    this.logger.info('New adapter cached', {
      metadata: {
        subProviderId,
        cacheSize: this.adapterCache.size
      }
    });

    return adapter;
  }

  async releaseAdapter(subProviderId: string): Promise<void> {
    const instance = this.adapterCache.get(subProviderId);
    if (instance) {
      this.adapterCache.delete(subProviderId);
      
      this.logger.debug('Adapter released from cache', {
        metadata: {
          subProviderId,
          requestCount: instance.requestCount,
          lifespan: Date.now() - instance.createdAt
        }
      });
    }
  }

  async trackRequest(subProviderId: string): Promise<void> {
    const currentCount = this.activeRequests.get(subProviderId) || 0;
    this.activeRequests.set(subProviderId, currentCount + 1);

    this.logger.debug('Request tracked', {
      metadata: {
        subProviderId,
        activeRequests: currentCount + 1
      }
    });
  }

  async releaseRequest(subProviderId: string): Promise<void> {
    const currentCount = this.activeRequests.get(subProviderId) || 0;
    const newCount = Math.max(0, currentCount - 1);
    
    if (newCount === 0) {
      this.activeRequests.delete(subProviderId);
    } else {
      this.activeRequests.set(subProviderId, newCount);
    }

    this.logger.debug('Request released', {
      metadata: {
        subProviderId,
        activeRequests: newCount
      }
    });
  }

  getActiveRequestCount(subProviderId: string): number {
    return this.activeRequests.get(subProviderId) || 0;
  }

  async cleanupIdleAdapters(): Promise<void> {
    const now = Date.now();
    const maxIdleTime = 600000;
    const toRemove: string[] = [];

    for (const [subProviderId, instance] of this.adapterCache.entries()) {
      const idleTime = now - instance.lastUsedAt;
      const hasActiveRequests = this.getActiveRequestCount(subProviderId) > 0;

      if (idleTime > maxIdleTime && !hasActiveRequests) {
        toRemove.push(subProviderId);
      }
    }

    for (const subProviderId of toRemove) {
      await this.releaseAdapter(subProviderId);
    }

    if (toRemove.length > 0) {
      this.logger.info('Cleaned up idle adapters', {
        metadata: {
          removedCount: toRemove.length,
          remainingCount: this.adapterCache.size
        }
      });
    }
  }

  async dispose(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.adapterCache.clear();
    this.activeRequests.clear();

    this.logger.info('AdapterFactoryService disposed');
  }
}