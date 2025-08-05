import { RequestIdentity, RequestDetails, RequestMetrics, RequestStatus } from '../../../domain/entities';

export interface ApiRequestDocument {
  _id?: string;
  identity: RequestIdentity;
  details: RequestDetails;
  metrics: RequestMetrics;
  status: RequestStatus;
  createdAt: Date;
  updatedAt: Date;
}

export const ApiRequestCollectionName = 'apiRequests';

export const ApiRequestIndexes = [
  { key: { 'identity.id': 1 }, unique: true },
  { key: { 'identity.userId': 1 } },
  { key: { 'details.endpoint': 1 } },
  { key: { 'details.model': 1 } },
  { key: { 'details.providerId': 1 } },
  { key: { 'details.subProviderId': 1 } },
  { key: { 'status.status': 1 } },
  { key: { 'status.statusCode': 1 } },
  { key: { 'identity.createdAt': 1 } },
  { key: { 'status.completedAt': 1 } },
  { key: { 'metrics.latency': 1 } },
  { key: { 'metrics.tokensUsed': 1 } }
];