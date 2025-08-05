import { injectable } from 'inversify';
import { BaseProviderAdapter, type ProviderConfiguration } from '../base';
import type { ILogger } from '../../../core/logging';
import type { MetricsService } from '../../../core/metrics';
import type { 
  ChatCompletionRequest, 
  ChatCompletionResponse,
  StreamChunk,
  ModerationRequest,
  ModerationResponse,
  TranscriptionResponse,
  EmbeddingResponse,
  ImageResponse
} from '../../../application/types';

@injectable()
export class MistralAdapter extends BaseProviderAdapter {
  constructor(
    apiKey: string,
    logger: ILogger,
    metricsService: MetricsService
  ) {
    const configuration: ProviderConfiguration = {
      name: 'mistral',
      apiKey,
      baseUrl: 'https://api.mistral.ai/v1',
      timeout: 30000,
      maxRetries: 3,
      rateLimitPerMinute: 60,
      requiresApiKey: true,
      supportedModels: [
        'magistral-medium-latest',
        'magistral-small-latest',
        'mistral-large-latest',
        'mistral-medium-latest',
        'mistral-small-latest',
        'ministral-3b-latest',
        'ministral-8b-latest',
        'mistral-moderation-latest'
      ],
      capabilities: {
        chat: true,
        audio: false,
        embeddings: false,
        images: false,
        moderation: true
      }
    };

    super(configuration, logger, metricsService);
  }

  protected async executeChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse | AsyncIterable<StreamChunk>> {
    const transformedRequest = {
      ...request,
      messages: this.transformMessages(request.messages)
    };

    if (transformedRequest.stream) {
      return this.createStreamResponse('/chat/completions', transformedRequest);
    }

    const response = await this.makeHttpRequest<ChatCompletionResponse>(
      '/chat/completions',
      'POST',
      transformedRequest
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

  protected async executeModerateContent(request: ModerationRequest): Promise<ModerationResponse> {
    const response = await this.makeHttpRequest<ModerationResponse>(
      '/moderations',
      'POST',
      request
    );

    return response;
  }

  protected async executeHealthCheck(): Promise<void> {
    await this.makeHttpRequest<any>('/models', 'GET');
  }

  private transformMessages(messages: any[]): any[] {
    return messages.map(message => {
      if (message.content && Array.isArray(message.content)) {
        return {
          ...message,
          content: message.content.map((item: any) => {
            if (item.type === 'image_url' && item.image_url && item.image_url.url) {
              return {
                ...item,
                image_url: item.image_url.url
              };
            }
            return item;
          })
        };
      }
      return message;
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
      throw new Error(`Mistral streaming API error: ${response.status} - ${errorText}`);
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