import { injectable, inject } from 'inversify';
import { TYPES } from '../../../core/container/types';
import type { ILogger } from '../../../core/logging';
import { ModerationAlert } from '../../../application/types';

export interface IDiscordWebhookService {
  sendModerationAlert(alert: ModerationAlert): Promise<void>;
}

@injectable()
export class DiscordWebhookService implements IDiscordWebhookService {
  private readonly webhookUrl: string | undefined;

  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger
  ) {
    this.webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!this.webhookUrl) {
      this.logger.warn('Discord webhook URL not configured - moderation alerts will not be sent to Discord');
    }
  }

  async sendModerationAlert(alert: ModerationAlert): Promise<void> {
    if (!this.webhookUrl) {
      this.logger.warn('Cannot send Discord webhook - URL not configured');
      return;
    }

    try {
      const embed = {
        title: '🚨 Moderation Alert - User Disabled',
        color: 0xFF0000,
        fields: [
          {
            name: 'User ID',
            value: alert.userId,
            inline: true
          },
          {
            name: 'Action',
            value: alert.action,
            inline: true
          },
          {
            name: 'Reason',
            value: alert.reason,
            inline: false
          },
          {
            name: 'Categories',
            value: alert.categories.length > 0 ? alert.categories.join(', ') : 'None',
            inline: false
          },
          {
            name: 'Timestamp',
            value: alert.timestamp,
            inline: true
          }
        ],
        footer: {
          text: 'VoidAI Moderation System'
        }
      };

      if (alert.prompt) {
        embed.fields.push({
          name: 'Flagged Content',
          value: this.truncateText(alert.prompt, 1000),
          inline: false
        });
      }

      if (alert.score !== undefined) {
        embed.fields.push({
          name: 'Moderation Score',
          value: alert.score.toFixed(4),
          inline: true
        });
      }

      const payload = {
        embeds: [embed]
      };

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Discord webhook failed with status ${response.status}: ${response.statusText}`);
      }

      this.logger.info('Discord moderation alert sent successfully', {
        userId: alert.userId,
        metadata: {
          reason: alert.reason,
          categories: alert.categories
        }
      });

    } catch (error) {
      this.logger.error('Failed to send Discord moderation alert', error as Error, {
        userId: alert.userId,
        metadata: {
          reason: alert.reason,
          categories: alert.categories
        }
      });
    }
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }
}