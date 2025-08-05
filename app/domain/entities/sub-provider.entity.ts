import { injectable } from 'inversify';

export interface ApiKeyConfig {
  encrypted: string;
  iv: string;
  masterKey: string;
  name: string;
  createdAt: number;
  lastUsedAt?: number;
  isActive: boolean;
}

export interface SubProviderIdentity {
  readonly id: string;
  readonly providerId: string;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SubProviderConfiguration {
  readonly apiKeys: Record<string, ApiKeyConfig>;
  enabled: boolean;
  readonly priority: number;
  readonly weight: number;
  readonly modelMapping: Record<string, string>;
  readonly timeout: number;
  readonly retryAttempts: number;
  readonly customHeaders: Record<string, string>;
}

export interface SubProviderMetrics {
  totalTokenUsage: number;
  totalRequests: number;
  lastUsedAt?: number;
  errorCount: number;
  successCount: number;
  consecutiveErrors: number;
  lastErrorAt?: number;
  lastErrorType?: string;
  avgLatency: number;
  healthScore: number;
  circuitBreakerState: 'closed' | 'open' | 'half-open';
  lastCircuitBreakerTrigger?: number;
}

export interface SubProviderLimits {
  maxRequestsPerMinute: number;
  maxRequestsPerHour: number;
  maxTokensPerMinute: number;
  maxConcurrentRequests: number;
  currentRequestCount: number;
  currentTokenCount: number;
  currentConcurrentRequests: number;
  requestWindow: Array<{ timestamp: number; count: number }>;
  tokenWindow: Array<{ timestamp: number; count: number }>;
  lastWindowReset: number;
}

@injectable()
export class SubProvider {
  private readonly identity: SubProviderIdentity;
  private readonly configuration: SubProviderConfiguration;
  private readonly metrics: SubProviderMetrics;
  private readonly limits: SubProviderLimits;

  constructor(
    identity: SubProviderIdentity,
    configuration: SubProviderConfiguration,
    metrics: SubProviderMetrics,
    limits: SubProviderLimits
  ) {
    this.identity = identity;
    this.configuration = configuration;
    this.metrics = metrics;
    this.limits = limits;
  }

  getId(): string {
    return this.identity.id;
  }

  getName(): string {
    return this.identity.name;
  }

  getProviderId(): string {
    return this.identity.providerId;
  }

  isEnabled(): boolean {
    return this.configuration.enabled;
  }

  getPriority(): number {
    return this.configuration.priority;
  }

  getWeight(): number {
    return this.configuration.weight;
  }

  getApiKeys(): Record<string, ApiKeyConfig> {
    return { ...this.configuration.apiKeys };
  }

  getApiKey(keyName: string = 'default'): ApiKeyConfig | undefined {
    return this.configuration.apiKeys[keyName];
  }

  getPrimaryApiKey(): ApiKeyConfig | undefined {
    const keys = Object.keys(this.configuration.apiKeys);
    if (keys.length === 0) return undefined;
    
    return this.configuration.apiKeys['primary'] ||
           this.configuration.apiKeys['default'] ||
           this.configuration.apiKeys[keys[0]];
  }

  getActiveApiKeys(): Record<string, ApiKeyConfig> {
    const activeKeys: Record<string, ApiKeyConfig> = {};
    for (const [name, config] of Object.entries(this.configuration.apiKeys)) {
      if (config.isActive) {
        activeKeys[name] = config;
      }
    }
    return activeKeys;
  }

  hasApiKey(keyName: string): boolean {
    return keyName in this.configuration.apiKeys;
  }

  getAvailableApiKeyNames(): string[] {
    return Object.keys(this.configuration.apiKeys);
  }

  getActiveApiKeyNames(): string[] {
    return Object.entries(this.configuration.apiKeys)
      .filter(([_, config]) => config.isActive)
      .map(([name, _]) => name);
  }

  isHealthy(): boolean {
    return this.metrics.healthScore > 0.7 && 
           this.metrics.circuitBreakerState === 'closed' &&
           this.metrics.consecutiveErrors < 5;
  }

  isAvailable(): boolean {
    return this.isEnabled() && 
           this.isHealthy() && 
           !this.isRateLimited() &&
           !this.isConcurrencyLimited();
  }

  isRateLimited(): boolean {
    this.cleanupOldWindows();
    const currentRPM = this.getCurrentRequestsPerMinute();
    const currentTPM = this.getCurrentTokensPerMinute();
    
    return currentRPM >= this.limits.maxRequestsPerMinute ||
           currentTPM >= this.limits.maxTokensPerMinute;
  }

  getCurrentRequestsPerMinute(): number {
    this.cleanupOldWindows();
    return this.limits.requestWindow.reduce((sum, window) => sum + window.count, 0);
  }

  getCurrentTokensPerMinute(): number {
    this.cleanupOldWindows();
    return this.limits.tokenWindow.reduce((sum, window) => sum + window.count, 0);
  }

  canHandleRequest(estimatedTokens: number = 0): boolean {
    if (!this.isAvailable()) {
      return false;
    }

    this.cleanupOldWindows();
    const currentRPM = this.getCurrentRequestsPerMinute();
    const currentTPM = this.getCurrentTokensPerMinute();

    return (currentRPM + 1) <= this.limits.maxRequestsPerMinute &&
           (currentTPM + estimatedTokens) <= this.limits.maxTokensPerMinute &&
           (this.limits.currentConcurrentRequests + 1) <= this.limits.maxConcurrentRequests;
  }

  reserveCapacity(estimatedTokens: number = 0): boolean {
    if (!this.canHandleRequest(estimatedTokens)) {
      return false;
    }

    const now = Date.now();
    const currentMinute = Math.floor(now / 60000) * 60000;

    const existingRequestWindow = this.limits.requestWindow.find(w => w.timestamp === currentMinute);
    if (existingRequestWindow) {
      existingRequestWindow.count++;
    } else {
      this.limits.requestWindow.push({ timestamp: currentMinute, count: 1 });
    }

    if (estimatedTokens > 0) {
      const existingTokenWindow = this.limits.tokenWindow.find(w => w.timestamp === currentMinute);
      if (existingTokenWindow) {
        existingTokenWindow.count += estimatedTokens;
      } else {
        this.limits.tokenWindow.push({ timestamp: currentMinute, count: estimatedTokens });
      }
    }

    this.limits.currentConcurrentRequests++;

    return true;
  }

  releaseCapacity(): void {
    this.limits.currentConcurrentRequests = Math.max(0, this.limits.currentConcurrentRequests - 1);
  }

  private cleanupOldWindows(): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    this.limits.requestWindow = this.limits.requestWindow.filter(
      window => window.timestamp > oneMinuteAgo
    );

    this.limits.tokenWindow = this.limits.tokenWindow.filter(
      window => window.timestamp > oneMinuteAgo
    );

    this.limits.currentRequestCount = this.getCurrentRequestsPerMinute();
    this.limits.currentTokenCount = this.getCurrentTokensPerMinute();
  }

  isConcurrencyLimited(): boolean {
    return this.limits.currentConcurrentRequests >= this.limits.maxConcurrentRequests;
  }

  isCircuitBreakerOpen(): boolean {
    return this.metrics.circuitBreakerState === 'open';
  }

  supportsModel(model: string): boolean {
    return this.configuration.modelMapping.hasOwnProperty(model);
  }

  mapModel(model: string): string {
    return this.configuration.modelMapping[model] || model;
  }

  getSuccessRate(): number {
    const total = this.metrics.successCount + this.metrics.errorCount;
    return total > 0 ? this.metrics.successCount / total : 0;
  }

  getAvgLatency(): number {
    return this.metrics.avgLatency;
  }

  getHealthScore(): number {
    return this.metrics.healthScore;
  }

  getConsecutiveErrors(): number {
    return this.metrics.consecutiveErrors;
  }

  recordSuccess(latency: number, tokensUsed: number): void {
    this.metrics.successCount++;
    this.metrics.totalRequests++;
    this.metrics.totalTokenUsage += tokensUsed;
    this.metrics.lastUsedAt = Date.now();
    this.metrics.consecutiveErrors = 0;

    this.updateLatencyMetrics(latency);
    this.updateHealthScore();
    this.updateCircuitBreaker();
  }

  recordError(errorType: string): void {
    this.metrics.errorCount++;
    this.metrics.totalRequests++;
    this.metrics.consecutiveErrors++;
    this.metrics.lastErrorAt = Date.now();
    this.metrics.lastErrorType = errorType;

    this.updateHealthScore();
    this.updateCircuitBreaker();
  }

  updateLimits(requestCount: number, tokenCount: number, concurrentRequests: number): void {
    this.limits.currentRequestCount = requestCount;
    this.limits.currentTokenCount = tokenCount;
    this.limits.currentConcurrentRequests = concurrentRequests;
  }

  openCircuitBreaker(): void {
    this.metrics.circuitBreakerState = 'open';
    this.metrics.lastCircuitBreakerTrigger = Date.now();
  }

  closeCircuitBreaker(): void {
    this.metrics.circuitBreakerState = 'closed';
    this.metrics.consecutiveErrors = 0;
  }

  halfOpenCircuitBreaker(): void {
    this.metrics.circuitBreakerState = 'half-open';
  }

  enable(): void {
    this.configuration.enabled = true;
  }

  disable(): void {
    this.configuration.enabled = false;
  }

  getMetrics(): {
    totalTokenUsage: number;
    totalRequests: number;
    successCount: number;
    errorCount: number;
    consecutiveErrors: number;
    avgLatency: number;
    successRate: number;
    healthScore: number;
    circuitBreakerState: string;
    lastUsedAt?: number;
    lastErrorAt?: number;
  } {
    return {
      totalTokenUsage: this.metrics.totalTokenUsage,
      totalRequests: this.metrics.totalRequests,
      successCount: this.metrics.successCount,
      errorCount: this.metrics.errorCount,
      consecutiveErrors: this.metrics.consecutiveErrors,
      avgLatency: this.metrics.avgLatency,
      successRate: this.getSuccessRate(),
      healthScore: this.metrics.healthScore,
      circuitBreakerState: this.metrics.circuitBreakerState,
      lastUsedAt: this.metrics.lastUsedAt,
      lastErrorAt: this.metrics.lastErrorAt
    };
  }

  getLimits(): {
    maxRequestsPerMinute: number;
    maxTokensPerMinute: number;
    maxConcurrentRequests: number;
    currentRequestCount: number;
    currentTokenCount: number;
    currentConcurrentRequests: number;
    isRateLimited: boolean;
    isConcurrencyLimited: boolean;
  } {
    return {
      maxRequestsPerMinute: this.limits.maxRequestsPerMinute,
      maxTokensPerMinute: this.limits.maxTokensPerMinute,
      maxConcurrentRequests: this.limits.maxConcurrentRequests,
      currentRequestCount: this.limits.currentRequestCount,
      currentTokenCount: this.limits.currentTokenCount,
      currentConcurrentRequests: this.limits.currentConcurrentRequests,
      isRateLimited: this.isRateLimited(),
      isConcurrencyLimited: this.isConcurrencyLimited()
    };
  }

  getFullLimits(): SubProviderLimits {
    return { ...this.limits };
  }

  getIdentity(): SubProviderIdentity {
    return { ...this.identity };
  }

  getConfiguration(): SubProviderConfiguration {
    return { ...this.configuration };
  }

  getCreatedAt(): number {
    return this.identity.createdAt;
  }

  getUpdatedAt(): number {
    return this.identity.updatedAt;
  }

  getTimeout(): number {
    return this.configuration.timeout;
  }

  getRetryAttempts(): number {
    return this.configuration.retryAttempts;
  }

  getModelMapping(): Record<string, string> {
    return { ...this.configuration.modelMapping };
  }

  getCustomHeaders(): Record<string, string> {
    return { ...this.configuration.customHeaders };
  }

  getCircuitBreakerState(): 'closed' | 'open' | 'half-open' {
    return this.metrics.circuitBreakerState;
  }

  getTotalTokenUsage(): number {
    return this.metrics.totalTokenUsage;
  }

  getTotalRequests(): number {
    return this.metrics.totalRequests;
  }

  getLastUsedAt(): number | undefined {
    return this.metrics.lastUsedAt;
  }

  getLastErrorAt(): number | undefined {
    return this.metrics.lastErrorAt;
  }

  getLastErrorType(): string | undefined {
    return this.metrics.lastErrorType;
  }

  getLastCircuitBreakerTrigger(): number | undefined {
    return this.metrics.lastCircuitBreakerTrigger;
  }

  private updateLatencyMetrics(latency: number): void {
    const total = this.metrics.successCount + this.metrics.errorCount;
    this.metrics.avgLatency = ((this.metrics.avgLatency * (total - 1)) + latency) / total;
  }

  private updateHealthScore(): void {
    const successRate = this.getSuccessRate();
    const errorPenalty = Math.min(this.metrics.consecutiveErrors * 0.1, 0.5);
    const latencyPenalty = Math.max(0, (this.metrics.avgLatency - 1000) / 10000);
    
    this.metrics.healthScore = Math.max(0, Math.min(1, successRate - errorPenalty - latencyPenalty));
  }

  private updateCircuitBreaker(): void {
    if (this.metrics.circuitBreakerState === 'closed' && this.metrics.consecutiveErrors >= 5) {
      this.openCircuitBreaker();
    } else if (this.metrics.circuitBreakerState === 'open') {
      const timeSinceOpen = Date.now() - (this.metrics.lastCircuitBreakerTrigger || 0);
      if (timeSinceOpen > 60000) {
        this.halfOpenCircuitBreaker();
      }
    } else if (this.metrics.circuitBreakerState === 'half-open' && this.metrics.consecutiveErrors === 0) {
      this.closeCircuitBreaker();
    }
  }
}