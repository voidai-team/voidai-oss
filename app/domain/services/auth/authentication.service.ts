import { injectable, inject } from 'inversify';
import { User } from '../../entities';
import type { UserRepository } from '../../repositories';
import { CryptoService } from '../../../core/security';
import { TYPES } from '../../../core/container';

export interface AuthenticationResult {
  success: boolean;
  user?: User;
  error?: string;
}

@injectable()
export class AuthenticationService {
  constructor(
    @inject(TYPES.UserRepository) private userRepository: UserRepository,
    @inject(TYPES.CryptoService) private cryptoService: CryptoService
  ) {}

  async authenticateApiKey(apiKey: string): Promise<AuthenticationResult> {
    try {
      const keyHash = (await this.cryptoService.hashApiKey(apiKey)).encrypted;
      const user = await this.userRepository.findByApiKeyHash(keyHash);

      if (!user) {
        return { success: false, error: 'Invalid API key' };
      }

      if (!user.isEnabled()) {
        return { success: false, error: 'Account disabled' };
      }

      return { success: true, user };
    } catch (error) {
      return { success: false, error: 'Authentication failed' };
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    const result = await this.authenticateApiKey(apiKey);
    return result.success;
  }

  async getUserByApiKey(apiKey: string): Promise<User | null> {
    const result = await this.authenticateApiKey(apiKey);
    return result.user || null;
  }

  async generateApiKey(): Promise<string> {
    return this.cryptoService.generateSecureToken(32);
  }

  async hashApiKey(apiKey: string): Promise<string> {
    return (await this.cryptoService.hashApiKey(apiKey)).encrypted;
  }

  async validateKeyFormat(apiKey: string): Promise<boolean> {
    return apiKey.length >= 32 && /^[a-zA-Z0-9]+$/.test(apiKey);
  }
}