import { injectable, inject } from 'inversify';
import { Provider, ProviderIdentity, ProviderConfiguration, ProviderMetrics, ProviderCosts, ProviderSecurity } from '../../entities';
import type { ProviderRepository } from '../../repositories';
import { MetricsService } from '../../../core/metrics';
import { TYPES } from '../../../core/container';

export interface CreateProviderRequest {
  name: string;
  displayName: string;
  needsSubProviders: boolean;
  priority: number;
  baseUrl: string;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
  supportedModels: string[];
  rateLimits: {
    requestsPerMinute: number;
    requestsPerHour: number;
    tokensPerMinute: number;
  };
  features: string[];
}

@injectable()
export class ProviderService {
  constructor(
    @inject(TYPES.ProviderRepository) private providerRepository: ProviderRepository,
    @inject(TYPES.MetricsService) private metricsService: MetricsService
  ) {}

  async createProvider(request: CreateProviderRequest): Promise<Provider> {
    const identity: ProviderIdentity = {
      id: crypto.randomUUID(),
      name: request.name,
      displayName: request.displayName,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const configuration: ProviderConfiguration = {
      needsSubProviders: request.needsSubProviders,
      isActive: true,
      priority: request.priority,
      baseUrl: request.baseUrl,
      timeout: request.timeout,
      retryAttempts: request.retryAttempts,
      retryDelay: request.retryDelay,
      supportedModels: request.supportedModels,
      rateLimits: request.rateLimits,
      features: request.features
    };

    const metrics: ProviderMetrics = {
      totalTokenUsage: 0,
      totalRequests: 0,
      lastUsedAt: Date.now(),
      avgLatency: 0,
      errorCount: 0,
      successCount: 0,
      consecutiveErrors: 0,
      timeoutCount: 0,
      healthStatus: 'healthy',
      uptime: 0,
      throughput: {
        requestsPerSecond: 0,
        tokensPerSecond: 0,
        peakRequestsPerSecond: 0,
        peakTokensPerSecond: 0
      },
      performance: {
        minLatency: 0,
        maxLatency: 0,
        p50Latency: 0,
        p95Latency: 0,
        p99Latency: 0,
        latencyHistory: [],
        lastPercentileCalculation: Date.now()
      },
      capacity: {
        maxConcurrentRequests: 100,
        currentConcurrentRequests: 0,
        queueLength: 0,
        utilizationPercent: 0
      }
    };

    const costs: ProviderCosts = {
      totalCost: 0,
      costPerToken: 0,
      costPerRequest: 0,
      monthlySpend: 0,
      dailySpend: 0,
      budgetAlert: false
    };

    const security: ProviderSecurity = {
      encryptionEnabled: true,
      apiKeyRotationEnabled: false,
      allowedIpRanges: [],
      securityEvents: []
    };

    const provider = new Provider(identity, configuration, metrics, costs, security);
    await this.providerRepository.save(provider);
    
    this.metricsService.recordError('provider_created', 'provider_service');
    
    return provider;
  }

  async getProviderById(id: string): Promise<Provider | null> {
    return await this.providerRepository.findById(id);
  }

  async getProviderByName(name: string): Promise<Provider | null> {
    return await this.providerRepository.findByName(name);
  }

  async getActiveProviders(): Promise<Provider[]> {
    return await this.providerRepository.findActive();
  }

  async getProvidersByModel(model: string): Promise<Provider[]> {
    return await this.providerRepository.findSupportingModel(model);
  }

  async updateProviderHealth(id: string, status: 'healthy' | 'degraded' | 'unhealthy'): Promise<void> {
    const provider = await this.providerRepository.findById(id);
    if (provider) {
      provider.updateHealthStatus(status);
      await this.providerRepository.save(provider);
      this.metricsService.recordError('provider_health_updated', 'provider_service');
    }
  }

  async recordProviderMetrics(id: string, latency: number, tokensUsed: number, cost: number): Promise<void> {
    const provider = await this.providerRepository.findById(id);
    if (provider) {
      provider.recordSuccess(latency, tokensUsed, cost);
      await this.providerRepository.save(provider);
    }
  }

  async recordProviderError(id: string, errorType: string): Promise<void> {
    const provider = await this.providerRepository.findById(id);
    if (provider) {
      provider.recordError(errorType);
      await this.providerRepository.save(provider);
    }
  }

  async getProviderStats(): Promise<{
    totalProviders: number;
    activeProviders: number;
    healthyProviders: number;
    totalCost: number;
    totalRequests: number;
  }> {
    const allProviders = await this.providerRepository.findAll();
    const activeProviders = allProviders.filter(p => p.isActive());
    const healthyProviders = allProviders.filter(p => p.isHealthy());
    
    const totalCost = allProviders.reduce((sum, p) => sum + p.getTotalCost(), 0);
    const totalRequests = allProviders.reduce((sum, p) => sum + p.getMetrics().totalRequests, 0);

    return {
      totalProviders: allProviders.length,
      activeProviders: activeProviders.length,
      healthyProviders: healthyProviders.length,
      totalCost,
      totalRequests
    };
  }
}