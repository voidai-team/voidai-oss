import { injectable, inject } from 'inversify';
import { TYPES } from '../../core/container';
import type { ILogger } from '../../core/logging';
import type { ErrorClassificationService } from '../../core/error-classification';
import type { UserService, AuthorizationService, LoadBalancerService, LoadBalancingResult, ApiRequestService } from '../../domain/services';
import type { ApiRequest } from '../../domain/entities';
import type { SpeechRequest, AudioTranscriptionRequest, TranscriptionResponse, AuthenticatedUser } from '../types';

@injectable()
export class AudioService {
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
    this.logger = logger.createChild('AudioService');
    this.errorClassificationService = errorClassificationService;
    this.userService = userService;
    this.authorizationService = authorizationService;
    this.loadBalancerService = loadBalancerService;
    this.apiRequestService = apiRequestService;
  }

  async textToSpeech(request: SpeechRequest, user: AuthenticatedUser): Promise<ArrayBuffer> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    let apiRequest: ApiRequest | null = null;

    try {
      this.logger.info('Processing text-to-speech request', {
        requestId,
        userId: user.id,
        metadata: {
          model: request.model,
          voice: request.voice,
          inputLength: request.input.length
        }
      });

      const userEntity = await this.userService.getUserById(user.id);
      if (!userEntity) {
        throw new Error('User not found');
      }

      const authResult = await this.authorizationService.authorizeModel(
        userEntity,
        request.model,
        '/v1/audio/speech'
      );

      if (!authResult.authorized) {
        throw new Error(authResult.reason || 'Authorization failed');
      }

      const estimatedCredits = this.estimateCredits(request.input.length);
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
        endpoint: '/v1/audio/speech',
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

      const result = await this.processWithRetry(request, requestId);
      const totalLatency = Date.now() - startTime;

      await this.apiRequestService.completeApiRequest(apiRequest.getId(), {
        tokensUsed: Math.ceil(request.input.length / 4),
        creditsUsed: estimatedCredits,
        latency: totalLatency,
        responseSize: result.byteLength,
        statusCode: 200
      });

      this.logger.info('Text-to-speech completed successfully', {
        requestId,
        userId: user.id,
        metadata: {
          model: request.model,
          latency: totalLatency,
          outputSize: result.byteLength
        }
      });

      return result;

    } catch (error) {
      this.logger.error('Text-to-speech failed', error as Error, {
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

  async audioTranscription(request: AudioTranscriptionRequest, user: AuthenticatedUser, path: string): Promise<TranscriptionResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    let apiRequest: ApiRequest | null = null;

    try {
      this.logger.info('Processing audio transcription request', {
        requestId,
        userId: user.id,
        metadata: {
          model: request.model,
          path,
          language: request.language,
          fileSize: request.file.size
        }
      });

      const userEntity = await this.userService.getUserById(user.id);
      if (!userEntity) {
        throw new Error('User not found');
      }

      const endpoint = `/v1/audio/${path}`;
      const authResult = await this.authorizationService.authorizeModel(
        userEntity,
        request.model,
        endpoint
      );

      if (!authResult.authorized) {
        throw new Error(authResult.reason || 'Authorization failed');
      }

      const estimatedCredits = this.estimateTranscriptionCredits(request.file.size);
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
        endpoint,
        method: 'POST',
        model: request.model,
        ipAddress: '',
        userAgent: '',
        requestSize: request.file.size
      });

      if (!apiRequest) {
        throw new Error('Failed to create API request');
      }

      await this.apiRequestService.startProcessing(apiRequest.getId());

      const result = await this.processTranscriptionWithRetry(request, path, requestId);
      const totalLatency = Date.now() - startTime;

      await this.apiRequestService.completeApiRequest(apiRequest.getId(), {
        tokensUsed: Math.ceil(result.text.length / 4),
        creditsUsed: estimatedCredits,
        latency: totalLatency,
        responseSize: JSON.stringify(result).length,
        statusCode: 200
      });

      this.logger.info('Audio transcription completed successfully', {
        requestId,
        userId: user.id,
        metadata: {
          model: request.model,
          path,
          latency: totalLatency,
          textLength: result.text.length
        }
      });

      return result;

    } catch (error) {
      this.logger.error('Audio transcription failed', error as Error, {
        metadata: { userId: user.id, model: request.model, requestId, path }
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

  private async processWithRetry(request: SpeechRequest, requestId: string): Promise<ArrayBuffer> {
    const excludedProviders: string[] = [];
    const maxAttempts = 5;

    let loadBalancingResult: LoadBalancingResult | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        loadBalancingResult = await this.loadBalancerService.selectProviderAndSubProvider(request.model);

        if (!loadBalancingResult.provider) {
          throw new Error(loadBalancingResult.error || 'No providers available');
        }

        if (excludedProviders.includes(loadBalancingResult.provider.getId())) {
          continue;
        }

        this.logger.debug('Attempting audio provider request', {
          requestId,
          metadata: {
            providerId: loadBalancingResult.provider.getId(),
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
          const estimatedTokens = Math.ceil(request.input.length / 4);
          const reserved = await this.loadBalancerService.reserveCapacity(
            loadBalancingResult.subProvider.getId(),
            estimatedTokens
          );
          
          if (!reserved) {
            throw new Error('Unable to reserve capacity for this request');
          }
        }

        try {
          const result = await adapter.textToSpeech(request);
          
          const responseLatency = Date.now() - Date.now();
          await this.loadBalancerService.recordSuccess(
            loadBalancingResult.provider.getId(),
            loadBalancingResult.subProvider?.getId(),
            responseLatency,
            Math.ceil(request.input.length / 4),
            0
          );

          this.logger.info('Audio provider request successful', {
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
        if (this.errorClassificationService.isRetryableError(error as Error) && attempt < maxAttempts) {
          excludedProviders.push(loadBalancingResult?.provider?.getId() || 'unknown');
          continue;
        }

        throw error;
      }
    }

    throw new Error(`All ${maxAttempts} audio provider attempts failed`);
  }

  private async processTranscriptionWithRetry(request: AudioTranscriptionRequest, path: string, requestId: string): Promise<TranscriptionResponse> {
    const excludedProviders: string[] = [];
    const maxAttempts = 5;

    let loadBalancingResult: LoadBalancingResult | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        loadBalancingResult = await this.loadBalancerService.selectProviderAndSubProvider(request.model);

        if (!loadBalancingResult.provider) {
          throw new Error(loadBalancingResult.error || 'No providers available');
        }

        if (excludedProviders.includes(loadBalancingResult.provider.getId())) {
          continue;
        }

        this.logger.debug('Attempting transcription provider request', {
          requestId,
          metadata: {
            providerId: loadBalancingResult.provider.getId(),
            attempt,
            path,
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
          const estimatedTokens = Math.ceil(request.file.size / 1024);
          const reserved = await this.loadBalancerService.reserveCapacity(
            loadBalancingResult.subProvider.getId(),
            estimatedTokens
          );
          
          if (!reserved) {
            throw new Error('Unable to reserve capacity for this request');
          }
        }

        try {
          const result = await adapter.audioTranscription(request);
          
          const responseLatency = Date.now() - Date.now();
          const tokensUsed = Math.ceil(result.text.length / 4);
          
          await this.loadBalancerService.recordSuccess(
            loadBalancingResult.provider.getId(),
            loadBalancingResult.subProvider?.getId(),
            responseLatency,
            tokensUsed,
            0
          );

          this.logger.info('Transcription provider request successful', {
            requestId,
            metadata: {
              providerId: loadBalancingResult.provider.getId(),
              subProviderId: loadBalancingResult.subProvider?.getId(),
              attempt,
              path,
              latency: responseLatency,
              tokensUsed
            }
          });

          return result;

        } finally {
          if (loadBalancingResult.subProvider) {
            await this.loadBalancerService.releaseCapacity(loadBalancingResult.subProvider.getId());
          }
        }

      } catch (error) {
        if (this.errorClassificationService.isRetryableError(error as Error) && attempt < maxAttempts) {
          excludedProviders.push(loadBalancingResult?.provider?.getId() || 'unknown');
          continue;
        }

        throw error;
      }
    }

    throw new Error(`All ${maxAttempts} transcription provider attempts failed`);
  }


  private estimateCredits(textLength: number): number {
    return Math.ceil(textLength * 0.01);
  }

  private estimateTranscriptionCredits(fileSize: number): number {
    return Math.ceil(fileSize / 1024 / 1024 * 5);
  }

  private generateRequestId(): string {
    return `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}