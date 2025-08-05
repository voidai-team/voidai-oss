import { t } from 'elysia';
import { injectable } from 'inversify';
import { TYPES } from '../../../core/container/types';
import type { ModerationsService } from '../../../application/services';
import type { ModerationRequest } from '../../../application/types';
import { BaseController, type RequestContext, type ControllerConfiguration } from '../base.controller';

const ModerationRequestSchema = t.Object({
  input: t.Union([
    t.String(),
    t.Array(t.String())
  ]),
  model: t.Optional(t.String())
});

@injectable()
export class ModerationsController extends BaseController {
  private readonly moderationsService: ModerationsService;

  constructor() {
    const configuration: ControllerConfiguration = {
      prefix: '/v1/moderations',
      enableAuth: true,
      enableMetrics: true,
      enableErrorHandling: true,
      rateLimitConfig: {
        maxRequests: 200,
        windowMs: 60000
      }
    };

    super(configuration);
    this.moderationsService = this.getService<ModerationsService>(TYPES.ModerationsService);
  }

  public registerRoutes() {
    return this.createApplication()
      .post('/', async (context) => {
        return await this.executeWithContext(
          'create_moderation',
          context,
          async (requestContext: RequestContext) => {
            const request = this.validateAndParseRequest(context.body);

            this.logRequestDetails(request, requestContext);

            const moderation = await this.moderationsService.createModeration(request, requestContext.user);

            this.logger.info('Content moderation completed successfully', {
              requestId: requestContext.requestId,
              userId: requestContext.user.id,
              metadata: {
                model: request.model,
                inputCount: Array.isArray(request.input) ? request.input.length : 1,
                resultCount: moderation.results.length,
                flaggedCount: moderation.results.filter(r => r.flagged).length
              }
            });

            return this.createSuccessResponse(moderation, requestContext);
          }
        );
      }, {
        body: ModerationRequestSchema
      });
  }

  private validateAndParseRequest(body: any): ModerationRequest {
    try {
      return this.validateRequestPayload<ModerationRequest>(
        body,
        this.isModerationRequest
      );
    } catch (error) {
      this.logger.warn('Invalid moderation request payload', {
        metadata: {
          error: (error as Error).message,
          payloadKeys: Object.keys(body || {})
        }
      });
      throw new Error('Invalid moderation request format');
    }
  }

  private isModerationRequest(data: any): data is ModerationRequest {
    return (
      typeof data === 'object' &&
      data !== null &&
      (
        typeof data.input === 'string' ||
        (Array.isArray(data.input) && data.input.every((item: any) => typeof item === 'string'))
      )
    );
  }

  private logRequestDetails(request: ModerationRequest, context: RequestContext): void {
    const inputCount = Array.isArray(request.input) ? request.input.length : 1;
    const totalLength = Array.isArray(request.input)
      ? request.input.reduce((sum, item) => {
          if (typeof item === 'string') {
            return sum + item.length;
          } else if (typeof item === 'object' && item.type === 'text' && item.text) {
            return sum + item.text.length;
          }
          return sum + 100;
        }, 0)
      : (request.input as string).length;
    
    this.logger.debug('Moderation request details', {
      requestId: context.requestId,
      userId: context.user.id,
      metadata: {
        model: request.model,
        inputCount,
        totalLength
      }
    });
  }
}

export const moderationsController = new ModerationsController().registerRoutes();