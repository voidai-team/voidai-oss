export type ModerationInput = string | string[] | Array<{
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
  };
}>;

export interface ModerationRequest {
  input: ModerationInput;
  model: string;
}

export interface ModerationResponse {
  id: string;
  model: string;
  results: Array<{
    flagged: boolean;
    categories: Record<string, boolean>;
    category_scores: Record<string, number>;
  }>;
}

export interface CSAMDetectionResult {
  isFlagged: boolean;
  categories: string[];
  reason?: string;
  userDisabled?: boolean;
  score?: number;
  granularAnalysis?: {
    flaggedMessages?: Array<{
      messageIndex: number;
      role: string;
      categories: string[];
      score: number;
      flaggedText: string;
    }>;
    flaggedSegments?: Array<{
      text: string;
      messageIndex?: number;
      startIndex: number;
      endIndex: number;
      score: number;
      categories: string[];
    }>;
    analysisComplete: boolean;
  };
}

export interface ModerationAlert {
  userId: string;
  reason: string;
  categories: string[];
  prompt?: string;
  score?: number;
  timestamp: string;
  action: string;
}