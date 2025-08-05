import { injectable, inject } from 'inversify';
import { TYPES } from '../../core/container';
import type { ILogger } from '../../core/logging';
import type { ErrorClassificationService } from '../../core/error-classification';
import type { UserService, AuthorizationService, LoadBalancerService, ApiRequestService } from '../../domain/services';
import type { CSAMDetectorService, LoadBalancingResult } from '../../domain/services';
import type { ApiRequest } from '../../domain/entities';
import type { ChatCompletionRequest, ChatCompletionResponse, StreamChunk, AuthenticatedUser } from '../types';

interface ProviderAttempt {
  providerId: string;
  subProviderId?: string;
  attempt: number;
  error?: string;
  latency?: number;
}

interface StreamChunkIterable extends AsyncIterable<StreamChunk> {
  getIterator(): StreamIterator;
  postTasksPromise?: Promise<void>;
}

@injectable()
export class ChatService {
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
    this.logger = logger.createChild('ChatService');
    this.errorClassificationService = errorClassificationService;
    this.userService = userService;
    this.authorizationService = authorizationService;
    this.loadBalancerService = loadBalancerService;
    this.apiRequestService = apiRequestService;
    this.csamDetectorService = csamDetectorService;
  }

  async processCompletion(request: ChatCompletionRequest, user: AuthenticatedUser): Promise<ChatCompletionResponse | StreamChunkIterable> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    let apiRequest: ApiRequest | null = null;

    try {
      this.logger.info('Processing chat completion request', {
        requestId,
        userId: user.id,
        metadata: {
          model: request.model,
          isStreaming: request.stream || false,
          messageCount: request.messages.length
        }
      });

      const userEntity = await this.userService.getUserById(user.id);
      if (!userEntity) {
        throw new Error('User not found');
      }

      this.logger.info('Starting CSAM moderation check', {
        requestId,
        userId: user.id,
        metadata: {
          messageCount: request.messages.length
        }
      });

      const moderationResult = await this.csamDetectorService.checkMessages(
        request.messages,
        user.id
      );

      if (moderationResult.isFlagged) {
        this.logger.error('🚨 CHAT REQUEST BLOCKED - CSAM CONTENT DETECTED 🚨', undefined, {
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

      this.logger.info('CSAM moderation check passed', {
        requestId,
        userId: user.id
      });

      const authResult = await this.authorizationService.authorizeModel(
        userEntity,
        request.model,
        '/v1/chat/completions'
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
        endpoint: '/v1/chat/completions',
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

      if (request.stream) {
        return this.processStreamingCompletion(request, apiRequest, requestId, startTime);
      }

      return this.processNonStreamingCompletion(request, requestId);

    } catch (error) {
      this.logger.error('Chat completion failed', error as Error, {
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

  private async processNonStreamingCompletion(
    request: ChatCompletionRequest,
    requestId: string
  ): Promise<ChatCompletionResponse> {
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

        this.logger.debug('Attempting provider request', {
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
          const estimatedTokens = this.estimatePromptTokens(request);
          const reserved = await this.loadBalancerService.reserveCapacity(
            loadBalancingResult.subProvider.getId(),
            estimatedTokens
          );
          
          if (!reserved) {
            throw new Error('Unable to reserve capacity for this request');
          }
        }

        try {
          const response = await adapter.chatCompletion(request);
          
          if (Symbol.asyncIterator in response) {
            throw new Error('Expected non-streaming response but got streaming response');
          }
          
          const responseLatency = Date.now() - attemptStartTime;
          const totalTokens = this.calculateTotalTokens(request, response);
          
          await this.loadBalancerService.recordSuccess(
            loadBalancingResult.provider.getId(),
            loadBalancingResult.subProvider?.getId(),
            responseLatency,
            totalTokens,
            0
          );

          this.logger.info('Provider request successful', {
            requestId,
            metadata: {
              providerId: loadBalancingResult.provider.getId(),
              subProviderId: loadBalancingResult.subProvider?.getId(),
              attempt,
              latency: responseLatency,
              tokensUsed: totalTokens
            }
          });

          return response as ChatCompletionResponse;

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
            
            this.logger.warn('Provider request failed, retrying', {
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

        this.logger.error('Provider request failed, not retrying', error as Error, {
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

    throw new Error(`All ${maxAttempts} provider attempts failed. Excluded providers: ${excludedProviders.join(', ')}`);
  }

  private async processStreamingCompletion(
    request: ChatCompletionRequest,
    apiRequest: ApiRequest,
    requestId: string,
    startTime: number
  ): Promise<StreamChunkIterable> {
    let resolvePostTasks: () => void;
    const postTasksPromise = new Promise<void>((resolve) => {
      resolvePostTasks = resolve;
    });

    const streamIterator = new StreamIterator(
      request,
      apiRequest,
      requestId,
      startTime,
      this.loadBalancerService,
      this.apiRequestService,
      this.logger,
      () => resolvePostTasks()
    );

    const iterable: StreamChunkIterable = {
      [Symbol.asyncIterator]: () => streamIterator,
      getIterator: () => streamIterator,
      postTasksPromise
    };

    return iterable;
  }


  private estimateCredits(request: ChatCompletionRequest): number {
    const promptTokens = this.estimatePromptTokens(request);
    return this.calculateCredits(promptTokens);
  }

  private estimatePromptTokens(request: ChatCompletionRequest): number {
    return request.messages.reduce((total, message) => {
      if (typeof message.content === 'string') {
        return total + Math.ceil(message.content.length / 4);
      } else if (Array.isArray(message.content)) {
        return total + message.content.reduce((contentTotal, item) => {
          if (item.type === 'text' && item.text) {
            return contentTotal + Math.ceil(item.text.length / 4);
          } else if (item.type === 'image_url') {
            return contentTotal + 765;
          }
          return contentTotal;
        }, 0);
      }
      return total + 5;
    }, 0);
  }

  private calculateCredits(tokens: number): number {
    return Math.ceil(tokens * 0.001);
  }

  private calculateTotalTokens(request: ChatCompletionRequest, response: ChatCompletionResponse): number {
    const promptTokens = this.estimatePromptTokens(request);
    const responseText = response.choices[0]?.message?.content || '';
    const completionTokens = Math.ceil(responseText.length / 4);
    return promptTokens + completionTokens;
  }

  private generateRequestId(): string {
    return `chatcmpl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async processPostResponseTasks(): Promise<void> {
    this.logger.debug('Post-response tasks completed');
  }
}

class StreamIterator {
  private currentIterator: AsyncIterator<StreamChunk> | null = null;
  private excludedProviders: string[] = [];
  private attemptCount = 0;
  private readonly maxAttempts = 10;
  private finalTaskScheduled = false;
  private accumulated = '';

  constructor(
    private request: ChatCompletionRequest,
    private apiRequest: ApiRequest,
    private requestId: string,
    private startTime: number,
    private loadBalancerService: LoadBalancerService,
    private apiRequestService: ApiRequestService,
    private logger: ILogger,
    private onComplete: () => void
  ) {}

  async next(): Promise<IteratorResult<StreamChunk>> {
    if (!this.currentIterator) {
      const result = await this.getNextProvider();
      if (!result) {
        this.scheduleFinalTask(true);
        return { done: true, value: undefined };
      }
      this.currentIterator = result;
    }

    try {
      const { value, done } = await this.currentIterator.next();
      
      if (done) {
        this.scheduleFinalTask(false);
        return { done: true, value: undefined };
      }

      if (value.choices?.[0]?.delta?.content) {
        this.accumulated += value.choices[0].delta.content;
      }

      (value as any).id = this.requestId;
      return { done: false, value };

    } catch (error) {
      this.logger.warn('Stream error, attempting next provider', {
        requestId: this.requestId,
        metadata: {
          error: (error as Error).message,
          attempt: this.attemptCount
        }
      });

      const result = await this.getNextProvider();
      if (!result) {
        this.scheduleFinalTask(true);
        throw error;
      }

      this.currentIterator = result;
      return this.next();
    }
  }

  private async getNextProvider(): Promise<AsyncIterator<StreamChunk> | null> {
    while (this.attemptCount < this.maxAttempts) {
      this.attemptCount++;

      try {
        const loadBalancingResult = await this.loadBalancerService.selectProviderAndSubProvider(this.request.model);
        
        if (!loadBalancingResult.provider || this.excludedProviders.includes(loadBalancingResult.provider.getId())) {
          continue;
        }

        const adapter = loadBalancingResult.subProvider
          ? await this.loadBalancerService.getAdapter(loadBalancingResult.subProvider)
          : await this.loadBalancerService.getAdapter(loadBalancingResult.provider as any);

        if (!adapter) {
          throw new Error('Failed to create adapter for selected provider');
        }

        if (loadBalancingResult.subProvider) {
          const estimatedTokens = this.estimatePromptTokens(this.request);
          const reserved = await this.loadBalancerService.reserveCapacity(
            loadBalancingResult.subProvider.getId(),
            estimatedTokens
          );
          
          if (!reserved) {
            throw new Error('Unable to reserve capacity for this request');
          }
        }

        try {
          const streamResponse = await adapter.chatCompletion(this.request);
          
          if (Symbol.asyncIterator in streamResponse) {
            this.logger.info('Streaming provider request started', {
              requestId: this.requestId,
              metadata: {
                providerId: loadBalancingResult.provider.getId(),
                subProviderId: loadBalancingResult.subProvider?.getId(),
                attempt: this.attemptCount
              }
            });

            return streamResponse[Symbol.asyncIterator]();
          } else {
            throw new Error('Expected streaming response but got non-streaming response');
          }

        } catch (error) {
          if (loadBalancingResult.subProvider) {
            await this.loadBalancerService.releaseCapacity(loadBalancingResult.subProvider.getId());
          }
          throw error;
        }

      } catch (error) {
        this.logger.warn('Provider selection failed', {
          requestId: this.requestId,
          metadata: {
            attempt: this.attemptCount,
            error: (error as Error).message
          }
        });
        continue;
      }
    }

    return null;
  }

  private scheduleFinalTask(error: boolean): void {
    if (this.finalTaskScheduled) return;
    this.finalTaskScheduled = true;

    const totalLatency = Date.now() - this.startTime;
    const tokensUsed = Math.ceil(this.accumulated.length / 4);
    const creditsUsed = Math.ceil(tokensUsed * 0.001);

    if (!error) {
      this.apiRequestService.completeApiRequest(this.apiRequest.getId(), {
        tokensUsed,
        creditsUsed,
        latency: totalLatency,
        responseSize: this.accumulated.length,
        statusCode: 200
      }).catch(err => this.logger.error('Failed to complete API request', err));
    } else {
      this.apiRequestService.failApiRequest(this.apiRequest.getId(), {
        statusCode: 500,
        errorMessage: 'Streaming failed',
        latency: totalLatency
      }).catch(err => this.logger.error('Failed to fail API request', err));
    }

    this.onComplete();
  }

  forceScheduleFinalTask(): void {
    this.scheduleFinalTask(false);
  }

  private estimatePromptTokens(request: ChatCompletionRequest): number {
    return request.messages.reduce((total, message) => {
      if (typeof message.content === 'string') {
        return total + Math.ceil(message.content.length / 4);
      } else if (Array.isArray(message.content)) {
        return total + message.content.reduce((contentTotal, item) => {
          if (item.type === 'text' && item.text) {
            return contentTotal + Math.ceil(item.text.length / 4);
          } else if (item.type === 'image_url') {
            return contentTotal + 765;
          }
          return contentTotal;
        }, 0);
      }
      return total + 5;
    }, 0);
  }
}