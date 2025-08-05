import { injectable } from 'inversify';
import { ModelInfo } from '../../../application/types';

@injectable()
export class ModelRegistryService {
  private models: Map<string, ModelInfo> = new Map();
  private initialized = false;

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    if (this.initialized) return;
    this.loadModels();
    this.initialized = true;
  }

  private loadModels(): void {
    const modelConfigs: ModelInfo[] = [
      {
        id: 'gpt-3.5-turbo',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.25,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'gpt-4o-mini',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.25,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'gpt-4o-mini-search-preview',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.25,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'gpt-4o',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 1.25,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'gpt-4o-search-preview',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 1.5,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'gpt-4.1-nano',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.1,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'gpt-4.1-mini',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.25,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'gpt-4.1',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.75,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'chatgpt-4o-latest',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 1.25,
        supportsStreaming: true,
        supportsToolCalling: false
      },
      {
        id: 'gpt-oss-20b',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.1,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'gpt-oss-120b',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.15,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'o1',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 5,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'o3-mini',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.25,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'o3',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.5,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'o4-mini',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.25,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'dall-e-3',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/images/generations'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 500,
        multiplier: 1.0,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'gpt-image-1',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/images/generations', '/v1/images/edits'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 2000,
        multiplier: 1.0,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'text-embedding-3-small',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/embeddings'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 50,
        multiplier: 1.0,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'text-embedding-3-large',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/embeddings'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 50,
        multiplier: 1.0,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'tts-1',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/audio/speech'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 75,
        multiplier: 1.0,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'tts-1-hd',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/audio/speech'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 150,
        multiplier: 1.0,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'gpt-4o-mini-tts',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/audio/speech'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 250,
        multiplier: 1.0,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'whisper-1',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/audio/transcriptions', '/v1/audio/translations'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 10,
        multiplier: 1.0,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'gpt-4o-mini-transcribe',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/audio/transcriptions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 20,
        multiplier: 1.0,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'gpt-4o-transcribe',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/audio/transcriptions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 50,
        multiplier: 1.0,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'omni-moderation-latest',
        object: 'model',
        ownedBy: 'openai',
        endpoints: ['/v1/moderations'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 0,
        multiplier: 1.0,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'claude-3-haiku-20240307',
        object: 'model',
        ownedBy: 'anthropic',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 1,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'claude-3-opus-20240229',
        object: 'model',
        ownedBy: 'anthropic',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 3.5,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'claude-3-5-sonnet-20240620',
        object: 'model',
        ownedBy: 'anthropic',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 3.5,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'claude-3-5-haiku-20241022',
        object: 'model',
        ownedBy: 'anthropic',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 1,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        object: 'model',
        ownedBy: 'anthropic',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 3.5,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'claude-3-7-sonnet-20250219',
        object: 'model',
        ownedBy: 'anthropic',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 3.5,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'claude-sonnet-4-20250514',
        object: 'model',
        ownedBy: 'anthropic',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 3.5,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'claude-opus-4-20250514',
        object: 'model',
        ownedBy: 'anthropic',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 7.5,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'gemini-1.5-flash',
        object: 'model',
        ownedBy: 'google',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.75,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'gemini-1.5-pro',
        object: 'model',
        ownedBy: 'google',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 1.5,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'gemini-2.0-flash',
        object: 'model',
        ownedBy: 'google',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.75,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'gemini-2.5-flash-lite-preview-06-17',
        object: 'model',
        ownedBy: 'google',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.5,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'gemini-2.5-flash',
        object: 'model',
        ownedBy: 'google',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.75,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'gemini-2.5-pro',
        object: 'model',
        ownedBy: 'google',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 2.5,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'grok-2',
        object: 'model',
        ownedBy: 'x-ai',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.25,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'grok-2-vision',
        object: 'model',
        ownedBy: 'x-ai',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.25,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'grok-2-image',
        object: 'model',
        ownedBy: 'x-ai',
        endpoints: ['/v1/images/generations'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 500,
        multiplier: 1,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'grok-3',
        object: 'model',
        ownedBy: 'x-ai',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.75,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'grok-3-mini',
        object: 'model',
        ownedBy: 'x-ai',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.25,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'grok-3-mini-fast',
        object: 'model',
        ownedBy: 'x-ai',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 1,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'grok-3-fast',
        object: 'model',
        ownedBy: 'x-ai',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 1.5,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'grok-4',
        object: 'model',
        ownedBy: 'x-ai',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 1.75,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'magistral-medium-latest',
        object: 'model',
        ownedBy: 'mistral',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.25,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'magistral-small-latest',
        object: 'model',
        ownedBy: 'mistral',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.25,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'mistral-large-latest',
        object: 'model',
        ownedBy: 'mistral',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.25,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'mistral-medium-latest',
        object: 'model',
        ownedBy: 'mistral',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.25,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'mistral-small-latest',
        object: 'model',
        ownedBy: 'mistral',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.25,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'ministral-3b-latest',
        object: 'model',
        ownedBy: 'mistral',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.25,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'ministral-8b-latest',
        object: 'model',
        ownedBy: 'mistral',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.25,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'mistral-moderation-latest',
        object: 'model',
        ownedBy: 'mistral',
        endpoints: ['/v1/moderations'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 0,
        multiplier: 1,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'sonar',
        object: 'model',
        ownedBy: 'perplexity',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.1,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'sonar-pro',
        object: 'model',
        ownedBy: 'perplexity',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.25,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'sonar-reasoning',
        object: 'model',
        ownedBy: 'perplexity',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.25,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'sonar-reasoning-pro',
        object: 'model',
        ownedBy: 'perplexity',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.5,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'sonar-deep-research',
        object: 'model',
        ownedBy: 'perplexity',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.5,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'r1-1776',
        object: 'model',
        ownedBy: 'perplexity',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.5,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'llama-4-scout-17b-16e-instruct',
        object: 'model',
        ownedBy: 'meta',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.1,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'llama-4-maverick-17b-128e-instruct',
        object: 'model',
        ownedBy: 'meta',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.1,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'deepseek-v3',
        object: 'model',
        ownedBy: 'deepseek',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.5,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'deepseek-r1',
        object: 'model',
        ownedBy: 'deepseek',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.75,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'qwq-32b',
        object: 'model',
        ownedBy: 'qwen',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.1,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'qwen3-235b-a22b-instruct',
        object: 'model',
        ownedBy: 'qwen',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.1,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'qwen3-coder-480b-a35b-instruct',
        object: 'model',
        ownedBy: 'qwen',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.1,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'kimi-k2-instruct',
        object: 'model',
        ownedBy: 'moonshot',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.1,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'gemma-3n-e4b-it',
        object: 'model',
        ownedBy: 'google',
        endpoints: ['/v1/chat/completions'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'per_token',
        baseCost: 0,
        multiplier: 0.1,
        supportsStreaming: true,
        supportsToolCalling: true
      },
      {
        id: 'flux-schnell',
        object: 'model',
        ownedBy: 'black-forest-labs',
        endpoints: ['/v1/images/generations'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 75,
        multiplier: 1.0,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'flux-dev',
        object: 'model',
        ownedBy: 'black-forest-labs',
        endpoints: ['/v1/images/generations'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 150,
        multiplier: 1.0,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'flux-pro',
        object: 'model',
        ownedBy: 'black-forest-labs',
        endpoints: ['/v1/images/generations'],
        planRequirements: ['free', 'basic', 'premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 250,
        multiplier: 1.0,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'flux-1.1-pro',
        object: 'model',
        ownedBy: 'black-forest-labs',
        endpoints: ['/v1/images/generations'],
        planRequirements: ['basic', 'premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 1000,
        multiplier: 1.0,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'flux-1.1-pro-ultra',
        object: 'model',
        ownedBy: 'black-forest-labs',
        endpoints: ['/v1/images/generations'],
        planRequirements: ['premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 2000,
        multiplier: 1.0,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'flux-kontext-pro',
        object: 'model',
        ownedBy: 'black-forest-labs',
        endpoints: ['/v1/images/generations'],
        planRequirements: ['premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 3000,
        multiplier: 1.0,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'flux-kontext-max',
        object: 'model',
        ownedBy: 'black-forest-labs',
        endpoints: ['/v1/images/generations'],
        planRequirements: ['premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 3000,
        multiplier: 1.0,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'midjourney',
        object: 'model',
        ownedBy: 'midjourney',
        endpoints: ['/v1/images/generations'],
        planRequirements: ['enterprise'],
        costType: 'fixed',
        baseCost: 75000,
        multiplier: 1.0,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'imagen-3.0-generate-002',
        object: 'model',
        ownedBy: 'google',
        endpoints: ['/v1/images/generations'],
        planRequirements: ['basic', 'premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 2500,
        multiplier: 1.0,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'imagen-4.0-generate-preview-06-06',
        object: 'model',
        ownedBy: 'google',
        endpoints: ['/v1/images/generations'],
        planRequirements: ['premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 3500,
        multiplier: 1.0,
        supportsStreaming: false,
        supportsToolCalling: false
      },
      {
        id: 'recraft-v3',
        object: 'model',
        ownedBy: 'recraft',
        endpoints: ['/v1/images/generations'],
        planRequirements: ['premium', 'enterprise'],
        costType: 'fixed',
        baseCost: 1000,
        multiplier: 1.0,
        supportsStreaming: false,
        supportsToolCalling: false
      }
    ];

    modelConfigs.forEach(config => {
      this.models.set(config.id, config);
    });
  }

  getById(id: string): ModelInfo | undefined {
    return this.models.get(id);
  }

  list(): ModelInfo[] {
    return Array.from(this.models.values());
  }

  supportsEndpoint(modelId: string, endpoint: string): boolean {
    const model = this.getById(modelId);
    return model ? model.endpoints.includes(endpoint) : false;
  }

  hasAccess(modelId: string, userPlan: string): boolean {
    const model = this.getById(modelId);
    return model ? model.planRequirements.includes(userPlan) : false;
  }

  getCost(modelId: string): number | 'per_token' {
    const model = this.getById(modelId);
    if (!model) return 0;
    return model.costType === 'per_token' ? 'per_token' : model.baseCost;
  }

  getMultiplier(modelId: string): number {
    const model = this.getById(modelId);
    return model ? model.multiplier : 1.0;
  }

  calculateCredits(modelId: string, tokensUsed: number): number {
    const model = this.getById(modelId);
    return model ? tokensUsed * model.multiplier : 0;
  }

  getByProvider(provider: string): ModelInfo[] {
    return this.list().filter(model => model.ownedBy === provider);
  }

  getByEndpoint(endpoint: string): ModelInfo[] {
    return this.list().filter(model => model.endpoints.includes(endpoint));
  }
}
