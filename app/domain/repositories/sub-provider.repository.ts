import { SubProvider } from '../entities';

export interface SubProviderRepository {
  findById(id: string): Promise<SubProvider | null>;
  findByProviderId(providerId: string): Promise<SubProvider[]>;
  findByName(name: string): Promise<SubProvider | null>;
  findAll(): Promise<SubProvider[]>;
  findActive(): Promise<SubProvider[]>;
  findAvailable(): Promise<SubProvider[]>;
  findHealthy(): Promise<SubProvider[]>;
  save(subProvider: SubProvider): Promise<SubProvider>;
  update(id: string, updates: Partial<SubProvider>): Promise<SubProvider>;
  delete(id: string): Promise<void>;
  exists(id: string): Promise<boolean>;
  findByCircuitBreakerState(state: 'closed' | 'open' | 'half-open'): Promise<SubProvider[]>;
  findSupportingModel(model: string): Promise<SubProvider[]>;
  findByPriority(minPriority: number): Promise<SubProvider[]>;
  findByWeight(minWeight: number): Promise<SubProvider[]>;
  recordSuccess(id: string, latency: number, tokensUsed: number): Promise<void>;
  recordError(id: string, errorType: string): Promise<void>;
  updateLimits(id: string, requestCount: number, tokenCount: number, concurrentRequests: number): Promise<void>;
  openCircuitBreaker(id: string): Promise<void>;
  closeCircuitBreaker(id: string): Promise<void>;
  halfOpenCircuitBreaker(id: string): Promise<void>;
  getTopPerformers(limit: number): Promise<SubProvider[]>;
  getLeastUsed(limit: number): Promise<SubProvider[]>;
  getTotalTokenUsage(): Promise<number>;
  getAverageLatency(): Promise<number>;
  countByStatus(): Promise<Record<string, number>>;
  countByCircuitBreakerState(): Promise<Record<string, number>>;
}