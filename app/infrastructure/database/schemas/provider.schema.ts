import { ProviderIdentity, ProviderConfiguration, ProviderMetrics, ProviderCosts, ProviderSecurity } from '../../../domain/entities';

export interface ProviderDocument {
  _id?: string;
  identity: ProviderIdentity;
  configuration: ProviderConfiguration;
  metrics: ProviderMetrics;
  costs: ProviderCosts;
  security: ProviderSecurity;
  createdAt: Date;
  updatedAt: Date;
}

export const ProviderCollectionName = 'providers';

export const ProviderIndexes = [
  { key: { 'identity.id': 1 }, unique: true },
  { key: { 'identity.name': 1 }, unique: true },
  { key: { 'configuration.isActive': 1 } },
  { key: { 'configuration.priority': 1 } },
  { key: { 'configuration.supportedModels': 1 } },
  { key: { 'metrics.healthStatus': 1 } },
  { key: { 'metrics.lastUsedAt': 1 } },
  { key: { createdAt: 1 } }
];