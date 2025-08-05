import { injectable, inject } from 'inversify';
import { Collection, Db } from 'mongodb';
import { SubProvider } from '../../domain/entities';
import type { SubProviderRepository } from '../../domain/repositories';
import type { IDatabaseService } from '../database';
import { SubProviderDocument, SubProviderCollectionName } from '../database/schemas';
import type { ILogger } from '../../core/logging';
import { TYPES } from '../../core/container';

@injectable()
export class MongoSubProviderRepository implements SubProviderRepository {
  private readonly logger: ILogger;
  private readonly databaseService: IDatabaseService;

  constructor(
    @inject(TYPES.Logger) logger: ILogger,
    @inject(TYPES.DatabaseService) databaseService: IDatabaseService
  ) {
    this.logger = logger.createChild('MongoSubProviderRepository');
    this.databaseService = databaseService;
  }

  private getCollection(): Collection<SubProviderDocument> {
    const db: Db = this.databaseService.getDatabase();
    return db.collection<SubProviderDocument>(SubProviderCollectionName);
  }

  private documentToEntity(doc: SubProviderDocument): SubProvider {
    return new SubProvider(
      doc.identity,
      doc.configuration,
      doc.metrics,
      doc.limits
    );
  }

  private entityToDocument(subProvider: SubProvider): Omit<SubProviderDocument, '_id'> {
    const identity = subProvider.getIdentity();
    const configuration = subProvider.getConfiguration();
    const metrics = subProvider.getMetrics();
    const limits = subProvider.getFullLimits();
    
    return {
      identity,
      configuration,
      metrics: {
        totalTokenUsage: metrics.totalTokenUsage,
        totalRequests: metrics.totalRequests,
        lastUsedAt: subProvider.getLastUsedAt(),
        errorCount: metrics.errorCount,
        successCount: metrics.successCount,
        consecutiveErrors: metrics.consecutiveErrors,
        lastErrorAt: subProvider.getLastErrorAt(),
        lastErrorType: subProvider.getLastErrorType(),
        avgLatency: metrics.avgLatency,
        healthScore: metrics.healthScore,
        circuitBreakerState: subProvider.getCircuitBreakerState(),
        lastCircuitBreakerTrigger: subProvider.getLastCircuitBreakerTrigger()
      },
      limits: {
        maxRequestsPerMinute: limits.maxRequestsPerMinute,
        maxRequestsPerHour: limits.maxRequestsPerHour,
        maxTokensPerMinute: limits.maxTokensPerMinute,
        maxConcurrentRequests: limits.maxConcurrentRequests,
        currentRequestCount: limits.currentRequestCount,
        currentTokenCount: limits.currentTokenCount,
        currentConcurrentRequests: limits.currentConcurrentRequests,
        requestWindow: limits.requestWindow || [],
        tokenWindow: limits.tokenWindow || [],
        lastWindowReset: limits.lastWindowReset || Date.now()
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  async findById(id: string): Promise<SubProvider | null> {
    try {
      const collection = this.getCollection();
      const doc = await collection.findOne({ 'identity.id': id });
      
      if (!doc) {
        return null;
      }

      return this.documentToEntity(doc);
    } catch (error) {
      this.logger.error('Failed to find sub-provider by ID', error as Error, {
        metadata: { subProviderId: id }
      });
      throw error;
    }
  }

  async findByProviderId(providerId: string): Promise<SubProvider[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 'identity.providerId': providerId }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find sub-providers by provider ID', error as Error, {
        metadata: { providerId }
      });
      throw error;
    }
  }

  async findByName(name: string): Promise<SubProvider | null> {
    try {
      const collection = this.getCollection();
      const doc = await collection.findOne({ 'identity.name': name });
      
      if (!doc) {
        return null;
      }

      return this.documentToEntity(doc);
    } catch (error) {
      this.logger.error('Failed to find sub-provider by name', error as Error, {
        metadata: { name }
      });
      throw error;
    }
  }

  async findAll(): Promise<SubProvider[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({}).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find all sub-providers', error as Error);
      throw error;
    }
  }

  async findActive(): Promise<SubProvider[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 
        'configuration.enabled': true
      }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find active sub-providers', error as Error);
      throw error;
    }
  }

  async findAvailable(): Promise<SubProvider[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 
        'configuration.enabled': true,
        'metrics.healthScore': { $gt: 0.7 },
        'metrics.circuitBreakerState': 'closed',
        'metrics.consecutiveErrors': { $lt: 5 }
      }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find available sub-providers', error as Error);
      throw error;
    }
  }

  async findHealthy(): Promise<SubProvider[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 
        'metrics.healthScore': { $gt: 0.7 },
        'metrics.circuitBreakerState': 'closed'
      }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find healthy sub-providers', error as Error);
      throw error;
    }
  }

  async save(subProvider: SubProvider): Promise<SubProvider> {
    try {
      const collection = this.getCollection();
      const doc = this.entityToDocument(subProvider);
      
      await collection.replaceOne(
        { 'identity.id': subProvider.getId() },
        { ...doc, updatedAt: new Date() },
        { upsert: true }
      );

      this.logger.debug('Sub-provider saved successfully', {
        metadata: { subProviderId: subProvider.getId() }
      });

      return subProvider;
    } catch (error) {
      this.logger.error('Failed to save sub-provider', error as Error, {
        metadata: { subProviderId: subProvider.getId() }
      });
      throw error;
    }
  }

  async update(id: string, updates: Partial<SubProvider>): Promise<SubProvider> {
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

      const updatedSubProvider = await this.findById(id);
      if (!updatedSubProvider) {
        throw new Error(`Sub-provider with ID ${id} not found after update`);
      }

      return updatedSubProvider;
    } catch (error) {
      this.logger.error('Failed to update sub-provider', error as Error, {
        metadata: { subProviderId: id }
      });
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const collection = this.getCollection();
      await collection.deleteOne({ 'identity.id': id });

      this.logger.debug('Sub-provider deleted successfully', {
        metadata: { subProviderId: id }
      });
    } catch (error) {
      this.logger.error('Failed to delete sub-provider', error as Error, {
        metadata: { subProviderId: id }
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
      this.logger.error('Failed to check if sub-provider exists', error as Error, {
        metadata: { subProviderId: id }
      });
      throw error;
    }
  }

  async findByCircuitBreakerState(state: 'closed' | 'open' | 'half-open'): Promise<SubProvider[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 
        'metrics.circuitBreakerState': state
      }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find sub-providers by circuit breaker state', error as Error, {
        metadata: { state }
      });
      throw error;
    }
  }

  async findSupportingModel(model: string): Promise<SubProvider[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 
        [`configuration.modelMapping.${model}`]: { $exists: true }
      }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find sub-providers supporting model', error as Error, {
        metadata: { model }
      });
      throw error;
    }
  }

  async findByPriority(minPriority: number): Promise<SubProvider[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 
        'configuration.priority': { $gte: minPriority }
      }).sort({ 'configuration.priority': -1 }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find sub-providers by priority', error as Error, {
        metadata: { minPriority }
      });
      throw error;
    }
  }

  async findByWeight(minWeight: number): Promise<SubProvider[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 
        'configuration.weight': { $gte: minWeight }
      }).sort({ 'configuration.weight': -1 }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find sub-providers by weight', error as Error, {
        metadata: { minWeight }
      });
      throw error;
    }
  }

  async recordSuccess(id: string, latency: number, tokensUsed: number): Promise<void> {
    try {
      const collection = this.getCollection();
      await collection.updateOne(
        { 'identity.id': id },
        { 
          $inc: { 
            'metrics.successCount': 1,
            'metrics.totalRequests': 1,
            'metrics.totalTokenUsage': tokensUsed
          },
          $set: {
            'metrics.lastUsedAt': Date.now(),
            'metrics.consecutiveErrors': 0,
            updatedAt: new Date()
          }
        }
      );
    } catch (error) {
      this.logger.error('Failed to record sub-provider success', error as Error, {
        metadata: { subProviderId: id, latency, tokensUsed }
      });
      throw error;
    }
  }

  async recordError(id: string, errorType: string): Promise<void> {
    try {
      const collection = this.getCollection();
      await collection.updateOne(
        { 'identity.id': id },
        { 
          $inc: { 
            'metrics.errorCount': 1,
            'metrics.totalRequests': 1,
            'metrics.consecutiveErrors': 1
          },
          $set: {
            'metrics.lastErrorAt': Date.now(),
            'metrics.lastErrorType': errorType,
            updatedAt: new Date()
          }
        }
      );
    } catch (error) {
      this.logger.error('Failed to record sub-provider error', error as Error, {
        metadata: { subProviderId: id, errorType }
      });
      throw error;
    }
  }

  async updateLimits(id: string, requestCount: number, tokenCount: number, concurrentRequests: number): Promise<void> {
    try {
      const collection = this.getCollection();
      await collection.updateOne(
        { 'identity.id': id },
        { 
          $set: { 
            'limits.currentRequestCount': requestCount,
            'limits.currentTokenCount': tokenCount,
            'limits.currentConcurrentRequests': concurrentRequests,
            updatedAt: new Date()
          }
        }
      );
    } catch (error) {
      this.logger.error('Failed to update sub-provider limits', error as Error, {
        metadata: { subProviderId: id, requestCount, tokenCount, concurrentRequests }
      });
      throw error;
    }
  }

  async openCircuitBreaker(id: string): Promise<void> {
    try {
      const collection = this.getCollection();
      await collection.updateOne(
        { 'identity.id': id },
        { 
          $set: { 
            'metrics.circuitBreakerState': 'open',
            'metrics.lastCircuitBreakerTrigger': Date.now(),
            updatedAt: new Date()
          }
        }
      );
    } catch (error) {
      this.logger.error('Failed to open circuit breaker', error as Error, {
        metadata: { subProviderId: id }
      });
      throw error;
    }
  }

  async closeCircuitBreaker(id: string): Promise<void> {
    try {
      const collection = this.getCollection();
      await collection.updateOne(
        { 'identity.id': id },
        { 
          $set: { 
            'metrics.circuitBreakerState': 'closed',
            'metrics.consecutiveErrors': 0,
            updatedAt: new Date()
          }
        }
      );
    } catch (error) {
      this.logger.error('Failed to close circuit breaker', error as Error, {
        metadata: { subProviderId: id }
      });
      throw error;
    }
  }

  async halfOpenCircuitBreaker(id: string): Promise<void> {
    try {
      const collection = this.getCollection();
      await collection.updateOne(
        { 'identity.id': id },
        { 
          $set: { 
            'metrics.circuitBreakerState': 'half-open',
            updatedAt: new Date()
          }
        }
      );
    } catch (error) {
      this.logger.error('Failed to half-open circuit breaker', error as Error, {
        metadata: { subProviderId: id }
      });
      throw error;
    }
  }

  async getTopPerformers(limit: number): Promise<SubProvider[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({
        'configuration.enabled': true,
        'metrics.circuitBreakerState': 'closed'
      })
      .sort({ 
        'metrics.healthScore': -1,
        'metrics.avgLatency': 1 
      })
      .limit(limit)
      .toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to get top performing sub-providers', error as Error, {
        metadata: { limit }
      });
      throw error;
    }
  }

  async getLeastUsed(limit: number): Promise<SubProvider[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({
        'configuration.enabled': true,
        'metrics.circuitBreakerState': 'closed'
      })
      .sort({ 'metrics.totalRequests': 1 })
      .limit(limit)
      .toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to get least used sub-providers', error as Error, {
        metadata: { limit }
      });
      throw error;
    }
  }

  async getTotalTokenUsage(): Promise<number> {
    try {
      const collection = this.getCollection();
      const pipeline = [
        {
          $group: {
            _id: null,
            totalTokenUsage: { $sum: '$metrics.totalTokenUsage' }
          }
        }
      ];
      
      const results = await collection.aggregate(pipeline).toArray();
      return results.length > 0 ? results[0].totalTokenUsage : 0;
    } catch (error) {
      this.logger.error('Failed to get total token usage', error as Error);
      throw error;
    }
  }

  async getAverageLatency(): Promise<number> {
    try {
      const collection = this.getCollection();
      const pipeline = [
        {
          $group: {
            _id: null,
            avgLatency: { $avg: '$metrics.avgLatency' }
          }
        }
      ];
      
      const results = await collection.aggregate(pipeline).toArray();
      return results.length > 0 ? results[0].avgLatency : 0;
    } catch (error) {
      this.logger.error('Failed to get average latency', error as Error);
      throw error;
    }
  }

  async countByStatus(): Promise<Record<string, number>> {
    try {
      const collection = this.getCollection();
      const pipeline = [
        {
          $group: {
            _id: '$configuration.enabled',
            count: { $sum: 1 }
          }
        }
      ];
      
      const results = await collection.aggregate(pipeline).toArray();
      
      const counts: Record<string, number> = {};
      results.forEach(result => {
        const status = result._id ? 'enabled' : 'disabled';
        counts[status] = result.count;
      });
      
      return counts;
    } catch (error) {
      this.logger.error('Failed to count sub-providers by status', error as Error);
      throw error;
    }
  }

  async countByCircuitBreakerState(): Promise<Record<string, number>> {
    try {
      const collection = this.getCollection();
      const pipeline = [
        {
          $group: {
            _id: '$metrics.circuitBreakerState',
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
      this.logger.error('Failed to count sub-providers by circuit breaker state', error as Error);
      throw error;
    }
  }
}