import { injectable, inject } from 'inversify';
import { TYPES } from '../../core/container';
import type { ILogger } from '../../core/logging';
import type { ErrorClassificationService } from '../../core/error-classification';
import type { UserService, AuthorizationService, LoadBalancerService, ApiRequestService, CSAMDetectorService } from '../../domain/services';
import type { LoadBalancingResult } from '../../domain/services/provider/load-balancer.service';
import type { ApiRequest } from '../../domain/entities';
import type { ImageGenerationRequest, ImageEditRequest, ImageResponse, AuthenticatedUser } from '../types';

interface ProviderAttempt {
  providerId: string;
  subProviderId?: string;
  attempt: number;
  error?: string;
  latency?: number;
}

@injectable()
export class ImagesService {
  private readonly logger: ILogger;
  private readonly errorClassificationService: ErrorClassificationService;
  private readonly userService: UserService;
  private readonly authorizationService: AuthorizationService;
  private readonly loadBalancerService: LoadBalancerService;
  private readonly apiRequestService: ApiRequestService;
  private readonly csamDetectorService: CSAMDetectorService;

  constructor(
    @inject(TYPES.Logger) logger: ILogger,
    @inject(TYPES.ErrorClassificationService) errorClassificationService: ErrorClassificationService,
    @inject(TYPES.UserService) userService: UserService,
    @inject(TYPES.AuthorizationService) authorizationService: AuthorizationService,
    @inject(TYPES.LoadBalancerService) loadBalancerService: LoadBalancerService,
    @inject(TYPES.ApiRequestService) apiRequestService: ApiRequestService,
    @inject(TYPES.CSAMDetectorService) csamDetectorService: CSAMDetectorService
  ) {
    this.logger = logger.createChild('ImagesService');
    this.errorClassificationService = errorClassificationService;
    this.userService = userService;
    this.authorizationService = authorizationService;
    this.loadBalancerService = loadBalancerService;
    this.apiRequestService = apiRequestService;
    this.csamDetectorService = csamDetectorService;
  }

  async generateImages(request: ImageGenerationRequest, user: AuthenticatedUser): Promise<ImageResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    let apiRequest: ApiRequest | null = null;

    try {
      this.logger.info('Processing image generation request', {
        requestId,
        userId: user.id,
        metadata: {
          model: request.model,
          prompt: request.prompt.substring(0, 100),
          size: request.size,
          n: request.n
        }
      });

      const userEntity = await this.userService.getUserById(user.id);
      if (!userEntity) {
        throw new Error('User not found');
      }

      this.logger.info('Starting CSAM moderation check for image generation prompt', {
        requestId,
        userId: user.id,
        metadata: {
          promptLength: request.prompt.length
        }
      });

      const moderationResult = await this.csamDetectorService.checkPrompt(
        request.prompt,
        user.id
      );

      if (moderationResult.isFlagged) {
        this.logger.error('🚨 IMAGE GENERATION REQUEST BLOCKED - CSAM CONTENT DETECTED 🚨', undefined, {
          metadata: {
            userId: user.id,
            requestId,
            categories: moderationResult.categories,
            reason: moderationResult.reason,
            userDisabled: moderationResult.userDisabled,
            timestamp: new Date().toISOString()
          }
        });

        throw new Error('Content violates our terms of service and has been blocked');
      }

      this.logger.info('CSAM moderation check passed for image generation', {
        requestId,
        userId: user.id
      });

      const authResult = await this.authorizationService.authorizeModel(
        userEntity,
        request.model,
        '/v1/images/generations'
      );

      if (!authResult.authorized) {
        throw new Error(authResult.reason || 'Authorization failed');
      }

      const estimatedCredits = this.estimateGenerationCredits(request);
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
        endpoint: '/v1/images/generations',
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

      const result = await this.processImageGenerationWithRetry(request, requestId);
      const totalLatency = Date.now() - startTime;

      await this.apiRequestService.completeApiRequest(apiRequest.getId(), {
        tokensUsed: Math.ceil(request.prompt.length / 4),
        creditsUsed: estimatedCredits,
        latency: totalLatency,
        responseSize: JSON.stringify(result).length,
        statusCode: 200
      });

      this.logger.info('Image generation completed successfully', {
        requestId,
        userId: user.id,
        metadata: {
          model: request.model,
          latency: totalLatency,
          imagesGenerated: result.data.length
        }
      });

      return result;

    } catch (error) {
      this.logger.error('Image generation failed', error as Error, {
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

  async editImages(request: ImageEditRequest, user: AuthenticatedUser): Promise<ImageResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    let apiRequest: ApiRequest | null = null;

    try {
      this.logger.info('Processing image edit request', {
        requestId,
        userId: user.id,
        metadata: {
          model: request.model,
          prompt: request.prompt.substring(0, 100),
          size: request.size,
          n: request.n
        }
      });

      const userEntity = await this.userService.getUserById(user.id);
      if (!userEntity) {
        throw new Error('User not found');
      }

      this.logger.info('Starting CSAM moderation check for image edit prompt', {
        requestId,
        userId: user.id,
        metadata: {
          promptLength: request.prompt.length
        }
      });

      const moderationResult = await this.csamDetectorService.checkPrompt(
        request.prompt,
        user.id
      );

      if (moderationResult.isFlagged) {
        this.logger.error('🚨 IMAGE EDIT REQUEST BLOCKED - CSAM CONTENT DETECTED 🚨', undefined, {
          metadata: {
            userId: user.id,
            requestId,
            categories: moderationResult.categories,
            reason: moderationResult.reason,
            userDisabled: moderationResult.userDisabled,
            timestamp: new Date().toISOString()
          }
        });

        throw new Error('Content violates our terms of service and has been blocked');
      }

      this.logger.info('CSAM moderation check passed for image edit', {
        requestId,
        userId: user.id
      });

      const authResult = await this.authorizationService.authorizeModel(
        userEntity,
        request.model,
        '/v1/images/edits'
      );

      if (!authResult.authorized) {
        throw new Error(authResult.reason || 'Authorization failed');
      }

      const estimatedCredits = this.estimateEditCredits(request);
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
        endpoint: '/v1/images/edits',
        method: 'POST',
        model: request.model,
        ipAddress: '',
        userAgent: '',
        requestSize: request.image.size + (request.mask?.size || 0)
      });

      if (!apiRequest) {
        throw new Error('Failed to create API request');
      }

      await this.apiRequestService.startProcessing(apiRequest.getId());

      const result = await this.processImageEditWithRetry(request, requestId);
      const totalLatency = Date.now() - startTime;

      await this.apiRequestService.completeApiRequest(apiRequest.getId(), {
        tokensUsed: Math.ceil(request.prompt.length / 4),
        creditsUsed: estimatedCredits,
        latency: totalLatency,
        responseSize: JSON.stringify(result).length,
        statusCode: 200
      });

      this.logger.info('Image edit completed successfully', {
        requestId,
        userId: user.id,
        metadata: {
          model: request.model,
          latency: totalLatency,
          imagesEdited: result.data.length
        }
      });

      return result;

    } catch (error) {
      this.logger.error('Image edit failed', error as Error, {
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

  private async processImageGenerationWithRetry(
    request: ImageGenerationRequest,
    requestId: string
  ): Promise<ImageResponse> {
    return this.processWithRetry('generation', request, requestId);
  }

  private async processImageEditWithRetry(
    request: ImageEditRequest,
    requestId: string
  ): Promise<ImageResponse> {
    return this.processWithRetry('edit', request, requestId);
  }

  private async processWithRetry(
    operation: string,
    request: ImageGenerationRequest | ImageEditRequest,
    requestId: string
  ): Promise<any> {
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

        this.logger.debug(`Attempting image ${operation} provider request`, {
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
          const reserved = await this.loadBalancerService.reserveCapacity(
            loadBalancingResult.subProvider.getId(),
            1
          );
          
          if (!reserved) {
            throw new Error('Unable to reserve capacity for this request');
          }
        }

        try {
          let result;
          if (operation === 'generation') {
            result = await adapter.generateImages(request as ImageGenerationRequest);
          } else {
            result = await adapter.editImages(request as ImageEditRequest);
          }

          const responseLatency = Date.now() - attemptStartTime;
          await this.loadBalancerService.recordSuccess(
            loadBalancingResult.provider.getId(),
            loadBalancingResult.subProvider?.getId(),
            responseLatency,
            1,
            0
          );

          this.logger.info(`Image ${operation} provider request successful`, {
            requestId,
            metadata: {
              providerId: loadBalancingResult.provider.getId(),
              subProviderId: loadBalancingResult.subProvider?.getId(),
              attempt,
              latency: responseLatency
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
            
            this.logger.warn(`Image ${operation} provider request failed, retrying`, {
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

        this.logger.error(`Image ${operation} provider request failed, not retrying`, error as Error, {
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

    throw new Error(`All ${maxAttempts} image ${operation} provider attempts failed. Excluded providers: ${excludedProviders.join(', ')}`);
  }

  private estimateGenerationCredits(request: ImageGenerationRequest): number {
    const baseCredits = this.getBaseCreditsBySize(request.size || '1024x1024');
    return baseCredits * (request.n || 1);
  }

  private estimateEditCredits(request: ImageEditRequest): number {
    const baseCredits = this.getBaseCreditsBySize(request.size || '1024x1024');
    return baseCredits * (request.n || 1);
  }

  private getBaseCreditsBySize(size: string): number {
    switch (size) {
      case '256x256': return 16;
      case '512x512': return 18;
      case '1024x1024': return 20;
      case '1792x1024':
      case '1024x1792': return 40;
      default: return 20;
    }
  }

  private generateRequestId(): string {
    return `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}