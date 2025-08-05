import { injectable, inject } from 'inversify';
import { TYPES } from '../../core/container';
import type { ILogger } from '../../core/logging';
import type { ErrorClassificationService } from '../../core/error-classification';
import type { UserService, AuthorizationService, LoadBalancerService, ApiRequestService } from '../../domain/services';
import type { LoadBalancingResult } from '../../domain/services';
import type { ApiRequest } from '../../domain/entities';
import type { EmbeddingRequest, EmbeddingResponse, AuthenticatedUser } from '../types';

interface ProviderAttempt {
  providerId: string;
  subProviderId?: string;
  attempt: number;
  error?: string;
  latency?: number;
}

@injectable()
export class EmbeddingsService {
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
    this.logger = logger.createChild('EmbeddingsService');
    this.errorClassificationService = errorClassificationService;
    this.userService = userService;
    this.authorizationService = authorizationService;
    this.loadBalancerService = loadBalancerService;
    this.apiRequestService = apiRequestService;
  }

  async createEmbeddings(request: EmbeddingRequest, user: AuthenticatedUser): Promise<EmbeddingResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    let apiRequest: ApiRequest | null = null;

    try {
      this.logger.info('Processing embeddings request', {
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
        '/v1/embeddings'
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
        endpoint: '/v1/embeddings',
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

      const result = await this.processEmbeddingsWithRetry(request, requestId);
      const totalLatency = Date.now() - startTime;

      await this.apiRequestService.completeApiRequest(apiRequest.getId(), {
        tokensUsed: this.calculateTokensUsed(request),
        creditsUsed: estimatedCredits,
        latency: totalLatency,
        responseSize: JSON.stringify(result).length,
        statusCode: 200
      });

      this.logger.info('Embeddings request completed successfully', {
        requestId,
        userId: user.id,
        metadata: {
          model: request.model,
          latency: totalLatency,
          embeddingsCount: result.data.length
        }
      });

      return result;

    } catch (error) {
      this.logger.error('Embeddings request failed', error as Error, {
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

  private async processEmbeddingsWithRetry(
    request: EmbeddingRequest,
    requestId: string
  ): Promise<EmbeddingResponse> {
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

        this.logger.debug('Attempting embeddings provider request', {
          requestId,
          metadata: {
            providerId: loadBalancingResult.provider.getId(),
            subProviderId: loadBalancingResult.subProvider?.getId(),
            attempt,
            excludedProviders: excludedProviders.length
          }
        });

        const adapter = loadBalancingResult.subProvider
          ? await this.loadBalancerService.getAdapter(loadBalancingResult.subProvider)
          : await this.loadBalancerService.getAdapter(loadBalancingResult.provider as any);

        if (!adapter) {
          throw new Error('Failed to create adapter for selected provider');
        }

        if (loadBalancingResult.subProvider) {
          const estimatedTokens = this.calculateTokensUsed(request);
          const reserved = await this.loadBalancerService.reserveCapacity(
            loadBalancingResult.subProvider.getId(),
            estimatedTokens
          );
          
          if (!reserved) {
            throw new Error('Unable to reserve capacity for this request');
          }
        }

        try {
          const result = await adapter.createEmbeddings(request);
          
          const responseLatency = Date.now() - attemptStartTime;
          const tokensUsed = this.calculateTokensUsed(request);
          
          await this.loadBalancerService.recordSuccess(
            loadBalancingResult.provider.getId(),
            loadBalancingResult.subProvider?.getId(),
            responseLatency,
            tokensUsed,
            0
          );

          this.logger.info('Embeddings provider request successful', {
            requestId,
            metadata: {
              providerId: loadBalancingResult.provider.getId(),
              subProviderId: loadBalancingResult.subProvider?.getId(),
              attempt,
              latency: responseLatency,
              tokensUsed,
              embeddingsCount: result.data.length
            }
          });

          return result;

        } finally {
          if (loadBalancingResult.subProvider) {
            await this.loadBalancerService.releaseCapacity(loadBalancingResult.subProvider.getId());
          }
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
            
            this.logger.warn('Embeddings provider request failed, retrying', {
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

        this.logger.error('Embeddings provider request failed, not retrying', error as Error, {
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

    throw new Error(`All ${maxAttempts} embeddings provider attempts failed. Excluded providers: ${excludedProviders.join(', ')}`);
  }

  private estimateCredits(request: EmbeddingRequest): number {
    const tokens = this.calculateTokensUsed(request);
    return Math.ceil(tokens * 0.0001);
  }

  private calculateTokensUsed(request: EmbeddingRequest): number {
    const input = request.input;
    
    if (typeof input === 'string') {
      return Math.ceil(input.length / 4);
    }
    
    if (Array.isArray(input)) {
      if (input.length === 0) return 0;
      
      if (typeof input[0] === 'string') {
        return (input as string[]).reduce((total, text) => {
          return total + Math.ceil(text.length / 4);
        }, 0);
      }
      
      if (typeof input[0] === 'number') {
        return input.length;
      }
      
      if (Array.isArray(input[0])) {
        return (input as number[][]).reduce((total, arr) => {
          return total + arr.length;
        }, 0);
      }
    }
    
    return 1;
  }

  private generateRequestId(): string {
    return `emb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}