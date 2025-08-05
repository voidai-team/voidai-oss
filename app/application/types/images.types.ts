export type ImageSize = '256x256' | '512x512' | '1024x1024' | '1536x1024' | '1024x1536' | 'auto';

export interface ImageGenerationRequest {
  model: string;
  prompt: string;
  n?: number;
  size?: ImageSize;
}

export interface ImageEditRequest {
  image: File;
  prompt: string;
  model: string;
  n?: number;
  size?: ImageSize;
  mask?: File;
}

export interface ImageResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
}