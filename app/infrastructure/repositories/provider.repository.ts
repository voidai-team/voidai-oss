import { injectable, inject } from 'inversify';
import { Collection, Db } from 'mongodb';
import { Provider } from '../../domain/entities';
import type { ProviderRepository } from '../../domain/repositories';
import type { IDatabaseService } from '../database';
import { ProviderDocument, ProviderCollectionName } from '../database/schemas';
import type { ILogger } from '../../core/logging';
import { TYPES } from '../../core/container';

@injectable()
export class MongoProviderRepository implements ProviderRepository {
  private readonly logger: ILogger;
  private readonly databaseService: IDatabaseService;

  constructor(
    @inject(TYPES.Logger) logger: ILogger,
    @inject(TYPES.DatabaseService) databaseService: IDatabaseService
  ) {
    this.logger = logger.createChild('MongoProviderRepository');
    this.databaseService = databaseService;
  }

  private getCollection(): Collection<ProviderDocument> {
    const db: Db = this.databaseService.getDatabase();
    return db.collection<ProviderDocument>(ProviderCollectionName);
  }

  private documentToEntity(doc: ProviderDocument): Provider {
    return new Provider(
      doc.identity,
      doc.configuration,
      doc.metrics,
      doc.costs,
      doc.security
    );
  }

  private entityToDocument(provider: Provider): Omit<ProviderDocument, '_id'> {
    const identity = provider.getIdentity();
    const configuration = provider.getConfiguration();
    const metrics = provider.getMetrics();
    const costMetrics = provider.getCostMetrics();
    const security = provider.getSecurity();
    
    return {
      identity,
      configuration,
      metrics: {
        totalTokenUsage: metrics.totalTokenUsage,
        totalRequests: metrics.totalRequests,
        lastUsedAt: metrics.lastUsedAt,
        avgLatency: metrics.avgLatency,
        errorCount: metrics.errorCount,
        successCount: metrics.successCount,
        consecutiveErrors: metrics.consecutiveErrors,
        timeoutCount: metrics.timeoutCount,
        lastHealthCheck: Date.now(),
        healthStatus: metrics.healthStatus as 'healthy' | 'degraded' | 'unhealthy',
        uptime: metrics.uptime,
        throughput: metrics.throughput,
        performance: metrics.performance,
        capacity: metrics.capacity
      },
      costs: {
        totalCost: costMetrics.totalCost,
        costPerToken: costMetrics.costPerToken,
        costPerRequest: costMetrics.costPerRequest,
        monthlySpend: costMetrics.monthlySpend,
        dailySpend: costMetrics.dailySpend,
        budgetAlert: false
      },
      security,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  async findById(id: string): Promise<Provider | null> {
    try {
      const collection = this.getCollection();
      const doc = await collection.findOne({ 'identity.id': id });
      
      if (!doc) {
        return null;
      }

      return this.documentToEntity(doc);
    } catch (error) {
      this.logger.error('Failed to find provider by ID', error as Error, {
        metadata: { providerId: id }
      });
      throw error;
    }
  }

  async findByName(name: string): Promise<Provider | null> {
    try {
      const collection = this.getCollection();
      const doc = await collection.findOne({ 'identity.name': name });
      
      if (!doc) {
        return null;
      }

      return this.documentToEntity(doc);
    } catch (error) {
      this.logger.error('Failed to find provider by name', error as Error, {
        metadata: { name }
      });
      throw error;
    }
  }

  async findAll(): Promise<Provider[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({}).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find all providers', error as Error);
      throw error;
    }
  }

  async findActive(): Promise<Provider[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 
        'configuration.isActive': true,
        'metrics.healthStatus': { $in: ['healthy', 'degraded'] }
      }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find active providers', error as Error);
      throw error;
    }
  }

  async findByVendor(vendor: string): Promise<Provider[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 
        'identity.name': { $regex: vendor, $options: 'i' }
      }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find providers by vendor', error as Error, {
        metadata: { vendor }
      });
      throw error;
    }
  }

  async save(provider: Provider): Promise<Provider> {
    try {
      const collection = this.getCollection();
      const doc = this.entityToDocument(provider);
      
      await collection.replaceOne(
        { 'identity.id': provider.getId() },
        { ...doc, updatedAt: new Date() },
        { upsert: true }
      );

      this.logger.debug('Provider saved successfully', {
        metadata: { providerId: provider.getId() }
      });

      return provider;
    } catch (error) {
      this.logger.error('Failed to save provider', error as Error, {
        metadata: { providerId: provider.getId() }
      });
      throw error;
    }
  }

  async update(id: string, updates: Partial<Provider>): Promise<Provider> {
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

      const updatedProvider = await this.findById(id);
      if (!updatedProvider) {
        throw new Error(`Provider with ID ${id} not found after update`);
      }

      return updatedProvider;
    } catch (error) {
      this.logger.error('Failed to update provider', error as Error, {
        metadata: { providerId: id }
      });
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const collection = this.getCollection();
      await collection.deleteOne({ 'identity.id': id });

      this.logger.debug('Provider deleted successfully', {
        metadata: { providerId: id }
      });
    } catch (error) {
      this.logger.error('Failed to delete provider', error as Error, {
        metadata: { providerId: id }
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
      this.logger.error('Failed to check if provider exists', error as Error, {
        metadata: { providerId: id }
      });
      throw error;
    }
  }

  async findHealthy(): Promise<Provider[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 
        'metrics.healthStatus': 'healthy'
      }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find healthy providers', error as Error);
      throw error;
    }
  }

  async findByPriority(minPriority: number): Promise<Provider[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 
        'configuration.priority': { $gte: minPriority }
      }).sort({ 'configuration.priority': -1 }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find providers by priority', error as Error, {
        metadata: { minPriority }
      });
      throw error;
    }
  }

  async findSupportingModel(model: string): Promise<Provider[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 
        'configuration.supportedModels': model
      }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find providers supporting model', error as Error, {
        metadata: { model }
      });
      throw error;
    }
  }

  async findSupportingFeature(feature: string): Promise<Provider[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 
        'configuration.features': feature
      }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find providers supporting feature', error as Error, {
        metadata: { feature }
      });
      throw error;
    }
  }

  async updateMetrics(id: string, metrics: any): Promise<void> {
    try {
      const collection = this.getCollection();
      await collection.updateOne(
        { 'identity.id': id },
        { 
          $set: { 
            metrics,
            updatedAt: new Date()
          }
        }
      );
    } catch (error) {
      this.logger.error('Failed to update provider metrics', error as Error, {
        metadata: { providerId: id }
      });
      throw error;
    }
  }

  async updateHealthStatus(id: string, status: 'healthy' | 'degraded' | 'unhealthy'): Promise<void> {
    try {
      const collection = this.getCollection();
      await collection.updateOne(
        { 'identity.id': id },
        { 
          $set: { 
            'metrics.healthStatus': status,
            'metrics.lastHealthCheck': Date.now(),
            updatedAt: new Date()
          }
        }
      );
    } catch (error) {
      this.logger.error('Failed to update provider health status', error as Error, {
        metadata: { providerId: id, status }
      });
      throw error;
    }
  }

  async recordSuccess(id: string, latency: number, tokensUsed: number, cost: number): Promise<void> {
    try {
      const collection = this.getCollection();
      await collection.updateOne(
        { 'identity.id': id },
        {
          $inc: {
            'metrics.successCount': 1,
            'metrics.totalRequests': 1,
            'metrics.totalTokenUsage': tokensUsed,
            'costs.totalCost': cost,
            'costs.dailySpend': cost,
            'costs.monthlySpend': cost
          },
          $set: {
            'metrics.consecutiveErrors': 0,
            'metrics.lastUsedAt': Date.now(),
            updatedAt: new Date()
          }
        }
      );
    } catch (error) {
      this.logger.error('Failed to record provider success', error as Error, {
        metadata: { providerId: id, latency, tokensUsed, cost }
      });
      throw error;
    }
  }

  async recordError(id: string, errorType: string): Promise<void> {
    try {
      const collection = this.getCollection();
      const updateFields: any = {
        $inc: {
          'metrics.errorCount': 1,
          'metrics.totalRequests': 1,
          'metrics.consecutiveErrors': 1
        },
        $set: {
          'metrics.lastUsedAt': Date.now(),
          updatedAt: new Date()
        }
      };

      if (errorType === 'timeout') {
        updateFields.$inc['metrics.timeoutCount'] = 1;
      }

      await collection.updateOne(
        { 'identity.id': id },
        updateFields
      );
    } catch (error) {
      this.logger.error('Failed to record provider error', error as Error, {
        metadata: { providerId: id, errorType }
      });
      throw error;
    }
  }

  async getTopPerformers(limit: number): Promise<Provider[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({
        'configuration.isActive': true,
        'metrics.healthStatus': { $in: ['healthy', 'degraded'] }
      })
      .sort({ 
        'metrics.performance.p50Latency': 1,
        'metrics.successCount': -1 
      })
      .limit(limit)
      .toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to get top performing providers', error as Error, {
        metadata: { limit }
      });
      throw error;
    }
  }

  async getLeastUsed(limit: number): Promise<Provider[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({
        'configuration.isActive': true,
        'metrics.healthStatus': { $in: ['healthy', 'degraded'] }
      })
      .sort({ 'metrics.totalRequests': 1 })
      .limit(limit)
      .toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to get least used providers', error as Error, {
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

  async getTotalCost(): Promise<number> {
    try {
      const collection = this.getCollection();
      const pipeline = [
        {
          $group: {
            _id: null,
            totalCost: { $sum: '$costs.totalCost' }
          }
        }
      ];
      
      const results = await collection.aggregate(pipeline).toArray();
      return results.length > 0 ? results[0].totalCost : 0;
    } catch (error) {
      this.logger.error('Failed to get total cost', error as Error);
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
            _id: '$metrics.healthStatus',
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
      this.logger.error('Failed to count providers by status', error as Error);
      throw error;
    }
  }
}