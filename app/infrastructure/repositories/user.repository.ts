import { injectable, inject } from 'inversify';
import { Collection, Db } from 'mongodb';
import { User } from '../../domain/entities';
import type { UserRepository } from '../../domain/repositories';
import type { IDatabaseService } from '../database';
import { UserDocument, UserCollectionName } from '../database/schemas';
import type { ILogger } from '../../core/logging';
import { TYPES } from '../../core/container';

@injectable()
export class MongoUserRepository implements UserRepository {
  private readonly logger: ILogger;
  private readonly databaseService: IDatabaseService;

  constructor(
    @inject(TYPES.Logger) logger: ILogger,
    @inject(TYPES.DatabaseService) databaseService: IDatabaseService
  ) {
    this.logger = logger.createChild('MongoUserRepository');
    this.databaseService = databaseService;
  }

  private getCollection(): Collection<UserDocument> {
    const db: Db = this.databaseService.getDatabase();
    return db.collection<UserDocument>(UserCollectionName);
  }

  private documentToEntity(doc: UserDocument): User {
    return new User(
      doc.identity,
      doc.authentication,
      doc.authorization,
      doc.usage
    );
  }

  private entityToDocument(user: User): Omit<UserDocument, '_id'> {
    const stats = user.getUsageStats();
    
    return {
      identity: {
        id: user.getId(),
        name: user.getName(),
        createdAt: user.getCreatedAt(),
        updatedAt: user.getUpdatedAt()
      },
      authentication: {
        apiKeyHashes: user.getApiKeyHashes()
      },
      authorization: {
        plan: user.getPlan(),
        planExpiresAt: user.getPlanExpiresAt(),
        enabled: user.isEnabled(),
        credits: user.getCredits(),
        creditsLastReset: user.getCreditsLastReset(),
        permissions: user.getPermissions(),
        ipWhitelist: user.getIpWhitelist(),
        rateLimit: user.getRateLimit(),
        maxConcurrentRequests: user.getMaxConcurrentRequests()
      },
      usage: {
        totalRequests: stats.totalRequests,
        totalTokensUsed: stats.totalTokensUsed,
        totalCreditsUsed: stats.totalCreditsUsed,
        lastRequestAt: stats.lastRequestAt,
        requestHistory: user.getRequestHistory()
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  async findById(id: string): Promise<User | null> {
    try {
      const collection = this.getCollection();
      const doc = await collection.findOne({ 'identity.id': id });
      
      if (!doc) {
        return null;
      }

      return this.documentToEntity(doc);
    } catch (error) {
      this.logger.error('Failed to find user by ID', error as Error, {
        metadata: { userId: id }
      });
      throw error;
    }
  }

  async findByApiKeyHash(keyHash: string): Promise<User | null> {
    try {
      const collection = this.getCollection();
      const doc = await collection.findOne({ 
        'authentication.apiKeyHashes': { '$in': [keyHash] } 
      });
      
      if (!doc) {
        return null;
      }

      return this.documentToEntity(doc);
    } catch (error) {
      this.logger.error('Failed to find user by API key hash', error as Error);
      throw error;
    }
  }

  async findByName(name: string): Promise<User | null> {
    try {
      const collection = this.getCollection();
      const doc = await collection.findOne({ 'identity.name': name });
      
      if (!doc) {
        return null;
      }

      return this.documentToEntity(doc);
    } catch (error) {
      this.logger.error('Failed to find user by name', error as Error, {
        metadata: { name }
      });
      throw error;
    }
  }

  async findAll(): Promise<User[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({}).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find all users', error as Error);
      throw error;
    }
  }

  async save(user: User): Promise<User> {
    try {
      const collection = this.getCollection();
      const doc = this.entityToDocument(user);
      
      await collection.replaceOne(
        { 'identity.id': user.getId() },
        { ...doc, updatedAt: new Date() },
        { upsert: true }
      );

      this.logger.debug('User saved successfully', {
        metadata: { userId: user.getId() }
      });

      return user;
    } catch (error) {
      this.logger.error('Failed to save user', error as Error, {
        metadata: { userId: user.getId() }
      });
      throw error;
    }
  }

  async update(id: string, updates: Partial<User>): Promise<User> {
    try {
      const collection = this.getCollection();
      
      await collection.updateOne(
        { 'identity.id': id },
        { 
          $set: { 
            ...updates,
            updatedAt: new Date()
          }
        }
      );

      const updatedUser = await this.findById(id);
      if (!updatedUser) {
        throw new Error(`User with ID ${id} not found after update`);
      }

      return updatedUser;
    } catch (error) {
      this.logger.error('Failed to update user', error as Error, {
        metadata: { userId: id }
      });
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const collection = this.getCollection();
      await collection.deleteOne({ 'identity.id': id });

      this.logger.debug('User deleted successfully', {
        metadata: { userId: id }
      });
    } catch (error) {
      this.logger.error('Failed to delete user', error as Error, {
        metadata: { userId: id }
      });
      throw error;
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      const collection = this.getCollection();
      const count = await collection.countDocuments({ 'identity.id': id });
      return count > 0;
    } catch (error) {
      this.logger.error('Failed to check if user exists', error as Error, {
        metadata: { userId: id }
      });
      throw error;
    }
  }

  async findByPlan(plan: string): Promise<User[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 'authorization.plan': plan }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find users by plan', error as Error, {
        metadata: { plan }
      });
      throw error;
    }
  }

  async findActiveUsers(): Promise<User[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 'authorization.enabled': true }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find active users', error as Error);
      throw error;
    }
  }

  async findUsersWithLowCredits(threshold: number): Promise<User[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 
        'authorization.credits': { $lt: threshold }
      }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find users with low credits', error as Error, {
        metadata: { threshold }
      });
      throw error;
    }
  }

  async updateCredits(id: string, credits: number): Promise<void> {
    try {
      const collection = this.getCollection();
      await collection.updateOne(
        { 'identity.id': id },
        { 
          $set: { 
            'authorization.credits': credits,
            updatedAt: new Date()
          }
        }
      );
    } catch (error) {
      this.logger.error('Failed to update user credits', error as Error, {
        metadata: { userId: id, credits }
      });
      throw error;
    }
  }

  async incrementCredits(id: string, amount: number): Promise<void> {
    try {
      const collection = this.getCollection();
      await collection.updateOne(
        { 'identity.id': id },
        { 
          $inc: { 'authorization.credits': amount },
          $set: { updatedAt: new Date() }
        }
      );
    } catch (error) {
      this.logger.error('Failed to increment user credits', error as Error, {
        metadata: { userId: id, amount }
      });
      throw error;
    }
  }


  async resetCredits(id: string, newCredits: number): Promise<void> {
    try {
      const collection = this.getCollection();
      await collection.updateOne(
        { 'identity.id': id },
        {
          $set: {
            'authorization.credits': newCredits,
            'authorization.creditsLastReset': Date.now(),
            updatedAt: new Date()
          }
        }
      );
    } catch (error) {
      this.logger.error('Failed to reset user credits', error as Error, {
        metadata: { userId: id, newCredits }
      });
      throw error;
    }
  }

  async decrementCredits(id: string, amount: number): Promise<boolean> {
    try {
      const collection = this.getCollection();
      const result = await collection.updateOne(
        {
          'identity.id': id,
          'authorization.credits': { $gte: amount }
        },
        {
          $inc: { 'authorization.credits': -amount },
          $set: { updatedAt: new Date() }
        }
      );
      
      return result.modifiedCount > 0;
    } catch (error) {
      this.logger.error('Failed to decrement user credits with check', error as Error, {
        metadata: { userId: id, amount }
      });
      throw error;
    }
  }

  async findUsersNeedingCreditReset(): Promise<User[]> {
    try {
      const collection = this.getCollection();
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      
      const docs = await collection.find({ 
        'authorization.creditsLastReset': { $lt: oneDayAgo }
      }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find users needing credit reset', error as Error);
      throw error;
    }
  }

  async countByPlan(): Promise<Record<string, number>> {
    try {
      const collection = this.getCollection();
      const pipeline = [
        {
          $group: {
            _id: '$authorization.plan',
            count: { $sum: 1 }
          }
        }
      ];
      
      const results = await collection.aggregate(pipeline).toArray();
      
      const counts: Record<string, number> = {};
      results.forEach(result => {
        counts[result._id] = result.count;
      });
      
      return counts;
    } catch (error) {
      this.logger.error('Failed to count users by plan', error as Error);
      throw error;
    }
  }

  async getTotalCreditsUsed(): Promise<number> {
    try {
      const collection = this.getCollection();
      const pipeline = [
        {
          $group: {
            _id: null,
            totalCreditsUsed: { $sum: '$usage.totalCreditsUsed' }
          }
        }
      ];
      
      const results = await collection.aggregate(pipeline).toArray();
      return results.length > 0 ? results[0].totalCreditsUsed : 0;
    } catch (error) {
      this.logger.error('Failed to get total credits used', error as Error);
      throw error;
    }
  }

  async getActiveUserCount(): Promise<number> {
    try {
      const collection = this.getCollection();
      return await collection.countDocuments({ 'authorization.enabled': true });
    } catch (error) {
      this.logger.error('Failed to get active user count', error as Error);
      throw error;
    }
  }
}