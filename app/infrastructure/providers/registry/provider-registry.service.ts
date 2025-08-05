import { injectable, inject } from 'inversify';
import { readdirSync } from 'fs';
import { join } from 'path';
import { TYPES } from '../../../core/container';
import type { ILogger } from '../../../core/logging';
import type { MetricsService } from '../../../core/metrics';
import type { BaseProviderAdapter } from '../base';

export interface ProviderAdapterInfo {
  name: string;
  adapterClass: new (...args: any[]) => BaseProviderAdapter;
  needsSubProviders: boolean;
}

@injectable()
export class ProviderRegistryService {
  private adapters: Map<string, ProviderAdapterInfo> = new Map();

  constructor(
    @inject(TYPES.Logger) private logger: ILogger,
    @inject(TYPES.MetricsService) private metricsService: MetricsService
  ) {
    this.registerAdapters();
  }

  private async registerAdapters(): Promise<void> {
    const adaptersPath = join(__dirname, '../adapters');
    
    try {
      const adapterFiles = readdirSync(adaptersPath)
        .filter(file => file.endsWith('.adapter.ts') || file.endsWith('.adapter.js'))
        .filter(file => file !== 'index.ts' && file !== 'index.js');

      for (const file of adapterFiles) {
        try {
          const adapterModule = await import(join(adaptersPath, file));
          const adapterClasses = Object.values(adapterModule).filter(
            (exported: any) => 
              typeof exported === 'function' && 
              exported.name.endsWith('Adapter')
          );

          for (const AdapterClass of adapterClasses) {
            await this.registerAdapter(AdapterClass as new (...args: any[]) => BaseProviderAdapter);
          }
        } catch (error) {
          this.logger.warn(`Failed to load adapter file ${file}`, {
            metadata: { error: (error as Error).message }
          });
        }
      }

      this.logger.info(`Registered ${this.adapters.size} provider adapters`, {
        metadata: { 
          adapters: Array.from(this.adapters.keys()),
          withSubProviders: Array.from(this.adapters.values()).filter(a => a.needsSubProviders).map(a => a.name),
          withStaticKeys: Array.from(this.adapters.values()).filter(a => !a.needsSubProviders).map(a => a.name)
        }
      });
    } catch (error) {
      this.logger.error('Failed to register adapters', error as Error);
    }
  }

  private async registerAdapter(AdapterClass: new (...args: any[]) => BaseProviderAdapter): Promise<void> {
    try {
      let dummyAdapter: BaseProviderAdapter;
      
      try {
        dummyAdapter = new AdapterClass(
          'dummy-key',
          this.logger,
          this.metricsService
        );
      } catch {
        try {
          dummyAdapter = new AdapterClass(
            this.logger,
            this.metricsService
          );
        } catch (error) {
          this.logger.warn(`Failed to instantiate adapter ${AdapterClass.name}`, {
            metadata: { error: (error as Error).message }
          });
          return;
        }
      }
      
      const providerName = dummyAdapter.configuration.name;
      const needsSubProviders = dummyAdapter.configuration.requiresApiKey;
      
      this.adapters.set(providerName, {
        name: providerName,
        adapterClass: AdapterClass,
        needsSubProviders
      });

      this.logger.debug(`Registered provider adapter: ${providerName}`, {
        metadata: { 
          className: AdapterClass.name, 
          needsSubProviders,
          supportedModels: dummyAdapter.getSupportedModels().length,
          capabilities: Object.entries(dummyAdapter.configuration.capabilities)
            .filter(([_, enabled]) => enabled)
            .map(([capability]) => capability)
        }
      });
    } catch (error) {
      this.logger.warn(`Failed to register adapter ${AdapterClass.name}`, {
        metadata: { error: (error as Error).message }
      });
    }
  }

  getAllAdapters(): ProviderAdapterInfo[] {
    return Array.from(this.adapters.values());
  }

  getAdapter(name: string): ProviderAdapterInfo | undefined {
    return this.adapters.get(name);
  }

  hasAdapter(name: string): boolean {
    return this.adapters.has(name);
  }

  getAdapterNames(): string[] {
    return Array.from(this.adapters.keys());
  }

  getAdaptersWithSubProviders(): ProviderAdapterInfo[] {
    return Array.from(this.adapters.values()).filter(adapter => adapter.needsSubProviders);
  }

  getAdaptersWithStaticKeys(): ProviderAdapterInfo[] {
    return Array.from(this.adapters.values()).filter(adapter => !adapter.needsSubProviders);
  }

  createAdapter(
    providerName: string,
    apiKey?: string,
    modelMapping?: Record<string, string>
  ): BaseProviderAdapter | null {
    const adapterInfo = this.getAdapter(providerName);
    if (!adapterInfo) {
      this.logger.warn(`Adapter not found: ${providerName}`, {
        metadata: { availableAdapters: this.getAdapterNames() }
      });
      return null;
    }

    try {
      const args: any[] = [];
      
      if (adapterInfo.needsSubProviders && apiKey) {
        args.push(apiKey);
      }
      
      args.push(this.logger, this.metricsService);
      
      if (modelMapping && Object.keys(modelMapping).length > 0) {
        args.push(modelMapping);
      }

      return new adapterInfo.adapterClass(...args);
    } catch (error) {
      this.logger.error(`Failed to create adapter for ${providerName}`, error as Error, {
        metadata: { needsSubProviders: adapterInfo.needsSubProviders }
      });
      return null;
    }
  }

  async refreshAdapters(): Promise<void> {
    this.adapters.clear();
    await this.registerAdapters();
  }
}