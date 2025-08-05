import { SubProviderIdentity, SubProviderConfiguration, SubProviderMetrics, SubProviderLimits } from '../../../domain/entities';

export interface SubProviderDocument {
  _id?: string;
  identity: SubProviderIdentity;
  configuration: SubProviderConfiguration;
  metrics: SubProviderMetrics;
  limits: SubProviderLimits;
  createdAt: Date;
  updatedAt: Date;
}

export const SubProviderCollectionName = 'subProviders';

export const SubProviderIndexes = [
  { key: { 'identity.id': 1 }, unique: true },
  { key: { 'identity.providerId': 1 } },
  { key: { 'identity.name': 1 } },
  { key: { 'configuration.enabled': 1 } },
  { key: { 'configuration.priority': 1 } },
  { key: { 'metrics.healthScore': 1 } },
  { key: { 'metrics.circuitBreakerState': 1 } },
  { key: { 'metrics.lastUsedAt': 1 } },
  { key: { createdAt: 1 } }
];