import { injectable, inject } from 'inversify';
import { t } from 'elysia';
import { TYPES } from '../../../core/container';
import { BaseController, type ControllerConfiguration } from '../base.controller';
import type { UserService } from '../../../domain/services';

export interface CreateUserRequest {
  name: string;
  plan: string;
  planExpiresAt?: number;
  credits?: number;
  permissions?: string[];
  ipWhitelist?: string[];
  rateLimit?: number;
  maxConcurrentRequests?: number;
}

export interface UpdateUserRequest {
  name?: string;
  plan?: string;
  planExpiresAt?: number;
  enabled?: boolean;
  credits?: number;
  permissions?: string[];
  ipWhitelist?: string[];
  rateLimit?: number;
  maxConcurrentRequests?: number;
}

export interface ListUsersQuery {
  limit?: string;
  offset?: string;
}

export interface ResetCreditsRequest {
  credits: number;
}

export interface RemoveApiKeyRequest {
  apiKey: string;
}

@injectable()
export class UsersController extends BaseController {
  constructor(
    @inject(TYPES.UserService) private adminUserService: UserService
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
      .get('/users', 
        async (context) => {
          return this.executeWithContext('listUsers', context, async () => {
            const query = context.query as ListUsersQuery;
            const limit = Math.min(parseInt(query.limit || '100'), 1000);
            const offset = Math.max(parseInt(query.offset || '0'), 0);

            const users = await this.adminUserService.getAllUsers();
            const paginatedUsers = users.slice(offset, offset + limit);

            return {
              object: 'list',
              data: paginatedUsers.map(user => ({
                id: user.getId(),
                name: user.getName(),
                plan: user.getPlan(),
                planExpiresAt: user.getPlanExpiresAt(),
                enabled: user.isEnabled(),
                credits: user.getCredits(),
                creditsLastReset: user.getCreditsLastReset(),
                permissions: user.getPermissions(),
                ipWhitelist: user.getIpWhitelist(),
                rateLimit: user.getRateLimit(),
                maxConcurrentRequests: user.getMaxConcurrentRequests(),
                createdAt: user.getCreatedAt(),
                updatedAt: user.getUpdatedAt(),
                object: 'user'
              })),
              hasMore: offset + limit < users.length
            };
          });
        },
        {
          query: t.Object({
            limit: t.Optional(t.String()),
            offset: t.Optional(t.String())
          })
        }
      )
      .get('/users/:userId', async (context) => {
        return this.executeWithContext('getUser', context, async () => {
          const { userId } = context.params as { userId: string };
          
          const user = await this.adminUserService.getUserById(userId);
          if (!user) {
            context.set.status = 404;
            return {
              error: {
                message: `User with ID ${userId} not found`,
                type: 'invalid_request_error',
                param: 'userId',
                code: null
              }
            };
          }

          return {
            id: user.getId(),
            name: user.getName(),
            plan: user.getPlan(),
            planExpiresAt: user.getPlanExpiresAt(),
            enabled: user.isEnabled(),
            credits: user.getCredits(),
            creditsLastReset: user.getCreditsLastReset(),
            permissions: user.getPermissions(),
            ipWhitelist: user.getIpWhitelist(),
            rateLimit: user.getRateLimit(),
            maxConcurrentRequests: user.getMaxConcurrentRequests(),
            usageStats: user.getUsageStats(),
            createdAt: user.getCreatedAt(),
            updatedAt: user.getUpdatedAt(),
            object: 'user'
          };
        });
      })
      .post('/users',
        async (context) => {
          return this.executeWithContext('createUser', context, async () => {
            const body = context.body as CreateUserRequest;
            
            const result = await this.adminUserService.createUser({
              name: body.name,
              plan: body.plan,
              planExpiresAt: body.planExpiresAt || Date.now() + (365 * 24 * 60 * 60 * 1000), // 1 year default
              credits: body.credits || 0,
              permissions: body.permissions || ['chat:completions'],
              ipWhitelist: body.ipWhitelist,
              rateLimit: body.rateLimit || 1000,
              maxConcurrentRequests: body.maxConcurrentRequests || 10
            });

            context.set.status = 201;
            return {
              id: result.user.getId(),
              name: result.user.getName(),
              plan: result.user.getPlan(),
              planExpiresAt: result.user.getPlanExpiresAt(),
              enabled: result.user.isEnabled(),
              credits: result.user.getCredits(),
              permissions: result.user.getPermissions(),
              rateLimit: result.user.getRateLimit(),
              maxConcurrentRequests: result.user.getMaxConcurrentRequests(),
              createdAt: result.user.getCreatedAt(),
              updatedAt: result.user.getUpdatedAt(),
              apiKey: result.apiKey,
              object: 'user'
            };
          });
        },
        {
          body: t.Object({
            name: t.String({ minLength: 1 }),
            plan: t.String({ minLength: 1 }),
            planExpiresAt: t.Optional(t.Number()),
            credits: t.Optional(t.Number({ minimum: 0 })),
            permissions: t.Optional(t.Array(t.String())),
            ipWhitelist: t.Optional(t.Array(t.String())),
            rateLimit: t.Optional(t.Number({ minimum: 1 })),
            maxConcurrentRequests: t.Optional(t.Number({ minimum: 1 }))
          })
        }
      )
      .patch('/users/:userId',
        async (context) => {
          return this.executeWithContext('updateUser', context, async () => {
            const { userId } = context.params as { userId: string };
            const body = context.body as UpdateUserRequest;
            
            const existingUser = await this.adminUserService.getUserById(userId);
            if (!existingUser) {
              context.set.status = 404;
              return {
                error: {
                  message: `User with ID ${userId} not found`,
                  type: 'invalid_request_error',
                  param: 'userId',
                  code: null
                }
              };
            }

            const updatedUser = await this.adminUserService.updateUser(userId, body);
            if (!updatedUser) {
              context.set.status = 500;
              return {
                error: {
                  message: 'Failed to update user',
                  type: 'internal_server_error',
                  param: null,
                  code: 'update_failed'
                }
              };
            }

            return {
              id: updatedUser.getId(),
              name: updatedUser.getName(),
              plan: updatedUser.getPlan(),
              planExpiresAt: updatedUser.getPlanExpiresAt(),
              enabled: updatedUser.isEnabled(),
              credits: updatedUser.getCredits(),
              permissions: updatedUser.getPermissions(),
              rateLimit: updatedUser.getRateLimit(),
              maxConcurrentRequests: updatedUser.getMaxConcurrentRequests(),
              createdAt: updatedUser.getCreatedAt(),
              updatedAt: updatedUser.getUpdatedAt(),
              object: 'user'
            };
          });
        },
        {
          body: t.Object({
            name: t.Optional(t.String()),
            plan: t.Optional(t.String()),
            planExpiresAt: t.Optional(t.Number()),
            enabled: t.Optional(t.Boolean()),
            credits: t.Optional(t.Number({ minimum: 0 })),
            permissions: t.Optional(t.Array(t.String())),
            ipWhitelist: t.Optional(t.Array(t.String())),
            rateLimit: t.Optional(t.Number({ minimum: 1 })),
            maxConcurrentRequests: t.Optional(t.Number({ minimum: 1 }))
          })
        }
      )
      .delete('/users/:userId', async (context) => {
        return this.executeWithContext('deleteUser', context, async () => {
          const { userId } = context.params as { userId: string };

          const existingUser = await this.adminUserService.getUserById(userId);
          if (!existingUser) {
            context.set.status = 404;
            return {
              error: {
                message: `User with ID ${userId} not found`,
                type: 'invalid_request_error',
                param: 'userId',
                code: null
              }
            };
          }

          await this.adminUserService.deleteUser(userId);

          return {
            id: userId,
            object: 'user',
            deleted: true
          };
        });
      })
      .post('/users/:userId/regenerate-api-key', async (context) => {
        return this.executeWithContext('regenerateApiKey', context, async () => {
          const { userId } = context.params as { userId: string };
          
          const existingUser = await this.adminUserService.getUserById(userId);
          if (!existingUser) {
            context.set.status = 404;
            return {
              error: {
                message: `User with ID ${userId} not found`,
                type: 'invalid_request_error',
                param: 'userId',
                code: null
              }
            };
          }

          const result = await this.adminUserService.regenerateApiKey(userId);

          return {
            id: result.user.getId(),
            name: result.user.getName(),
            plan: result.user.getPlan(),
            enabled: result.user.isEnabled(),
            credits: result.user.getCredits(),
            createdAt: result.user.getCreatedAt(),
            updatedAt: result.user.getUpdatedAt(),
            apiKey: result.apiKey,
            object: 'user'
          };
        });
      })
      .post('/users/:userId/reset-credits',
        async (context) => {
          return this.executeWithContext('resetCredits', context, async () => {
            const { userId } = context.params as { userId: string };
            const body = context.body as ResetCreditsRequest;
            
            const existingUser = await this.adminUserService.getUserById(userId);
            if (!existingUser) {
              context.set.status = 404;
              return {
                error: {
                  message: `User with ID ${userId} not found`,
                  type: 'invalid_request_error',
                  param: 'userId',
                  code: null
                }
              };
            }

            const updatedUser = await this.adminUserService.resetCredits(userId, body.credits);

            return {
              id: updatedUser.getId(),
              name: updatedUser.getName(),
              plan: updatedUser.getPlan(),
              enabled: updatedUser.isEnabled(),
              credits: updatedUser.getCredits(),
              creditsLastReset: updatedUser.getCreditsLastReset(),
              createdAt: updatedUser.getCreatedAt(),
              updatedAt: updatedUser.getUpdatedAt(),
              object: 'user'
            };
          });
        },
        {
          body: t.Object({
            credits: t.Number({ minimum: 0 })
          })
        }
      )
      .post('/users/:userId/api-keys', async (context) => {
        return this.executeWithContext('addApiKey', context, async () => {
          const { userId } = context.params as { userId: string };
          
          const existingUser = await this.adminUserService.getUserById(userId);
          if (!existingUser) {
            context.set.status = 404;
            return {
              error: {
                message: `User with ID ${userId} not found`,
                type: 'invalid_request_error',
                param: 'userId',
                code: null
              }
            };
          }

          const result = await this.adminUserService.addApiKey(userId);

          return {
            id: result.user.getId(),
            name: result.user.getName(),
            plan: result.user.getPlan(),
            enabled: result.user.isEnabled(),
            credits: result.user.getCredits(),
            createdAt: result.user.getCreatedAt(),
            updatedAt: result.user.getUpdatedAt(),
            newApiKey: result.apiKey,
            object: 'user'
          };
        });
      })
      .delete('/users/:userId/api-keys',
        async (context) => {
          return this.executeWithContext('removeApiKey', context, async () => {
            const { userId } = context.params as { userId: string };
            const body = context.body as RemoveApiKeyRequest;
            
            const existingUser = await this.adminUserService.getUserById(userId);
            if (!existingUser) {
              context.set.status = 404;
              return {
                error: {
                  message: `User with ID ${userId} not found`,
                  type: 'invalid_request_error',
                  param: 'userId',
                  code: null
                }
              };
            }

            try {
              const updatedUser = await this.adminUserService.removeApiKey(userId, body.apiKey);

              return {
                id: updatedUser.getId(),
                name: updatedUser.getName(),
                plan: updatedUser.getPlan(),
                enabled: updatedUser.isEnabled(),
                credits: updatedUser.getCredits(),
                createdAt: updatedUser.getCreatedAt(),
                updatedAt: updatedUser.getUpdatedAt(),
                object: 'user'
              };
            } catch (error) {
              context.set.status = 400;
              return {
                error: {
                  message: error instanceof Error ? error.message : 'Failed to remove API key',
                  type: 'invalid_request_error',
                  param: 'apiKey',
                  code: 'validation_error'
                }
              };
            }
          });
        },
        {
          body: t.Object({
            apiKey: t.String({ minLength: 1 })
          })
        }
      );
  }
}