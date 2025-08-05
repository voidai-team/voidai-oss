import { injectable, inject } from 'inversify';
import { Collection, Db } from 'mongodb';
import { ApiRequest } from '../../domain/entities';
import type { ApiRequestRepository } from '../../domain/repositories';
import type { IDatabaseService } from '../database';
import { ApiRequestDocument, ApiRequestCollectionName } from '../database/schemas';
import type { ILogger } from '../../core/logging';
import { TYPES } from '../../core/container';

@injectable()
export class MongoApiRequestRepository implements ApiRequestRepository {
  private readonly logger: ILogger;
  private readonly databaseService: IDatabaseService;

  constructor(
    @inject(TYPES.Logger) logger: ILogger,
    @inject(TYPES.DatabaseService) databaseService: IDatabaseService
  ) {
    this.logger = logger.createChild('MongoApiRequestRepository');
    this.databaseService = databaseService;
  }

  private getCollection(): Collection<ApiRequestDocument> {
    const db: Db = this.databaseService.getDatabase();
    return db.collection<ApiRequestDocument>(ApiRequestCollectionName);
  }

  private documentToEntity(doc: ApiRequestDocument): ApiRequest {
    return new ApiRequest(
      doc.identity,
      doc.details,
      doc.metrics,
      doc.status
    );
  }

  private entityToDocument(request: ApiRequest): Omit<ApiRequestDocument, '_id'> {
    const identity = request.getIdentity();
    const details = request.getDetails();
    const metrics = request.getRequestMetrics();
    const status = request.getRequestStatus();
    
    return {
      identity,
      details,
      metrics,
      status,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  async findById(id: string): Promise<ApiRequest | null> {
    try {
      const collection = this.getCollection();
      const doc = await collection.findOne({ 'identity.id': id });
      
      if (!doc) {
        return null;
      }

      return this.documentToEntity(doc);
    } catch (error) {
      this.logger.error('Failed to find API request by ID', error as Error, {
        metadata: { requestId: id }
      });
      throw error;
    }
  }

  async findByUserId(userId: string): Promise<ApiRequest[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 'identity.userId': userId }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find API requests by user ID', error as Error, {
        metadata: { userId }
      });
      throw error;
    }
  }

  async findByEndpoint(endpoint: string): Promise<ApiRequest[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 'details.endpoint': endpoint }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find API requests by endpoint', error as Error, {
        metadata: { endpoint }
      });
      throw error;
    }
  }

  async findByModel(model: string): Promise<ApiRequest[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 'details.model': model }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find API requests by model', error as Error, {
        metadata: { model }
      });
      throw error;
    }
  }

  async findByProviderId(providerId: string): Promise<ApiRequest[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 'details.providerId': providerId }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find API requests by provider ID', error as Error, {
        metadata: { providerId }
      });
      throw error;
    }
  }

  async findByStatus(status: string): Promise<ApiRequest[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 'status.status': status }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find API requests by status', error as Error, {
        metadata: { status }
      });
      throw error;
    }
  }

  async findAll(): Promise<ApiRequest[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({}).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find all API requests', error as Error);
      throw error;
    }
  }

  async save(request: ApiRequest): Promise<ApiRequest> {
    try {
      const collection = this.getCollection();
      const doc = this.entityToDocument(request);
      
      await collection.replaceOne(
        { 'identity.id': request.getId() },
        { ...doc, updatedAt: new Date() },
        { upsert: true }
      );

      this.logger.debug('API request saved successfully', {
        metadata: { requestId: request.getId() }
      });

      return request;
    } catch (error) {
      this.logger.error('Failed to save API request', error as Error, {
        metadata: { requestId: request.getId() }
      });
      throw error;
    }
  }

  async update(id: string, updates: Partial<ApiRequest>): Promise<ApiRequest> {
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

      const updatedRequest = await this.findById(id);
      if (!updatedRequest) {
        throw new Error(`API request with ID ${id} not found after update`);
      }

      return updatedRequest;
    } catch (error) {
      this.logger.error('Failed to update API request', error as Error, {
        metadata: { requestId: id }
      });
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const collection = this.getCollection();
      await collection.deleteOne({ 'identity.id': id });

      this.logger.debug('API request deleted successfully', {
        metadata: { requestId: id }
      });
    } catch (error) {
      this.logger.error('Failed to delete API request', error as Error, {
        metadata: { requestId: id }
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
      this.logger.error('Failed to check if API request exists', error as Error, {
        metadata: { requestId: id }
      });
      throw error;
    }
  }

  async findByDateRange(startDate: number, endDate: number): Promise<ApiRequest[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 
        'identity.createdAt': { 
          $gte: startDate, 
          $lte: endDate 
        }
      }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find API requests by date range', error as Error, {
        metadata: { startDate, endDate }
      });
      throw error;
    }
  }

  async findByUserAndDateRange(userId: string, startDate: number, endDate: number): Promise<ApiRequest[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 
        'identity.userId': userId,
        'identity.createdAt': { 
          $gte: startDate, 
          $lte: endDate 
        }
      }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find API requests by user and date range', error as Error, {
        metadata: { userId, startDate, endDate }
      });
      throw error;
    }
  }

  async findCompleted(): Promise<ApiRequest[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 'status.status': 'completed' }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find completed API requests', error as Error);
      throw error;
    }
  }

  async findFailed(): Promise<ApiRequest[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 
        'status.status': { $in: ['failed', 'timeout'] }
      }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find failed API requests', error as Error);
      throw error;
    }
  }

  async findProcessing(): Promise<ApiRequest[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 'status.status': 'processing' }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find processing API requests', error as Error);
      throw error;
    }
  }

  async findByLatencyRange(minLatency: number, maxLatency: number): Promise<ApiRequest[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 
        'metrics.latency': { 
          $gte: minLatency, 
          $lte: maxLatency 
        }
      }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find API requests by latency range', error as Error, {
        metadata: { minLatency, maxLatency }
      });
      throw error;
    }
  }

  async findByTokenRange(minTokens: number, maxTokens: number): Promise<ApiRequest[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 
        'metrics.tokensUsed': { 
          $gte: minTokens, 
          $lte: maxTokens 
        }
      }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find API requests by token range', error as Error, {
        metadata: { minTokens, maxTokens }
      });
      throw error;
    }
  }

  async findByCreditRange(minCredits: number, maxCredits: number): Promise<ApiRequest[]> {
    try {
      const collection = this.getCollection();
      const docs = await collection.find({ 
        'metrics.creditsUsed': { 
          $gte: minCredits, 
          $lte: maxCredits 
        }
      }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to find API requests by credit range', error as Error, {
        metadata: { minCredits, maxCredits }
      });
      throw error;
    }
  }

  async getTotalRequests(): Promise<number> {
    try {
      const collection = this.getCollection();
      return await collection.countDocuments({});
    } catch (error) {
      this.logger.error('Failed to get total requests', error as Error);
      throw error;
    }
  }

  async getTotalTokensUsed(): Promise<number> {
    try {
      const collection = this.getCollection();
      const pipeline = [
        {
          $group: {
            _id: null,
            totalTokensUsed: { $sum: '$metrics.tokensUsed' }
          }
        }
      ];
      
      const results = await collection.aggregate(pipeline).toArray();
      return results.length > 0 ? results[0].totalTokensUsed : 0;
    } catch (error) {
      this.logger.error('Failed to get total tokens used', error as Error);
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
            totalCreditsUsed: { $sum: '$metrics.creditsUsed' }
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

  async getAverageLatency(): Promise<number> {
    try {
      const collection = this.getCollection();
      const pipeline = [
        {
          $group: {
            _id: null,
            avgLatency: { $avg: '$metrics.latency' }
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

  async getSuccessRate(): Promise<number> {
    try {
      const collection = this.getCollection();
      const totalRequests = await collection.countDocuments({});
      const successfulRequests = await collection.countDocuments({ 'status.status': 'completed' });
      
      return totalRequests > 0 ? successfulRequests / totalRequests : 0;
    } catch (error) {
      this.logger.error('Failed to get success rate', error as Error);
      throw error;
    }
  }

  async getRequestsByEndpoint(): Promise<Record<string, number>> {
    try {
      const collection = this.getCollection();
      const pipeline = [
        {
          $group: {
            _id: '$details.endpoint',
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
      this.logger.error('Failed to get requests by endpoint', error as Error);
      throw error;
    }
  }

  async getRequestsByModel(): Promise<Record<string, number>> {
    try {
      const collection = this.getCollection();
      const pipeline = [
        {
          $group: {
            _id: '$details.model',
            count: { $sum: 1 }
          }
        }
      ];
      
      const results = await collection.aggregate(pipeline).toArray();
      
      const counts: Record<string, number> = {};
      results.forEach(result => {
        if (result._id) {
          counts[result._id] = result.count;
        }
      });
      
      return counts;
    } catch (error) {
      this.logger.error('Failed to get requests by model', error as Error);
      throw error;
    }
  }

  async getRequestsByProvider(): Promise<Record<string, number>> {
    try {
      const collection = this.getCollection();
      const pipeline = [
        {
          $group: {
            _id: '$details.providerId',
            count: { $sum: 1 }
          }
        }
      ];
      
      const results = await collection.aggregate(pipeline).toArray();
      
      const counts: Record<string, number> = {};
      results.forEach(result => {
        if (result._id) {
          counts[result._id] = result.count;
        }
      });
      
      return counts;
    } catch (error) {
      this.logger.error('Failed to get requests by provider', error as Error);
      throw error;
    }
  }

  async getRequestsByStatus(): Promise<Record<string, number>> {
    try {
      const collection = this.getCollection();
      const pipeline = [
        {
          $group: {
            _id: '$status.status',
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
      this.logger.error('Failed to get requests by status', error as Error);
      throw error;
    }
  }

  async getRequestsByHour(hours: number): Promise<ApiRequest[]> {
    try {
      const collection = this.getCollection();
      const startTime = Date.now() - (hours * 60 * 60 * 1000);
      
      const docs = await collection.find({ 
        'identity.createdAt': { $gte: startTime }
      }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to get requests by hour', error as Error, {
        metadata: { hours }
      });
      throw error;
    }
  }

  async getRequestsByDay(days: number): Promise<ApiRequest[]> {
    try {
      const collection = this.getCollection();
      const startTime = Date.now() - (days * 24 * 60 * 60 * 1000);
      
      const docs = await collection.find({ 
        'identity.createdAt': { $gte: startTime }
      }).toArray();
      
      return docs.map(doc => this.documentToEntity(doc));
    } catch (error) {
      this.logger.error('Failed to get requests by day', error as Error, {
        metadata: { days }
      });
      throw error;
    }
  }

  async getUserStats(userId: string): Promise<{
    totalRequests: number;
    totalTokensUsed: number;
    totalCreditsUsed: number;
    averageLatency: number;
    successRate: number;
  }> {
    try {
      const collection = this.getCollection();
      const pipeline = [
        { $match: { 'identity.userId': userId } },
        {
          $group: {
            _id: null,
            totalRequests: { $sum: 1 },
            totalTokensUsed: { $sum: '$metrics.tokensUsed' },
            totalCreditsUsed: { $sum: '$metrics.creditsUsed' },
            averageLatency: { $avg: '$metrics.latency' },
            successfulRequests: {
              $sum: {
                $cond: [{ $eq: ['$status.status', 'completed'] }, 1, 0]
              }
            }
          }
        }
      ];
      
      const results = await collection.aggregate(pipeline).toArray();
      
      if (results.length === 0) {
        return {
          totalRequests: 0,
          totalTokensUsed: 0,
          totalCreditsUsed: 0,
          averageLatency: 0,
          successRate: 0
        };
      }
      
      const result = results[0];
      return {
        totalRequests: result.totalRequests,
        totalTokensUsed: result.totalTokensUsed,
        totalCreditsUsed: result.totalCreditsUsed,
        averageLatency: result.averageLatency,
        successRate: result.totalRequests > 0 ? result.successfulRequests / result.totalRequests : 0
      };
    } catch (error) {
      this.logger.error('Failed to get user stats', error as Error, {
        metadata: { userId }
      });
      throw error;
    }
  }

  async getProviderStats(providerId: string): Promise<{
    totalRequests: number;
    totalTokensUsed: number;
    averageLatency: number;
    successRate: number;
  }> {
    try {
      const collection = this.getCollection();
      const pipeline = [
        { $match: { 'details.providerId': providerId } },
        {
          $group: {
            _id: null,
            totalRequests: { $sum: 1 },
            totalTokensUsed: { $sum: '$metrics.tokensUsed' },
            averageLatency: { $avg: '$metrics.latency' },
            successfulRequests: {
              $sum: {
                $cond: [{ $eq: ['$status.status', 'completed'] }, 1, 0]
              }
            }
          }
        }
      ];
      
      const results = await collection.aggregate(pipeline).toArray();
      
      if (results.length === 0) {
        return {
          totalRequests: 0,
          totalTokensUsed: 0,
          averageLatency: 0,
          successRate: 0
        };
      }
      
      const result = results[0];
      return {
        totalRequests: result.totalRequests,
        totalTokensUsed: result.totalTokensUsed,
        averageLatency: result.averageLatency,
        successRate: result.totalRequests > 0 ? result.successfulRequests / result.totalRequests : 0
      };
    } catch (error) {
      this.logger.error('Failed to get provider stats', error as Error, {
        metadata: { providerId }
      });
      throw error;
    }
  }
}