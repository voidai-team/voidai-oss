import { Provider } from '../entities';

export interface ProviderRepository {
  findById(id: string): Promise<Provider | null>;
  findByName(name: string): Promise<Provider | null>;
  findAll(): Promise<Provider[]>;
  findActive(): Promise<Provider[]>;
  findByVendor(vendor: string): Promise<Provider[]>;
  save(provider: Provider): Promise<Provider>;
  update(id: string, updates: Partial<Provider>): Promise<Provider>;
  delete(id: string): Promise<void>;
  exists(id: string): Promise<boolean>;
  findHealthy(): Promise<Provider[]>;
  findByPriority(minPriority: number): Promise<Provider[]>;
  findSupportingModel(model: string): Promise<Provider[]>;
  findSupportingFeature(feature: string): Promise<Provider[]>;
  updateMetrics(id: string, metrics: any): Promise<void>;
  updateHealthStatus(id: string, status: 'healthy' | 'degraded' | 'unhealthy'): Promise<void>;
  recordSuccess(id: string, latency: number, tokensUsed: number, cost: number): Promise<void>;
  recordError(id: string, errorType: string): Promise<void>;
  getTopPerformers(limit: number): Promise<Provider[]>;
  getLeastUsed(limit: number): Promise<Provider[]>;
  getTotalTokenUsage(): Promise<number>;
  getTotalCost(): Promise<number>;
  getAverageLatency(): Promise<number>;
  countByStatus(): Promise<Record<string, number>>;
}