import { injectable, inject } from 'inversify';
import { MongoClient, Db, MongoClientOptions } from 'mongodb';
import type { ILogger } from '../../core/logging';
import { TYPES } from '../../core/container';

export interface IDatabaseService {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getDatabase(): Db;
}

@injectable()
export class DatabaseService implements IDatabaseService {
  private client: MongoClient | null = null;
  private database: Db | null = null;
  private readonly logger: ILogger;
  private readonly connectionString: string;
  private readonly databaseName: string;

  constructor(
    @inject(TYPES.Logger) logger: ILogger
  ) {
    this.logger = logger.createChild('DatabaseService');
    this.connectionString = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    this.databaseName = process.env.DATABASE_NAME || 'voidai';
  }

  async connect(): Promise<void> {
    try {
      this.logger.info('Connecting to MongoDB...', {
        metadata: { 
          connectionString: this.connectionString.replace(/\/\/.*@/, '//***:***@'),
          databaseName: this.databaseName
        }
      });

      const options: MongoClientOptions = {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        family: 4
      };

      this.client = new MongoClient(this.connectionString, options);
      await this.client.connect();
      
      this.database = this.client.db(this.databaseName);

      this.logger.info('MongoDB connected successfully', {
        metadata: { databaseName: this.databaseName }
      });
    } catch (error) {
      this.logger.error('Failed to connect to MongoDB', error as Error);
      throw new Error(`Database connection failed: ${(error as Error).message}`);
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.client) {
        this.logger.info('Disconnecting from MongoDB...');
        await this.client.close();
        this.client = null;
        this.database = null;
        this.logger.info('MongoDB disconnected successfully');
      }
    } catch (error) {
      this.logger.error('Failed to disconnect from MongoDB', error as Error);
      throw error;
    }
  }

  isConnected(): boolean {
    return this.client !== null && this.database !== null;
  }

  getDatabase(): Db {
    if (!this.database) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.database;
  }
}