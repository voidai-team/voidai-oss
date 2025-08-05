import 'reflect-metadata';
import { container } from './core/container';
import { DatabaseService } from './infrastructure/database';
import type { ILogger } from './core/logging';
import type { MetricsService } from './core/metrics';
import { TYPES } from './core/container/types';
import type { ProviderInitializationService } from './infrastructure/providers/initialization';

export interface BootstrapConfig {
  environment?: 'development' | 'production' | 'test';
  enableMetrics?: boolean;
  enableTracing?: boolean;
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
}

export class ApplicationBootstrap {
  private logger?: ILogger;
  private metricsService?: MetricsService;
  private databaseService?: DatabaseService;

  constructor(private config: BootstrapConfig = {}) {}

  async initialize(): Promise<void> {
    try {
      await container.initialize();
      this.logger = container.get<ILogger>(TYPES.Logger);
      this.logger.info('Application bootstrap initialization started', {
        metadata: {
          environment: this.config.environment || process.env.NODE_ENV || 'development',
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          enableMetrics: this.config.enableMetrics,
          enableTracing: this.config.enableTracing,
          logLevel: this.config.logLevel
        }
      });

      await this.initializeDatabase();
      await this.initializeMetrics();
      await this.initializeProviders();
      
      this.setupGracefulShutdown();
      
      this.logger.info('Application bootstrap initialized successfully');
      
    } catch (error) {
      console.error('Bootstrap initialization failed:', error);
      throw error;
    }
  }

  private async initializeDatabase(): Promise<void> {
    try {
      this.databaseService = container.get<DatabaseService>(TYPES.DatabaseService);
      await this.databaseService.connect();
      
      this.logger?.info('Database connection established successfully');
    } catch (error) {
      this.logger?.error('Database initialization failed', error as Error);
      throw error;
    }
  }

  private async initializeMetrics(): Promise<void> {
    if (this.config.enableMetrics !== false) {
      try {
        this.metricsService = container.get<MetricsService>(TYPES.MetricsService);
        this.metricsService.startPeriodicCollection();
        
        this.logger?.info('Metrics collection started successfully');
      } catch (error) {
        this.logger?.warn('Metrics initialization failed', {
          metadata: { error: (error as Error).message }
        });
      }
    }
  }

  private async initializeProviders(): Promise<void> {
    try {
      const providerInitService = container.get<ProviderInitializationService>(TYPES.ProviderInitializationService);
      await providerInitService.initializeProviders();
      
      this.logger?.info('Provider initialization completed successfully');
    } catch (error) {
      this.logger?.warn('Provider initialization failed', {
        metadata: { error: (error as Error).message }
      });
    }
  }

  async shutdown(): Promise<void> {
    try {
      this.logger?.info('Application shutdown initiated');

      if (this.metricsService) {
        this.metricsService.stopPeriodicCollection();
        this.logger?.info('Metrics collection stopped');
      }

      if (this.databaseService) {
        await this.databaseService.disconnect();
        this.logger?.info('Database connection closed');
      }
      
      this.logger?.info('Application shutdown completed successfully');
    } catch (error) {
      console.error('Error during shutdown:', error);
      throw error;
    }
  }

  private setupGracefulShutdown(): void {
    const shutdownHandler = async (signal: string) => {
      this.logger?.info(`Received ${signal}, initiating graceful shutdown`);
      
      try {
        await this.shutdown();
        process.exit(0);
      } catch (error) {
        console.error('Error during graceful shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
    process.on('SIGINT', () => shutdownHandler('SIGINT'));
    
    process.on('uncaughtException', (error) => {
      if (this.logger) {
        this.logger.error('Uncaught exception', error);
      } else {
        console.error('Uncaught exception:', error);
      }
      shutdownHandler('UNCAUGHT_EXCEPTION');
    });

    process.on('unhandledRejection', (reason) => {
      if (this.logger) {
        this.logger.error('Unhandled rejection', reason instanceof Error ? reason : new Error(String(reason)));
      } else {
        console.error('Unhandled rejection:', reason);
      }
      shutdownHandler('UNHANDLED_REJECTION');
    });
  }
}