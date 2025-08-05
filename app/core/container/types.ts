export const TYPES = {
  DatabaseService: Symbol.for('DatabaseService'),
  Logger: Symbol.for('Logger'),
  MetricsService: Symbol.for('MetricsService'),
  MetricsCollector: Symbol.for('MetricsCollector'),
  SecurityService: Symbol.for('SecurityService'),
  CryptoService: Symbol.for('CryptoService'),
  RateLimiter: Symbol.for('RateLimiter'),
  CacheService: Symbol.for('CacheService'),
  ErrorClassificationService: Symbol.for('ErrorClassificationService'),
  
  UserRepository: Symbol.for('UserRepository'),
  ApiRequestRepository: Symbol.for('ApiRequestRepository'),
  ProviderRepository: Symbol.for('ProviderRepository'),
  SubProviderRepository: Symbol.for('SubProviderRepository'),
  
  UserService: Symbol.for('UserService'),
  CreditService: Symbol.for('CreditService'),
  ApiLogService: Symbol.for('ApiLogService'),
  SubProviderService: Symbol.for('SubProviderService'),
  ApiRequestService: Symbol.for('ApiRequestService'),
  ProviderService: Symbol.for('ProviderService'),
  
  AuthService: Symbol.for('AuthService'),
  RateLimitService: Symbol.for('RateLimitService'),
  AuthenticationService: Symbol.for('AuthenticationService'),
  AuthorizationService: Symbol.for('AuthorizationService'),
  ModelRegistryService: Symbol.for('ModelRegistryService'),
  LoadBalancerService: Symbol.for('LoadBalancerService'),
  
  ChatService: Symbol.for('ChatService'),
  ImagesService: Symbol.for('ImagesService'),
  AudioService: Symbol.for('AudioService'),
  EmbeddingsService: Symbol.for('EmbeddingsService'),
  ModerationsService: Symbol.for('ModerationsService'),
  ModelsService: Symbol.for('ModelsService'),
  
  ProviderRegistry: Symbol.for('ProviderRegistry'),
  ProviderRegistryService: Symbol.for('ProviderRegistryService'),
  ProviderInitializationService: Symbol.for('ProviderInitializationService'),
  AdapterFactoryService: Symbol.for('AdapterFactoryService'),
  LoadBalancer: Symbol.for('LoadBalancer'),
  
  QueueManager: Symbol.for('QueueManager'),
  
  DiscordWebhookService: Symbol.for('DiscordWebhookService'),
  CSAMDetectorService: Symbol.for('CSAMDetectorService'),
  
  SubProvidersController: Symbol.for('SubProvidersController'),
  UsersController: Symbol.for('UsersController'),
  ApiLogsController: Symbol.for('ApiLogsController'),
  
  ChatController: Symbol.for('ChatController'),
  AudioController: Symbol.for('AudioController'),
  EmbeddingsController: Symbol.for('EmbeddingsController'),
  ImagesController: Symbol.for('ImagesController'),
  ModelsController: Symbol.for('ModelsController'),
  ModerationsController: Symbol.for('ModerationsController'),
  
  Application: Symbol.for('Application'),
  Server: Symbol.for('Server')
};