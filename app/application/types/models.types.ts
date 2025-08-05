export interface ModelListResponse {
  object: 'list';
  data: ModelInfo[];
}

export interface ModelInfo {
  id: string;
  object: 'model';
  ownedBy: string;
  endpoints: string[];
  planRequirements: string[];
  costType: 'fixed' | 'per_token';
  baseCost: number;
  multiplier: number;
  maxTokens?: number;
  supportsStreaming: boolean;
  supportsToolCalling: boolean;
}