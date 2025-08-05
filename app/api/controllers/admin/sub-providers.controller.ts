import { injectable, inject } from 'inversify';
import { t } from 'elysia';
import { TYPES } from '../../../core/container';
import { BaseController, type ControllerConfiguration } from '../base.controller';
import type { SubProviderService } from '../../../domain/services';

export interface CreateSubProviderRequest {
  name?: string;
  providerId?: string;
  apiKey: string;
  enabled?: boolean;
  priority?: number;
  weight?: number;
  maxRequestsPerMinute?: number;
  maxConcurrentRequests?: number;
}

export interface UpdateSubProviderRequest {
  name?: string;
  apiKey?: string;
  enabled?: boolean;
  priority?: number;
  weight?: number;
  maxRequestsPerMinute?: number;
  maxConcurrentRequests?: number;
}

export interface ListSubProvidersQuery {
  limit?: string;
  offset?: string;
  providerId?: string;
}

@injectable()
export class SubProvidersController extends BaseController {
  constructor(
    @inject(TYPES.SubProviderService) private subProviderService: SubProviderService
  ) {
    const config: ControllerConfiguration = {
      prefix: '/admin',
      enableAuth: true,
      enableMetrics: true,
      enableErrorHandling: true,
      requireAdmin: true
    };
    super(config);
  }

  public registerRoutes() {
    const app = this.createApplication();

    return app
      .get('/sub-providers', 
        async (context) => {
          return this.executeWithContext('listSubProviders', context, async () => {
            const query = context.query as ListSubProvidersQuery;
            const limit = Math.min(parseInt(query.limit || '100'), 1000);
            const offset = Math.max(parseInt(query.offset || '0'), 0);

            const subProviders = await this.subProviderService.getAvailableSubProviders(query.providerId!);
            const paginatedSubProviders = subProviders.slice(offset, offset + limit);

            return {
              object: 'list',
              data: paginatedSubProviders.map(sp => ({
                id: sp.getId(),
                providerId: sp.getProviderId(),
                name: sp.getName(),
                isEnabled: sp.isEnabled(),
                priority: sp.getPriority(),
                weight: sp.getWeight(),
                createdAt: sp.getCreatedAt(),
                updatedAt: sp.getUpdatedAt(),
                object: 'sub_provider'
              })),
              hasMore: offset + limit < subProviders.length
            };
          });
        },
        {
          query: t.Object({
            limit: t.Optional(t.String()),
            offset: t.Optional(t.String()),
            providerId: t.Optional(t.String())
          })
        }
      )
      .get('/sub-providers/:subProviderId', async (context) => {
        return this.executeWithContext('getSubProvider', context, async () => {
          const { subProviderId } = context.params as { subProviderId: string };
          
          const subProvider = await this.subProviderService.getSubProviderById(subProviderId);
          if (!subProvider) {
            context.set.status = 404;
            return {
              error: {
                message: `SubProvider with ID ${subProviderId} not found`,
                type: 'invalid_request_error',
                param: 'subProviderId',
                code: null
              }
            };
          }

          return {
            id: subProvider.getId(),
            providerId: subProvider.getProviderId(),
            name: subProvider.getName(),
            isEnabled: subProvider.isEnabled(),
            priority: subProvider.getPriority(),
            weight: subProvider.getWeight(),
            createdAt: subProvider.getCreatedAt(),
            updatedAt: subProvider.getUpdatedAt(),
            object: 'sub_provider'
          };
        });
      })
      .post('/sub-providers',
        async (context) => {
          return this.executeWithContext('createSubProvider', context, async () => {
            const body = context.body as CreateSubProviderRequest;
            
            if (!body.providerId) {
              context.set.status = 400;
              return {
                error: {
                  message: 'Provider ID is required',
                  type: 'invalid_request_error',
                  param: 'providerId',
                  code: 'validation_error'
                }
              };
            }

            const subProvider = await this.subProviderService.createSubProvider({
              providerId: body.providerId,
              name: body.name || `${body.providerId}-${Date.now()}`,
              apiKey: body.apiKey,
              priority: body.priority ?? 1,
              weight: body.weight ?? 100,
              maxRequestsPerMinute: body.maxRequestsPerMinute ?? 60,
              maxConcurrentRequests: body.maxConcurrentRequests ?? 10,
              modelMapping: {},
              timeout: 30000,
              retryAttempts: 3,
              maxRequestsPerHour: (body.maxRequestsPerMinute ?? 60) * 60,
              maxTokensPerMinute: 100000
            });

            context.set.status = 201;
            return {
              id: subProvider.getId(),
              providerId: subProvider.getProviderId(),
              name: subProvider.getName(),
              isEnabled: subProvider.isEnabled(),
              priority: subProvider.getPriority(),
              weight: subProvider.getWeight(),
              createdAt: subProvider.getCreatedAt(),
              updatedAt: subProvider.getUpdatedAt(),
              object: 'sub_provider'
            };
          });
        },
        {
          body: t.Object({
            name: t.Optional(t.String({ minLength: 1 })),
            providerId: t.Optional(t.String({ minLength: 1 })),
            apiKey: t.String({ minLength: 1 }),
            enabled: t.Optional(t.Boolean()),
            priority: t.Optional(t.Number()),
            weight: t.Optional(t.Number()),
            maxRequestsPerMinute: t.Optional(t.Number()),
            maxConcurrentRequests: t.Optional(t.Number())
          })
        }
      )
      .put('/sub-providers/:subProviderId',
        async (context) => {
          return this.executeWithContext('updateSubProvider', context, async () => {
            const { subProviderId } = context.params as { subProviderId: string };
            const body = context.body as UpdateSubProviderRequest;
            
            const existingSubProvider = await this.subProviderService.getSubProviderById(subProviderId);
            if (!existingSubProvider) {
              context.set.status = 404;
              return {
                error: {
                  message: `SubProvider with ID ${subProviderId} not found`,
                  type: 'invalid_request_error',
                  param: 'subProviderId',
                  code: null
                }
              };
            }

            const updatedSubProvider = await this.subProviderService.updateSubProvider(subProviderId, body);

            return {
              id: updatedSubProvider.getId(),
              providerId: updatedSubProvider.getProviderId(),
              name: updatedSubProvider.getName(),
              isEnabled: updatedSubProvider.isEnabled(),
              priority: updatedSubProvider.getPriority(),
              weight: updatedSubProvider.getWeight(),
              createdAt: updatedSubProvider.getCreatedAt(),
              updatedAt: updatedSubProvider.getUpdatedAt(),
              object: 'sub_provider'
            };
          });
        },
        {
          body: t.Object({
            name: t.Optional(t.String({ minLength: 1 })),
            apiKey: t.Optional(t.String({ minLength: 1 })),
            enabled: t.Optional(t.Boolean()),
            priority: t.Optional(t.Number()),
            weight: t.Optional(t.Number()),
            maxRequestsPerMinute: t.Optional(t.Number()),
            maxConcurrentRequests: t.Optional(t.Number())
          })
        }
      )
      .delete('/sub-providers/:subProviderId', async (context) => {
        return this.executeWithContext('deleteSubProvider', context, async () => {
          const { subProviderId } = context.params as { subProviderId: string };

          const existingSubProvider = await this.subProviderService.getSubProviderById(subProviderId);
          if (!existingSubProvider) {
            context.set.status = 404;
            return {
              error: {
                message: `SubProvider with ID ${subProviderId} not found`,
                type: 'invalid_request_error',
                param: 'subProviderId',
                code: null
              }
            };
          }

          await this.subProviderService.deleteSubProvider(subProviderId);

          return {
            id: subProviderId,
            object: 'sub_provider',
            deleted: true
          };
        });
      })
      .get('/sub-providers/provider/:provider', async (context) => {
        return this.executeWithContext('getSubProvidersByProvider', context, async () => {
          const { provider } = context.params as { provider: string };
          
          const subProviders = await this.subProviderService.getAvailableSubProviders(provider);
          
          return {
            object: 'list',
            data: subProviders.map(sp => ({
              id: sp.getId(),
              providerId: sp.getProviderId(),
              name: sp.getName(),
              isEnabled: sp.isEnabled(),
              priority: sp.getPriority(),
              weight: sp.getWeight(),
              createdAt: sp.getCreatedAt(),
              updatedAt: sp.getUpdatedAt(),
              object: 'sub_provider'
            }))
          };
        });
      });
  }
}