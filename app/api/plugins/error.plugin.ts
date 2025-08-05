import { Elysia } from 'elysia';
import { container, TYPES } from '../../core/container';
import type { ILogger } from '../../core/logging';

interface ErrorResponse {
  error: {
    message: string;
    type: string;
    code?: string;
    details?: string;
  };
}

export class ErrorPlugin {
  private readonly pluginName = 'error';

  createPlugin() {
    return new Elysia({ name: this.pluginName })
      .decorate('container', container)
      .onError(({ error, code, set, container }) => {
        return this.handleError(error, String(code), set, container);
      });
  }

  private handleError(error: unknown, code: string, set: any, container: any): ErrorResponse {
    const logger = container.get(TYPES.Logger) as ILogger;
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    logger.error('API request failed', error instanceof Error ? error : new Error(String(error)), {
      metadata: {
        code,
        message: errorMessage,
        stack: errorStack
      }
    });

    return this.mapErrorToResponse(error, code, set);
  }

  private mapErrorToResponse(error: unknown, code: string, set: any): ErrorResponse {
    const errorMessage = error instanceof Error ? error.message : String(error);

    switch (code) {
      case 'VALIDATION':
        set.status = 400;
        return this.createErrorResponse('Validation failed', 'validation_error', undefined, errorMessage);

      case 'NOT_FOUND':
        set.status = 404;
        return this.createErrorResponse('Resource not found', 'not_found_error');

      case 'PARSE':
        set.status = 400;
        return this.createErrorResponse('Invalid request format', 'parse_error');

      default:
        return this.handleCustomErrors(errorMessage, set);
    }
  }

  private handleCustomErrors(errorMessage: string, set: any): ErrorResponse {
    if (this.isAuthenticationError(errorMessage)) {
      set.status = 401;
      return this.createErrorResponse(errorMessage, 'authentication_error', 'invalid_api_key');
    }

    if (this.isAuthorizationError(errorMessage)) {
      set.status = 403;
      return this.createErrorResponse(errorMessage, 'authorization_error', 'access_denied');
    }

    if (this.isInsufficientCreditsError(errorMessage)) {
      set.status = 402;
      return this.createErrorResponse(errorMessage, 'insufficient_quota', 'insufficient_credits');
    }

    set.status = 500;
    return this.createErrorResponse('Internal server error', 'internal_server_error');
  }

  private isAuthenticationError(message: string): boolean {
    return message.includes('Authentication') || message.includes('Invalid API key');
  }

  private isAuthorizationError(message: string): boolean {
    return message.includes('Authorization') || message.includes('disabled');
  }

  private isInsufficientCreditsError(message: string): boolean {
    return message.includes('credits') || message.includes('insufficient');
  }

  private createErrorResponse(
    message: string,
    type: string,
    code?: string,
    details?: string
  ): ErrorResponse {
    return {
      error: {
        message,
        type,
        ...(code && { code }),
        ...(details && { details })
      }
    };
  }
}

export const errorPlugin = new ErrorPlugin().createPlugin();