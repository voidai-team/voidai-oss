export type EmbeddingInput = string | string[] | number[] | number[][];

export interface EmbeddingRequest {
  model: string;
  input: EmbeddingInput;
  encoding_format?: 'float' | 'base64';
  dimensions?: number;
}

export interface EmbeddingResponse {
  object: 'list';
  data: Array<{
    object: 'embedding';
    index: number;
    embedding: number[];
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}