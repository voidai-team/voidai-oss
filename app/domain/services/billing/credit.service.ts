import { injectable, inject } from 'inversify';
import * as cron from 'node-cron';
import type { UserRepository } from '../../repositories';
import type { ILogger } from '../../../core/logging';
import { TYPES } from '../../../core/container';
import { PLAN_CONFIGS, type UserPlan } from '../../config';

export interface ICreditService {
  startCronJobs(): void;
  stopCronJobs(): void;
  resetCredits(): Promise<void>;
  resetUserCredits(userId: string): Promise<boolean>;
  consumeCredits(userId: string, amount: number): Promise<boolean>;
}

@injectable()
export class CreditService implements ICreditService {
  private readonly logger: ILogger;
  private readonly userRepository: UserRepository;
  private cronJob?: cron.ScheduledTask;

  constructor(
    @inject(TYPES.Logger) logger: ILogger,
    @inject(TYPES.UserRepository) userRepository: UserRepository
  ) {
    this.logger = logger.createChild('CreditService');
    this.userRepository = userRepository;
  }

  startCronJobs(): void {
    this.cronJob = cron.schedule('* * * * *', async () => {
      await this.resetCredits();
    }, { timezone: 'UTC' });

    this.cronJob.start();
    
    this.logger.info('Credit reset cron job started', {
      metadata: { schedule: '* * * * *' }
    });
  }

  stopCronJobs(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob.destroy();
      this.cronJob = undefined;
      
      this.logger.info('Credit reset cron job stopped');
    }
  }

  async resetCredits(): Promise<void> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const resetThreshold = now - 86400;

      const users = await this.userRepository.findActiveUsers();

      let resetCount = 0;
      for (const user of users) {
        if (user.getCreditsLastReset() <= resetThreshold) {
          const planConfig = PLAN_CONFIGS[user.getPlan() as UserPlan];
          if (planConfig) {
            const currentCredits = user.getCredits();
            const newCredits = currentCredits + planConfig.credits > planConfig.credits
              ? planConfig.credits
              : currentCredits + planConfig.credits;
            
            await this.userRepository.resetCredits(user.getId(), newCredits);
            resetCount++;
          }
        }
      }

      if (resetCount > 0) {
        this.logger.info('Credit reset completed', {
          metadata: { resetCount }
        });
      }
    } catch (error) {
      this.logger.error('Credit reset failed', error as Error);
      throw error;
    }
  }

  async resetUserCredits(userId: string): Promise<boolean> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const resetThreshold = now - 86400;

      const user = await this.userRepository.findById(userId);
      if (!user || !user.isEnabled() || user.getCreditsLastReset() > resetThreshold) {
        return false;
      }

      const planConfig = PLAN_CONFIGS[user.getPlan() as UserPlan];
      if (!planConfig) {
        return false;
      }

      const currentCredits = user.getCredits();
      const newCredits = currentCredits + planConfig.credits > planConfig.credits
        ? planConfig.credits
        : currentCredits + planConfig.credits;

      await this.userRepository.resetCredits(userId, newCredits);
      
      this.logger.debug('User credits reset', {
        metadata: { userId, newCredits }
      });
      
      return true;
    } catch (error) {
      this.logger.error('Failed to reset user credits', error as Error, {
        metadata: { userId }
      });
      throw error;
    }
  }

  async consumeCredits(userId: string, amount: number): Promise<boolean> {
    try {
      const success = await this.userRepository.decrementCredits(userId, amount);
      
      if (success) {
        this.logger.debug('Credits consumed', {
          metadata: { userId, amount }
        });
      } else {
        this.logger.warn('Insufficient credits for consumption', {
          metadata: { userId, amount }
        });
      }
      
      return success;
    } catch (error) {
      this.logger.error('Failed to consume credits', error as Error, {
        metadata: { userId, amount }
      });
      throw error;
    }
  }
}