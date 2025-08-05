import { injectable } from 'inversify';
import { BaseProviderAdapter, type ProviderConfiguration } from '../base';
import type { ILogger } from '../../../core/logging';
import type { MetricsService } from '../../../core/metrics';
import type { 
  ChatCompletionRequest, 
  ChatCompletionResponse,
  StreamChunk,
  ChatMessage,
  EmbeddingRequest,
  EmbeddingResponse,
  ImageGenerationRequest,
  ImageResponse,
  TranscriptionResponse,
  ModerationResponse
} from '../../../application/types';

interface GooglePart {
  thought?: boolean;
  text?: string;
  inlineData?: { mimeType: string; data: string };
  fileData?: { mimeType: string; fileUri: string };
  functionCall?: { name: string; args: any };
  functionResponse?: { name: string; response: any };
}

interface GoogleMessage {
  role: 'user' | 'model';
  parts: GooglePart[];
}

interface GoogleRequest {
  contents: GoogleMessage[];
  systemInstruction?: { parts: GooglePart[] };
  generationConfig?: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
    thinkingConfig?: {
      thinkingBudget: number;
      includeThoughts: boolean;
    };
  };
  tools?: Array<{
    functionDeclarations: Array<{
      name: string;
      description: string;
      parameters: any;
    }>;
  }>;
  toolConfig?: {
    functionCallingConfig: {
      mode: 'NONE' | 'AUTO' | 'ANY';
      allowedFunctionNames?: string[];
    };
  };
  safetySettings?: {
    category: string;
    threshold: string;
  }[];
}

interface GoogleCandidate {
  content: { parts: GooglePart[]; role: string };
  finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION';
  index: number;
}

interface GoogleResponse {
  candidates: GoogleCandidate[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
  responseId: string;
}

const HARM_CATEGORIES = [
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_CIVIC_INTEGRITY'
];

const REASONING_BUDGETS = { low: 1024, medium: 2048, high: 4096 };

@injectable()
export class GoogleAdapter extends BaseProviderAdapter {
  constructor(
    apiKey: string,
    logger: ILogger,
    metricsService: MetricsService
  ) {
    const configuration: ProviderConfiguration = {
      name: 'google',
      apiKey,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      timeout: 30000,
      maxRetries: 3,
      rateLimitPerMinute: 60,
      requiresApiKey: true,
      supportedModels: [
        'gemini-1.5-flash',
        'gemini-1.5-pro',
        'gemini-2.0-flash',
        'gemini-2.5-flash-lite-preview-06-17',
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'imagen-3.0-generate-002',
        'imagen-4.0-generate-preview-06-06'
      ],
      capabilities: {
        chat: true,
        audio: false,
        embeddings: true,
        images: true,
        moderation: false
      }
    };

    super(configuration, logger, metricsService);
  }

  protected async executeChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse | AsyncIterable<StreamChunk>> {
    const googleRequest = this.transformChatRequest(request);

    const action = request.stream ? 'streamGenerateContent' : 'generateContent';
    const url = `/models/${request.model}:${action}?key=${this.configuration.apiKey}${request.stream ? '&alt=sse' : ''}`;

    if (request.stream) {
      return this.streamChatCompletion(googleRequest, request.model, url);
    }

    const response = await this.makeHttpRequest<GoogleResponse>(
      url,
      'POST',
      googleRequest,
      { 'Content-Type': 'application/json' }
    );

    return this.transformChatResponse(response, request.model);
  }

  protected async executeTextToSpeech(): Promise<ArrayBuffer> {
    throw new Error('This provider does not support this endpoint');
  }

  protected async executeAudioTranscription(): Promise<TranscriptionResponse> {
    throw new Error('This provider does not support this endpoint');
  }

  protected async executeCreateEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const contents = Array.isArray(request.input) 
      ? request.input.map(text => ({ content: { parts: [{ text }] } }))
      : [{ content: { parts: [{ text: request.input }] } }];

    const googleRequest = {
      requests: contents.map(content => ({
        model: `models/${request.model}`,
        content: content.content
      }))
    };

    const response = await this.makeHttpRequest<any>(
      `/models/${request.model}:batchEmbedContents?key=${this.configuration.apiKey}`,
      'POST',
      googleRequest,
      { 'Content-Type': 'application/json' }
    );

    return this.transformEmbeddingResponse(response, request.model);
  }

  protected async executeGenerateImages(request: ImageGenerationRequest): Promise<ImageResponse> {
    const googleRequest = {
      instances: [{ prompt: request.prompt }],
      parameters: {
        sampleCount: request.n || 1,
        aspectRatio: this.mapImageSize(request.size),
      }
    };

    const response = await this.makeHttpRequest<any>(
      `/models/${request.model}:predict`,
      'POST',
      googleRequest,
      {
        'x-goog-api-key': this.configuration.apiKey,
        'Content-Type': 'application/json',
      }
    );

    return this.transformImageResponse(response);
  }

  protected async executeEditImages(): Promise<ImageResponse> {
    throw new Error('This provider does not support this endpoint');
  }

  protected async executeModerateContent(): Promise<ModerationResponse> {
    throw new Error('This provider does not support this endpoint');
  }

  private transformChatRequest(request: ChatCompletionRequest): GoogleRequest {
    const { contents, systemInstruction } = this.processMessages(request.messages);

    const googleRequest: GoogleRequest = {
      contents,
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.max_tokens,
        stopSequences: request.stop ? (Array.isArray(request.stop) ? request.stop : [request.stop]) : undefined
      },
      safetySettings: HARM_CATEGORIES.map(category => ({
        category,
        threshold: 'BLOCK_NONE'
      }))
    };

    const effort = request.reasoning_effort || request.reasoning?.effort;

    if (effort) {
      if (!googleRequest.generationConfig) {
        googleRequest.generationConfig = {};
      }

      googleRequest.generationConfig.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: REASONING_BUDGETS[effort] || 1024
      };
    }

    if (systemInstruction) {
      googleRequest.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    if (request.tools) {
      googleRequest.tools = [{
        functionDeclarations: request.tools.map(tool => ({
          name: tool.function.name,
          description: tool.function.description || '',
          parameters: tool.function.parameters || {}
        }))
      }];
    }

    if (request.tool_choice) {
      googleRequest.toolConfig = {
        functionCallingConfig: this.mapToolChoice(request.tool_choice)
      };
    }

    return googleRequest;
  }

  private processMessages(messages: ChatMessage[]): { contents: GoogleMessage[], systemInstruction?: string } {
    const contents: GoogleMessage[] = [];
    let systemInstruction: string | undefined;

    for (const msg of messages) {
      if (['developer', 'system'].includes(msg.role)) {
        systemInstruction = typeof msg.content === 'string' 
          ? msg.content 
          : msg.content!.map((c: any) => c.type === 'text' ? c.text : '').join('\n');
      } else if (msg.role === 'tool') {
        const toolResponse = {
          role: 'user' as const,
          parts: [{
            functionResponse: {
              name: msg.tool_call_id || 'unknown_function',
              response: { result: msg.content }
            }
          }]
        };
        contents.push(toolResponse);
      } else {
        const googleMessage: GoogleMessage = {
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: []
        };

        const contentParts = this.transformMessageContent(msg.content!);
        googleMessage.parts.push(...contentParts);

        if (msg.role === 'assistant' && msg.tool_calls) {
          const toolCallParts = msg.tool_calls.map(toolCall => ({
            functionCall: {
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments)
            }
          }));
          googleMessage.parts.push(...toolCallParts);
        }

        contents.push(googleMessage);
      }
    }

    return { contents, systemInstruction };
  }

  private transformMessageContent(content: string | any[]): GooglePart[] {
    if (!content) return [];
    if (typeof content === 'string') return [{ text: content }];
    if (!Array.isArray(content)) return [];

    return content.map(part => {
      if (!part) return { text: '' };

      if (part.type === 'text') return { text: part.text || '' };

      if (part.type === 'image_url') {
        const imageUrl = part.image_url?.url;
        if (!imageUrl) return { text: '' };

        if (imageUrl.startsWith('data:')) {
          const [mimeType, base64] = imageUrl.split(';base64,');
          return { inlineData: { mimeType: mimeType.replace('data:', ''), data: base64 } };
        }

        const mimeType = this.guessMimeTypeFromUrl(imageUrl);
        return { fileData: { mimeType, fileUri: imageUrl } };
      }

      return { text: JSON.stringify(part) };
    }).filter(part => part.text !== '');
  }

  private guessMimeTypeFromUrl(url: string): string {
    const extension = url.split('.').pop()?.split('?')[0]?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      bmp: 'image/bmp',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      tiff: 'image/tiff',
      ico: 'image/vnd.microsoft.icon',
      avif: 'image/avif'
    };
    return mimeTypes[extension || ''] || 'application/octet-stream';
  }

  private mapToolChoice(toolChoice: any): { mode: 'NONE' | 'AUTO' | 'ANY'; allowedFunctionNames?: string[] } {
    if (typeof toolChoice === 'string') {
      switch (toolChoice) {
        case 'none':
          return { mode: 'NONE' };
        case 'auto':
          return { mode: 'AUTO' };
        case 'required':
          return { mode: 'ANY' };
        default:
          return { mode: 'AUTO' };
      }
    }
    
    if (toolChoice && toolChoice.type === 'function') {
      return { 
        mode: 'ANY', 
        allowedFunctionNames: [toolChoice.function.name] 
      };
    }
    
    return { mode: 'AUTO' };
  }

  private transformChatResponse(response: GoogleResponse, model: string): ChatCompletionResponse {
    const candidate = response.candidates[0];
    const content = this.extractContent(candidate.content, false);
    const toolCalls = this.extractToolCalls(candidate.content);

    return {
      id: response.responseId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: Array.isArray(content) ? content.join('') : content,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined
        },
        finish_reason: this.mapFinishReason(candidate.finishReason)
      }],
      usage: {
        prompt_tokens: response.usageMetadata?.promptTokenCount || 0,
        completion_tokens: response.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: response.usageMetadata?.totalTokenCount || 0,
      },
    };
  }

  private extractContent(content: GoogleCandidate['content'], thoughts: boolean): string | string[] {
    if (!content?.parts) return thoughts ? [] : '';
    
    const filtered = content.parts
      .filter(part => thoughts ? part.thought : !part.thought && !part.functionCall)
      .filter(part => part.text)
      .map(part => part.text || '');

    return thoughts ? filtered : filtered.join('');
  }

  private extractToolCalls(content: GoogleCandidate['content']): any[] {
    if (!content?.parts) return [];
    
    return content.parts
      .filter(part => part.functionCall)
      .map((part, index) => ({
        id: `call_${Date.now()}_${index}`,
        type: 'function' as const,
        function: {
          name: part.functionCall!.name,
          arguments: JSON.stringify(part.functionCall!.args)
        }
      }));
  }

  private mapFinishReason(reason: GoogleCandidate['finishReason']): 'stop' | 'length' | 'content_filter' {
    const map = {
      'STOP': 'stop' as const,
      'MAX_TOKENS': 'length' as const,
      'SAFETY': 'content_filter' as const,
      'RECITATION': 'content_filter' as const
    };
    return map[reason] || 'stop';
  }

  private async *streamChatCompletion(request: GoogleRequest, model: string, url: string): AsyncIterable<StreamChunk> {
    const response = await fetch(`${this.configuration.baseUrl}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.configuration.timeout)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google streaming API error: ${response.status} - ${errorText}`);
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
          if (!line.trim() || !line.startsWith('data: ')) continue;
          
          try {
            const jsonStr = line.slice(6);
            if (jsonStr === '[DONE]') break;
            
            const data = JSON.parse(jsonStr) as GoogleResponse;
            for (const chunk of this.processStreamData(data, model)) {
              yield chunk;
            }
          } catch (error) {
            this.logger.warn('Failed to parse chunk', {
              metadata: { line, error: (error as Error).message }
            });
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private *processStreamData(data: GoogleResponse, model: string): Generator<StreamChunk> {
    if (!data.candidates?.[0]) return;
    
    const candidate = data.candidates[0];
    const baseChunk = {
      id: data.responseId,
      object: 'chat.completion.chunk' as const,
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: {}, finish_reason: null }],
    };

    if (candidate.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.text && !part.thought) {
          yield { 
            ...baseChunk, 
            choices: [{ 
              index: 0, 
              delta: { content: part.text }, 
              finish_reason: null 
            }] 
          };
        } else if (part.functionCall) {
          yield {
            ...baseChunk,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                  type: 'function',
                  function: {
                    name: part.functionCall.name,
                    arguments: JSON.stringify(part.functionCall.args)
                  }
                }]
              },
              finish_reason: null,
            }],
          };
        }
      }
    }

    if (candidate.finishReason) {
      yield {
        ...baseChunk,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: this.mapFinishReason(candidate.finishReason),
        }],
      };
    }
  }

  private mapImageSize(size?: string): string {
    const sizeMap: Record<string, string> = {
      '256x256': '1:1',
      '512x512': '1:1',
      '1024x1024': '1:1',
      '1536x1024': '16:9',
      '1024x1536': '9:16'
    };
    return size && sizeMap[size] ? sizeMap[size] : '1:1';
  }

  private transformImageResponse(response: any): ImageResponse {
    const images = response.predictions.map((prediction: any) => {
      return {
        url: prediction.uri || `data:image/png;base64,${prediction.bytesBase64Encoded}`
      };
    });

    return {
      created: Math.floor(Date.now() / 1000),
      data: images
    };
  }

  private transformEmbeddingResponse(response: any, model: string): EmbeddingResponse {
    const embeddings = response.embeddings.map((embedding: any, index: number) => ({
      object: 'embedding' as const,
      index,
      embedding: embedding.values
    }));

    return {
      object: 'list',
      data: embeddings,
      model,
      usage: { prompt_tokens: 0, total_tokens: 0 }
    };
  }
}