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
  ImageGenerationRequest,
  ImageResponse,
  ModerationResponse
} from '../../../application/types';

@injectable()
export class XAIAdapter extends BaseProviderAdapter {
  constructor(
    apiKey: string,
    logger: ILogger,
    metricsService: MetricsService
  ) {
    const configuration: ProviderConfiguration = {
      name: 'x-ai',
      apiKey,
      baseUrl: 'https://api.x.ai/v1',
      timeout: 30000,
      maxRetries: 3,
      rateLimitPerMinute: 60,
      requiresApiKey: true,
      supportedModels: [
        'grok-2',
        'grok-2-vision',
        'grok-2-image',
        'grok-3-mini',
        'grok-3-mini-fast',
        'grok-3',
        'grok-3-fast',
        'grok-4'
      ],
      capabilities: {
        chat: true,
        audio: false,
        embeddings: false,
        images: true,
        moderation: false
      }
    };

    super(configuration, logger, metricsService);
  }

  protected async executeChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse | AsyncIterable<StreamChunk>> {
    const cleanedRequest = { ...request };
    delete cleanedRequest.presence_penalty;
    delete cleanedRequest.frequency_penalty;

    if (request.stream) {
      return this.createStreamResponse('/chat/completions', cleanedRequest);
    }

    const response = await this.makeHttpRequest<ChatCompletionResponse>(
      '/chat/completions',
      'POST',
      cleanedRequest
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

  protected async executeGenerateImages(request: ImageGenerationRequest): Promise<ImageResponse> {
    const response = await this.makeHttpRequest<ImageResponse>(
      '/images/generations',
      'POST',
      request
    );

    return response;
  }

  protected async executeEditImages(): Promise<ImageResponse> {
    throw new Error('This provider does not support this endpoint');
  }

  protected async executeModerateContent(): Promise<ModerationResponse> {
    throw new Error('This provider does not support this endpoint');
  }

  protected async executeHealthCheck(): Promise<void> {
    await this.makeHttpRequest<any>('/chat/completions', 'POST', {
      model: 'grok-2',
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 1
    });
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
      throw new Error(`xAI streaming API error: ${response.status} - ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

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
