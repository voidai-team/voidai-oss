import { injectable } from 'inversify';

export interface UserIdentity {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface UserAuthentication {
  readonly apiKeyHashes: string[];
}

export interface UserAuthorization {
  readonly plan: string;
  readonly planExpiresAt: number;
  readonly enabled: boolean;
  credits: number;
  readonly creditsLastReset: number;
  readonly permissions: string[];
  readonly ipWhitelist: string[];
  readonly rateLimit: number;
  readonly maxConcurrentRequests: number;
}

export interface UserUsage {
  totalRequests: number;
  totalTokensUsed: number;
  totalCreditsUsed: number;
  lastRequestAt?: number;
  readonly requestHistory: Array<{
    timestamp: number;
    endpoint: string;
    tokensUsed: number;
    creditsUsed: number;
  }>;
}

@injectable()
export class User {
  private readonly identity: UserIdentity;
  private readonly authentication: UserAuthentication;
  private readonly authorization: UserAuthorization;
  private readonly usage: UserUsage;

  constructor(
    identity: UserIdentity,
    authentication: UserAuthentication,
    authorization: UserAuthorization,
    usage: UserUsage
  ) {
    this.identity = identity;
    this.authentication = authentication;
    this.authorization = authorization;
    this.usage = usage;
  }

  getId(): string {
    return this.identity.id;
  }

  getName(): string {
    return this.identity.name;
  }

  getPlan(): string {
    return this.authorization.plan;
  }

  getCredits(): number {
    return this.authorization.credits;
  }

  isEnabled(): boolean {
    return this.authorization.enabled;
  }

  isPlanExpired(): boolean {
    return Date.now() > this.authorization.planExpiresAt;
  }

  authenticateApiKey(keyHash: string): boolean {
    return this.authentication.apiKeyHashes.includes(keyHash) && this.isEnabled();
  }

  authorizeCredits(amount: number): boolean {
    return this.isEnabled() && this.authorization.credits >= amount;
  }

  authorizeIpAccess(ipAddress: string): boolean {
    return this.authorization.ipWhitelist.length === 0 || 
           this.authorization.ipWhitelist.includes(ipAddress);
  }

  authorizePermission(permission: string): boolean {
    return this.authorization.permissions.includes(permission) || 
           this.authorization.permissions.includes('*');
  }

  authorizeRateLimit(currentRequests: number): boolean {
    return currentRequests <= this.authorization.rateLimit;
  }

  authorizeConcurrentRequests(activeRequests: number): boolean {
    return activeRequests <= this.authorization.maxConcurrentRequests;
  }

  debitCredits(amount: number, endpoint: string, tokensUsed: number): void {
    if (!this.authorizeCredits(amount)) {
      throw new Error('Authorization failed: insufficient credits');
    }
    
    this.authorization.credits -= amount;
    this.usage.totalRequests++;
    this.usage.totalTokensUsed += tokensUsed;
    this.usage.totalCreditsUsed += amount;
    this.usage.lastRequestAt = Date.now();
    
    this.usage.requestHistory.push({
      timestamp: Date.now(),
      endpoint,
      tokensUsed,
      creditsUsed: amount
    });
  }

  shouldResetCredits(): boolean {
    const resetInterval = this.getResetInterval();
    return Date.now() - this.authorization.creditsLastReset >= resetInterval;
  }

  getUsageStats(): {
    totalRequests: number;
    totalTokensUsed: number;
    totalCreditsUsed: number;
    lastRequestAt?: number;
  } {
    return {
      totalRequests: this.usage.totalRequests,
      totalTokensUsed: this.usage.totalTokensUsed,
      totalCreditsUsed: this.usage.totalCreditsUsed,
      lastRequestAt: this.usage.lastRequestAt
    };
  }

  getApiKeyHashes(): string[] {
    return [...this.authentication.apiKeyHashes];
  }

  getPlanExpiresAt(): number {
    return this.authorization.planExpiresAt;
  }

  getCreditsLastReset(): number {
    return this.authorization.creditsLastReset;
  }

  getPermissions(): string[] {
    return [...this.authorization.permissions];
  }

  getIpWhitelist(): string[] {
    return [...this.authorization.ipWhitelist];
  }

  getRateLimit(): number {
    return this.authorization.rateLimit;
  }

  getMaxConcurrentRequests(): number {
    return this.authorization.maxConcurrentRequests;
  }

  getRequestHistory(): Array<{
    timestamp: number;
    endpoint: string;
    tokensUsed: number;
    creditsUsed: number;
  }> {
    return [...this.usage.requestHistory];
  }

  getCreatedAt(): number {
    return this.identity.createdAt;
  }

  getUpdatedAt(): number {
    return this.identity.updatedAt;
  }

  private getResetInterval(): number {
    switch (this.authorization.plan) {
      case 'daily': return 24 * 60 * 60 * 1000;
      case 'weekly': return 7 * 24 * 60 * 60 * 1000;
      case 'monthly': return 30 * 24 * 60 * 60 * 1000;
      default: return 24 * 60 * 60 * 1000;
    }
  }
}