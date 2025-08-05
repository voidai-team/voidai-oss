import { injectable, inject } from 'inversify';
import { MetricsService as CoreMetricsService } from '../../../core/metrics';
import type { UserRepository, ProviderRepository, SubProviderRepository, ApiRequestRepository } from '../../repositories';
import { TYPES } from '../../../core/container';

export interface SystemMetrics {
  totalUsers: number;
  activeUsers: number;
  totalProviders: number;
  activeProviders: number;
  totalSubProviders: number;
  activeSubProviders: number;
  totalRequests: number;
  completedRequests: number;
  failedRequests: number;
  averageLatency: number;
  totalTokensUsed: number;
  totalCreditsUsed: number;
  successRate: number;
}

export interface DomainProviderMetrics {
  providerId: string;
  providerName: string;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  averageLatency: number;
  totalTokensUsed: number;
  totalCost: number;
  healthStatus: string;
  successRate: number;
}

export interface DomainUserMetrics {
  userId: string;
  userName: string;
  totalRequests: number;
  totalTokensUsed: number;
  totalCreditsUsed: number;
  averageLatency: number;
  successRate: number;
  lastRequestAt?: number;
}

@injectable()
export class DomainMetricsService {
  constructor(
    @inject(TYPES.UserRepository) private userRepository: UserRepository,
    @inject(TYPES.ProviderRepository) private providerRepository: ProviderRepository,
    @inject(TYPES.SubProviderRepository) private subProviderRepository: SubProviderRepository,
    @inject(TYPES.ApiRequestRepository) private apiRequestRepository: ApiRequestRepository,
    @inject(TYPES.MetricsService) private coreMetricsService: CoreMetricsService
  ) {}

  async getSystemMetrics(): Promise<SystemMetrics> {
    const [
      allUsers,
      activeUsers,
      allProviders,
      activeProviders,
      allSubProviders,
      allRequests,
      completedRequests,
      failedRequests
    ] = await Promise.all([
      this.userRepository.findAll(),
      this.userRepository.findActiveUsers(),
      this.providerRepository.findAll(),
      this.providerRepository.findActive(),
      this.subProviderRepository.findAll(),
      this.apiRequestRepository.findAll(),
      this.apiRequestRepository.findCompleted(),
      this.apiRequestRepository.findFailed()
    ]);

    const activeSubProviders = allSubProviders.filter(sp => sp.isEnabled());
    
    const totalLatency = completedRequests.reduce((sum, req) => sum + req.getLatency(), 0);
    const averageLatency = completedRequests.length > 0 ? totalLatency / completedRequests.length : 0;
    
    const totalTokensUsed = completedRequests.reduce((sum, req) => sum + req.getTokensUsed(), 0);
    const totalCreditsUsed = completedRequests.reduce((sum, req) => sum + req.getCreditsUsed(), 0);
    
    const successRate = allRequests.length > 0 ? completedRequests.length / allRequests.length : 0;

    return {
      totalUsers: allUsers.length,
      activeUsers: activeUsers.length,
      totalProviders: allProviders.length,
      activeProviders: activeProviders.length,
      totalSubProviders: allSubProviders.length,
      activeSubProviders: activeSubProviders.length,
      totalRequests: allRequests.length,
      completedRequests: completedRequests.length,
      failedRequests: failedRequests.length,
      averageLatency,
      totalTokensUsed,
      totalCreditsUsed,
      successRate
    };
  }

  async getProviderMetrics(): Promise<DomainProviderMetrics[]> {
    const providers = await this.providerRepository.findAll();
    
    return providers.map(provider => {
      const metrics = provider.getMetrics();
      return {
        providerId: provider.getId(),
        providerName: provider.getName(),
        totalRequests: metrics.totalRequests,
        successCount: metrics.successCount,
        errorCount: metrics.errorCount,
        averageLatency: metrics.avgLatency,
        totalTokensUsed: metrics.totalTokenUsage,
        totalCost: provider.getTotalCost(),
        healthStatus: metrics.healthStatus,
        successRate: metrics.successRate
      };
    });
  }

  async getUserMetrics(): Promise<DomainUserMetrics[]> {
    const users = await this.userRepository.findAll();
    
    const userMetrics = await Promise.all(users.map(async (user) => {
      const stats = user.getUsageStats();
      const userRequests = await this.apiRequestRepository.findByUserId(user.getId());
      const completedRequests = userRequests.filter(req => req.isCompleted());
      
      const totalLatency = completedRequests.reduce((sum, req) => sum + req.getLatency(), 0);
      const averageLatency = completedRequests.length > 0 ? totalLatency / completedRequests.length : 0;
      const successRate = userRequests.length > 0 ? completedRequests.length / userRequests.length : 0;

      return {
        userId: user.getId(),
        userName: user.getName(),
        totalRequests: stats.totalRequests,
        totalTokensUsed: stats.totalTokensUsed,
        totalCreditsUsed: stats.totalCreditsUsed,
        averageLatency,
        successRate,
        lastRequestAt: stats.lastRequestAt
      };
    }));

    return userMetrics;
  }

  async getProviderMetricsById(providerId: string): Promise<DomainProviderMetrics | null> {
    const provider = await this.providerRepository.findById(providerId);
    if (!provider) return null;

    const metrics = provider.getMetrics();
    return {
      providerId: provider.getId(),
      providerName: provider.getName(),
      totalRequests: metrics.totalRequests,
      successCount: metrics.successCount,
      errorCount: metrics.errorCount,
      averageLatency: metrics.avgLatency,
      totalTokensUsed: metrics.totalTokenUsage,
      totalCost: provider.getTotalCost(),
      healthStatus: metrics.healthStatus,
      successRate: metrics.successRate
    };
  }

  async getUserMetricsById(userId: string): Promise<DomainUserMetrics | null> {
    const user = await this.userRepository.findById(userId);
    if (!user) return null;

    const stats = user.getUsageStats();
    const userRequests = await this.apiRequestRepository.findByUserId(userId);
    const completedRequests = userRequests.filter(req => req.isCompleted());
    
    const totalLatency = completedRequests.reduce((sum, req) => sum + req.getLatency(), 0);
    const averageLatency = completedRequests.length > 0 ? totalLatency / completedRequests.length : 0;
    const successRate = userRequests.length > 0 ? completedRequests.length / userRequests.length : 0;

    return {
      userId: user.getId(),
      userName: user.getName(),
      totalRequests: stats.totalRequests,
      totalTokensUsed: stats.totalTokensUsed,
      totalCreditsUsed: stats.totalCreditsUsed,
      averageLatency,
      successRate,
      lastRequestAt: stats.lastRequestAt
    };
  }

  async recordCustomMetric(name: string, value: number, labels?: Record<string, string>): Promise<void> {
    this.coreMetricsService.recordError(`${name}_${value}`, labels ? JSON.stringify(labels) : 'domain_metrics_service');
  }

  async getMetricsForDashboard(): Promise<{
    system: SystemMetrics;
    topProviders: DomainProviderMetrics[];
    topUsers: DomainUserMetrics[];
  }> {
    const [systemMetrics, providerMetrics, userMetrics] = await Promise.all([
      this.getSystemMetrics(),
      this.getProviderMetrics(),
      this.getUserMetrics()
    ]);

    const topProviders = providerMetrics
      .sort((a, b) => b.totalRequests - a.totalRequests)
      .slice(0, 10);

    const topUsers = userMetrics
      .sort((a, b) => b.totalRequests - a.totalRequests)
      .slice(0, 10);

    return {
      system: systemMetrics,
      topProviders,
      topUsers
    };
  }
}