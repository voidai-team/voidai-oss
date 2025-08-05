import { UserIdentity, UserAuthentication, UserAuthorization, UserUsage } from '../../../domain/entities';

export interface UserDocument {
  _id?: string;
  identity: UserIdentity;
  authentication: UserAuthentication;
  authorization: UserAuthorization;
  usage: UserUsage;
  createdAt: Date;
  updatedAt: Date;
}

export const UserCollectionName = 'users';

export const UserIndexes = [
  { key: { 'identity.id': 1 }, unique: true },
  { key: { 'authentication.apiKeyHashes': 1 } },
  { key: { 'identity.name': 1 } },
  { key: { 'authorization.plan': 1 } },
  { key: { 'authorization.enabled': 1 } },
  { key: { 'usage.lastRequestAt': 1 } },
  { key: { createdAt: 1 } }
];