import { injectable, inject } from 'inversify';
import { TYPES } from '../../core/container';
import type { ILogger } from '../../core/logging';
import type { UserService, AuthorizationService, ModelRegistryService } from '../../domain/services';
import type { ModelListResponse, AuthenticatedUser } from '../types';

@injectable()
export class ModelsService {
  private readonly logger: ILogger;
  private readonly userService: UserService;
  private readonly authorizationService: AuthorizationService;
  private readonly modelRegistryService: ModelRegistryService;

  constructor(
    @inject(TYPES.Logger) logger: ILogger,
    @inject(TYPES.UserService) userService: UserService,
    @inject(TYPES.AuthorizationService) authorizationService: AuthorizationService,
    @inject(TYPES.ModelRegistryService) modelRegistryService: ModelRegistryService
  ) {
    this.logger = logger.createChild('ModelsService');
    this.userService = userService;
    this.authorizationService = authorizationService;
    this.modelRegistryService = modelRegistryService;
  }

  async listModels(user: AuthenticatedUser): Promise<ModelListResponse> {
    const requestId = this.generateRequestId();

    try {
      this.logger.info('Processing models list request', {
        requestId,
        userId: user.id
      });

      const userEntity = await this.userService.getUserById(user.id);
      if (!userEntity) {
        throw new Error('User not found');
      }

      const allModels = this.modelRegistryService.list();
      const authorizedModels = [];

      const response: ModelListResponse = {
        object: 'list',
        data: this.modelRegistryService.list()
      };

      this.logger.info('Models list request completed successfully', {
        requestId,
        userId: user.id,
        metadata: {
          totalModels: allModels.length,
          authorizedModels: authorizedModels.length
        }
      });

      return response;

    } catch (error) {
      this.logger.error('Models list request failed', error as Error, {
        metadata: { userId: user.id, requestId }
      });

      throw error;
    }
  }

  async getModel(modelId: string, user: AuthenticatedUser): Promise<any> {
    const requestId = this.generateRequestId();

    try {
      this.logger.info('Processing model details request', {
        requestId,
        userId: user.id,
        metadata: { modelId }
      });

      const userEntity = await this.userService.getUserById(user.id);
      if (!userEntity) {
        throw new Error('User not found');
      }

      const authResult = await this.authorizationService.authorizeModel(
        userEntity,
        modelId,
        '/v1/models'
      );

      if (!authResult.authorized) {
        throw new Error(authResult.reason || 'Model access denied');
      }

      const model = this.modelRegistryService.getById(modelId);
      if (!model) {
        throw new Error('Model not found');
      }

      this.logger.info('Model details request completed successfully', {
        requestId,
        userId: user.id,
        metadata: { modelId }
      });

      return model;

    } catch (error) {
      this.logger.error('Model details request failed', error as Error, {
        metadata: { userId: user.id, modelId, requestId }
      });

      throw error;
    }
  }

  private generateRequestId(): string {
    return `models-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}