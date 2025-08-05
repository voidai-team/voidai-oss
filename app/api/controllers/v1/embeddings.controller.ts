import { t } from 'elysia';
import { injectable } from 'inversify';
import { TYPES } from '../../../core/container/types';
import type { EmbeddingsService } from '../../../application/services';
import type { EmbeddingRequest } from '../../../application/types';
import { BaseController, type RequestContext, type ControllerConfiguration } from '../base.controller';

const EmbeddingRequestSchema = t.Object({
  model: t.String(),
  input: t.Union([
    t.String(),
    t.Array(t.String()),
    t.Array(t.Number()),
    t.Array(t.Array(t.Number()))
  ]),
  encoding_format: t.Optional(t.Union([
    t.Literal('float'),
    t.Literal('base64')
  ])),
  dimensions: t.Optional(t.Number()),
  user: t.Optional(t.String())
});

@injectable()
export class EmbeddingsController extends BaseController {
  private readonly embeddingsService: EmbeddingsService;

  constructor() {
    const configuration: ControllerConfiguration = {
      prefix: '/v1/embeddings',
      enableAuth: true,
      enableMetrics: true,
      enableErrorHandling: true,
      rateLimitConfig: {
        maxRequests: 100,
        windowMs: 60000
      }
    };

    super(configuration);
    this.embeddingsService = this.getService<EmbeddingsService>(TYPES.EmbeddingsService);
  }

  public registerRoutes() {
    return this.createApplication()
      .post('/', async (context) => {
        return await this.executeWithContext(
          'create_embeddings',
          context,
          async (requestContext: RequestContext) => {
            const request = this.validateAndParseRequest(context.body);

            this.logRequestDetails(request, requestContext);

            const embeddings = await this.embeddingsService.createEmbeddings(request, requestContext.user);

            this.logger.info('Embeddings created successfully', {
              requestId: requestContext.requestId,
              userId: requestContext.user.id,
              metadata: {
                model: request.model,
                inputCount: Array.isArray(request.input) ? request.input.length : 1,
                embeddingCount: embeddings.data.length,
                totalTokens: embeddings.usage.total_tokens
              }
            });

            return this.createSuccessResponse(embeddings, requestContext);
          }
        );
      }, {
        body: EmbeddingRequestSchema
      });
  }

  private validateAndParseRequest(body: any): EmbeddingRequest {
    try {
      return this.validateRequestPayload<EmbeddingRequest>(
        body,
        this.isEmbeddingRequest
      );
    } catch (error) {
      this.logger.warn('Invalid embedding request payload', {
        metadata: {
          error: (error as Error).message,
          payloadKeys: Object.keys(body || {})
        }
      });
      throw new Error('Invalid embedding request format');
    }
  }

  private isEmbeddingRequest(data: any): data is EmbeddingRequest {
    return (
      typeof data === 'object' &&
      data !== null &&
      typeof data.model === 'string' &&
      (
        typeof data.input === 'string' ||
        Array.isArray(data.input)
      )
    );
  }

  private logRequestDetails(request: EmbeddingRequest, context: RequestContext): void {
    const inputCount = Array.isArray(request.input) ? request.input.length : 1;
    const inputType = typeof request.input;
    
    this.logger.debug('Embedding request details', {
      requestId: context.requestId,
      userId: context.user.id,
      metadata: {
        model: request.model,
        inputType,
        inputCount,
        encodingFormat: request.encoding_format,
        dimensions: request.dimensions
      }
    });
  }
}

export const embeddingsController = new EmbeddingsController().registerRoutes();