import { Elysia } from 'elysia';
import { container, TYPES } from '../../core/container';
import type { ILogger } from '../../core/logging';
import type { SecurityService } from '../../core/security';
import type { UserService } from '../../domain/services';
import type { AuthenticatedUser } from '../../application/types';

export class AuthPlugin {
  private readonly pluginName = 'auth';

  createPlugin() {
    return new Elysia({ name: this.pluginName })
      .decorate('container', container)
      .derive(({ headers, container }) => {
        return {
          authenticate: async (): Promise<AuthenticatedUser> => {
            return this.authenticateUser(headers, container);
          }
        };
      });
  }

  private async authenticateUser(headers: Record<string, string | undefined>, container: any): Promise<AuthenticatedUser> {
    const logger = container.get(TYPES.Logger) as ILogger;
    const securityService = container.get(TYPES.SecurityService) as SecurityService;
    const userService = container.get(TYPES.UserService) as UserService;

    try {
      const authHeader = headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('Missing or invalid authorization header');
      }

      const apiKey = authHeader.substring(7);
      
      const hashedKey = await securityService.hashApiKey(apiKey);
      const user = await userService.getUserByApiKeyHash(hashedKey.encrypted);
      
      if (!user) {
        throw new Error('Invalid API key');
      }

      if (!user.isEnabled()) {
        throw new Error('User account is disabled');
      }

      const context = this.createAuthContext(apiKey, headers);
      const authResult = await securityService.authenticateApiKey(apiKey, hashedKey, context);
      
      if (!authResult.success) {
        throw new Error(authResult.error || 'Authentication failed');
      }

      this.logSuccessfulAuthentication(logger, user);

      return this.createAuthenticatedUser(user);

    } catch (error) {
      this.logAuthenticationFailure(logger, error as Error);
      throw error;
    }
  }

  private createAuthContext(apiKey: string, headers: Record<string, string | undefined>) {
    return {
      userId: '',
      apiKey,
      ipAddress: headers['cf-connecting-ip'] || 'unknown',
      userAgent: headers['user-agent'] || 'unknown',
      requestId: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };
  }

  private logSuccessfulAuthentication(logger: ILogger, user: any): void {
    logger.debug('User authenticated successfully', {
      metadata: { 
        userId: user.getId(), 
        name: user.getName(),
        plan: user.getPlan()
      }
    });
  }

  private logAuthenticationFailure(logger: ILogger, error: Error): void {
    logger.warn('Authentication failed', {
      metadata: { error: error.message }
    });
  }

  private createAuthenticatedUser(user: any): AuthenticatedUser {
    return {
      id: user.getId(),
      name: user.getName(),
      plan: user.getPlan(),
      credits: user.getCredits(),
      enabled: user.isEnabled()
    };
  }
}

export const authPlugin = new AuthPlugin().createPlugin();