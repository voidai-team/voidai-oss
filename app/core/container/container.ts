import 'reflect-metadata';
import { Container } from 'inversify';
import { TYPES } from './types';
import { Logger, ILogger } from '../logging';
import { CryptoService, RateLimiter, SecurityService } from '../security';
import { PrometheusCollector, MetricsService } from '../metrics';
import { ErrorClassificationService } from '../error-classification';
import { DatabaseService } from '../../infrastructure/database';
import {
  MongoUserRepository,
  MongoProviderRepository,
  MongoSubProviderRepository,
  MongoApiRequestRepository
} from '../../infrastructure/repositories';
import {
  UserService,
  CreditService,
  AuthorizationService,
  LoadBalancerService,
  ModelRegistryService,
  ApiRequestService,
  ProviderService,
  SubProviderService,
  AdapterFactoryService,
  DiscordWebhookService,
  CSAMDetectorService
} from '../../domain/services';
import { ProviderRegistryService } from '../../infrastructure/providers/registry';
import { ProviderInitializationService } from '../../infrastructure/providers/initialization';
import {
  ChatService,
  AudioService,
  EmbeddingsService,
  ImagesService,
  ModelsService,
  ModerationsService
} from '../../application/services';
import {
  SubProvidersController,
  UsersController,
  ApiLogsController
} from '../../api/controllers/admin';
import {
  ChatController,
  AudioController,
  EmbeddingsController,
  ImagesController,
  ModelsController,
  ModerationsController
} from '../../api/controllers/v1';

export interface ContainerConfiguration {
  environment: 'development' | 'production' | 'test';
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  enableMetrics: boolean;
  enableTracing: boolean;
}

export interface IApplicationContainer {
  get<T>(serviceIdentifier: symbol): T;
  getAsync<T>(serviceIdentifier: symbol): Promise<T>;
  bind(serviceIdentifier: symbol): any;
  isBound(serviceIdentifier: symbol): boolean;
  rebind(serviceIdentifier: symbol): any;
  unbind(serviceIdentifier: symbol): void;
  snapshot(): void;
  restore(): void;
  createChild(): Container;
  dispose(): Promise<void>;
}

export class ApplicationContainer implements IApplicationContainer {
  private static instance: ApplicationContainer | null = null;
  private readonly container: Container;
  private readonly configuration: ContainerConfiguration;
  private isInitialized = false;
  private readonly disposables: Array<{ dispose(): Promise<void> }> = [];

  private constructor(configuration?: Partial<ContainerConfiguration>) {
    this.configuration = this.buildConfiguration(configuration);
    this.container = this.createContainer();
    this.validateEnvironment();
  }

  public static getInstance(configuration?: Partial<ContainerConfiguration>): ApplicationContainer {
    if (!ApplicationContainer.instance) {
      ApplicationContainer.instance = new ApplicationContainer(configuration);
    }
    return ApplicationContainer.instance;
  }

  public static reset(): void {
    if (ApplicationContainer.instance) {
      ApplicationContainer.instance.dispose();
      ApplicationContainer.instance = null;
    }
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      throw new Error('Container is already initialized');
    }

    try {
      await this.configureServices();
      await this.validateServices();
      this.isInitialized = true;
    } catch (error) {
      throw new Error(`Container initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public get<T>(serviceIdentifier: symbol): T {
    this.ensureInitialized();
    
    try {
      return this.container.get<T>(serviceIdentifier);
    } catch (error) {
      throw new Error(`Failed to resolve service ${String(serviceIdentifier)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async getAsync<T>(serviceIdentifier: symbol): Promise<T> {
    this.ensureInitialized();
    
    try {
      return this.container.getAsync<T>(serviceIdentifier);
    } catch (error) {
      throw new Error(`Failed to resolve service asynchronously ${String(serviceIdentifier)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public bind(serviceIdentifier: symbol): any {
    return this.container.bind(serviceIdentifier);
  }

  public isBound(serviceIdentifier: symbol): boolean {
    return this.container.isBound(serviceIdentifier);
  }

  public rebind(serviceIdentifier: symbol): any {
    return this.container.rebind(serviceIdentifier);
  }

  public unbind(serviceIdentifier: symbol): void {
    this.container.unbind(serviceIdentifier);
  }

  public snapshot(): void {
    this.container.snapshot();
  }

  public restore(): void {
    this.container.restore();
  }

  public createChild(): Container {
    return new Container();
  }

  public async dispose(): Promise<void> {
    const disposePromises = this.disposables.map(disposable => 
      disposable.dispose().catch(error => 
        console.error('Error during service disposal:', error)
      )
    );

    await Promise.allSettled(disposePromises);
    this.disposables.length = 0;
    this.isInitialized = false;
  }

  private buildConfiguration(userConfig?: Partial<ContainerConfiguration>): ContainerConfiguration {
    const defaultConfig: ContainerConfiguration = {
      environment: (process.env.NODE_ENV as any) || 'development',
      logLevel: (process.env.LOG_LEVEL as any) || 'info',
      enableMetrics: process.env.ENABLE_METRICS === 'true',
      enableTracing: process.env.ENABLE_TRACING === 'true'
    };

    return { ...defaultConfig, ...userConfig };
  }

  private createContainer(): Container {
    return new Container({ defaultScope: 'Singleton' });
  }

  private validateEnvironment(): void {
    const requiredEnvVars = ['NODE_ENV'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }
  }

  private async configureServices(): Promise<void> {
    this.configureLogging();
    this.configureSecurity();
    this.configureMetrics();
    this.configureCore();
    this.configureRepositories();
    this.configureDomainServices();
    this.configureApplicationServices();
    this.configureControllers();
  }

  private configureLogging(): void {
    this.container
      .bind<ILogger>(TYPES.Logger)
      .to(Logger)
      .inSingletonScope()
      .onActivation((_, logger) => {
        const loggerInstance = logger as Logger;
        this.disposables.push({
          dispose: async () => {
            console.log('Logger disposed');
          }
        });
        return loggerInstance;
      });
  }

  private configureSecurity(): void {
    this.container.bind(TYPES.CryptoService).to(CryptoService).inSingletonScope();
    this.container.bind(TYPES.RateLimiter).to(RateLimiter).inSingletonScope();
    this.container.bind(TYPES.SecurityService).to(SecurityService).inSingletonScope();
  }

  private configureMetrics(): void {
    if (this.configuration.enableMetrics) {
      this.container.bind(TYPES.MetricsCollector).to(PrometheusCollector).inSingletonScope();
      this.container.bind(TYPES.MetricsService).to(MetricsService).inSingletonScope();
    }
  }

  private configureCore(): void {
    this.container.bind(TYPES.DatabaseService).to(DatabaseService).inSingletonScope();
    this.container.bind(TYPES.ErrorClassificationService).to(ErrorClassificationService).inSingletonScope();
  }

  private configureRepositories(): void {
    this.container.bind(TYPES.UserRepository).to(MongoUserRepository).inSingletonScope();
    this.container.bind(TYPES.ProviderRepository).to(MongoProviderRepository).inSingletonScope();
    this.container.bind(TYPES.SubProviderRepository).to(MongoSubProviderRepository).inSingletonScope();
    this.container.bind(TYPES.ApiRequestRepository).to(MongoApiRequestRepository).inSingletonScope();
  }

  private configureDomainServices(): void {
    this.container.bind(TYPES.UserService).to(UserService).inSingletonScope();
    this.container.bind(TYPES.CreditService).to(CreditService).inSingletonScope();
    this.container.bind(TYPES.AuthorizationService).to(AuthorizationService).inSingletonScope();
    this.container.bind(TYPES.LoadBalancerService).to(LoadBalancerService).inSingletonScope();
    this.container.bind(TYPES.ModelRegistryService).to(ModelRegistryService).inSingletonScope();
    this.container.bind(TYPES.ApiRequestService).to(ApiRequestService).inSingletonScope();
    this.container.bind(TYPES.ProviderService).to(ProviderService).inSingletonScope();
    this.container.bind(TYPES.SubProviderService).to(SubProviderService).inSingletonScope();
    this.container.bind(TYPES.ProviderRegistryService).to(ProviderRegistryService).inSingletonScope();
    this.container.bind(TYPES.ProviderInitializationService).to(ProviderInitializationService).inSingletonScope();
    this.container.bind(TYPES.AdapterFactoryService).to(AdapterFactoryService).inSingletonScope();
    this.container.bind(TYPES.DiscordWebhookService).to(DiscordWebhookService).inSingletonScope();
    this.container.bind(TYPES.CSAMDetectorService).to(CSAMDetectorService).inSingletonScope();
  }

  private configureApplicationServices(): void {
    this.container.bind(TYPES.ChatService).to(ChatService).inSingletonScope();
    this.container.bind(TYPES.AudioService).to(AudioService).inSingletonScope();
    this.container.bind(TYPES.EmbeddingsService).to(EmbeddingsService).inSingletonScope();
    this.container.bind(TYPES.ImagesService).to(ImagesService).inSingletonScope();
    this.container.bind(TYPES.ModelsService).to(ModelsService).inSingletonScope();
    this.container.bind(TYPES.ModerationsService).to(ModerationsService).inSingletonScope();
  }

  private configureControllers(): void {
    this.container.bind(TYPES.SubProvidersController).to(SubProvidersController).inSingletonScope();
    this.container.bind(TYPES.UsersController).to(UsersController).inSingletonScope();
    this.container.bind(TYPES.ApiLogsController).to(ApiLogsController).inSingletonScope();
    
    this.container.bind(TYPES.ChatController).to(ChatController).inSingletonScope();
    this.container.bind(TYPES.AudioController).to(AudioController).inSingletonScope();
    this.container.bind(TYPES.EmbeddingsController).to(EmbeddingsController).inSingletonScope();
    this.container.bind(TYPES.ImagesController).to(ImagesController).inSingletonScope();
    this.container.bind(TYPES.ModelsController).to(ModelsController).inSingletonScope();
    this.container.bind(TYPES.ModerationsController).to(ModerationsController).inSingletonScope();
  }

  private async validateServices(): Promise<void> {
    const criticalServices = [TYPES.Logger];
    
    for (const serviceType of criticalServices) {
      if (!this.container.isBound(serviceType)) {
        throw new Error(`Critical service ${String(serviceType)} is not bound`);
      }
    }

    try {
      const logger = this.container.get<ILogger>(TYPES.Logger);
      logger.info('Container validation completed successfully', {
        metadata: {
          environment: this.configuration.environment,
          servicesCount: criticalServices.length,
          metricsEnabled: this.configuration.enableMetrics,
          tracingEnabled: this.configuration.enableTracing
        }
      });
    } catch (error) {
      throw new Error(`Service validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Container must be initialized before use. Call initialize() first.');
    }
  }
}

export const container = ApplicationContainer.getInstance();