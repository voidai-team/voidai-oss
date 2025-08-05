import { injectable } from 'inversify';
import type { ILogger } from '../../../core/logging';
import type { MetricsService } from '../../../core/metrics';
import type { 
  ChatCompletionRequest, 
  ChatCompletionResponse,
  SpeechRequest,
  AudioTranscriptionRequest,
  TranscriptionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ImageGenerationRequest,
  ImageEditRequest,
  ImageResponse,
  ModerationRequest,
  ModerationResponse
} from '../../../application/types';

export interface ProviderConfiguration {
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeout: number;
  readonly maxRetries: number;
  readonly rateLimitPerMinute: number;
  readonly supportedModels: readonly string[];
  readonly modelMapping?: Record<string, string>;
  readonly capabilities: {
    readonly chat: boolean;
    readonly audio: boolean;
    readonly embeddings: boolean;
    readonly images: boolean;
    readonly moderation: boolean;
  };
  readonly requiresApiKey: boolean;
}

export interface ProviderHealthStatus {
  readonly isHealthy: boolean;
  readonly lastChecked: number;
  readonly latency: number;
  readonly errorRate: number;
  readonly consecutiveFailures: number;
}

export interface ProviderRequestContext {
  readonly requestId: string;
  readonly model: string;
  readonly endpoint: string;
  readonly startTime: number;
  readonly retryAttempt: number;
}

@injectable()
export abstract class BaseProviderAdapter {
  protected readonly logger: ILogger;
  protected readonly metricsService: MetricsService;
  public configuration: ProviderConfiguration;

  constructor(
    configuration: ProviderConfiguration,
    logger: ILogger,
    metricsService: MetricsService
  ) {
    this.configuration = configuration;
    this.logger = logger.createChild(this.configuration.name);
    this.metricsService = metricsService;

    this.validateConfiguration();
  }

  public getSupportedModels(): readonly string[] {
    return this.configuration.supportedModels;
  }

  public supportsModel(model: string): boolean {
    return this.configuration.supportedModels.includes(model);
  }

  public supportsCapability(capability: keyof ProviderConfiguration['capabilities']): boolean {
    return this.configuration.capabilities[capability];
  }

  public async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse | AsyncIterable<any>> {
    if (!this.supportsCapability('chat')) {
      throw new Error(`Provider ${this.configuration.name} does not support chat completions`);
    }

    const context = this.createRequestContext('chat', request.model);
    
    try {
      this.logRequestStart(context, { messageCount: request.messages.length, stream: request.stream });
      
      const result = await this.executeChatCompletion(request, context);
      
      this.recordSuccessMetrics(context);
      this.logRequestSuccess(context);
      
      return result;
    } catch (error) {
      this.recordErrorMetrics(context);
      this.logRequestError(context, error as Error);
      throw error;
    }
  }

  public async textToSpeech(request: SpeechRequest): Promise<ArrayBuffer> {
    if (!this.supportsCapability('audio')) {
      throw new Error(`Provider ${this.configuration.name} does not support text-to-speech`);
    }

    const context = this.createRequestContext('tts', request.model);
    
    try {
      this.logRequestStart(context, { voice: request.voice, inputLength: request.input.length });
      
      const result = await this.executeTextToSpeech(request, context);
      
      this.recordSuccessMetrics(context);
      this.logRequestSuccess(context, { outputSize: result.byteLength });
      
      return result;
    } catch (error) {
      this.recordErrorMetrics(context);
      this.logRequestError(context, error as Error);
      throw error;
    }
  }

  public async audioTranscription(request: AudioTranscriptionRequest): Promise<TranscriptionResponse> {
    if (!this.supportsCapability('audio')) {
      throw new Error(`Provider ${this.configuration.name} does not support audio transcription`);
    }

    const context = this.createRequestContext('transcription', request.model);
    
    try {
      this.logRequestStart(context, { fileSize: request.file.size, language: request.language });
      
      const result = await this.executeAudioTranscription(request, context);
      
      this.recordSuccessMetrics(context);
      this.logRequestSuccess(context, { textLength: result.text.length });
      
      return result;
    } catch (error) {
      this.recordErrorMetrics(context);
      this.logRequestError(context, error as Error);
      throw error;
    }
  }

  public async createEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (!this.supportsCapability('embeddings')) {
      throw new Error(`Provider ${this.configuration.name} does not support embeddings`);
    }

    const context = this.createRequestContext('embeddings', request.model);
    
    try {
      const inputCount = Array.isArray(request.input) ? request.input.length : 1;
      this.logRequestStart(context, { inputCount });
      
      const result = await this.executeCreateEmbeddings(request, context);
      
      this.recordSuccessMetrics(context);
      this.logRequestSuccess(context, { embeddingCount: result.data.length });
      
      return result;
    } catch (error) {
      this.recordErrorMetrics(context);
      this.logRequestError(context, error as Error);
      throw error;
    }
  }

  public async generateImages(request: ImageGenerationRequest): Promise<ImageResponse> {
    if (!this.supportsCapability('images')) {
      throw new Error(`Provider ${this.configuration.name} does not support image generation`);
    }

    const context = this.createRequestContext('image-generation', request.model || 'dall-e-3');
    
    try {
      this.logRequestStart(context, { promptLength: request.prompt.length, imageCount: request.n || 1 });
      
      const result = await this.executeGenerateImages(request, context);
      
      this.recordSuccessMetrics(context);
      this.logRequestSuccess(context, { imageCount: result.data.length });
      
      return result;
    } catch (error) {
      this.recordErrorMetrics(context);
      this.logRequestError(context, error as Error);
      throw error;
    }
  }

  public async editImages(request: ImageEditRequest): Promise<ImageResponse> {
    if (!this.supportsCapability('images')) {
      throw new Error(`Provider ${this.configuration.name} does not support image editing`);
    }

    const context = this.createRequestContext('image-edit', request.model || 'dall-e-2');
    
    try {
      this.logRequestStart(context, { promptLength: request.prompt.length, hasMask: !!request.mask });
      
      const result = await this.executeEditImages(request, context);
      
      this.recordSuccessMetrics(context);
      this.logRequestSuccess(context, { imageCount: result.data.length });
      
      return result;
    } catch (error) {
      this.recordErrorMetrics(context);
      this.logRequestError(context, error as Error);
      throw error;
    }
  }

  public async moderateContent(request: ModerationRequest): Promise<ModerationResponse> {
    if (!this.supportsCapability('moderation')) {
      throw new Error(`Provider ${this.configuration.name} does not support content moderation`);
    }

    const context = this.createRequestContext('moderation', request.model || 'text-moderation-latest');
    
    try {
      const inputCount = Array.isArray(request.input) ? request.input.length : 1;
      this.logRequestStart(context, { inputCount });
      
      const result = await this.executeModerateContent(request, context);
      
      this.recordSuccessMetrics(context);
      this.logRequestSuccess(context, { resultCount: result.results.length });
      
      return result;
    } catch (error) {
      this.recordErrorMetrics(context);
      this.logRequestError(context, error as Error);
      throw error;
    }
  }

  protected abstract executeChatCompletion(request: ChatCompletionRequest, context: ProviderRequestContext): Promise<ChatCompletionResponse | AsyncIterable<any>>;
  protected abstract executeTextToSpeech(request: SpeechRequest, context: ProviderRequestContext): Promise<ArrayBuffer>;
  protected abstract executeAudioTranscription(request: AudioTranscriptionRequest, context: ProviderRequestContext): Promise<TranscriptionResponse>;
  protected abstract executeCreateEmbeddings(request: EmbeddingRequest, context: ProviderRequestContext): Promise<EmbeddingResponse>;
  protected abstract executeGenerateImages(request: ImageGenerationRequest, context: ProviderRequestContext): Promise<ImageResponse>;
  protected abstract executeEditImages(request: ImageEditRequest, context: ProviderRequestContext): Promise<ImageResponse>;
  protected abstract executeModerateContent(request: ModerationRequest, context: ProviderRequestContext): Promise<ModerationResponse>;

  protected createHttpHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.configuration.apiKey}`,
      'Content-Type': 'application/json'
    };
  }

  protected async makeHttpRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    body?: any,
    headers?: Record<string, string>
  ): Promise<T> {
    const url = `${this.configuration.baseUrl}${endpoint}`;
    const requestHeaders = { ...this.createHttpHeaders(), ...headers };

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.configuration.timeout)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  private createRequestContext(endpoint: string, model: string): ProviderRequestContext {
    return {
      requestId: `${this.configuration.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      model,
      endpoint,
      startTime: Date.now(),
      retryAttempt: 0
    };
  }

  private validateConfiguration(): void {
    const staticConfig = this.configuration;
    
    if (staticConfig.requiresApiKey && !this.configuration.apiKey) {
      throw new Error('API key is required');
    }
    if (!this.configuration.baseUrl) {
      throw new Error('Base URL is required');
    }
    if (this.configuration.supportedModels.length === 0) {
      throw new Error('At least one supported model is required');
    }
  }

  private logRequestStart(context: ProviderRequestContext, metadata: Record<string, any>): void {
    this.logger.info('Provider request initiated', {
      requestId: context.requestId,
      metadata: {
        provider: this.configuration.name,
        model: context.model,
        endpoint: context.endpoint,
        ...metadata
      }
    });
  }

  private logRequestSuccess(context: ProviderRequestContext, metadata?: Record<string, any>): void {
    const duration = Date.now() - context.startTime;
    
    this.logger.info('Provider request completed successfully', {
      requestId: context.requestId,
      metadata: {
        provider: this.configuration.name,
        model: context.model,
        endpoint: context.endpoint,
        duration,
        ...metadata
      }
    });
  }

  private logRequestError(context: ProviderRequestContext, error: Error): void {
    const duration = Date.now() - context.startTime;
    
    this.logger.error('Provider request failed', error, {
      requestId: context.requestId,
      metadata: {
        provider: this.configuration.name,
        model: context.model,
        endpoint: context.endpoint,
        duration,
        errorType: error.constructor.name
      }
    });
  }

  private recordSuccessMetrics(context: ProviderRequestContext): void {
    const duration = Date.now() - context.startTime;
    
    this.metricsService.recordHttpRequest(
      'POST',
      `/${this.configuration.name}/${context.endpoint}`,
      200,
      duration
    );
  }

  private recordErrorMetrics(context: ProviderRequestContext): void {
    const duration = Date.now() - context.startTime;
    
    this.metricsService.recordHttpRequest(
      'POST',
      `/${this.configuration.name}/${context.endpoint}`,
      500,
      duration
    );
    
    this.metricsService.recordError(
      'provider_request_failed',
      `${this.configuration.name}.${context.endpoint}`
    );
  }
}