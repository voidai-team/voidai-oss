import { ApiRequest } from '../entities';

export interface ApiRequestRepository {
  findById(id: string): Promise<ApiRequest | null>;
  findByUserId(userId: string): Promise<ApiRequest[]>;
  findByEndpoint(endpoint: string): Promise<ApiRequest[]>;
  findByModel(model: string): Promise<ApiRequest[]>;
  findByProviderId(providerId: string): Promise<ApiRequest[]>;
  findByStatus(status: string): Promise<ApiRequest[]>;
  findAll(): Promise<ApiRequest[]>;
  save(request: ApiRequest): Promise<ApiRequest>;
  update(id: string, updates: Partial<ApiRequest>): Promise<ApiRequest>;
  delete(id: string): Promise<void>;
  exists(id: string): Promise<boolean>;
  findByDateRange(startDate: number, endDate: number): Promise<ApiRequest[]>;
  findByUserAndDateRange(userId: string, startDate: number, endDate: number): Promise<ApiRequest[]>;
  findCompleted(): Promise<ApiRequest[]>;
  findFailed(): Promise<ApiRequest[]>;
  findProcessing(): Promise<ApiRequest[]>;
  findByLatencyRange(minLatency: number, maxLatency: number): Promise<ApiRequest[]>;
  findByTokenRange(minTokens: number, maxTokens: number): Promise<ApiRequest[]>;
  findByCreditRange(minCredits: number, maxCredits: number): Promise<ApiRequest[]>;
  getTotalRequests(): Promise<number>;
  getTotalTokensUsed(): Promise<number>;
  getTotalCreditsUsed(): Promise<number>;
  getAverageLatency(): Promise<number>;
  getSuccessRate(): Promise<number>;
  getRequestsByEndpoint(): Promise<Record<string, number>>;
  getRequestsByModel(): Promise<Record<string, number>>;
  getRequestsByProvider(): Promise<Record<string, number>>;
  getRequestsByStatus(): Promise<Record<string, number>>;
  getRequestsByHour(hours: number): Promise<ApiRequest[]>;
  getRequestsByDay(days: number): Promise<ApiRequest[]>;
  getUserStats(userId: string): Promise<{
    totalRequests: number;
    totalTokensUsed: number;
    totalCreditsUsed: number;
    averageLatency: number;
    successRate: number;
  }>;
  getProviderStats(providerId: string): Promise<{
    totalRequests: number;
    totalTokensUsed: number;
    averageLatency: number;
    successRate: number;
  }>;
}