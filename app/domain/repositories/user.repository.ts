import { User } from '../entities';

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByApiKeyHash(keyHash: string): Promise<User | null>;
  findByName(name: string): Promise<User | null>;
  findAll(): Promise<User[]>;
  save(user: User): Promise<User>;
  update(id: string, updates: Partial<User>): Promise<User>;
  delete(id: string): Promise<void>;
  exists(id: string): Promise<boolean>;
  findByPlan(plan: string): Promise<User[]>;
  findActiveUsers(): Promise<User[]>;
  findUsersWithLowCredits(threshold: number): Promise<User[]>;
  updateCredits(id: string, credits: number): Promise<void>;
  incrementCredits(id: string, amount: number): Promise<void>;
  decrementCredits(id: string, amount: number): Promise<boolean>;
  resetCredits(id: string, newCredits: number): Promise<void>;
  findUsersNeedingCreditReset(): Promise<User[]>;
  countByPlan(): Promise<Record<string, number>>;
  getTotalCreditsUsed(): Promise<number>;
  getActiveUserCount(): Promise<number>;
}