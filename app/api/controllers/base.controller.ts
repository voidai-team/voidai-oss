import { Elysia } from 'elysia';
import { injectable } from 'inversify';
import { TYPES } from '../../core/container/types';
import type { ILogger } from '../../core/logging';
import type { MetricsService } from '../../core/metrics';
import type { SecurityService } from '../../core/security';
import { container } from '../../core/container';
import type { AuthenticatedUser } from '../../application/types';
import { authPlugin, errorPlugin, metricsPlugin, snakeCasePlugin } from '../plugins';

export interface RequestContext {
  readonly requestId: string;
  readonly startTime: number;
  readonly user: AuthenticatedUser;
  readonly ipAddress: string;
  readonly userAgent: string;
}

export interface ControllerResponse<T = any> {
  readonly data?: T;
  readonly metadata?: {
    readonly requestId: string;
    readonly duration: number;
    readonly timestamp: number;
  };
}

export interface StreamResponse {
  readonly stream: ReadableStream;
  readonly headers: Record<string, string>;
}

export interface ControllerConfiguration {
  readonly prefix: string;
  readonly enableAuth: boolean;
  readonly enableMetrics: boolean;
  readonly enableErrorHandling: boolean;
  readonly requireAdmin?: boolean;
  readonly rateLimitConfig?: {
    readonly maxRequests: number;
    readonly windowMs: number;
  };
}

@injectable()
export abstract class BaseController {
  protected readonly logger: ILogger;
  protected readonly metricsService: MetricsService;
  protected readonly securityService: SecurityService;
  protected readonly authorizationService: any;
  protected readonly userService: any;
  protected readonly configuration: ControllerConfiguration;

  constructor(configuration: ControllerConfiguration) {
    this.configuration = configuration;
    this.logger = this.initializeLogger();
    this.metricsService = this.initializeMetricsService();
    this.securityService = this.initializeSecurityService();
    this.authorizationService = this.initializeAuthorizationService();
    this.userService = this.initializeUserService();
    
    this.validateConfiguration();
  }

  protected createApplication() {
    const app = new Elysia({ prefix: this.configuration.prefix });

    if (this.configuration.enableAuth) {
      app.use(authPlugin);
    }

    if (this.configuration.enableErrorHandling) {
      app.use(errorPlugin);
    }

    if (this.configuration.enableMetrics) {
      app.use(metricsPlugin);
    }

    app.use(snakeCasePlugin);

    return app;
  }

  protected async executeWithContext<T>(
    operation: string,
    context: any,
    handler: (requestContext: RequestContext) => Promise<T>
  ): Promise<T> {
    const requestContext = await this.createRequestContext(context);
    
    this.logOperationStart(operation, requestContext);
    
    try {
      const result = await handler(requestContext);
      
      this.logOperationSuccess(operation, requestContext);
      this.recordMetrics(operation, requestContext, true);
      
      return result;
    } catch (error) {
      this.logOperationError(operation, error as Error, requestContext);
      this.recordMetrics(operation, requestContext, false);
      
      throw error;
    }
  }

  protected async authenticateRequest(context: any): Promise<AuthenticatedUser> {
    if (!this.configuration.enableAuth) {
      throw new Error('Authentication is not enabled for this controller');
    }

    try {
      return await (context as any).authenticate();
    } catch (error) {
      this.logger.warn('Authentication failed', {
        metadata: {
          controller: this.constructor.name,
          error: (error as Error).message
        }
      });
      throw error;
    }
  }

  protected getService<T>(serviceIdentifier: symbol): T {
    try {
      return container.get<T>(serviceIdentifier);
    } catch (error) {
      this.logger.error('Failed to resolve service dependency', error as Error, {
        metadata: {
          controller: this.constructor.name,
          serviceIdentifier: String(serviceIdentifier)
        }
      });
      throw new Error(`Service dependency resolution failed: ${String(serviceIdentifier)}`);
    }
  }

  protected createSuccessResponse<T>(
    data: T,
    requestContext: RequestContext
  ): ControllerResponse<T> {
    return {
      data,
      metadata: {
        requestId: requestContext.requestId,
        duration: Date.now() - requestContext.startTime,
        timestamp: Date.now()
      }
    };
  }

  protected createStreamResponse(
    stream: AsyncIterable<any>,
    requestContext: RequestContext,
    onError?: (error: Error) => void
  ): StreamResponse {
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const data = `data: ${JSON.stringify(chunk)}\n\n`;
            controller.enqueue(new TextEncoder().encode(data));
          }
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        } catch (error) {
          if (onError) {
            onError(error as Error);
          }
          controller.error(error);
        } finally {
          controller.close();
        }
      }
    });

    return {
      stream: readableStream,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Request-ID': requestContext.requestId
      }
    };
  }

  protected validateRequestPayload<T>(payload: any, validator: (data: any) => data is T): T {
    if (!validator(payload)) {
      throw new Error('Invalid request payload structure');
    }
    return payload;
  }

  private async createRequestContext(context: any): Promise<RequestContext> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();
    
    let user: AuthenticatedUser;
    if (this.configuration.enableAuth) {
      user = await this.authenticateRequest(context);
      
      if (this.configuration.requireAdmin) {
        await this.verifyAdminAccess(user);
      }
    } else {
      user = {
        id: 'anonymous',
        name: 'Anonymous User',
        plan: 'free',
        credits: 0,
        enabled: true
      };
    }

    return {
      requestId,
      startTime,
      user,
      ipAddress: this.extractIpAddress(context),
      userAgent: this.extractUserAgent(context)
    };
  }

  private async verifyAdminAccess(authenticatedUser: AuthenticatedUser): Promise<void> {
    const user = await this.userService.getUserById(authenticatedUser.id);
    
    if (!user) {
      throw new Error('User not found');
    }

    const authResult = await this.authorizationService.authorizeAdmin(user);
    
    if (!authResult.authorized) {
      const error = new Error(authResult.reason || 'Admin access denied');
      (error as any).statusCode = authResult.httpStatus || 403;
      (error as any).errorCode = authResult.errorCode || 'ADMIN_ACCESS_DENIED';
      throw error;
    }
  }

  private generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substr(2, 12)}`;
  }

  private extractIpAddress(context: any): string {
    return context.headers?.['cf-connecting-ip'] || 
           context.headers?.['x-forwarded-for'] || 
           context.headers?.['x-real-ip'] || 
           'unknown';
  }

  private extractUserAgent(context: any): string {
    return context.headers?.['user-agent'] || 'unknown';
  }

  private initializeLogger(): ILogger {
    return container.get<ILogger>(TYPES.Logger).createChild(this.constructor.name);
  }

  private initializeMetricsService(): MetricsService {
    return container.get<MetricsService>(TYPES.MetricsService);
  }

  private initializeSecurityService(): SecurityService {
    return container.get<SecurityService>(TYPES.SecurityService);
  }

  private initializeAuthorizationService(): any {
    return container.get(TYPES.AuthorizationService);
  }

  private initializeUserService(): any {
    return container.get(TYPES.UserService);
  }

  private validateConfiguration(): void {
    if (!this.configuration.prefix) {
      throw new Error('Controller prefix is required');
    }

    if (!this.configuration.prefix.startsWith('/')) {
      throw new Error('Controller prefix must start with "/"');
    }
  }

  private logOperationStart(operation: string, context: RequestContext): void {
    this.logger.info(`${operation} operation initiated`, {
      requestId: context.requestId,
      userId: context.user.id,
      metadata: {
        controller: this.constructor.name,
        operation,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent
      }
    });
  }

  private logOperationSuccess(operation: string, context: RequestContext): void {
    const duration = Date.now() - context.startTime;
    
    this.logger.info(`${operation} operation completed successfully`, {
      requestId: context.requestId,
      userId: context.user.id,
      metadata: {
        controller: this.constructor.name,
        operation,
        duration
      }
    });
  }

  private logOperationError(operation: string, error: Error, context: RequestContext): void {
    const duration = Date.now() - context.startTime;
    
    this.logger.error(`${operation} operation failed`, error, {
      requestId: context.requestId,
      userId: context.user.id,
      metadata: {
        controller: this.constructor.name,
        operation,
        duration,
        errorType: error.constructor.name
      }
    });
  }

  private recordMetrics(operation: string, context: RequestContext, success: boolean): void {
    if (!this.configuration.enableMetrics) {
      return;
    }

    const duration = Date.now() - context.startTime;
    const statusCode = success ? 200 : 500;
    
    this.metricsService.recordHttpRequest(
      'POST',
      `${this.configuration.prefix}/${operation}`,
      statusCode,
      duration
    );

    if (!success) {
      this.metricsService.recordError(
        'controller_operation_failed',
        `${this.constructor.name}.${operation}`
      );
    }
  }

  public abstract registerRoutes(): any;
}