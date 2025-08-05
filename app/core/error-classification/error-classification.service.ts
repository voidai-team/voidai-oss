import { injectable } from 'inversify';

export interface ErrorThresholdConfiguration {
  readonly maxConsecutiveErrors: number;
  readonly errorWindowSeconds: number;
  readonly criticalErrorPatterns: readonly string[];
  readonly excludedErrorPatterns: readonly string[];
  readonly retryableErrorPatterns: readonly string[];
  readonly nonRetryableErrorPatterns: readonly string[];
}

export interface ErrorClassificationResult {
  readonly isRetryable: boolean;
  readonly isCritical: boolean;
  readonly isExcluded: boolean;
  readonly shouldRecordFailure: boolean;
  readonly classification: 'retryable' | 'non-retryable' | 'critical' | 'excluded';
  readonly matchedPattern?: string;
}

@injectable()
export class ErrorClassificationService {
  private readonly configuration: ErrorThresholdConfiguration = {
    maxConsecutiveErrors: 10,
    errorWindowSeconds: 300,
    criticalErrorPatterns: [
      '401',
      '402', 
      '403',
      '428',
      'You exceeded your current quota',
      'balance is too low',
      'API Key not found',
      'API key not valid',
      'API key expired',
      'invalid API key',
      'invalid key',
      'hard limit'
    ],
    excludedErrorPatterns: [
      'unsupported_country_region_territory',
      'requiring a key',
      'User location',
      'Provider returned error',
      'Request not allowed',
      'organization must be verified',
      'Argument not supported on this model',
      'maximum allowed number of output tokens for',
      'This is not a chat model',
      'Unsupported parameter',
      'maximum context length',
      'Invalid model',
      'Unsupported value',
      'Invalid value for',
      'Unsupported file uri',
      'Model incompatible request argument',
      'must have non-empty content',
      'must be non-empty',
      'too large',
      'overloaded_error',
      'requires moderation',
      'Client specified an invalid argument',
      'must be a string',
      'The model is not supported',
      'Network error',
      'LLM provider is down',
      'could not complete assistant response',
      'moderation_blocked',
      'must contain non-whitespace',
      'model_not_found',
      'Content violates usage guidelines',
      'trailing whitespace',
      'Gateway Timeout',
      'prompt is too long'
    ],
    retryableErrorPatterns: [
      'timeout',
      'network error',
      'connection reset',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNREFUSED',
      '500',
      '502',
      '503',
      '504',
      'internal server error',
      'bad gateway',
      'service unavailable',
      'gateway timeout',
      'temporary failure',
      'rate limit',
      'too many requests',
      'overloaded',
      'capacity exceeded',
      'server overloaded'
    ],
    nonRetryableErrorPatterns: [
      'insufficient credits',
      'authorization failed',
      'model not found',
      'access denied',
      'invalid request',
      'content policy violation',
      'file too large',
      'unsupported format',
      'invalid api key',
      'quota exceeded',
      'plan expired',
      'account disabled',
      'malformed request',
      'validation error',
      'permission denied',
      'forbidden',
      'unauthorized',
      'bad request',
      '400',
      '401',
      '403',
      '404',
      '422'
    ]
  };

  classifyError(error: Error): ErrorClassificationResult {
    const errorMessage = error.message.toLowerCase();
    
    const criticalMatch = this.findMatchingPattern(errorMessage, this.configuration.criticalErrorPatterns);
    if (criticalMatch) {
      return {
        isRetryable: false,
        isCritical: true,
        isExcluded: false,
        shouldRecordFailure: true,
        classification: 'critical',
        matchedPattern: criticalMatch
      };
    }

    const excludedMatch = this.findMatchingPattern(errorMessage, this.configuration.excludedErrorPatterns);
    if (excludedMatch) {
      return {
        isRetryable: false,
        isCritical: false,
        isExcluded: true,
        shouldRecordFailure: false,
        classification: 'excluded',
        matchedPattern: excludedMatch
      };
    }

    const nonRetryableMatch = this.findMatchingPattern(errorMessage.toLowerCase(), this.configuration.nonRetryableErrorPatterns);
    if (nonRetryableMatch) {
      return {
        isRetryable: false,
        isCritical: false,
        isExcluded: false,
        shouldRecordFailure: true,
        classification: 'non-retryable',
        matchedPattern: nonRetryableMatch
      };
    }

    const retryableMatch = this.findMatchingPattern(errorMessage.toLowerCase(), this.configuration.retryableErrorPatterns);
    if (retryableMatch) {
      return {
        isRetryable: true,
        isCritical: false,
        isExcluded: false,
        shouldRecordFailure: true,
        classification: 'retryable',
        matchedPattern: retryableMatch
      };
    }

    return {
      isRetryable: false,
      isCritical: false,
      isExcluded: false,
      shouldRecordFailure: true,
      classification: 'non-retryable',
      matchedPattern: undefined
    };
  }

  isRetryableError(error: Error): boolean {
    return this.classifyError(error).isRetryable;
  }

  isCriticalError(error: Error): boolean {
    return this.classifyError(error).isCritical;
  }

  isExcludedError(error: Error): boolean {
    return this.classifyError(error).isExcluded;
  }

  shouldRecordFailure(error: Error): boolean {
    return this.classifyError(error).shouldRecordFailure;
  }

  getConfiguration(): ErrorThresholdConfiguration {
    return { ...this.configuration };
  }

  getMaxConsecutiveErrors(): number {
    return this.configuration.maxConsecutiveErrors;
  }

  getErrorWindowSeconds(): number {
    return this.configuration.errorWindowSeconds;
  }

  private findMatchingPattern(errorMessage: string, patterns: readonly string[]): string | undefined {
    return patterns.find(pattern => 
      errorMessage.includes(pattern)
    );
  }
}