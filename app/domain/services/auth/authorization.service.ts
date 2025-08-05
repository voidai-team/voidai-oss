import { injectable, inject } from 'inversify';
import { User } from '../../entities';
import { ModelRegistryService } from '../provider';
import { TYPES } from '../../../core/container';

export interface AuthorizationResult {
  authorized: boolean;
  reason?: string;
  user?: User;
  errorCode?: string;
  httpStatus?: number;
}

@injectable()
export class AuthorizationService {
  constructor(
    @inject(TYPES.ModelRegistryService) private modelRegistry: ModelRegistryService
  ) {}

  async authorizeCredits(user: User, amount: number, model?: string): Promise<AuthorizationResult> {
    if (!user.isEnabled()) {
      return {
        authorized: false,
        reason: 'Your account has been disabled. Please contact our support team to resolve this issue.',
        errorCode: 'ACCOUNT_DISABLED',
        httpStatus: 403
      };
    }

    const modelClass = model ? this.modelRegistry.getById(model) : null;
    const isFreeModel = modelClass ? modelClass.planRequirements.includes('free') : false;
    
    if (!isFreeModel && user.isPlanExpired()) {
      return {
        authorized: false,
        reason: 'Your subscription has expired. Please upgrade your plan to continue using premium models.',
        errorCode: 'PLAN_EXPIRED',
        httpStatus: 402
      };
    }

    if (!user.authorizeCredits(amount)) {
      return {
        authorized: false,
        reason: `Insufficient credits. You need ${amount} credits but only have ${user.getCredits()} available.`,
        errorCode: 'INSUFFICIENT_CREDITS',
        httpStatus: 402
      };
    }

    return { authorized: true, user };
  }

  async authorizeRequest(user: User, model?: string): Promise<AuthorizationResult> {
    if (!user.isEnabled()) {
      return {
        authorized: false,
        reason: 'Your account has been disabled. Please contact our support team to resolve this issue.',
        errorCode: 'ACCOUNT_DISABLED',
        httpStatus: 403
      };
    }

    const modelClass = model ? this.modelRegistry.getById(model) : null;
    const isFreeModel = modelClass ? modelClass.planRequirements.includes('free') : false;
    
    if (!isFreeModel && user.isPlanExpired()) {
      return {
        authorized: false,
        reason: 'Your subscription has expired. Please upgrade your plan to access premium models.',
        errorCode: 'PLAN_EXPIRED',
        httpStatus: 402
      };
    }

    return { authorized: true, user };
  }

  async authorizeIpAccess(user: User, ipAddress: string): Promise<AuthorizationResult> {
    if (!user.authorizeIpAccess(ipAddress)) {
      return {
        authorized: false,
        reason: `Access denied from IP address ${ipAddress}. Please add this IP to your whitelist or contact support.`,
        errorCode: 'IP_NOT_WHITELISTED',
        httpStatus: 403
      };
    }

    return { authorized: true, user };
  }

  async authorizeRateLimit(user: User, currentRequests: number): Promise<AuthorizationResult> {
    if (!user.authorizeRateLimit(currentRequests)) {
      const resetTime = new Date(Date.now() + 60000).toISOString();
      return {
        authorized: false,
        reason: `Rate limit exceeded. You have made ${currentRequests} requests. Please wait until ${resetTime} before making more requests.`,
        errorCode: 'RATE_LIMIT_EXCEEDED',
        httpStatus: 429
      };
    }

    return { authorized: true, user };
  }

  async authorizeConcurrentRequests(user: User, activeRequests: number): Promise<AuthorizationResult> {
    if (!user.authorizeConcurrentRequests(activeRequests)) {
      return {
        authorized: false,
        reason: `Too many concurrent requests. You currently have ${activeRequests} active requests. Please wait for some to complete before starting new ones.`,
        errorCode: 'CONCURRENT_LIMIT_EXCEEDED',
        httpStatus: 429
      };
    }

    return { authorized: true, user };
  }

  async performFullAuthorization(
    user: User,
    creditsRequired: number,
    ipAddress: string,
    currentRequests: number,
    activeRequests: number,
    model?: string
  ): Promise<AuthorizationResult> {
    const checks = [
      () => this.authorizeRequest(user, model),
      () => this.authorizeCredits(user, creditsRequired, model),
      () => this.authorizeIpAccess(user, ipAddress),
      () => this.authorizeRateLimit(user, currentRequests),
      () => this.authorizeConcurrentRequests(user, activeRequests)
    ];

    for (const check of checks) {
      const result = await check();
      if (!result.authorized) {
        return result;
      }
    }

    return { authorized: true, user };
  }

  async authorizeModel(user: User, model: string, endpoint: string): Promise<AuthorizationResult> {
    const modelEntity = this.modelRegistry.getById(model);
    
    if (!modelEntity) {
      return {
        authorized: false,
        reason: `Model '${model}' is not supported or does not exist.`,
        errorCode: 'MODEL_NOT_FOUND',
        httpStatus: 400
      };
    }

    if (!modelEntity.endpoints.includes(endpoint)) {
      return {
        authorized: false,
        reason: `Model '${model}' does not support endpoint '${endpoint}'.`,
        errorCode: 'ENDPOINT_NOT_SUPPORTED',
        httpStatus: 400
      };
    }

    if (!modelEntity.planRequirements.includes(user.getPlan())) {
      return {
        authorized: false,
        reason: `Your ${user.getPlan()} plan does not have access to model '${model}'. Please upgrade your plan.`,
        errorCode: 'MODEL_ACCESS_DENIED',
        httpStatus: 403
      };
    }

    return { authorized: true, user };
  }

  async authorizeAdmin(user: User): Promise<AuthorizationResult> {
    if (!user.isEnabled()) {
      return {
        authorized: false,
        reason: 'Your account has been disabled. Please contact our support team to resolve this issue.',
        errorCode: 'ACCOUNT_DISABLED',
        httpStatus: 403
      };
    }

    if (!user.authorizePermission('admin') && !user.authorizePermission('*')) {
      return {
        authorized: false,
        reason: 'Access denied. Admin privileges required to access this resource.',
        errorCode: 'ADMIN_ACCESS_DENIED',
        httpStatus: 403
      };
    }

    return { authorized: true, user };
  }
}