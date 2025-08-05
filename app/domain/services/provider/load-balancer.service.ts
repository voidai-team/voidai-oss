import { injectable, inject } from 'inversify';
import { Provider, SubProvider } from '../../entities';
import type { ProviderRepository, SubProviderRepository } from '../../repositories';
import type { AdapterFactoryService } from './adapter-factory.service';
import { TYPES } from '../../../core/container/types';

export interface LoadBalancingResult {
  provider?: Provider;
  subProvider?: SubProvider;
  error?: string;
  errorCode?: string;
  httpStatus?: number;
}

export interface LoadBalancingStrategy {
  selectProvider(providers: Provider[]): Provider | null;
  selectSubProvider(subProviders: SubProvider[], estimatedTokens?: number, adapterFactory?: any): SubProvider | null;
}

@injectable()
export class PerformanceStrategy implements LoadBalancingStrategy {
  selectProvider(providers: Provider[]): Provider | null {
    if (providers.length === 0) return null;
    
    const scoredProviders = providers.map(provider => ({
      provider,
      score: this.calculateProviderScore(provider)
    }));
    
    scoredProviders.sort((a, b) => b.score - a.score);
    
    const topProviders = scoredProviders.slice(0, Math.max(1, Math.ceil(providers.length * 0.3)));
    const weights = topProviders.map(p => p.score);
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    
    if (totalWeight === 0) return topProviders[0].provider;
    
    let random = Math.random() * totalWeight;
    for (let i = 0; i < topProviders.length; i++) {
      random -= weights[i];
      if (random <= 0) return topProviders[i].provider;
    }
    
    return topProviders[0].provider;
  }

  selectSubProvider(subProviders: SubProvider[], estimatedTokens: number = 0, adapterFactory?: any): SubProvider | null {
    if (subProviders.length === 0) return null;
    
    const availableSubProviders = subProviders.filter(sp =>
      sp.isAvailable() && sp.canHandleRequest(estimatedTokens)
    );
    if (availableSubProviders.length === 0) return null;
    
    const scoredSubProviders = availableSubProviders.map(subProvider => ({
      subProvider,
      score: this.calculateSubProviderScore(subProvider, estimatedTokens, adapterFactory)
    }));
    
    scoredSubProviders.sort((a, b) => b.score - a.score);
    
    const weights = scoredSubProviders.map(sp => sp.score);
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    
    if (totalWeight === 0) return scoredSubProviders[0].subProvider;
    
    let random = Math.random() * totalWeight;
    for (let i = 0; i < scoredSubProviders.length; i++) {
      random -= weights[i];
      if (random <= 0) return scoredSubProviders[i].subProvider;
    }
    
    return scoredSubProviders[0].subProvider;
  }

  private calculateProviderScore(provider: Provider): number {
    const metrics = provider.getMetrics();
    
    const successRate = metrics.successRate;
    
    const p50Score = Math.max(0, 1 - (metrics.performance.p50Latency / 3000));
    const p95Score = Math.max(0, 1 - (metrics.performance.p95Latency / 8000));
    const avgLatencyScore = Math.max(0, 1 - (metrics.avgLatency / 5000));
    const latencyScore = (p50Score * 0.4) + (p95Score * 0.4) + (avgLatencyScore * 0.2);
    
    const healthScore = provider.isHealthy() ? 1 : provider.isDegraded() ? 0.5 : 0;
    const uptimeScore = Math.min(1, metrics.uptime / 86400);
    
    const throughputScore = Math.min(1, metrics.throughput.requestsPerSecond / 100);
    const capacityScore = Math.max(0, 1 - (metrics.capacity.utilizationPercent / 100));
    
    const consistencyPenalty = Math.abs(metrics.performance.p95Latency - metrics.performance.p50Latency) / 1000;
    const consistencyScore = Math.max(0, 1 - consistencyPenalty);
    
    return (successRate * 0.25) + (latencyScore * 0.25) + (healthScore * 0.15) +
           (uptimeScore * 0.05) + (throughputScore * 0.1) + 
           (capacityScore * 0.05) + (consistencyScore * 0.05);
  }

  private calculateSubProviderScore(subProvider: SubProvider, estimatedTokens: number = 0, adapterFactory?: any): number {
    const successRate = subProvider.getSuccessRate();
    const latencyScore = Math.max(0, 1 - (subProvider.getAvgLatency() / 5000));
    const healthScore = subProvider.getHealthScore();
    const availabilityScore = subProvider.isAvailable() ? 1 : 0;
    
    const currentRPM = subProvider.getCurrentRequestsPerMinute();
    const currentTPM = subProvider.getCurrentTokensPerMinute();
    const limits = subProvider.getLimits();
    
    const actualConcurrentRequests = adapterFactory ? adapterFactory.getActiveRequestCount(subProvider.getId()) : limits.currentConcurrentRequests;
    
    const rpmUtilization = limits.maxRequestsPerMinute > 0 ? currentRPM / limits.maxRequestsPerMinute : 0;
    const tpmUtilization = limits.maxTokensPerMinute > 0 ? (currentTPM + estimatedTokens) / limits.maxTokensPerMinute : 0;
    const concurrencyUtilization = limits.maxConcurrentRequests > 0 ? actualConcurrentRequests / limits.maxConcurrentRequests : 0;
    
    const capacityScore = Math.max(0, 1 - Math.max(rpmUtilization, tpmUtilization, concurrencyUtilization));
    
    return (successRate * 0.25) + (latencyScore * 0.25) + (healthScore * 0.15) +
           (availabilityScore * 0.15) + (capacityScore * 0.2);
  }
}

@injectable()
export class LoadBalancerService {
  private strategy: LoadBalancingStrategy;

  constructor(
    @inject(TYPES.ProviderRepository) private providerRepository: ProviderRepository,
    @inject(TYPES.SubProviderRepository) private subProviderRepository: SubProviderRepository,
    @inject(TYPES.AdapterFactoryService) private adapterFactory: AdapterFactoryService
  ) {
    this.strategy = new PerformanceStrategy();
  }

  async selectProvider(model?: string): Promise<LoadBalancingResult> {
    try {
      let providers = await this.providerRepository.findActive();
      
      if (model) {
        providers = providers.filter(p => p.supportsModel(model));
      }
      
      providers = providers.filter(p => p.isHealthy());
      
      if (providers.length === 0) {
        return {
          error: 'No healthy providers are currently available. All providers may be experiencing issues or are under maintenance.',
          errorCode: 'NO_PROVIDERS_AVAILABLE',
          httpStatus: 503
        };
      }
      
      const selectedProvider = this.strategy.selectProvider(providers);
      
      if (!selectedProvider) {
        return {
          error: 'Provider selection algorithm failed to select a suitable provider. This may indicate a system configuration issue.',
          errorCode: 'PROVIDER_SELECTION_FAILED',
          httpStatus: 500
        };
      }
      
      return { provider: selectedProvider };
    } catch (error) {
      return {
        error: 'An internal error occurred while selecting a provider. Please try again later.',
        errorCode: 'LOAD_BALANCER_ERROR',
        httpStatus: 500
      };
    }
  }

  async selectSubProvider(providerId: string, model?: string, estimatedTokens: number = 0): Promise<LoadBalancingResult> {
    try {
      let subProviders = await this.subProviderRepository.findByProviderId(providerId);
      
      subProviders = subProviders.filter(sp => sp.isAvailable());
      
      if (model) {
        subProviders = subProviders.filter(sp => sp.supportsModel(model));
      }
      
      if (subProviders.length === 0) {
        return {
          error: `No available sub-providers found for the requested configuration. The provider may be temporarily unavailable${model ? ` for model '${model}'` : ''}.`,
          errorCode: 'NO_SUB_PROVIDERS_AVAILABLE',
          httpStatus: 503
        };
      }
      
      const selectedSubProvider = this.strategy.selectSubProvider(subProviders, estimatedTokens, this.adapterFactory);
      
      if (!selectedSubProvider) {
        return {
          error: 'Sub-provider selection failed. This may indicate a temporary system issue or all sub-providers are at capacity.',
          errorCode: 'SUB_PROVIDER_SELECTION_FAILED',
          httpStatus: 503
        };
      }
      
      return { subProvider: selectedSubProvider };
    } catch (error) {
      return {
        error: 'An internal error occurred while selecting a sub-provider. Please try again later.',
        errorCode: 'LOAD_BALANCER_ERROR',
        httpStatus: 500
      };
    }
  }

  async selectProviderAndSubProvider(model?: string, estimatedTokens: number = 0): Promise<LoadBalancingResult> {
    const providerResult = await this.selectProvider(model);
    
    if (!providerResult.provider) {
      return providerResult;
    }
    
    if (!providerResult.provider.needsSubProviders()) {
      return providerResult;
    }
    
    const subProviderResult = await this.selectSubProvider(providerResult.provider.getId(), model, estimatedTokens);
    
    if (!subProviderResult.subProvider) {
      return {
        error: `The selected provider '${providerResult.provider.getName()}' requires a sub-provider, but none are currently available${model ? ` for model '${model}'` : ''}. This may be due to rate limits or capacity constraints.`,
        errorCode: 'SUB_PROVIDER_REQUIRED_BUT_UNAVAILABLE',
        httpStatus: 503
      };
    }
    
    return {
      provider: providerResult.provider,
      subProvider: subProviderResult.subProvider
    };
  }

  async reserveCapacity(subProviderId: string, estimatedTokens: number = 0): Promise<boolean> {
    try {
      const subProvider = await this.subProviderRepository.findById(subProviderId);
      if (!subProvider) {
        return false;
      }
      
      const reserved = subProvider.reserveCapacity(estimatedTokens);
      if (reserved) {
        await this.subProviderRepository.save(subProvider);
        await this.adapterFactory.trackRequest(subProviderId);
      }
      
      return reserved;
    } catch (error) {
      return false;
    }
  }

  async releaseCapacity(subProviderId: string): Promise<void> {
    try {
      const subProvider = await this.subProviderRepository.findById(subProviderId);
      if (subProvider) {
        subProvider.releaseCapacity();
        await this.subProviderRepository.save(subProvider);
        await this.adapterFactory.releaseRequest(subProviderId);
      }
    } catch {}
  }

  async getAdapter(subProvider: SubProvider) {
    return this.adapterFactory.getOrCreateAdapter(subProvider);
  }

  getActiveRequestCount(subProviderId: string): number {
    return this.adapterFactory.getActiveRequestCount(subProviderId);
  }

  setStrategy(strategy: LoadBalancingStrategy): void {
    this.strategy = strategy;
  }

  async recordSuccess(providerId: string, subProviderId?: string, latency?: number, tokensUsed?: number, cost?: number): Promise<void> {
    try {
      if (latency && tokensUsed && cost) {
        await this.providerRepository.recordSuccess(providerId, latency, tokensUsed, cost);
      }
      
      if (subProviderId && latency && tokensUsed) {
        await this.subProviderRepository.recordSuccess(subProviderId, latency, tokensUsed);
      }
    } catch {}
  }

  async recordError(providerId: string, subProviderId?: string, errorType?: string): Promise<void> {
    try {
      await this.providerRepository.recordError(providerId, errorType || 'unknown');
      
      if (subProviderId) {
        await this.subProviderRepository.recordError(subProviderId, errorType || 'unknown');
      }
    } catch {}
  }

  async getProviderMetrics(providerId: string): Promise<any> {
    try {
      const provider = await this.providerRepository.findById(providerId);
      return provider ? provider.getMetrics() : null;
    } catch (error) {
      return null;
    }
  }

  async getSubProviderMetrics(subProviderId: string): Promise<any> {
    try {
      const subProvider = await this.subProviderRepository.findById(subProviderId);
      return subProvider ? subProvider.getMetrics() : null;
    } catch (error) {
      return null;
    }
  }
}