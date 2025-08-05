import { injectable } from 'inversify';
import { BaseProviderAdapter, type ProviderConfiguration } from '../base';
import type { ILogger } from '../../../core/logging';
import type { MetricsService } from '../../../core/metrics';
import type { 
  ChatCompletionRequest, 
  ChatCompletionResponse,
  StreamChunk,
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

@injectable()
export class OpenAIAdapter extends BaseProviderAdapter {
  constructor(
    apiKey: string,
    logger: ILogger,
    metricsService: MetricsService
  ) {
    const configuration: ProviderConfiguration = {
      name: 'openai',
      apiKey,
      baseUrl: 'https://api.openai.com/v1',
      timeout: 30000,
      maxRetries: 3,
      rateLimitPerMinute: 60,
      requiresApiKey: true,
      supportedModels: [
        'gpt-3.5-turbo',
        'gpt-4o-mini',
        'gpt-4o-mini-search-preview',
        'gpt-4o',
        'gpt-4o-search-preview',
        'gpt-4.1-nano',
        'gpt-4.1-mini',
        'gpt-4.1',
        'chatgpt-4o-latest',
        'gpt-oss-20b',
        'gpt-oss-120b',
        'o1',
        'o3-mini',
        'o3',
        'o4-mini',
        'dall-e-3',
        'gpt-image-1',
        'text-embedding-3-small',
        'text-embedding-3-large',
        'tts-1',
        'tts-1-hd',
        'gpt-4o-mini-tts',
        'whisper-1',
        'gpt-4o-mini-transcribe',
        'gpt-4o-transcribe',
        'omni-moderation-latest'
      ],
      capabilities: {
        chat: true,
        audio: true,
        embeddings: true,
        images: true,
        moderation: true
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

  protected async executeTextToSpeech(request: SpeechRequest): Promise<ArrayBuffer> {
    const payload = {
      model: request.model,
      input: request.input,
      voice: request.voice,
      response_format: request.response_format || 'mp3',
      speed: request.speed || 1.0
    };

    const response = await fetch(`${this.configuration.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: this.createHttpHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.configuration.timeout)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI TTS API error: ${response.status} - ${errorText}`);
    }

    return response.arrayBuffer();
  }

  protected async executeAudioTranscription(request: AudioTranscriptionRequest): Promise<TranscriptionResponse> {
    const formData = this.createAudioFormData(request);
    const headers = this.createHttpHeaders();
    delete headers['Content-Type'];

    const response = await fetch(`${this.configuration.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers,
      body: formData,
      signal: AbortSignal.timeout(this.configuration.timeout)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI transcription API error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  protected async executeCreateEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const response = await this.makeHttpRequest<EmbeddingResponse>(
      '/embeddings',
      'POST',
      request
    );

    return response;
  }

  protected async executeGenerateImages(request: ImageGenerationRequest): Promise<ImageResponse> {
    const payload = {
      model: request.model,
      prompt: request.prompt,
      n: request.n || 1,
      size: request.size || '1024x1024'
    };

    const response = await this.makeHttpRequest<any>(
      '/images/generations',
      'POST',
      payload
    );

    return {
      created: response.created,
      data: response.data
    };
  }

  protected async executeEditImages(request: ImageEditRequest): Promise<ImageResponse> {
    const formData = this.createImageEditFormData(request);
    const headers = this.createHttpHeaders();
    delete headers['Content-Type'];

    const response = await fetch(`${this.configuration.baseUrl}/images/edits`, {
      method: 'POST',
      headers,
      body: formData,
      signal: AbortSignal.timeout(this.configuration.timeout)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI image edit API error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  protected async executeModerateContent(request: ModerationRequest): Promise<ModerationResponse> {
    const response = await this.makeHttpRequest<ModerationResponse>(
      '/moderations',
      'POST',
      request
    );

    return response;
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
      throw new Error(`OpenAI streaming API error: ${response.status} - ${errorText}`);
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

  private createAudioFormData(request: AudioTranscriptionRequest): FormData {
    const formData = new FormData();
    formData.append('file', request.file);
    formData.append('model', request.model);
    
    if (request.language) formData.append('language', request.language);
    if (request.prompt) formData.append('prompt', request.prompt);
    if (request.response_format) formData.append('response_format', request.response_format);
    if (request.temperature !== undefined) formData.append('temperature', request.temperature.toString());
    
    return formData;
  }

  private createImageEditFormData(request: ImageEditRequest): FormData {
    const formData = new FormData();
    formData.append('model', request.model);
    formData.append('prompt', request.prompt);

    const pngBlob = new Blob([request.image], { type: 'image/png' });
    const imageFile = new File([pngBlob], 'image.png', { type: 'image/png' });
    formData.append('image', imageFile);
    
    if (request.mask) formData.append('mask', request.mask);
    if (request.n) formData.append('n', request.n.toString());
    if (request.size) formData.append('size', request.size);
    
    return formData;
  }
}
