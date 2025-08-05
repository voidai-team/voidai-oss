import { t } from 'elysia';
import { injectable } from 'inversify';
import { TYPES } from '../../../core/container/types';
import type { ChatService } from '../../../application/services';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../../../application/types';
import { BaseController, type RequestContext, type ControllerConfiguration } from '../base.controller';

const ChatMessageSchema = t.Object({
  role: t.Union([
    t.Literal('system'),
    t.Literal('user'),
    t.Literal('assistant'),
    t.Literal('developer'),
    t.Literal('function'),
    t.Literal('tool')
  ]),
  content: t.Union([
    t.String(),
    t.Array(t.Object({
      type: t.Union([t.Literal('text'), t.Literal('image_url')]),
      text: t.Optional(t.String()),
      image_url: t.Optional(t.Object({
        url: t.String(),
        detail: t.Optional(t.Union([t.Literal('low'), t.Literal('high'), t.Literal('auto')]))
      }))
    })),
    t.Null()
  ]),
  name: t.Optional(t.String()),
  tool_calls: t.Optional(t.Array(t.Object({
    id: t.String(),
    type: t.Literal('function'),
    function: t.Object({
      name: t.String(),
      arguments: t.String()
    })
  }))),
  tool_call_id: t.Optional(t.String()),
  cache_control: t.Optional(t.Object({
    type: t.Literal('ephemeral')
  }))
});

const ChatCompletionRequestSchema = t.Object({
  model: t.String(),
  messages: t.Array(ChatMessageSchema),
  temperature: t.Optional(t.Number()),
  stream: t.Optional(t.Boolean()),
  stop: t.Optional(t.Union([t.String(), t.Array(t.String())])),
  max_tokens: t.Optional(t.Number()),
  presence_penalty: t.Optional(t.Number()),
  frequency_penalty: t.Optional(t.Number()),
  tools: t.Optional(t.Array(t.Object({
    type: t.Literal('function'),
    function: t.Object({
      name: t.String(),
      description: t.Optional(t.String()),
      parameters: t.Record(t.String(), t.Any())
    })
  }))),
  tool_choice: t.Optional(t.Union([
    t.String(),
    t.Object({
      type: t.Literal('function'),
      function: t.Object({
        name: t.String()
      })
    })
  ])),
  parallel_tool_calls: t.Optional(t.Boolean()),
  response_format: t.Optional(t.Object({
    type: t.Union([t.Literal('text'), t.Literal('json_object')])
  })),
  reasoning_effort: t.Optional(t.Union([t.Literal('low'), t.Literal('medium'), t.Literal('high')])),
  reasoning: t.Optional(t.Object({
    effort: t.Union([t.Literal('low'), t.Literal('medium'), t.Literal('high')])
  }))
});

@injectable()
export class ChatController extends BaseController {
  private readonly chatService: ChatService;

  constructor() {
    const configuration: ControllerConfiguration = {
      prefix: '/v1/chat',
      enableAuth: true,
      enableMetrics: true,
      enableErrorHandling: true,
      rateLimitConfig: {
        maxRequests: 100,
        windowMs: 60000
      }
    };

    super(configuration);
    this.chatService = this.getService<ChatService>(TYPES.ChatService);
  }

  public registerRoutes() {
    return this.createApplication()
      .post('/completions', async (context) => {
        return await this.executeWithContext(
          'chat_completion',
          context,
          async (requestContext: RequestContext) => {
            const request = this.validateAndParseRequest(context.body);
            
            this.logRequestDetails(request, requestContext);
            
            const result = await this.chatService.processCompletion(request, requestContext.user);
            
            if (request.stream) {
              return this.handleStreamingResponse(result, requestContext);
            }
            
            return this.handleNonStreamingResponse(result as ChatCompletionResponse, requestContext);
          }
        );
      }, {
        body: ChatCompletionRequestSchema
      });
  }

  private validateAndParseRequest(body: any): ChatCompletionRequest {
    try {
      return this.validateRequestPayload<ChatCompletionRequest>(
        body,
        this.isChatCompletionRequest
      );
    } catch (error) {
      this.logger.warn('Invalid chat completion request payload', {
        metadata: {
          error: (error as Error).message,
          payloadKeys: Object.keys(body || {})
        }
      });
      throw new Error('Invalid chat completion request format');
    }
  }

  private isChatCompletionRequest(data: any): data is ChatCompletionRequest {
    return (
      typeof data === 'object' &&
      data !== null &&
      typeof data.model === 'string' &&
      Array.isArray(data.messages) &&
      data.messages.length > 0 &&
      data.messages.every((msg: any) => 
        typeof msg === 'object' &&
        typeof msg.role === 'string' &&
        (typeof msg.content === 'string' || msg.content === null || Array.isArray(msg.content))
      )
    );
  }

  private logRequestDetails(request: ChatCompletionRequest, context: RequestContext): void {
    this.logger.debug('Chat completion request details', {
      requestId: context.requestId,
      userId: context.user.id,
      metadata: {
        model: request.model,
        messageCount: request.messages.length,
        isStreaming: request.stream || false,
        hasTools: !!(request.tools && request.tools.length > 0),
        temperature: request.temperature,
        maxTokens: request.max_tokens
      }
    });
  }

  private handleStreamingResponse(result: any, context: RequestContext) {
    this.logger.info('Initiating streaming chat completion', {
      requestId: context.requestId,
      userId: context.user.id
    });

    const streamResponse = this.createStreamResponse(
      result,
      context,
      (error) => {
        this.logger.error('Streaming chat completion error', error, {
          requestId: context.requestId,
          userId: context.user.id
        });
      }
    );

    return new Response(streamResponse.stream, {
      headers: streamResponse.headers
    });
  }

  private handleNonStreamingResponse(result: ChatCompletionResponse, context: RequestContext) {
    this.logger.info('Chat completion response generated', {
      requestId: context.requestId,
      userId: context.user.id,
      metadata: {
        responseId: result.id,
        model: result.model,
        choicesCount: result.choices.length,
        totalTokens: result.usage.total_tokens,
        promptTokens: result.usage.prompt_tokens,
        completionTokens: result.usage.completion_tokens
      }
    });

    return this.createSuccessResponse(result, context);
  }
}

export const chatController = new ChatController().registerRoutes();