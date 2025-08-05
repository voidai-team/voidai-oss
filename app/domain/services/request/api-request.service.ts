import { injectable, inject } from 'inversify';
import { ApiRequest, RequestIdentity, RequestDetails, RequestMetrics, RequestStatus } from '../../entities';
import type { ApiRequestRepository } from '../../repositories';
import type { MetricsService } from '../../../core/metrics';
import { TYPES } from '../../../core/container';

export interface CreateApiRequestRequest {
  userId: string;
  endpoint: string;
  method: string;
  model?: string;
  providerId?: string;
  subProviderId?: string;
  ipAddress: string;
  userAgent: string;
  requestSize: number;
}

export interface CompleteApiRequestRequest {
  tokensUsed: number;
  creditsUsed: number;
  latency: number;
  responseSize: number;
  statusCode: number;
  providerId?: string;
  subProviderId?: string;
}

export interface FailApiRequestRequest {
  statusCode: number;
  errorMessage: string;
  latency: number;
  retryCount?: number;
}

@injectable()
export class ApiRequestService {
  constructor(
    @inject(TYPES.ApiRequestRepository) private apiRequestRepository: ApiRequestRepository,
    @inject(TYPES.MetricsService) private metricsService: MetricsService
  ) {}

  async createApiRequest(request: CreateApiRequestRequest): Promise<ApiRequest> {
    const identity: RequestIdentity = {
      id: crypto.randomUUID(),
      userId: request.userId,
      createdAt: Date.now()
    };

    const details: RequestDetails = {
      endpoint: request.endpoint,
      method: request.method,
      model: request.model,
      providerId: request.providerId,
      subProviderId: request.subProviderId,
      ipAddress: request.ipAddress,
      userAgent: request.userAgent
    };

    const metrics: RequestMetrics = {
      tokensUsed: 0,
      creditsUsed: 0,
      latency: 0,
      responseSize: 0,
      requestSize: request.requestSize
    };

    const status: RequestStatus = {
      status: 'pending',
      statusCode: 0,
      retryCount: 0
    };

    const apiRequest = new ApiRequest(identity, details, metrics, status);
    await this.apiRequestRepository.save(apiRequest);
    
    this.metricsService.recordError('api_request_created', 'api_request_service');
    
    return apiRequest;
  }

  async startProcessing(id: string): Promise<void> {
    const apiRequest = await this.apiRequestRepository.findById(id);
    if (apiRequest) {
      apiRequest.startProcessing();
      await this.apiRequestRepository.save(apiRequest);
      this.metricsService.recordError('api_request_processing', 'api_request_service');
    }
  }

  async completeApiRequest(id: string, request: CompleteApiRequestRequest): Promise<void> {
    const apiRequest = await this.apiRequestRepository.findById(id);
    if (apiRequest) {
      apiRequest.complete(
        request.tokensUsed,
        request.creditsUsed,
        request.latency,
        request.responseSize,
        request.statusCode,
        request.providerId,
        request.subProviderId
      );
      await this.apiRequestRepository.save(apiRequest);
      this.metricsService.recordError('api_request_completed', 'api_request_service');
    }
  }

  async failApiRequest(id: string, request: FailApiRequestRequest): Promise<void> {
    const apiRequest = await this.apiRequestRepository.findById(id);
    if (apiRequest) {
      apiRequest.fail(request.statusCode, request.errorMessage, request.latency, request.retryCount);
      await this.apiRequestRepository.save(apiRequest);
      this.metricsService.recordError('api_request_failed', 'api_request_service');
    }
  }

  async timeoutApiRequest(id: string, latency: number): Promise<void> {
    const apiRequest = await this.apiRequestRepository.findById(id);
    if (apiRequest) {
      apiRequest.timeout(latency);
      await this.apiRequestRepository.save(apiRequest);
      this.metricsService.recordError('api_request_timeout', 'api_request_service');
    }
  }

  async getApiRequestById(id: string): Promise<ApiRequest | null> {
    return await this.apiRequestRepository.findById(id);
  }

  async getApiRequestsByUser(userId: string): Promise<ApiRequest[]> {
    return await this.apiRequestRepository.findByUserId(userId);
  }

  async getApiRequestsByEndpoint(endpoint: string): Promise<ApiRequest[]> {
    return await this.apiRequestRepository.findByEndpoint(endpoint);
  }

  async getApiRequestsByProvider(providerId: string): Promise<ApiRequest[]> {
    return await this.apiRequestRepository.findByProviderId(providerId);
  }

  async getApiRequestsByDateRange(startDate: number, endDate: number): Promise<ApiRequest[]> {
    return await this.apiRequestRepository.findByDateRange(startDate, endDate);
  }

  async getFailedApiRequests(): Promise<ApiRequest[]> {
    return await this.apiRequestRepository.findFailed();
  }

  async getApiRequestStats(userId?: string): Promise<{
    totalRequests: number;
    completedRequests: number;
    failedRequests: number;
    timeoutRequests: number;
    averageLatency: number;
    totalTokensUsed: number;
    totalCreditsUsed: number;
    successRate: number;
  }> {
    const requests = userId 
      ? await this.apiRequestRepository.findByUserId(userId)
      : await this.apiRequestRepository.findAll();

    const completedRequests = requests.filter(r => r.isCompleted());
    const failedRequests = requests.filter(r => r.isFailed());
    const timeoutRequests = requests.filter(r => r.getStatus() === 'timeout');

    const totalLatency = completedRequests.reduce((sum, r) => sum + r.getLatency(), 0);
    const averageLatency = completedRequests.length > 0 ? totalLatency / completedRequests.length : 0;

    const totalTokensUsed = completedRequests.reduce((sum, r) => sum + r.getTokensUsed(), 0);
    const totalCreditsUsed = completedRequests.reduce((sum, r) => sum + r.getCreditsUsed(), 0);

    const successRate = requests.length > 0 ? completedRequests.length / requests.length : 0;

    return {
      totalRequests: requests.length,
      completedRequests: completedRequests.length,
      failedRequests: failedRequests.length,
      timeoutRequests: timeoutRequests.length,
      averageLatency,
      totalTokensUsed,
      totalCreditsUsed,
      successRate
    };
  }

  async getAllApiRequests(): Promise<ApiRequest[]> {
    return await this.apiRequestRepository.findAll();
  }

  async getApiRequestsWithFilters(filters: {
    userId?: string;
    endpoint?: string;
    model?: string;
  }, pagination?: {
    limit: number;
    offset: number;
  }, dateRange?: {
    startDate?: number;
    endDate?: number;
  }): Promise<ApiRequest[]> {
    let requests = await this.apiRequestRepository.findAll();

    if (filters.userId) {
      requests = requests.filter(r => r.getUserId() === filters.userId);
    }
    if (filters.endpoint) {
      requests = requests.filter(r => r.getEndpoint() === filters.endpoint);
    }
    if (filters.model) {
      requests = requests.filter(r => r.getModel() === filters.model);
    }

    if (dateRange?.startDate) {
      requests = requests.filter(r => r.getCreatedAt() >= dateRange.startDate!);
    }
    if (dateRange?.endDate) {
      requests = requests.filter(r => r.getCreatedAt() <= dateRange.endDate!);
    }

    if (pagination) {
      requests = requests.slice(pagination.offset, pagination.offset + pagination.limit);
    }

    return requests;
  }

  async getModelStats(): Promise<Array<{
    model: string;
    totalRequests: number;
    totalTokens: number;
    totalCredits: number;
    averageLatency: number;
    successRate: number;
  }>> {
    const requests = await this.apiRequestRepository.findAll();
    const modelStats = new Map<string, {
      totalRequests: number;
      completedRequests: number;
      totalTokens: number;
      totalCredits: number;
      totalLatency: number;
    }>();

    for (const request of requests) {
      const model = request.getModel() || 'unknown';
      const stats = modelStats.get(model) || {
        totalRequests: 0,
        completedRequests: 0,
        totalTokens: 0,
        totalCredits: 0,
        totalLatency: 0
      };

      stats.totalRequests++;
      if (request.isCompleted()) {
        stats.completedRequests++;
        stats.totalTokens += request.getTokensUsed();
        stats.totalCredits += request.getCreditsUsed();
        stats.totalLatency += request.getLatency();
      }

      modelStats.set(model, stats);
    }

    return Array.from(modelStats.entries()).map(([model, stats]) => ({
      model,
      totalRequests: stats.totalRequests,
      totalTokens: stats.totalTokens,
      totalCredits: stats.totalCredits,
      averageLatency: stats.completedRequests > 0 ? stats.totalLatency / stats.completedRequests : 0,
      successRate: stats.totalRequests > 0 ? stats.completedRequests / stats.totalRequests : 0
    }));
  }

  async getEndpointStats(): Promise<Array<{
    endpoint: string;
    totalRequests: number;
    totalTokens: number;
    totalCredits: number;
    averageLatency: number;
    successRate: number;
  }>> {
    const requests = await this.apiRequestRepository.findAll();
    const endpointStats = new Map<string, {
      totalRequests: number;
      completedRequests: number;
      totalTokens: number;
      totalCredits: number;
      totalLatency: number;
    }>();

    for (const request of requests) {
      const endpoint = request.getEndpoint();
      const stats = endpointStats.get(endpoint) || {
        totalRequests: 0,
        completedRequests: 0,
        totalTokens: 0,
        totalCredits: 0,
        totalLatency: 0
      };

      stats.totalRequests++;
      if (request.isCompleted()) {
        stats.completedRequests++;
        stats.totalTokens += request.getTokensUsed();
        stats.totalCredits += request.getCreditsUsed();
        stats.totalLatency += request.getLatency();
      }

      endpointStats.set(endpoint, stats);
    }

    return Array.from(endpointStats.entries()).map(([endpoint, stats]) => ({
      endpoint,
      totalRequests: stats.totalRequests,
      totalTokens: stats.totalTokens,
      totalCredits: stats.totalCredits,
      averageLatency: stats.completedRequests > 0 ? stats.totalLatency / stats.completedRequests : 0,
      successRate: stats.totalRequests > 0 ? stats.completedRequests / stats.totalRequests : 0
    }));
  }
}