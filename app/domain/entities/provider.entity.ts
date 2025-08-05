import { injectable } from 'inversify';

export interface ProviderIdentity {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ProviderConfiguration {
  readonly needsSubProviders: boolean;
  readonly isActive: boolean;
  readonly priority: number;
  readonly baseUrl: string;
  readonly timeout: number;
  readonly retryAttempts: number;
  readonly retryDelay: number;
  readonly supportedModels: string[];
  readonly rateLimits: {
    requestsPerMinute: number;
    requestsPerHour: number;
    tokensPerMinute: number;
  };
  readonly features: string[];
}

export interface ProviderMetrics {
  totalTokenUsage: number;
  totalRequests: number;
  lastUsedAt: number;
  avgLatency: number;
  errorCount: number;
  successCount: number;
  consecutiveErrors: number;
  timeoutCount: number;
  healthStatus: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  throughput: {
    requestsPerSecond: number;
    tokensPerSecond: number;
    peakRequestsPerSecond: number;
    peakTokensPerSecond: number;
  };
  performance: {
    minLatency: number;
    maxLatency: number;
    p50Latency: number;
    p95Latency: number;
    p99Latency: number;
    latencyHistory: Array<{ timestamp: number; latency: number }>;
    lastPercentileCalculation: number;
  };
  capacity: {
    maxConcurrentRequests: number;
    currentConcurrentRequests: number;
    queueLength: number;
    utilizationPercent: number;
  };
}

export interface ProviderCosts {
  totalCost: number;
  costPerToken: number;
  costPerRequest: number;
  monthlySpend: number;
  dailySpend: number;
  budgetAlert: boolean;
}

export interface ProviderSecurity {
  readonly encryptionEnabled: boolean;
  readonly apiKeyRotationEnabled: boolean;
  readonly lastKeyRotation?: number;
  readonly allowedIpRanges: string[];
  readonly securityEvents: Array<{
    timestamp: number;
    event: string;
    severity: 'low' | 'medium' | 'high';
    details: Record<string, any>;
  }>;
}

@injectable()
export class Provider {
  private readonly identity: ProviderIdentity;
  private readonly configuration: ProviderConfiguration;
  private readonly metrics: ProviderMetrics;
  private readonly costs: ProviderCosts;
  private readonly security: ProviderSecurity;

  constructor(
    identity: ProviderIdentity,
    configuration: ProviderConfiguration,
    metrics: ProviderMetrics,
    costs: ProviderCosts,
    security: ProviderSecurity
  ) {
    this.identity = identity;
    this.configuration = configuration;
    this.metrics = metrics;
    this.costs = costs;
    this.security = security;
  }

  getId(): string {
    return this.identity.id;
  }

  getName(): string {
    return this.identity.name;
  }

  getDisplayName(): string {
    return this.identity.displayName;
  }

  isActive(): boolean {
    return this.configuration.isActive && this.isHealthy();
  }

  needsSubProviders(): boolean {
    return this.configuration.needsSubProviders;
  }

  getPriority(): number {
    return this.configuration.priority;
  }

  getSupportedModels(): string[] {
    return [...this.configuration.supportedModels];
  }

  getSuccessRate(): number {
    const total = this.metrics.successCount + this.metrics.errorCount;
    return total > 0 ? this.metrics.successCount / total : 0;
  }

  getAvgLatency(): number {
    return this.metrics.avgLatency;
  }

  getTotalTokenUsage(): number {
    return this.metrics.totalTokenUsage;
  }

  getTotalCost(): number {
    return this.costs.totalCost;
  }

  getMonthlySpend(): number {
    return this.costs.monthlySpend;
  }

  isHealthy(): boolean {
    return this.metrics.healthStatus === 'healthy';
  }

  isDegraded(): boolean {
    return this.metrics.healthStatus === 'degraded';
  }

  supportsModel(model: string): boolean {
    return this.configuration.supportedModels.includes(model);
  }

  supportsFeature(feature: string): boolean {
    return this.configuration.features.includes(feature);
  }

  recordSuccess(latency: number, tokensUsed: number, cost: number): void {
    this.metrics.successCount++;
    this.metrics.totalRequests++;
    this.metrics.totalTokenUsage += tokensUsed;
    this.metrics.lastUsedAt = Date.now();
    this.metrics.consecutiveErrors = 0;
    
    this.costs.totalCost += cost;
    this.costs.dailySpend += cost;
    this.costs.monthlySpend += cost;
    
    this.updateLatencyMetrics(latency);
    this.updatePerformanceMetrics(latency);
    this.updateThroughputMetrics(tokensUsed);
    this.updateCapacityMetrics();
    this.updateHealthStatusBasedOnErrors();
  }

  recordError(errorType: string): void {
    this.metrics.errorCount++;
    this.metrics.totalRequests++;
    this.metrics.consecutiveErrors++;
    this.metrics.lastUsedAt = Date.now();
    
    if (errorType === 'timeout') {
      this.metrics.timeoutCount++;
    }
    
    this.updateHealthStatusBasedOnErrors();
  }

  recordSecurityEvent(event: string, severity: 'low' | 'medium' | 'high', details: Record<string, any>): void {
    this.security.securityEvents.push({
      timestamp: Date.now(),
      event,
      severity,
      details
    });
  }

  updateHealthStatus(status: 'healthy' | 'degraded' | 'unhealthy'): void {
    this.metrics.healthStatus = status;
  }

  getMetrics(): {
    totalTokenUsage: number;
    totalRequests: number;
    successCount: number;
    errorCount: number;
    consecutiveErrors: number;
    timeoutCount: number;
    avgLatency: number;
    successRate: number;
    healthStatus: string;
    uptime: number;
    lastUsedAt: number;
    throughput: {
      requestsPerSecond: number;
      tokensPerSecond: number;
      peakRequestsPerSecond: number;
      peakTokensPerSecond: number;
    };
    performance: {
      minLatency: number;
      maxLatency: number;
      p50Latency: number;
      p95Latency: number;
      p99Latency: number;
      latencyHistory: Array<{ timestamp: number; latency: number }>;
      lastPercentileCalculation: number;
    };
    capacity: {
      maxConcurrentRequests: number;
      currentConcurrentRequests: number;
      queueLength: number;
      utilizationPercent: number;
    };
  } {
    return {
      totalTokenUsage: this.metrics.totalTokenUsage,
      totalRequests: this.metrics.totalRequests,
      successCount: this.metrics.successCount,
      errorCount: this.metrics.errorCount,
      consecutiveErrors: this.metrics.consecutiveErrors,
      timeoutCount: this.metrics.timeoutCount,
      avgLatency: this.metrics.avgLatency,
      successRate: this.getSuccessRate(),
      healthStatus: this.metrics.healthStatus,
      uptime: this.metrics.uptime,
      lastUsedAt: this.metrics.lastUsedAt,
      throughput: this.metrics.throughput,
      performance: this.metrics.performance,
      capacity: this.metrics.capacity
    };
  }

  getCostMetrics(): {
    totalCost: number;
    monthlySpend: number;
    dailySpend: number;
    costPerToken: number;
    costPerRequest: number;
  } {
    return {
      totalCost: this.costs.totalCost,
      monthlySpend: this.costs.monthlySpend,
      dailySpend: this.costs.dailySpend,
      costPerToken: this.costs.costPerToken,
      costPerRequest: this.costs.costPerRequest
    };
  }

  getConfiguration(): ProviderConfiguration {
    return { ...this.configuration };
  }

  getBaseUrl(): string {
    return this.configuration.baseUrl;
  }

  getTimeout(): number {
    return this.configuration.timeout;
  }

  getRetryAttempts(): number {
    return this.configuration.retryAttempts;
  }

  getRetryDelay(): number {
    return this.configuration.retryDelay;
  }

  getRateLimits(): {
    requestsPerMinute: number;
    requestsPerHour: number;
    tokensPerMinute: number;
  } {
    return { ...this.configuration.rateLimits };
  }

  getFeatures(): string[] {
    return [...this.configuration.features];
  }

  getIdentity(): ProviderIdentity {
    return { ...this.identity };
  }

  getCreatedAt(): number {
    return this.identity.createdAt;
  }

  getUpdatedAt(): number {
    return this.identity.updatedAt;
  }

  getSecurity(): ProviderSecurity {
    return { ...this.security };
  }

  getSecurityEvents(): Array<{
    timestamp: number;
    event: string;
    severity: 'low' | 'medium' | 'high';
    details: Record<string, any>;
  }> {
    return [...this.security.securityEvents];
  }

  isEncryptionEnabled(): boolean {
    return this.security.encryptionEnabled;
  }

  isApiKeyRotationEnabled(): boolean {
    return this.security.apiKeyRotationEnabled;
  }

  getLastKeyRotation(): number | undefined {
    return this.security.lastKeyRotation;
  }

  getAllowedIpRanges(): string[] {
    return [...this.security.allowedIpRanges];
  }

  private updateLatencyMetrics(latency: number): void {
    const total = this.metrics.successCount + this.metrics.errorCount;
    this.metrics.avgLatency = ((this.metrics.avgLatency * (total - 1)) + latency) / total;
  }

  private updatePerformanceMetrics(latency: number): void {
    const now = Date.now();
    
    this.metrics.performance.latencyHistory.push({
      timestamp: now,
      latency: latency
    });
    
    this.cleanupOldLatencyHistory(now);
    
    this.metrics.performance.minLatency = Math.min(this.metrics.performance.minLatency, latency);
    this.metrics.performance.maxLatency = Math.max(this.metrics.performance.maxLatency, latency);
    
    if (now - this.metrics.performance.lastPercentileCalculation > 5000) {
      this.calculateLatencyPercentiles();
      this.metrics.performance.lastPercentileCalculation = now;
    }
  }

  private cleanupOldLatencyHistory(now: number): void {
    const maxAge = 10 * 60 * 1000;
    const maxEntries = 1000;
    
    this.metrics.performance.latencyHistory = this.metrics.performance.latencyHistory
      .filter(entry => now - entry.timestamp <= maxAge)
      .slice(-maxEntries);
  }

  private calculateLatencyPercentiles(): void {
    if (this.metrics.performance.latencyHistory.length === 0) {
      return;
    }
    
    const latencies = this.metrics.performance.latencyHistory
      .map(entry => entry.latency)
      .sort((a, b) => a - b);
    
    this.metrics.performance.p50Latency = this.calculatePercentile(latencies, 0.50);
    this.metrics.performance.p95Latency = this.calculatePercentile(latencies, 0.95);
    this.metrics.performance.p99Latency = this.calculatePercentile(latencies, 0.99);
  }

  private calculatePercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;
    if (sortedArray.length === 1) return sortedArray[0];
    
    const index = (sortedArray.length - 1) * percentile;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    
    if (lower === upper) {
      return sortedArray[lower];
    }
    
    const weight = index - lower;
    return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
  }

  private updateThroughputMetrics(tokensUsed: number): void {
    const now = Date.now();
    const windowSize = 1000;
    
    this.metrics.throughput.requestsPerSecond = this.calculateRPS(now, windowSize);
    this.metrics.throughput.tokensPerSecond = this.calculateTPS(tokensUsed, windowSize);
    
    this.metrics.throughput.peakRequestsPerSecond = Math.max(
      this.metrics.throughput.peakRequestsPerSecond,
      this.metrics.throughput.requestsPerSecond
    );
    
    this.metrics.throughput.peakTokensPerSecond = Math.max(
      this.metrics.throughput.peakTokensPerSecond,
      this.metrics.throughput.tokensPerSecond
    );
  }

  private calculateRPS(now: number, windowSize: number): number {
    return this.metrics.totalRequests / ((now - (this.metrics.lastUsedAt - windowSize)) / 1000);
  }

  private calculateTPS(tokensUsed: number, windowSize: number): number {
    return tokensUsed / (windowSize / 1000);
  }

  private updateCapacityMetrics(): void {
    const utilizationPercent = Math.min(100, (this.metrics.capacity.currentConcurrentRequests / this.metrics.capacity.maxConcurrentRequests) * 100);
    this.metrics.capacity.utilizationPercent = utilizationPercent;
  }

  incrementConcurrentRequests(): void {
    this.metrics.capacity.currentConcurrentRequests++;
    this.updateCapacityMetrics();
  }

  decrementConcurrentRequests(): void {
    this.metrics.capacity.currentConcurrentRequests = Math.max(0, this.metrics.capacity.currentConcurrentRequests - 1);
    this.updateCapacityMetrics();
  }

  getConsecutiveErrors(): number {
    return this.metrics.consecutiveErrors;
  }

  private updateHealthStatusBasedOnErrors(): void {
    const consecutiveErrors = this.metrics.consecutiveErrors;
    const successRate = this.getSuccessRate();
    const avgLatency = this.metrics.avgLatency;
    
    if (consecutiveErrors >= 10 || successRate < 0.5) {
      this.metrics.healthStatus = 'unhealthy';
    } else if (consecutiveErrors >= 5 || successRate < 0.8 || avgLatency > 5000) {
      this.metrics.healthStatus = 'degraded';
    } else if (consecutiveErrors === 0 && successRate >= 0.95 && avgLatency <= 2000) {
      this.metrics.healthStatus = 'healthy';
    }
  }
}