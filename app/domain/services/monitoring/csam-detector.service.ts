import { injectable, inject } from 'inversify';
import { TYPES } from '../../../core/container';
import type { ILogger } from '../../../core/logging';
import type { UserService } from '../user';
import type { IDiscordWebhookService } from './discord-webhook.service';
import type { BaseProviderAdapter } from '../../../infrastructure/providers/base';
import type { MetricsService } from '../../../core/metrics';
import { OpenAIAdapter } from '../../../infrastructure/providers/adapters';
import type {
  ModerationRequest,
  ModerationResponse,
  CSAMDetectionResult,
  ChatMessage
} from '../../../application/types';

export interface ICSAMDetectorService {
  updateApiKey(apiKey: string): void;
  checkText(text: string, adapter?: BaseProviderAdapter): Promise<CSAMDetectionResult>;
  checkMessages(messages: ChatMessage[], userId?: string, adapter?: BaseProviderAdapter): Promise<CSAMDetectionResult>;
  checkPrompt(prompt: string, userId?: string, adapter?: BaseProviderAdapter): Promise<CSAMDetectionResult>;
  checkGeneratedImage(image: string, userId?: string, adapter?: BaseProviderAdapter): Promise<CSAMDetectionResult>;
}

@injectable()
export class CSAMDetectorService implements ICSAMDetectorService {
  private openaiAdapter: OpenAIAdapter | null = null;
  private readonly maxScore: number = 0.85;

  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.UserService) private readonly userService: UserService,
    @inject(TYPES.DiscordWebhookService) private readonly discordWebhook: IDiscordWebhookService,
    @inject(TYPES.MetricsService) private readonly metricsService: MetricsService
  ) {
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (apiKey) {
        this.openaiAdapter = new OpenAIAdapter(apiKey, this.logger, this.metricsService);
      }
    } catch (error) {
      this.logger.error('Failed to initialize CSAM detector - THIS IS A SECURITY RISK', error as Error);
    }
  }

  updateApiKey(apiKey: string): void {
    try {
      if (apiKey && apiKey.trim()) {
        this.openaiAdapter = new OpenAIAdapter(apiKey, this.logger, this.metricsService);
        this.logger.info('CSAM detector API key updated');
      } else {
        this.logger.error('Cannot update CSAM detector with empty API key');
      }
    } catch (error) {
      this.logger.error('Failed to update CSAM detector API key', error as Error);
    }
  }

  private async disableUser(userId: string, reason: string, categories: string[], prompt?: string, score?: number): Promise<void> {
    try {
      await this.userService.updateUser(userId, { enabled: false });
      
      const timestamp = new Date().toISOString();
      
      this.logger.error('🚨 USER AUTOMATICALLY DISABLED FOR CSAM VIOLATION 🚨', undefined, {
        metadata: {
          userId,
          reason,
          categories,
          timestamp,
          action: 'ACCOUNT_DISABLED'
        }
      });

      await this.discordWebhook.sendModerationAlert({
        userId,
        reason,
        categories,
        prompt,
        score,
        timestamp,
        action: 'ACCOUNT_DISABLED'
      });
    } catch (error) {
      this.logger.error('Failed to disable user account after CSAM detection', error as Error, {
        metadata: {
          userId,
          reason,
          categories
        }
      });
    }
  }

  async checkText(text: string, adapter?: BaseProviderAdapter): Promise<CSAMDetectionResult> {
    const moderationAdapter = adapter || this.openaiAdapter;
    
    if (!moderationAdapter) {
      this.logger.warn('CSAM detection unavailable - allowing content to proceed', {
        metadata: {
          hasAdapter: !!adapter,
          hasDefaultAdapter: !!this.openaiAdapter
        }
      });
      return {
        isFlagged: false,
        categories: [],
        reason: 'CSAM detection service unavailable'
      };
    }

    const maxRetries = 5;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const request: ModerationRequest = {
          input: text,
          model: 'omni-moderation-latest'
        };

        const response = await moderationAdapter.moderateContent(request);
        const result = this.parseResponse(response);
        
        return result;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`CSAM text detection attempt ${attempt} failed`, {
          metadata: {
            attempt,
            maxRetries,
            error: lastError.message
          }
        });

        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }

    this.logger.error('CSAM text detection failed after all retries - allowing content to proceed', lastError!, {
      metadata: {
        message: 'API failure should not block legitimate users'
      }
    });

    return {
      isFlagged: false,
      categories: [],
      reason: 'CSAM detection service failed - allowing content to proceed'
    };
  }

  async checkMessages(messages: ChatMessage[], userId?: string, adapter?: BaseProviderAdapter): Promise<CSAMDetectionResult> {
    try {
      const fullConversationText = this.extractTextFromMessages(messages);
      const fullResult = await this.checkText(fullConversationText, adapter);

      if (!fullResult.isFlagged) {
        return fullResult;
      }

      const result: CSAMDetectionResult = {
        ...fullResult,
        granularAnalysis: {
          analysisComplete: false
        }
      };

      this.logger.error('🚨 FULL CONVERSATION FLAGGED FOR CSAM - STARTING GRANULAR ANALYSIS 🚨', undefined, {
        metadata: {
          categories: fullResult.categories,
          reason: fullResult.reason,
          userId,
          messageCount: messages.length,
          timestamp: new Date().toISOString()
        }
      });

      if (userId) {
        const conversationText = this.extractTextFromMessages(messages);
        await this.disableUser(userId, 'CSAM threshold exceeded in chat messages', fullResult.categories, conversationText, fullResult.score);
        result.userDisabled = true;
      }

      this.performGranularAnalysis(messages, userId, result, adapter).catch(error => {
        this.logger.error('Background granular analysis failed', error as Error, { 
          metadata: { userId } 
        });
      });

      return result;
    } catch (error) {
      this.logger.error('CSAM message detection failed', error as Error);
      return { isFlagged: false, categories: [], reason: 'Detection service unavailable' };
    }
  }

  async checkPrompt(prompt: string, userId?: string, adapter?: BaseProviderAdapter): Promise<CSAMDetectionResult> {
    try {
      const result = await this.checkText(prompt, adapter);

      if (!result.isFlagged) {
        return result;
      }

      this.logger.error('🚨 PROMPT FLAGGED FOR CSAM 🚨', undefined, {
        metadata: {
          categories: result.categories,
          reason: result.reason,
          userId,
          timestamp: new Date().toISOString()
        }
      });

      if (userId) {
        await this.disableUser(userId, 'CSAM threshold exceeded in prompt', result.categories, prompt, result.score);
        result.userDisabled = true;
      }

      return result;
    } catch (error) {
      this.logger.error('CSAM prompt detection failed', error as Error);
      return { isFlagged: false, categories: [], reason: 'Detection service unavailable' };
    }
  }

  private async performGranularAnalysis(
    messages: ChatMessage[],
    userId: string | undefined,
    result: CSAMDetectionResult,
    adapter?: BaseProviderAdapter
  ): Promise<void> {
    try {
      this.logger.info('Starting background granular CSAM analysis', { 
        metadata: {
          messageCount: messages.length, 
          userId 
        }
      });

      const flaggedMessages: NonNullable<CSAMDetectionResult['granularAnalysis']>['flaggedMessages'] = [];
      const flaggedSegments: NonNullable<CSAMDetectionResult['granularAnalysis']>['flaggedSegments'] = [];

      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        const messageText = this.extractTextFromMessage(message);
        
        if (!messageText.trim()) continue;

        try {
          const messageResult = await this.checkText(messageText, adapter);
          
          if (messageResult.isFlagged) {
            const maxScore = this.maxScore;
            
            flaggedMessages.push({
              messageIndex: i,
              role: message.role,
              categories: messageResult.categories,
              score: maxScore,
              flaggedText: this.truncateText(messageText, 200)
            });

            const segments = await this.findFlaggedSegments(messageText, i, adapter);
            flaggedSegments.push(...segments);

            this.logger.error('🔍 GRANULAR ANALYSIS: Message flagged', undefined, {
              metadata: {
                messageIndex: i,
                messageRole: message.role,
                categories: messageResult.categories,
                score: maxScore,
                userId,
                timestamp: new Date().toISOString()
              }
            });
          }
        } catch (error) {
          this.logger.warn('Failed to analyze individual message in granular analysis', {
            metadata: {
              messageIndex: i,
              error: (error as Error).message
            }
          });
        }

        await new Promise(resolve => setTimeout(resolve, 50));
      }

      if (result.granularAnalysis) {
        result.granularAnalysis.flaggedMessages = flaggedMessages;
        result.granularAnalysis.flaggedSegments = flaggedSegments;
        result.granularAnalysis.analysisComplete = true;
      }

      this.logger.error('🔍 GRANULAR ANALYSIS COMPLETE', undefined, {
        metadata: {
          flaggedMessageCount: flaggedMessages.length,
          flaggedSegmentCount: flaggedSegments.length,
          userId,
          timestamp: new Date().toISOString(),
          summary: flaggedMessages.map(m => ({
            index: m.messageIndex,
            role: m.role,
            categories: m.categories
          }))
        }
      });

    } catch (error) {
      this.logger.error('Granular analysis failed', error as Error, { 
        metadata: { userId } 
      });
      
      if (result.granularAnalysis) {
        result.granularAnalysis.analysisComplete = true;
      }
    }
  }

  private async findFlaggedSegments(text: string, messageIndex: number, adapter?: BaseProviderAdapter): Promise<Array<{
    text: string;
    messageIndex: number;
    startIndex: number;
    endIndex: number;
    score: number;
    categories: string[];
  }>> {
    const segments: Array<{
      text: string;
      messageIndex: number;
      startIndex: number;
      endIndex: number;
      score: number;
      categories: string[];
    }> = [];

    try {
      const sentences = this.splitIntoSentences(text);
      let currentIndex = 0;

      for (const sentence of sentences) {
        if (sentence.trim().length < 10) {
          currentIndex = text.indexOf(sentence, currentIndex) + sentence.length;
          continue;
        }

        try {
          const sentenceResult = await this.checkText(sentence.trim(), adapter);
          
          if (sentenceResult.isFlagged) {
            const startIndex = text.indexOf(sentence, currentIndex);
            
            segments.push({
              text: sentence.trim(),
              messageIndex,
              startIndex,
              endIndex: startIndex + sentence.length,
              score: this.maxScore,
              categories: sentenceResult.categories
            });
          }
          
          currentIndex = text.indexOf(sentence, currentIndex) + sentence.length;

          await new Promise(resolve => setTimeout(resolve, 25));
        } catch (error) {
          this.logger.warn('Failed to analyze sentence in granular analysis', {
            metadata: {
              error: (error as Error).message
            }
          });
        }
      }
    } catch (error) {
      this.logger.warn('Failed to analyze segments', { 
        metadata: { 
          error: (error as Error).message 
        } 
      });
    }

    return segments;
  }

  async checkGeneratedImage(image: string, userId?: string, adapter?: BaseProviderAdapter): Promise<CSAMDetectionResult> {
    const maxRetries = 5;
    let lastError: Error | null = null;

    const moderationAdapter = adapter || this.openaiAdapter;
    
    if (!moderationAdapter) {
      this.logger.warn('CSAM detection unavailable - allowing content to proceed', {
        metadata: {
          hasAdapter: !!adapter,
          hasDefaultAdapter: !!this.openaiAdapter
        }
      });
      return {
        isFlagged: false,
        categories: [],
        reason: 'CSAM detection service unavailable'
      };
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        let imageUrl: string;

        if (image.startsWith('http') || image.startsWith('data:')) {
          imageUrl = image;
        } else {
          imageUrl = `data:image/png;base64,${image}`;
        }

        const request: ModerationRequest = {
          input: [
            {
              type: 'image_url',
              image_url: { url: imageUrl }
            }
          ],
          model: 'omni-moderation-latest'
        };

        const response = await moderationAdapter.moderateContent(request);
        const result = this.parseResponse(response);
        
        this.logger.info('CSAM image detection completed', {
          metadata: {
            attempt,
            isFlagged: result.isFlagged,
            categories: result.categories,
            imageType: image.startsWith('data:') || !image.startsWith('http') ? 'base64' : 'url'
          }
        });
        
        if (result.isFlagged && userId) {
          await this.disableUser(userId, 'CSAM threshold exceeded in generated image', result.categories, 'Generated image content', result.score);
          result.userDisabled = true;
        }
        
        return result;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`CSAM image detection attempt ${attempt} failed`, {
          metadata: {
            attempt,
            maxRetries,
            error: lastError.message
          }
        });

        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }

    this.logger.error('CSAM generated image detection failed after all retries - allowing content to proceed', lastError!, {
      metadata: {
        message: 'API failure should not block legitimate users'
      }
    });
    return {
      isFlagged: false,
      categories: [],
      reason: 'CSAM detection service failed - allowing content to proceed'
    };
  }

  private extractTextFromMessage(message: ChatMessage): string {
    if (typeof message.content === 'string') {
      return message.content;
    }
    if (Array.isArray(message.content)) {
      return message.content
        .filter(part => part.type === 'text')
        .map(part => part.text || '')
        .join(' ');
    }
    return '';
  }

  private extractTextFromMessages(messages: ChatMessage[]): string {
    return messages
      .map(message => this.extractTextFromMessage(message))
      .filter(text => text.trim())
      .join(' ');
  }

  private parseResponse(response: ModerationResponse): CSAMDetectionResult {
    const result = response.results[0];
    if (!result) {
      return { isFlagged: false, categories: [] };
    }

    const csamScores = {
      'sexual/minors': result.category_scores['sexual/minors'] || 0,
      'sexual-minors': result.category_scores['sexual-minors'] || 0
    };

    const maxCSAMScore = Math.max(...Object.values(csamScores));
    const exceedsThreshold = maxCSAMScore >= this.maxScore;

    const flaggedCategories = Object.entries(result.categories)
      .filter(([_, flagged]) => flagged)
      .map(([category]) => category);

    const csamCategories = flaggedCategories.filter(category =>
      category.includes('child') ||
      category.includes('minor') ||
      category.includes('sexual/minors') ||
      category.includes('sexual-minors') ||
      category === 'sexual/minors' ||
      category === 'sexual-minors'
    );

    return {
      isFlagged: exceedsThreshold,
      categories: exceedsThreshold ? [...csamCategories, ...flaggedCategories.filter(cat => cat.includes('sexual') || cat.includes('minor'))] : [],
      reason: exceedsThreshold ? `Content flagged for potential CSAM (max score: ${maxCSAMScore.toFixed(4)}, threshold: ${this.maxScore})` : undefined,
      score: maxCSAMScore
    };
  }

  private splitIntoSentences(text: string): string[] {
    return text.split(/[.!?]+/).filter(sentence => sentence.trim().length > 0);
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }
}