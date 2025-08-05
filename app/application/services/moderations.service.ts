import { injectable, inject } from 'inversify';
import { TYPES } from '../../core/container';
import type { ILogger } from '../../core/logging';
import type { ErrorClassificationService } from '../../core/error-classification';
import type { UserService, AuthorizationService, LoadBalancerService, LoadBalancingResult, ApiRequestService } from '../../domain/services';
import type { ApiRequest } from '../../domain/entities';
import type { ModerationRequest, ModerationResponse, AuthenticatedUser } from '../types';

interface ProviderAttempt {
  providerId: string;
  subProviderId?: string;
  attempt: number;
  error?: string;
  latency?: number;
}

@injectable()
export class ModerationsService {
  private readonly logger: ILogger;
  private readonly errorClassificationService: ErrorClassificationService;
  private readonly userService: UserService;
  private readonly authorizationService: AuthorizationService;
  private readonly loadBalancerService: LoadBalancerService;
  private readonly apiRequestService: ApiRequestService;

  constructor(
    @inject(TYPES.Logger) logger: ILogger,
    @inject(TYPES.ErrorClassificationService) errorClassificationService: ErrorClassificationService,
    @inject(TYPES.UserService) userService: UserService,
    @inject(TYPES.AuthorizationService) authorizationService: AuthorizationService,
    @inject(TYPES.LoadBalancerService) loadBalancerService: LoadBalancerService,
    @inject(TYPES.ApiRequestService) apiRequestService: ApiRequestService
  ) {
    this.logger = logger.createChild('ModerationsService');
    this.errorClassificationService = errorClassificationService;
    this.userService = userService;
    this.authorizationService = authorizationService;
    this.loadBalancerService = loadBalancerService;
    this.apiRequestService = apiRequestService;
  }

  async createModeration(request: ModerationRequest, user: AuthenticatedUser): Promise<ModerationResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    let apiRequest: ApiRequest | null = null;

    try {
      this.logger.info('Processing moderation request', {
        requestId,
        userId: user.id,
        metadata: {
          model: request.model,
          inputType: Array.isArray(request.input) ? 'array' : 'string',
          inputCount: Array.isArray(request.input) ? request.input.length : 1
        }
      });

      const userEntity = await this.userService.getUserById(user.id);
      if (!userEntity) {
        throw new Error('User not found');
      }

      const authResult = await this.authorizationService.authorizeModel(
        userEntity,
        request.model,
        '/v1/moderations'
      );

      if (!authResult.authorized) {
        throw new Error(authResult.reason || 'Authorization failed');
      }

      const estimatedCredits = this.estimateCredits(request);
      const creditAuthResult = await this.authorizationService.authorizeCredits(
        userEntity,
        estimatedCredits,
        request.model
      );

      if (!creditAuthResult.authorized) {
        throw new Error(creditAuthResult.reason || 'Insufficient credits');
      }

      apiRequest = await this.apiRequestService.createApiRequest({
        userId: user.id,
        endpoint: '/v1/moderations',
        method: 'POST',
        model: request.model,
        ipAddress: '',
        userAgent: '',
        requestSize: JSON.stringify(request).length
      });
      
      if (!apiRequest) {
        throw new Error('Failed to create API request');
      }

      await this.apiRequestService.startProcessing(apiRequest.getId());

      const result = await this.processModerationWithRetry(request, requestId);
      const totalLatency = Date.now() - startTime;

      await this.apiRequestService.completeApiRequest(apiRequest.getId(), {
        tokensUsed: this.calculateTokensUsed(request),
        creditsUsed: estimatedCredits,
        latency: totalLatency,
        responseSize: JSON.stringify(result).length,
        statusCode: 200
      });

      this.logger.info('Moderation request completed successfully', {
        requestId,
        userId: user.id,
        metadata: {
          model: request.model,
          latency: totalLatency,
          resultsCount: result.results.length
        }
      });

      return result;

    } catch (error) {
      this.logger.error('Moderation request failed', error as Error, {
        metadata: { userId: user.id, model: request.model, requestId }
      });

      if (apiRequest) {
        const latency = Date.now() - startTime;
        await this.apiRequestService.failApiRequest(apiRequest.getId(), {
          statusCode: 500,
          errorMessage: (error as Error).message,
          latency
        });
      }

      throw error;
    }
  }

  private async processModerationWithRetry(
    request: ModerationRequest,
    requestId: string
  ): Promise<ModerationResponse> {
    const excludedProviders: string[] = [];
    const maxAttempts = 10;
    const attempts: ProviderAttempt[] = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptStartTime = Date.now();
      let loadBalancingResult: LoadBalancingResult | null = null;

      try {
        loadBalancingResult = await this.loadBalancerService.selectProviderAndSubProvider(request.model);

        if (!loadBalancingResult.provider) {
          throw new Error(loadBalancingResult.error || 'No providers available');
        }

        if (excludedProviders.includes(loadBalancingResult.provider.getId())) {
          continue;
        }

        const attemptLatency = Date.now() - attemptStartTime;
        attempts.push({
          providerId: loadBalancingResult.provider.getId(),
          subProviderId: loadBalancingResult.subProvider?.getId(),
          attempt,
          latency: attemptLatency
        });

        this.logger.debug('Attempting moderation provider request', {
          requestId,
          metadata: {
            providerId: loadBalancingResult.provider.getId(),
            subProviderId: loadBalancingResult.subProvider?.getId(),
            attempt,
            excludedProviders: excludedProviders.length
          }
        });

        if (!loadBalancingResult.subProvider) {
          throw new Error('Sub-provider is required for moderation requests');
        }

        const adapter = await this.loadBalancerService.getAdapter(loadBalancingResult.subProvider);

        if (!adapter) {
          throw new Error('Failed to get provider adapter');
        }

        const estimatedTokens = this.calculateTokensUsed(request);
        const capacityReserved = await this.loadBalancerService.reserveCapacity(
          loadBalancingResult.subProvider.getId(),
          estimatedTokens
        );

        if (!capacityReserved) {
          throw new Error('Unable to reserve capacity for moderation request');
        }

        try {
          const response = await adapter.moderateContent({
            input: request.input,
            model: request.model
          });

          await this.loadBalancerService.recordSuccess(
            loadBalancingResult.provider.getId(),
            loadBalancingResult.subProvider.getId(),
            attemptLatency,
            estimatedTokens
          );

          return response;

        } finally {
          await this.loadBalancerService.releaseCapacity(loadBalancingResult.subProvider.getId());
        }

      } catch (error) {
        const errorMessage = (error as Error).message;
        const attemptLatency = Date.now() - attemptStartTime;

        if (loadBalancingResult?.provider) {
          attempts[attempts.length - 1].error = errorMessage;
          
          await this.loadBalancerService.recordError(
            loadBalancingResult.provider.getId(),
            loadBalancingResult.subProvider?.getId(),
            errorMessage
          );

          const shouldRetry = this.errorClassificationService.isRetryableError(error as Error) && attempt < maxAttempts;
          if (shouldRetry) {
            excludedProviders.push(loadBalancingResult.provider.getId());
            
            this.logger.warn('Moderation provider request failed, retrying', {
              requestId,
              metadata: {
                providerId: loadBalancingResult.provider.getId(),
                attempt,
                error: errorMessage,
                latency: attemptLatency,
                willRetry: true
              }
            });
            
            continue;
          }
        }

        this.logger.error('Moderation provider request failed, not retrying', error as Error, {
          requestId,
          metadata: {
            providerId: loadBalancingResult?.provider?.getId() || 'unknown',
            attempt,
            error: errorMessage,
            latency: attemptLatency,
            attempts: attempts.length
          }
        });

        throw error;
      }
    }

    throw new Error(`All ${maxAttempts} moderation provider attempts failed. Excluded providers: ${excludedProviders.join(', ')}`);
  }

  private estimateCredits(request: ModerationRequest): number {
    const tokens = this.calculateTokensUsed(request);
    return Math.ceil(tokens * 0.0002);
  }

  private calculateTokensUsed(request: ModerationRequest): number {
    if (Array.isArray(request.input)) {
      return request.input.reduce((total, item) => {
        if (typeof item === 'string') {
          return total + Math.ceil(item.length / 4);
        } else if (typeof item === 'object' && item.type === 'text' && item.text) {
          return total + Math.ceil(item.text.length / 4);
        }
        return total + 10;
      }, 0);
    }
    return Math.ceil((request.input as string).length / 4);
  }

  private generateRequestId(): string {
    return `mod-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}