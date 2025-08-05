import { injectable, inject } from 'inversify';
import { SubProvider, SubProviderIdentity, SubProviderConfiguration, SubProviderMetrics, SubProviderLimits } from '../../entities';
import type { SubProviderRepository } from '../../repositories';
import { MetricsService } from '../../../core/metrics';
import { CryptoService } from '../../../core/security';
import { TYPES } from '../../../core/container';

export interface CreateSubProviderRequest {
  providerId: string;
  name: string;
  apiKey: string;
  priority: number;
  weight: number;
  modelMapping: Record<string, string>;
  timeout: number;
  retryAttempts: number;
  customHeaders?: Record<string, string>;
  maxRequestsPerMinute: number;
  maxRequestsPerHour: number;
  maxTokensPerMinute: number;
  maxConcurrentRequests: number;
}

@injectable()
export class SubProviderService {
  constructor(
    @inject(TYPES.SubProviderRepository) private subProviderRepository: SubProviderRepository,
    @inject(TYPES.CryptoService) private cryptoService: CryptoService,
    @inject(TYPES.MetricsService) private metricsService: MetricsService
  ) {}

  async createSubProvider(request: CreateSubProviderRequest): Promise<SubProvider> {
    const masterKey = this.cryptoService.generateSecureToken(32);
    const encryptedApiKey = this.cryptoService.encryptApiKey(request.apiKey, masterKey);

    const identity: SubProviderIdentity = {
      id: crypto.randomUUID(),
      providerId: request.providerId,
      name: request.name,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const configuration: SubProviderConfiguration = {
      apiKeys: {
        default: {
          encrypted: encryptedApiKey.encrypted,
          iv: encryptedApiKey.iv,
          masterKey: masterKey,
          name: 'default',
          createdAt: Date.now(),
          isActive: true
        }
      },
      enabled: true,
      priority: request.priority,
      weight: request.weight,
      modelMapping: request.modelMapping,
      timeout: request.timeout,
      retryAttempts: request.retryAttempts,
      customHeaders: request.customHeaders || {}
    };

    const metrics: SubProviderMetrics = {
      totalTokenUsage: 0,
      totalRequests: 0,
      errorCount: 0,
      successCount: 0,
      consecutiveErrors: 0,
      avgLatency: 0,
      healthScore: 1.0,
      circuitBreakerState: 'closed'
    };

    const limits: SubProviderLimits = {
      maxRequestsPerMinute: request.maxRequestsPerMinute,
      maxRequestsPerHour: request.maxRequestsPerHour,
      maxTokensPerMinute: request.maxTokensPerMinute,
      maxConcurrentRequests: request.maxConcurrentRequests,
      currentRequestCount: 0,
      currentTokenCount: 0,
      currentConcurrentRequests: 0,
      requestWindow: [],
      tokenWindow: [],
      lastWindowReset: Date.now()
    };

    const subProvider = new SubProvider(identity, configuration, metrics, limits);
    await this.subProviderRepository.save(subProvider);
    
    this.metricsService.recordError('sub_provider_created', 'sub_provider_service');
    
    return subProvider;
  }

  async getSubProviderById(id: string): Promise<SubProvider | null> {
    return await this.subProviderRepository.findById(id);
  }

  async getSubProvidersByProvider(providerId: string): Promise<SubProvider[]> {
    return await this.subProviderRepository.findByProviderId(providerId);
  }

  async getAvailableSubProviders(providerId: string): Promise<SubProvider[]> {
    const subProviders = await this.subProviderRepository.findByProviderId(providerId);
    return subProviders.filter(sp => sp.isAvailable());
  }

  async getSubProvidersByModel(providerId: string, model: string): Promise<SubProvider[]> {
    const subProviders = await this.subProviderRepository.findByProviderId(providerId);
    return subProviders.filter(sp => sp.supportsModel(model) && sp.isAvailable());
  }

  async recordSubProviderSuccess(id: string, latency: number, tokensUsed: number): Promise<void> {
    const subProvider = await this.subProviderRepository.findById(id);
    if (subProvider) {
      subProvider.recordSuccess(latency, tokensUsed);
      await this.subProviderRepository.save(subProvider);
    }
  }

  async recordSubProviderError(id: string, errorType: string): Promise<void> {
    const subProvider = await this.subProviderRepository.findById(id);
    if (subProvider) {
      subProvider.recordError(errorType);
      await this.subProviderRepository.save(subProvider);
    }
  }

  async updateSubProviderLimits(id: string, requestCount: number, tokenCount: number, concurrentRequests: number): Promise<void> {
    const subProvider = await this.subProviderRepository.findById(id);
    if (subProvider) {
      subProvider.updateLimits(requestCount, tokenCount, concurrentRequests);
      await this.subProviderRepository.save(subProvider);
    }
  }

  async enableSubProvider(id: string): Promise<void> {
    const subProvider = await this.subProviderRepository.findById(id);
    if (subProvider) {
      subProvider.enable();
      await this.subProviderRepository.save(subProvider);
      this.metricsService.recordError('sub_provider_enabled', 'sub_provider_service');
    }
  }

  async disableSubProvider(id: string): Promise<void> {
    const subProvider = await this.subProviderRepository.findById(id);
    if (subProvider) {
      subProvider.disable();
      await this.subProviderRepository.save(subProvider);
      this.metricsService.recordError('sub_provider_disabled', 'sub_provider_service');
    }
  }

  async getSubProviderStats(providerId?: string): Promise<{
    totalSubProviders: number;
    enabledSubProviders: number;
    healthySubProviders: number;
    averageHealthScore: number;
    circuitBreakersOpen: number;
  }> {
    const subProviders = providerId 
      ? await this.subProviderRepository.findByProviderId(providerId)
      : await this.subProviderRepository.findAll();

    const enabledSubProviders = subProviders.filter(sp => sp.isEnabled());
    const healthySubProviders = subProviders.filter(sp => sp.isHealthy());
    const circuitBreakersOpen = subProviders.filter(sp => sp.isCircuitBreakerOpen());
    
    const averageHealthScore = subProviders.length > 0
      ? subProviders.reduce((sum, sp) => sum + sp.getHealthScore(), 0) / subProviders.length
      : 0;

    return {
      totalSubProviders: subProviders.length,
      enabledSubProviders: enabledSubProviders.length,
      healthySubProviders: healthySubProviders.length,
      averageHealthScore,
      circuitBreakersOpen: circuitBreakersOpen.length
    };
  }

  async updateSubProvider(id: string, updates: Partial<{
    name: string;
    apiKey: string;
    isEnabled: boolean;
    priority: number;
    weight: number;
    maxRequestsPerMinute: number;
    maxConcurrentRequests: number;
  }>): Promise<SubProvider> {
    const subProvider = await this.subProviderRepository.findById(id);
    if (!subProvider) {
      throw new Error(`SubProvider with ID ${id} not found`);
    }

    if (updates.isEnabled !== undefined) {
      if (updates.isEnabled) {
        subProvider.enable();
      } else {
        subProvider.disable();
      }
    }

    await this.subProviderRepository.save(subProvider);
    return subProvider;
  }

  async deleteSubProvider(id: string): Promise<void> {
    const subProvider = await this.subProviderRepository.findById(id);
    if (!subProvider) {
      throw new Error(`SubProvider with ID ${id} not found`);
    }

    await this.subProviderRepository.delete(id);
    this.metricsService.recordError('sub_provider_deleted', 'sub_provider_service');
  }

  async getAllSubProviders(): Promise<SubProvider[]> {
    return await this.subProviderRepository.findAll();
  }
}