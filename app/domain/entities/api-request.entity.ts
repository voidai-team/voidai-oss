import { injectable } from 'inversify';

export interface RequestIdentity {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: number;
}

export interface RequestDetails {
  readonly endpoint: string;
  readonly method: string;
  model?: string;
  providerId?: string;
  subProviderId?: string;
  readonly ipAddress: string;
  readonly userAgent: string;
}

export interface RequestMetrics {
  tokensUsed: number;
  creditsUsed: number;
  latency: number;
  responseSize: number;
  requestSize: number;
}

export interface RequestStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'timeout';
  statusCode: number;
  errorMessage?: string;
  retryCount: number;
  completedAt?: number;
}

@injectable()
export class ApiRequest {
  private readonly identity: RequestIdentity;
  private readonly details: RequestDetails;
  private readonly metrics: RequestMetrics;
  private readonly status: RequestStatus;

  constructor(
    identity: RequestIdentity,
    details: RequestDetails,
    metrics: RequestMetrics,
    status: RequestStatus
  ) {
    this.identity = identity;
    this.details = details;
    this.metrics = metrics;
    this.status = status;
  }

  getId(): string {
    return this.identity.id;
  }

  getUserId(): string {
    return this.identity.userId;
  }

  getEndpoint(): string {
    return this.details.endpoint;
  }

  getModel(): string | undefined {
    return this.details.model;
  }

  getProviderId(): string | undefined {
    return this.details.providerId;
  }

  getTokensUsed(): number {
    return this.metrics.tokensUsed;
  }

  getCreditsUsed(): number {
    return this.metrics.creditsUsed;
  }

  getLatency(): number {
    return this.metrics.latency;
  }

  getStatus(): string {
    return this.status.status;
  }

  getStatusCode(): number {
    return this.status.statusCode;
  }

  isCompleted(): boolean {
    return this.status.status === 'completed';
  }

  isFailed(): boolean {
    return this.status.status === 'failed' || this.status.status === 'timeout';
  }

  isProcessing(): boolean {
    return this.status.status === 'processing';
  }

  getCreatedAt(): number {
    return this.identity.createdAt;
  }

  getCompletedAt(): number | undefined {
    return this.status.completedAt;
  }

  getDuration(): number | undefined {
    if (!this.status.completedAt) return undefined;
    return this.status.completedAt - this.identity.createdAt;
  }

  getRetryCount(): number {
    return this.status.retryCount;
  }

  getErrorMessage(): string | undefined {
    return this.status.errorMessage;
  }

  getIpAddress(): string {
    return this.details.ipAddress;
  }

  getUserAgent(): string {
    return this.details.userAgent;
  }

  getResponseSize(): number {
    return this.metrics.responseSize;
  }

  getRequestSize(): number {
    return this.metrics.requestSize;
  }

  getEfficiency(): number {
    if (this.metrics.requestSize === 0) return 0;
    return this.metrics.responseSize / this.metrics.requestSize;
  }

  getCostPerToken(): number {
    if (this.metrics.tokensUsed === 0) return 0;
    return this.metrics.creditsUsed / this.metrics.tokensUsed;
  }

  getMetrics(): {
    tokensUsed: number;
    creditsUsed: number;
    latency: number;
    responseSize: number;
    requestSize: number;
    efficiency: number;
    costPerToken: number;
    duration?: number;
  } {
    return {
      tokensUsed: this.metrics.tokensUsed,
      creditsUsed: this.metrics.creditsUsed,
      latency: this.metrics.latency,
      responseSize: this.metrics.responseSize,
      requestSize: this.metrics.requestSize,
      efficiency: this.getEfficiency(),
      costPerToken: this.getCostPerToken(),
      duration: this.getDuration()
    };
  }

  getIdentity(): RequestIdentity {
    return { ...this.identity };
  }

  getDetails(): RequestDetails {
    return { ...this.details };
  }

  getRequestMetrics(): RequestMetrics {
    return { ...this.metrics };
  }

  getRequestStatus(): RequestStatus {
    return { ...this.status };
  }

  getMethod(): string {
    return this.details.method;
  }

  getSubProviderId(): string | undefined {
    return this.details.subProviderId;
  }

  startProcessing(): void {
    this.status.status = 'processing';
  }

  complete(tokensUsed: number, creditsUsed: number, latency: number, responseSize: number, statusCode: number, providerId?: string, subProviderId?: string): void {
    this.status.status = 'completed';
    this.status.statusCode = statusCode;
    this.status.completedAt = Date.now();
    this.metrics.tokensUsed = tokensUsed;
    this.metrics.creditsUsed = creditsUsed;
    this.metrics.latency = latency;
    this.metrics.responseSize = responseSize;
    if (providerId) this.details.providerId = providerId;
    if (subProviderId) this.details.subProviderId = subProviderId;
  }

  fail(statusCode: number, errorMessage: string, latency: number, retryCount?: number): void {
    this.status.status = 'failed';
    this.status.statusCode = statusCode;
    this.status.errorMessage = errorMessage;
    this.status.completedAt = Date.now();
    this.status.retryCount = retryCount || 0;
    this.metrics.latency = latency;
  }

  timeout(latency: number): void {
    this.status.status = 'timeout';
    this.status.statusCode = 408;
    this.status.errorMessage = 'Request timeout';
    this.status.completedAt = Date.now();
    this.metrics.latency = latency;
  }
}