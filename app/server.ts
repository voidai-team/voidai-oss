import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { ApplicationBootstrap } from './bootstrap';
import type { ILogger, IMetricsService } from './core';
import { TYPES, container } from './core/container';

export interface ServerConfig {
  port: number;
  host: string;
  cors: {
    origin: string | string[] | boolean;
    credentials: boolean;
  };
}

export class ApplicationServer {
  private app: Elysia;
  private bootstrap: ApplicationBootstrap;
  private logger?: ILogger;
  private metricsService?: IMetricsService;
  private config: ServerConfig;

  constructor(bootstrap: ApplicationBootstrap) {
    this.bootstrap = bootstrap;
    this.config = this.buildServerConfig();
    this.app = new Elysia();
    this.setupMiddleware();
  }

  async start(): Promise<void> {
    try {
      await this.bootstrap.initialize();
      
      this.logger = container.get<ILogger>(TYPES.Logger);
      
      if (container.isBound(TYPES.MetricsService)) {
        this.metricsService = container.get<IMetricsService>(TYPES.MetricsService);
      }

      this.setupRoutes();
      this.setupErrorHandling();

      this.app.listen(this.config.port, () => {
        this.logger?.info('Server started successfully', {
          metadata: {
            port: this.config.port,
            host: this.config.host,
            environment: process.env.NODE_ENV || 'development'
          }
        });
      });

    } catch (error) {
      console.error('Failed to start server:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      this.logger?.info('Server shutdown initiated');
      await this.bootstrap.shutdown();
      this.logger?.info('Server stopped successfully');
    } catch (error) {
      console.error('Error stopping server:', error);
      throw error;
    }
  }

  private buildServerConfig(): ServerConfig {
    return {
      port: parseInt(process.env.PORT || '8080', 10),
      host: process.env.HOST || '0.0.0.0',
      cors: {
        origin: process.env.CORS_ORIGIN || true,
        credentials: process.env.CORS_CREDENTIALS === 'true'
      }
    };
  }

  private setupMiddleware(): void {
    this.app.use(cors({
      origin: this.config.cors.origin,
      credentials: this.config.cors.credentials
    }));

    this.app.onRequest(async (context) => {
      const startTime = Date.now();
      context.store = { ...context.store, startTime };
      
      const requestId = this.generateRequestId();
      context.store = { ...context.store, requestId };

      this.logger?.debug('Incoming request', {
        requestId,
        metadata: {
          method: context.request.method,
          url: context.request.url,
          userAgent: context.request.headers.get('user-agent'),
          ip: context.request.headers.get('cf-connecting-ip') || 
              context.request.headers.get('x-forwarded-for') || 
              'unknown'
        }
      });
    });

    this.app.onAfterHandle(async (context) => {
      const store = context.store as any;
      const startTime = store?.startTime || Date.now();
      const duration = Date.now() - startTime;
      const requestId = store?.requestId;

      this.metricsService?.recordHttpRequest(
        context.request.method,
        context.path || '/',
        (context.set.status || 200) as number,
        duration
      );

      this.logger?.info('Request completed', {
        requestId,
        operation: 'http_request',
        duration,
        metadata: {
          method: context.request.method,
          url: context.request.url,
          status: context.set.status || 200,
          duration: `${duration}ms`
        }
      });
    });
  }

  private setupRoutes(): void {
    this.app.get('/health', () => ({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0'
    }));

    this.app.get('/metrics', async () => {
      if (!this.metricsService) {
        return new Response('Metrics not available', { status: 503 });
      }

      const metrics = await this.metricsService.getMetricsEndpoint();
      return new Response(metrics, {
        headers: {
          'Content-Type': 'text/plain; version=0.0.4; charset=utf-8'
        }
      });
    });

    this.app.get('/', () => ({
      message: 'VoidAI API Server',
      version: '2.0.0',
      status: 'operational',
      timestamp: new Date().toISOString()
    }));

    this.setupAdminRoutes();
    this.setupV1Routes();
  }

  private setupAdminRoutes(): void {
    try {
      const subProvidersController = container.get<any>(TYPES.SubProvidersController);
      const usersController = container.get<any>(TYPES.UsersController);
      const apiLogsController = container.get<any>(TYPES.ApiLogsController);

      this.app.use(subProvidersController.registerRoutes());
      this.app.use(usersController.registerRoutes());
      this.app.use(apiLogsController.registerRoutes());

      this.logger?.info('Admin routes registered successfully');
    } catch (error) {
      this.logger?.error('Failed to register admin routes', error as Error);
      throw error;
    }
  }

  private setupV1Routes(): void {
    try {
      const chatController = container.get<any>(TYPES.ChatController);
      const audioController = container.get<any>(TYPES.AudioController);
      const embeddingsController = container.get<any>(TYPES.EmbeddingsController);
      const imagesController = container.get<any>(TYPES.ImagesController);
      const modelsController = container.get<any>(TYPES.ModelsController);
      const moderationsController = container.get<any>(TYPES.ModerationsController);

      this.app.use(chatController.registerRoutes());
      this.app.use(audioController.registerRoutes());
      this.app.use(embeddingsController.registerRoutes());
      this.app.use(imagesController.registerRoutes());
      this.app.use(modelsController.registerRoutes());
      this.app.use(moderationsController.registerRoutes());

      this.logger?.info('V1 API routes registered successfully');
    } catch (error) {
      this.logger?.error('Failed to register V1 API routes', error as Error);
      throw error;
    }
  }

  private setupErrorHandling(): void {
    this.app.onError((context: any) => {
      const store = context.store as any;
      const startTime = store?.startTime || Date.now();
      const duration = Date.now() - startTime;
      const requestId = store?.requestId;

      let result;
      let finalStatus;

      if (context.code === 'NOT_FOUND') {
        context.set.status = 404;
        finalStatus = 404;
        result = {
          error: {
            message: 'Endpoint not found',
            type: 'not_found_error',
            status_code: 404,
            request_id: requestId
          }
        };
      } else {
        finalStatus = context.set.status || 500;
        result = {
          error: {
            message: 'Internal server error',
            type: 'internal_error',
            status_code: finalStatus,
            request_id: requestId
          }
        };
      }

      this.metricsService?.recordHttpRequest(
        context.request.method,
        context.path || '/',
        finalStatus,
        duration
      );

      this.metricsService?.recordError(
        context.code || 'unknown_error',
        'http_request'
      );

      this.logger?.error('Request failed', context.error, {
        requestId,
        operation: 'http_request_error',
        duration,
        metadata: {
          method: context.request.method,
          url: context.request.url,
          status: finalStatus,
          errorCode: context.code
        }
      });

      return result;
    });
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}