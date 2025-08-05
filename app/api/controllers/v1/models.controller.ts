import { injectable } from 'inversify';
import { TYPES } from '../../../core/container/types';
import type { ModelsService } from '../../../application/services';
import { BaseController, type RequestContext, type ControllerConfiguration } from '../base.controller';

@injectable()
export class ModelsController extends BaseController {
  private readonly modelsService: ModelsService;

  constructor() {
    const configuration: ControllerConfiguration = {
      prefix: '/v1/models',
      enableAuth: true,
      enableMetrics: true,
      enableErrorHandling: true,
      rateLimitConfig: {
        maxRequests: 200,
        windowMs: 60000
      }
    };

    super(configuration);
    this.modelsService = this.getService<ModelsService>(TYPES.ModelsService);
  }

  public registerRoutes() {
    return this.createApplication()
      .get('/', async (context) => {
        return await this.executeWithContext(
          'list_models',
          context,
          async (requestContext: RequestContext) => {
            this.logger.info('Listing available models', {
              requestId: requestContext.requestId,
              userId: requestContext.user.id
            });

            const models = await this.modelsService.listModels(requestContext.user);

            this.logger.info('Models list retrieved successfully', {
              requestId: requestContext.requestId,
              userId: requestContext.user.id,
              metadata: {
                modelCount: models.data.length
              }
            });

            return this.createSuccessResponse(models, requestContext);
          }
        );
      })
      .get('/:model', async (context) => {
        return await this.executeWithContext(
          'get_model',
          context,
          async (requestContext: RequestContext) => {
            const modelId = context.params.model;

            if (!modelId || typeof modelId !== 'string') {
              throw new Error('Model ID is required and must be a string');
            }

            this.logger.info('Retrieving model details', {
              requestId: requestContext.requestId,
              userId: requestContext.user.id,
              metadata: { modelId }
            });

            const model = await this.modelsService.getModel(modelId, requestContext.user);

            this.logger.info('Model details retrieved successfully', {
              requestId: requestContext.requestId,
              userId: requestContext.user.id,
              metadata: { modelId }
            });

            return this.createSuccessResponse(model, requestContext);
          }
        );
      });
  }
}

export const modelsController = new ModelsController().registerRoutes();