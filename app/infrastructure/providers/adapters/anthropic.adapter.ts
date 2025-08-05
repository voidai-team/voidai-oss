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
  ModerationResponse,
  ChatMessage,
  ToolCall,
  ThinkingBlock
} from '../../../application/types';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContent[];
}

interface AnthropicContent {
  type: 'text' | 'image' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: any;
  tool_use_id?: string;
  content?: string | AnthropicContent[];
  source?: {
    type: 'base64' | 'url';
    media_type?: string;
    data?: string;
    url?: string;
  };
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | { type: 'text'; text: string }[];
  max_tokens: number;
  temperature?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: { name: string; description?: string; input_schema: any }[];
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string; disable_parallel_tool_use?: boolean };
  thinking?: { type: 'enabled'; budget_tokens: number };
}

interface AnthropicResponse {
  id: string;
  content: AnthropicContent[];
  model: string;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number };
}

const REASONING_BUDGET_MAP = {
  low: 1024,
  medium: 2048,
  high: 4096
};

@injectable()
export class AnthropicAdapter extends BaseProviderAdapter {
  private readonly anthropicVersion = '2023-06-01';

  constructor(
    apiKey: string,
    logger: ILogger,
    metricsService: MetricsService
  ) {
    const configuration: ProviderConfiguration = {
      name: 'anthropic',
      apiKey,
      baseUrl: 'https://api.anthropic.com/v1',
      timeout: 30000,
      maxRetries: 3,
      rateLimitPerMinute: 60,
      requiresApiKey: true,
      supportedModels: [
        'claude-3-haiku-20240307',
        'claude-3-opus-20240229',
        'claude-3-5-sonnet-20240620',
        'claude-3-5-haiku-20241022',
        'claude-3-5-sonnet-20241022',
        'claude-3-7-sonnet-20250219',
        'claude-sonnet-4-20250514',
        'claude-opus-4-20250514'
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
    const anthropicRequest = this.buildRequest(request);

    if (request.stream) {
      return this.createStreamResponse('/messages', anthropicRequest);
    }

    const response = await this.makeHttpRequest<AnthropicResponse>(
      '/messages',
      'POST',
      anthropicRequest
    );

    return this.buildResponse(response, request.model, anthropicRequest);
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

  protected async executeHealthCheck(): Promise<void> {
    await this.makeHttpRequest<any>('/messages', 'POST', {
      model: 'claude-3-haiku-20240307',
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 1
    });
  }

  protected createHttpHeaders(): Record<string, string> {
    return {
      'X-Api-Key': this.configuration.apiKey || '',
      'Anthropic-Version': this.anthropicVersion,
      'Content-Type': 'application/json'
    };
  }

  private buildRequest(request: ChatCompletionRequest): AnthropicRequest {
    const systemContents = this.extractSystemContents(request.messages);
    const messages = this.convertMessages(request.messages.filter(m => !['developer', 'system'].includes(m.role)));

    const anthropicRequest: AnthropicRequest = {
      model: request.model,
      messages,
      max_tokens: request.max_tokens || request.max_completion_tokens || 4096,
      stream: request.stream || false
    };

    if (systemContents.length > 0) {
      anthropicRequest.system = systemContents.length === 1 ? systemContents[0].text : systemContents;
    }

    if (request.temperature !== undefined) anthropicRequest.temperature = request.temperature;
    if (request.stop) anthropicRequest.stop_sequences = Array.isArray(request.stop) ? request.stop : [request.stop];

    if (request.tools) {
      anthropicRequest.tools = request.tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters || { type: 'object' }
      }));

      if (request.tool_choice && request.tool_choice !== 'none') {
        anthropicRequest.tool_choice = this.mapToolChoice(request.tool_choice, request.parallel_tool_calls);
      }
    }

    const effort = request.reasoning_effort || request.reasoning?.effort;

    if (effort) {
      const budget = REASONING_BUDGET_MAP[effort];
      anthropicRequest.thinking = { type: 'enabled', budget_tokens: budget };
      anthropicRequest.temperature = 1.0;
      if (anthropicRequest.max_tokens <= budget) anthropicRequest.max_tokens = budget + 1;
    }

    return anthropicRequest;
  }

  private extractSystemContents(messages: ChatMessage[]): { type: 'text'; text: string }[] {
    return messages
      .filter(msg => ['developer', 'system'].includes(msg.role))
      .map(msg => ({ type: 'text' as const, text: typeof msg.content === 'string' ? msg.content : '' }))
      .filter(content => content.text);
  }

  private convertMessages(messages: ChatMessage[]): AnthropicMessage[] {
    const anthropicMessages: AnthropicMessage[] = [];
    
    for (const message of messages) {
      if (message.role === 'tool' && message.tool_call_id) {
        anthropicMessages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: message.tool_call_id,
            content: message.content as string
          }]
        });
        continue;
      }

      const role = message.role === 'assistant' ? 'assistant' : 'user';
      let content = this.convertContent(message);

      if (message.role === 'assistant' && message.tool_calls) {
        const toolContents = message.tool_calls.map(tc => ({
          type: 'tool_use' as const,
          id: tc.id || `tool_${Date.now()}`,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments)
        }));
        content = typeof content === 'string' && content
          ? [{ type: 'text', text: content }, ...toolContents]
          : [...(Array.isArray(content) ? content : []), ...toolContents];
      }

      anthropicMessages.push({ role, content });
    }
    
    return this.mergeConsecutiveUserMessages(anthropicMessages);
  }

  private convertContent(message: ChatMessage): string | AnthropicContent[] {
    if (typeof message.content === 'string') return message.content;
    if (!Array.isArray(message.content)) return '';

    return message.content.map(part => {
      if (part.type === 'text') return { type: 'text', text: part.text || '' };
      
      if (part.type === 'image_url' && part.image_url?.url) {
        if (part.image_url.url.startsWith('data:')) {
          const [mimeType, base64Data] = this.parseDataUrl(part.image_url.url);
          return { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Data } };
        }
        if (part.image_url.url.startsWith('http')) {
          return { type: 'image', source: { type: 'url', url: part.image_url.url } };
        }
      }

      return { type: 'text', text: '' };
    });
  }

  private parseDataUrl(dataUrl: string): [string, string] {
    const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) throw new Error('Invalid data URL format');
    return [matches[1], matches[2]];
  }

  private mergeConsecutiveUserMessages(messages: AnthropicMessage[]): AnthropicMessage[] {
    const merged: AnthropicMessage[] = [];
    
    for (const current of messages) {
      const lastMessage = merged[merged.length - 1];
      
      if (current.role === 'user' && lastMessage?.role === 'user') {
        const prevContent = Array.isArray(lastMessage.content) 
          ? lastMessage.content 
          : [{ type: 'text' as const, text: lastMessage.content }];
        const currContent = Array.isArray(current.content) 
          ? current.content 
          : [{ type: 'text' as const, text: current.content }];
        
        lastMessage.content = [...prevContent, ...currContent];
      } else {
        merged.push(current);
      }
    }
    
    return merged;
  }

  private mapToolChoice(
    toolChoice: string | { type: string; function: { name: string } },
    parallelToolCalls?: boolean
  ): { type: 'auto' | 'any' | 'tool'; name?: string; disable_parallel_tool_use?: boolean } {
    let choice: any;
    
    if (toolChoice === 'auto') choice = { type: 'auto' };
    else if (toolChoice === 'required') choice = { type: 'any' };
    else if (typeof toolChoice === 'object' && toolChoice.function?.name) {
      choice = { type: 'tool', name: toolChoice.function.name };
    }

    if (choice && parallelToolCalls !== undefined) {
      choice.disable_parallel_tool_use = !parallelToolCalls;
    }

    return choice;
  }

  private buildResponse(response: AnthropicResponse, model: string, request: AnthropicRequest): ChatCompletionResponse {
    let textContent = '';
    const toolCalls: ToolCall[] = [];
    const thinkingBlocks: ThinkingBlock[] = [];
    
    for (const content of response.content) {
      if (content.type === 'text') {
        textContent += content.text || '';
      } else if (content.type === 'tool_use') {
        toolCalls.push({
          id: content.id,
          type: 'function',
          function: {
            name: content.name || '',
            arguments: JSON.stringify(content.input || {})
          }
        });
      } else if (content.type === 'thinking') {
        thinkingBlocks.push({
          type: 'thinking_block',
          thinking: content.thinking!,
          signature: content.signature
        });
      }
    }

    let messageContent = textContent;
    if (request.tool_choice?.name === 'json_response' && toolCalls.length === 1) {
      try {
        const args = JSON.parse(toolCalls[0].function.arguments);
        messageContent = JSON.stringify(args);
      } catch {}
    }

    const usage = response.usage;
    const promptTokens = usage.input_tokens + (usage.cache_read_input_tokens || 0);

    return {
      id: response.id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: messageContent || '',
          tool_calls: toolCalls.length > 0 && request.tool_choice?.name !== 'json_response' ? toolCalls : undefined,
          thinking_blocks: thinkingBlocks.length > 0 ? thinkingBlocks : undefined
        },
        finish_reason: response.stop_reason as "length" | "stop" | "tool_calls" | "content_filter" | null
      }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: usage.output_tokens,
        total_tokens: promptTokens + usage.output_tokens
      }
    };
  }

  private async *createStreamResponse(endpoint: string, request: AnthropicRequest): AsyncIterable<StreamChunk> {
    const response = await fetch(`${this.configuration.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: this.createHttpHeaders(),
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.configuration.timeout)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic streaming API error: ${response.status} - ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolCall: { id: string; name: string; input: string } | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          
          const data = line.slice(6);
          if (data === '[DONE]') return;

          try {
            const event = JSON.parse(data);
            const chunk = this.parseStreamEvent(event, request, currentToolCall);
            
            if (chunk?.type === 'tool_call_start') {
              currentToolCall = chunk.toolCall || null;
            } else if (chunk?.type === 'tool_call_delta' && currentToolCall) {
              currentToolCall.input += chunk.delta || '';
            } else if (chunk?.type === 'tool_call_end') {
              currentToolCall = null;
            }
            
            if (chunk?.data) {
              yield chunk.data as StreamChunk;
            }
          } catch (error) {
            this.logger.warn('Failed to parse stream event', {
              metadata: { data, error: (error as Error).message }
            });
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private parseStreamEvent(event: any, request: AnthropicRequest, currentToolCall: any): any {
    const baseChunk = {
      id: 'stream_' + Date.now(),
      object: 'chat.completion.chunk' as const,
      created: Math.floor(Date.now() / 1000),
      model: request.model
    };

    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      return {
        type: 'tool_call_start',
        toolCall: {
          id: event.content_block.id,
          name: event.content_block.name,
          input: ''
        }
      };
    }

    if (event.type === 'content_block_delta') {
      if (event.delta?.type === 'text_delta') {
        return {
          type: 'text',
          data: {
            ...baseChunk,
            choices: [{
              index: 0,
              delta: { content: event.delta.text },
              finish_reason: null
            }]
          }
        };
      }
      
      if (event.delta?.type === 'input_json_delta') {
        return { type: 'tool_call_delta', delta: event.delta.partial_json };
      }

      if (event.delta?.type === 'thinking_delta') {
        return {
          type: 'thinking_delta',
          data: {
            ...baseChunk,
            choices: [{
              index: 0,
              delta: {
                thinking_blocks: [{
                  type: 'thinking_block',
                  thinking: event.delta.thinking
                }]
              },
              finish_reason: null
            }]
          }
        };
      }
    }

    if (event.type === 'content_block_stop' && currentToolCall) {
      return {
        type: 'tool_call_end',
        data: {
          ...baseChunk,
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                id: currentToolCall.id,
                type: 'function' as const,
                function: {
                  name: currentToolCall.name,
                  arguments: currentToolCall.input
                }
              }]
            },
            finish_reason: null
          }]
        }
      };
    }

    if (event.type === 'message_stop') {
      return {
        type: 'message_stop',
        data: {
          ...baseChunk,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: 'stop'
          }]
        }
      };
    }

    return null;
  }
}