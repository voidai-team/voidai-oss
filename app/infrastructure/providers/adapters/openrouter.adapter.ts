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
export class OpenRouterAdapter extends BaseProviderAdapter {
  private readonly modelMapping: Record<string, string> = {
    'gpt-3.5-turbo': 'openai/gpt-3.5-turbo',
    'gpt-4o-mini': 'openai/gpt-4o-mini',
    'gpt-4o': 'openai/gpt-4o',
    'gpt-4.1-nano': 'openai/gpt-4.1-nano',
    'gpt-4.1-mini': 'openai/gpt-4.1-mini',
    'gpt-4.1': 'openai/gpt-4.1',
    'chatgpt-4o-latest': 'openai/chatgpt-4o-latest',
    'gpt-4o-mini-search-preview': 'openai/gpt-4o-mini-search-preview',
    'gpt-4o-search-preview': 'openai/gpt-4o-search-preview',
    'o1': 'openai/o1',
    'o3-mini': 'openai/o3-mini',
    'o4-mini': 'openai/o4-mini',
    'claude-3-haiku-20240307': 'anthropic/claude-3-haiku:beta',
    'claude-3-opus-20240229': 'anthropic/claude-3-opus:beta',
    'claude-3-5-sonnet-20240620': 'anthropic/claude-3.5-sonnet-20240620:beta',
    'claude-3-5-haiku-20241022': 'anthropic/claude-3.5-haiku:beta',
    'claude-3-5-sonnet-20241022': 'anthropic/claude-3.5-sonnet:beta',
    'claude-3-7-sonnet-20250219': 'anthropic/claude-3.7-sonnet:beta',
    'claude-sonnet-4-20250514': 'anthropic/claude-sonnet-4',
    'claude-opus-4-20250514': 'anthropic/claude-opus-4',
    'deepseek-r1': 'deepseek/deepseek-r1-0528',
    'deepseek-v3': 'deepseek/deepseek-chat-v3-0324',
    'llama-4-maverick-17b-128e-instruct': 'meta-llama/llama-4-maverick',
    'llama-4-scout-17b-16e-instruct': 'meta-llama/llama-4-scout'
  };

  constructor(
    apiKey: string,
    logger: ILogger,
    metricsService: MetricsService
  ) {
    const configuration: ProviderConfiguration = {
      name: 'openrouter',
      apiKey,
      baseUrl: 'https://openrouter.ai/api/v1',
      timeout: 30000,
      maxRetries: 3,
      rateLimitPerMinute: 60,
      requiresApiKey: true,
      supportedModels: [
        'gpt-3.5-turbo',
        'gpt-4o-mini',
        'gpt-4o',
        'gpt-4.1-nano',
        'gpt-4.1-mini',
        'gpt-4.1',
        'chatgpt-4o-latest',
        'gpt-4o-mini-search-preview',
        'gpt-4o-search-preview',
        'o1',
        'o3-mini',
        'o4-mini',
        'claude-3-haiku-20240307',
        'claude-3-opus-20240229',
        'claude-3-5-sonnet-20240620',
        'claude-3-5-haiku-20241022',
        'claude-3-5-sonnet-20241022',
        'claude-3-7-sonnet-20250219',
        'claude-sonnet-4-20250514',
        'claude-opus-4-20250514',
        'deepseek-r1',
        'deepseek-v3',
        'llama-4-maverick-17b-128e-instruct',
        'llama-4-scout-17b-16e-instruct'
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
    const clonedRequest = { ...request, model: this.modelMapping[request.model] || request.model };

    if (request.stream) {
      return this.createStreamResponse('/chat/completions', clonedRequest);
    }

    const response = await this.makeHttpRequest<ChatCompletionResponse>(
      '/chat/completions',
      'POST',
      clonedRequest
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
      throw new Error(`OpenRouter streaming API error: ${response.status} - ${errorText}`);
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