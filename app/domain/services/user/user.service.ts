import { injectable, inject } from 'inversify';
import { User, UserIdentity, UserAuthentication, UserAuthorization, UserUsage } from '../../entities';
import type { UserRepository } from '../../repositories';
import { MetricsService } from '../../../core/metrics';
import { SecurityService } from '../../../core/security';
import { TYPES } from '../../../core/container';

export interface CreateUserRequest {
  name: string;
  plan: string;
  planExpiresAt: number;
  credits: number;
  permissions: string[];
  ipWhitelist?: string[];
  rateLimit: number;
  maxConcurrentRequests: number;
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

@injectable()
export class UserService {
  constructor(
    @inject(TYPES.UserRepository) private userRepository: UserRepository,
    @inject(TYPES.SecurityService) private securityService: SecurityService,
    @inject(TYPES.MetricsService) private metricsService: MetricsService
  ) {}

  async createUser(request: CreateUserRequest): Promise<{ user: User; apiKey: string }> {
    const apiKey = this.securityService.generateSecureApiKey();
    const hashedKey = await this.securityService.hashApiKey(apiKey);

    const identity: UserIdentity = {
      id: crypto.randomUUID(),
      name: request.name,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const authentication: UserAuthentication = {
      apiKeyHashes: [hashedKey.encrypted]
    };

    const authorization: UserAuthorization = {
      plan: request.plan,
      planExpiresAt: request.planExpiresAt,
      enabled: true,
      credits: request.credits,
      creditsLastReset: Date.now(),
      permissions: request.permissions,
      ipWhitelist: request.ipWhitelist || [],
      rateLimit: request.rateLimit,
      maxConcurrentRequests: request.maxConcurrentRequests
    };

    const usage: UserUsage = {
      totalRequests: 0,
      totalTokensUsed: 0,
      totalCreditsUsed: 0,
      requestHistory: []
    };

    const user = new User(identity, authentication, authorization, usage);
    await this.userRepository.save(user);
    
    this.metricsService.recordError('user_created', 'user_service');

    return { user, apiKey };
  }

  async getUserById(id: string): Promise<User | null> {
    return await this.userRepository.findById(id);
  }

  async getUserByApiKeyHash(keyHash: string): Promise<User | null> {
    return await this.userRepository.findByApiKeyHash(keyHash);
  }

  async updateUser(id: string, request: UpdateUserRequest): Promise<User | null> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      return null;
    }

    const updatedUser = await this.userRepository.update(id, request as User);
    
    this.metricsService.recordError('user_updated', 'user_service');
    
    return updatedUser;
  }

  async deleteUser(id: string): Promise<void> {
    await this.userRepository.delete(id);
    this.metricsService.recordError('user_deleted', 'user_service');
  }

  async findActiveUsers(): Promise<User[]> {
    return await this.userRepository.findActiveUsers();
  }

  async findUsersWithLowCredits(threshold: number): Promise<User[]> {
    return await this.userRepository.findUsersWithLowCredits(threshold);
  }

  async getUserStats(): Promise<{
    totalUsers: number;
    activeUsers: number;
    usersByPlan: Record<string, number>;
    totalCreditsUsed: number;
  }> {
    const [activeUserCount, usersByPlan, totalCreditsUsed] = await Promise.all([
      this.userRepository.getActiveUserCount(),
      this.userRepository.countByPlan(),
      this.userRepository.getTotalCreditsUsed()
    ]);

    const allUsers = await this.userRepository.findAll();

    return {
      totalUsers: allUsers.length,
      activeUsers: activeUserCount,
      usersByPlan,
      totalCreditsUsed
    };
  }

  async getAllUsers(): Promise<User[]> {
    return await this.userRepository.findAll();
  }

  async regenerateApiKey(id: string): Promise<{ user: User; apiKey: string }> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new Error(`User with ID ${id} not found`);
    }

    const apiKey = this.securityService.generateSecureApiKey();
    const hashedKey = await this.securityService.hashApiKey(apiKey);

    const updatedUser = await this.userRepository.update(id, {
      apiKeyHashes: [hashedKey.encrypted]
    } as any);

    if (!updatedUser) {
      throw new Error(`Failed to update user with ID ${id}`);
    }

    this.metricsService.recordError('user_api_key_regenerated', 'user_service');

    return { user: updatedUser, apiKey };
  }

  async resetCredits(id: string, credits: number): Promise<User> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new Error(`User with ID ${id} not found`);
    }

    const updatedUser = await this.userRepository.update(id, {
      credits,
      creditsLastReset: Date.now()
    } as any);

    if (!updatedUser) {
      throw new Error(`Failed to update user with ID ${id}`);
    }

    this.metricsService.recordError('user_credits_reset_manual', 'user_service');

    return updatedUser;
  }

  async addApiKey(id: string): Promise<{ user: User; apiKey: string }> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new Error(`User with ID ${id} not found`);
    }

    const apiKey = this.securityService.generateSecureApiKey();
    const hashedKey = await this.securityService.hashApiKey(apiKey);

    const currentHashes = user.getApiKeyHashes();
    const updatedUser = await this.userRepository.update(id, {
      apiKeyHashes: [...currentHashes, hashedKey.encrypted]
    } as any);

    if (!updatedUser) {
      throw new Error(`Failed to update user with ID ${id}`);
    }

    this.metricsService.recordError('user_api_key_added', 'user_service');

    return { user: updatedUser, apiKey };
  }

  async removeApiKey(id: string, apiKey: string): Promise<User> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new Error(`User with ID ${id} not found`);
    }

    const hashedKey = await this.securityService.hashApiKey(apiKey);
    const currentHashes = user.getApiKeyHashes();
    const updatedHashes = currentHashes.filter(hash => hash !== hashedKey.encrypted);

    if (updatedHashes.length === currentHashes.length) {
      throw new Error('API key not found');
    }

    if (updatedHashes.length === 0) {
      throw new Error('Cannot remove the last API key');
    }

    const updatedUser = await this.userRepository.update(id, {
      apiKeyHashes: updatedHashes
    } as any);

    if (!updatedUser) {
      throw new Error(`Failed to update user with ID ${id}`);
    }

    this.metricsService.recordError('user_api_key_removed', 'user_service');

    return updatedUser;
  }
}