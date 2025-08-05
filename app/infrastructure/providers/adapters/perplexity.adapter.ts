import { injectable } from 'inversify';
import { BaseProviderAdapter, type ProviderConfiguration } from '../base';
import type { ILogger } from '../../../core/logging';
import type { MetricsService } from '../../../core/metrics';
import type { 
  ChatCompletionRequest, 
  ChatCompletionResponse,
  StreamChunk,
  TranscriptionResponse,
  EmbeddingResponse,
  ImageResponse,
  ModerationResponse
} from '../../../application/types';

@injectable()
export class PerplexityAdapter extends BaseProviderAdapter {
  constructor(
    apiKey: string,
    logger: ILogger,
    metricsService: MetricsService
  ) {
    const configuration: ProviderConfiguration = {
      name: 'perplexity',
      apiKey,
      baseUrl: 'https://api.perplexity.ai',
      timeout: 30000,
      maxRetries: 3,
      rateLimitPerMinute: 60,
      requiresApiKey: true,
      supportedModels: [
        'llama-3.1-sonar-small-128k-online',
        'llama-3.1-sonar-large-128k-online',
        'llama-3.1-sonar-huge-128k-online',
        'llama-3.1-sonar-small-128k-chat',
        'llama-3.1-sonar-large-128k-chat',
        'llama-3.1-8b-instruct',
        'llama-3.1-70b-instruct'
      ],
      capabilities: {
        chat: true,
        audio: false,
        embeddings: false,
        images: false,
        moderation: false
      }
    };

    super(configuration, logger, metricsService);
  }

  protected async executeChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse | AsyncIterable<StreamChunk>> {
    if (request.stream) {
      return this.createStreamResponse('/chat/completions', request);
    }

    const response = await this.makeHttpRequest<ChatCompletionResponse>(
      '/chat/completions',
      'POST',
      request
    );

    return response;
  }

  protected async executeTextToSpeech(): Promise<ArrayBuffer> {
    throw new Error('This provider does not support this endpoint');
  }

  protected async executeAudioTranscription(): Promise<TranscriptionResponse> {
    throw new Error('This provider does not support this endpoint');
  }

  protected async executeCreateEmbeddings(): Promise<EmbeddingResponse> {
    throw new Error('This provider does not support this endpoint');
  }

  protected async executeGenerateImages(): Promise<ImageResponse> {
    throw new Error('This provider does not support this endpoint');
  }

  protected async executeEditImages(): Promise<ImageResponse> {
    throw new Error('This provider does not support this endpoint');
  }

  protected async executeModerateContent(): Promise<ModerationResponse> {
    throw new Error('This provider does not support this endpoint');
  }

  private async *createStreamResponse(endpoint: string, request: ChatCompletionRequest): AsyncIterable<StreamChunk> {
    const response = await fetch(`${this.configuration.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: this.createHttpHeaders(),
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.configuration.timeout)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Perplexity streaming API error: ${response.status} - ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get response stream reader');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            
            try {
              yield JSON.parse(data) as StreamChunk;
            } catch (error) {
              this.logger.warn('Failed to parse stream chunk', {
                metadata: { line, error: (error as Error).message }
              });
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}