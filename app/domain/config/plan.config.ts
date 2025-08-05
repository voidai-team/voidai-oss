export type UserPlan = 'free' | 'basic' | 'premium' | 'enterprise';

export interface PlanConfiguration {
  readonly name: string;
  readonly credits: number;
  readonly resetInterval: 'daily' | 'weekly' | 'monthly';
  readonly maxConcurrentRequests: number;
}

export const PLAN_CONFIGS: Record<UserPlan, PlanConfiguration> = {
  free: {
    name: 'Free',
    credits: 1000,
    resetInterval: 'daily',
    maxConcurrentRequests: 2
  },
  basic: {
    name: 'Basic',
    credits: 10000,
    resetInterval: 'daily',
    maxConcurrentRequests: 5
  },
  premium: {
    name: 'Premium',
    credits: 50000,
    resetInterval: 'daily',
    maxConcurrentRequests: 10
  },
  enterprise: {
    name: 'Enterprise',
    credits: 500000,
    resetInterval: 'daily',
    maxConcurrentRequests: 50
  }
};