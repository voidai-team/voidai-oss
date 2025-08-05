import { injectable, inject } from 'inversify';
import { TYPES } from '../../../core/container';
import type { ILogger } from '../../../core/logging';
import type { ProviderService } from '../../../domain/services';
import type { SubProviderService } from '../../../domain/services';
import type { ProviderRegistryService } from '../registry';

@injectable()
export class ProviderInitializationService {
  constructor(
    @inject(TYPES.Logger) private logger: ILogger,
    @inject(TYPES.ProviderService) private providerService: ProviderService,
    @inject(TYPES.SubProviderService) private subProviderService: SubProviderService,
    @inject(TYPES.ProviderRegistryService) private registryService: ProviderRegistryService
  ) {}

  async initializeProviders(): Promise<void> {
    this.logger.info('Starting provider initialization');

    try {
      const adapters = this.registryService.getAllAdapters();
      let providersCreated = 0;
      let subProvidersCreated = 0;

      for (const adapterInfo of adapters) {
        try {
          const existingProvider = await this.providerService.getProviderByName(adapterInfo.name);
          
          if (!existingProvider) {
            const dummyAdapter = this.registryService.createAdapter(adapterInfo.name, 'dummy-key');
            if (!dummyAdapter) {
              this.logger.warn(`Failed to create dummy adapter for ${adapterInfo.name}`);
              continue;
            }

            const provider = await this.providerService.createProvider({
              name: adapterInfo.name,
              displayName: this.formatDisplayName(adapterInfo.name),
              needsSubProviders: adapterInfo.needsSubProviders,
              priority: 1,
              baseUrl: dummyAdapter.configuration.baseUrl,
              timeout: dummyAdapter.configuration.timeout,
              retryAttempts: dummyAdapter.configuration.maxRetries,
              retryDelay: 1000,
              supportedModels: [...dummyAdapter.getSupportedModels()],
              rateLimits: {
                requestsPerMinute: dummyAdapter.configuration.rateLimitPerMinute,
                requestsPerHour: dummyAdapter.configuration.rateLimitPerMinute * 60,
                tokensPerMinute: 20000000
              },
              features: Object.entries(dummyAdapter.configuration.capabilities)
                .filter(([_, enabled]) => enabled)
                .map(([capability]) => capability)
            });

            providersCreated++;
            this.logger.info(`Created provider: ${adapterInfo.name}`, {
              metadata: {
                providerId: provider.getId(),
                supportedModels: dummyAdapter.getSupportedModels().length,
                requiresApiKey: dummyAdapter.configuration.requiresApiKey
              }
            });
          } else {
            this.logger.debug(`Provider ${adapterInfo.name} already exists`, {
              metadata: { providerId: existingProvider.getId() }
            });
          }
        } catch (error) {
          this.logger.error(`Failed to initialize provider ${adapterInfo.name}`, error as Error);
        }
      }

      this.logger.info('Provider initialization completed', {
        metadata: {
          totalAdapters: adapters.length,
          providersCreated,
          subProvidersCreated,
          withSubProviders: this.registryService.getAdaptersWithSubProviders().length,
          withStaticKeys: this.registryService.getAdaptersWithStaticKeys().length
        }
      });
    } catch (error) {
      this.logger.error('Provider initialization failed', error as Error);
      throw error;
    }
  }

  async refreshProviders(): Promise<void> {
    this.logger.info('Refreshing provider registry and reinitializing');
    await this.registryService.refreshAdapters();
    await this.initializeProviders();
  }

  async getInitializationStatus(): Promise<{
    totalAdapters: number;
    providersInDatabase: number;
    subProvidersInDatabase: number;
    missingProviders: string[];
    providersWithSubProviders: string[];
    providersWithStaticKeys: string[];
  }> {
    const adapters = this.registryService.getAllAdapters();
    const providers = await this.providerService.getActiveProviders();
    const subProviders = await this.subProviderService.getAvailableSubProviders('dummy-provider-id');

    const providerNames = new Set(providers.map(p => p.getName()));
    const missingProviders = adapters
      .map(a => a.name)
      .filter(name => !providerNames.has(name));

    return {
      totalAdapters: adapters.length,
      providersInDatabase: providers.length,
      subProvidersInDatabase: subProviders.length,
      missingProviders,
      providersWithSubProviders: this.registryService.getAdaptersWithSubProviders().map(a => a.name),
      providersWithStaticKeys: this.registryService.getAdaptersWithStaticKeys().map(a => a.name)
    };
  }

  private formatDisplayName(name: string): string {
    return name
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}