import { injectable, inject } from 'inversify';
import { t } from 'elysia';
import { TYPES } from '../../../core/container';
import { BaseController, type ControllerConfiguration } from '../base.controller';
import type { ApiRequestService } from '../../../domain/services';

export interface ListApiLogsQuery {
  limit?: string;
  offset?: string;
  userId?: string;
  endpoint?: string;
  model?: string;
  startDate?: string;
  endDate?: string;
}

@injectable()
export class ApiLogsController extends BaseController {
  constructor(
    @inject(TYPES.ApiRequestService) private apiRequestService: ApiRequestService
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
      .get('/api-logs/stats/by-model', async (context) => {
        return this.executeWithContext('getModelStats', context, async () => {
          const stats = await this.apiRequestService.getModelStats();
          
          return {
            object: 'list',
            data: stats
          };
        });
      })
      .get('/api-logs/stats/by-endpoint', async (context) => {
        return this.executeWithContext('getEndpointStats', context, async () => {
          const stats = await this.apiRequestService.getEndpointStats();
          
          return {
            object: 'list',
            data: stats
          };
        });
      })
      .get('/api-logs/stats', async (context) => {
        return this.executeWithContext('getStats', context, async () => {
          const stats = await this.apiRequestService.getApiRequestStats();
          
          return {
            object: 'api_log_stats',
            ...stats
          };
        });
      })
      .get('/api-logs/user/:userId', async (context) => {
        return this.executeWithContext('getLogsByUser', context, async () => {
          const { userId } = context.params as { userId: string };
          
          const logs = await this.apiRequestService.getApiRequestsByUser(userId);
          
          return {
            object: 'list',
            data: logs.map(log => ({
              id: log.getId(),
              userId: log.getUserId(),
              endpoint: log.getEndpoint(),
              method: log.getMethod(),
              model: log.getModel(),
              providerId: log.getProviderId(),
              subProviderId: log.getSubProviderId(),
              status: log.getStatus(),
              statusCode: log.getStatusCode(),
              tokensUsed: log.getTokensUsed(),
              creditsUsed: log.getCreditsUsed(),
              latency: log.getLatency(),
              responseSize: log.getResponseSize(),
              requestSize: log.getRequestSize(),
              ipAddress: log.getIpAddress(),
              userAgent: log.getUserAgent(),
              errorMessage: log.getErrorMessage(),
              retryCount: log.getRetryCount(),
              createdAt: log.getCreatedAt(),
              completedAt: log.getCompletedAt(),
              duration: log.getDuration(),
              object: 'api_log'
            }))
          };
        });
      })
      .get('/api-logs/:logId', async (context) => {
        return this.executeWithContext('getLog', context, async () => {
          const { logId } = context.params as { logId: string };
          
          const log = await this.apiRequestService.getApiRequestById(logId);
          if (!log) {
            context.set.status = 404;
            return {
              error: {
                message: `API log with ID ${logId} not found`,
                type: 'invalid_request_error',
                param: 'logId',
                code: null
              }
            };
          }

          return {
            id: log.getId(),
            userId: log.getUserId(),
            endpoint: log.getEndpoint(),
            method: log.getMethod(),
            model: log.getModel(),
            providerId: log.getProviderId(),
            subProviderId: log.getSubProviderId(),
            status: log.getStatus(),
            statusCode: log.getStatusCode(),
            tokensUsed: log.getTokensUsed(),
            creditsUsed: log.getCreditsUsed(),
            latency: log.getLatency(),
            responseSize: log.getResponseSize(),
            requestSize: log.getRequestSize(),
            ipAddress: log.getIpAddress(),
            userAgent: log.getUserAgent(),
            errorMessage: log.getErrorMessage(),
            retryCount: log.getRetryCount(),
            createdAt: log.getCreatedAt(),
            completedAt: log.getCompletedAt(),
            duration: log.getDuration(),
            metrics: log.getMetrics(),
            object: 'api_log'
          };
        });
      })
      .get('/api-logs', 
        async (context) => {
          return this.executeWithContext('listApiLogs', context, async () => {
            const query = context.query as ListApiLogsQuery;
            
            try {
              const limit = Math.min(parseInt(query.limit || '100'), 1000);
              const offset = Math.max(parseInt(query.offset || '0'), 0);
              
              const filters: any = {};
              if (query.userId) filters.userId = query.userId;
              if (query.endpoint) filters.endpoint = query.endpoint;
              if (query.model) filters.model = query.model;
              
              let dateRange: { startDate?: number; endDate?: number } | undefined;
              if (query.startDate || query.endDate) {
                dateRange = {};
                if (query.startDate) {
                  const startDate = new Date(query.startDate).getTime();
                  if (isNaN(startDate)) {
                    context.set.status = 400;
                    return {
                      error: {
                        message: 'Invalid startDate format',
                        type: 'invalid_request_error',
                        param: 'startDate',
                        code: null
                      }
                    };
                  }
                  dateRange.startDate = startDate;
                }
                if (query.endDate) {
                  const endDate = new Date(query.endDate).getTime();
                  if (isNaN(endDate)) {
                    context.set.status = 400;
                    return {
                      error: {
                        message: 'Invalid endDate format',
                        type: 'invalid_request_error',
                        param: 'endDate',
                        code: null
                      }
                    };
                  }
                  dateRange.endDate = endDate;
                }
              }

              const logs = await this.apiRequestService.getApiRequestsWithFilters(
                filters,
                { limit, offset },
                dateRange
              );
              
              return {
                object: 'list',
                data: logs.map(log => ({
                  id: log.getId(),
                  userId: log.getUserId(),
                  endpoint: log.getEndpoint(),
                  method: log.getMethod(),
                  model: log.getModel(),
                  providerId: log.getProviderId(),
                  subProviderId: log.getSubProviderId(),
                  status: log.getStatus(),
                  statusCode: log.getStatusCode(),
                  tokensUsed: log.getTokensUsed(),
                  creditsUsed: log.getCreditsUsed(),
                  latency: log.getLatency(),
                  responseSize: log.getResponseSize(),
                  requestSize: log.getRequestSize(),
                  ipAddress: log.getIpAddress(),
                  userAgent: log.getUserAgent(),
                  errorMessage: log.getErrorMessage(),
                  retryCount: log.getRetryCount(),
                  createdAt: log.getCreatedAt(),
                  completedAt: log.getCompletedAt(),
                  duration: log.getDuration(),
                  object: 'api_log'
                })),
                hasMore: logs.length === limit
              };
            } catch (error) {
              context.set.status = 500;
              return {
                error: {
                  message: `Failed to fetch API logs: ${(error as Error).message}`,
                  type: 'internal_server_error',
                  param: null,
                  code: null
                }
              };
            }
          });
        },
        {
          query: t.Object({
            limit: t.Optional(t.String()),
            offset: t.Optional(t.String()),
            userId: t.Optional(t.String()),
            endpoint: t.Optional(t.String()),
            model: t.Optional(t.String()),
            startDate: t.Optional(t.String()),
            endDate: t.Optional(t.String())
          })
        }
      );
  }
}