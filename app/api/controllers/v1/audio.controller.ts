import { t } from 'elysia';
import { injectable } from 'inversify';
import { TYPES } from '../../../core/container/types';
import type { AudioService } from '../../../application/services';
import type { SpeechRequest, AudioTranscriptionRequest } from '../../../application/types';
import { BaseController, type RequestContext, type ControllerConfiguration } from '../base.controller';

const TranscriptionRequestSchema = t.Object({
  file: t.File(),
  model: t.String(),
  language: t.Optional(t.String()),
  prompt: t.Optional(t.String()),
  response_format: t.Optional(t.Union([
    t.Literal('json'),
    t.Literal('text'),
    t.Literal('srt'),
    t.Literal('verbose_json'),
    t.Literal('vtt')
  ])),
  temperature: t.Optional(t.Number())
});

const SpeechRequestSchema = t.Object({
  model: t.String(),
  input: t.String(),
  voice: t.Union([
    t.Literal('alloy'),
    t.Literal('echo'),
    t.Literal('fable'),
    t.Literal('onyx'),
    t.Literal('nova'),
    t.Literal('shimmer')
  ]),
  response_format: t.Optional(t.Union([
    t.Literal('mp3'),
    t.Literal('opus'),
    t.Literal('aac'),
    t.Literal('flac')
  ])),
  speed: t.Optional(t.Number())
});

@injectable()
export class AudioController extends BaseController {
  private readonly audioService: AudioService;

  constructor() {
    const configuration: ControllerConfiguration = {
      prefix: '/v1/audio',
      enableAuth: true,
      enableMetrics: true,
      enableErrorHandling: true,
      rateLimitConfig: {
        maxRequests: 50,
        windowMs: 60000
      }
    };

    super(configuration);
    this.audioService = this.getService<AudioService>(TYPES.AudioService);
  }

  public registerRoutes() {
    return this.createApplication()
      .post('/transcriptions', async (context) => {
        return await this.executeWithContext(
          'create_transcription',
          context,
          async (requestContext: RequestContext) => {
            const request = this.validateAndParseTranscriptionRequest(context.body);

            this.logTranscriptionRequestDetails(request, requestContext);

            const transcription = await this.audioService.audioTranscription(
              request, 
              requestContext.user, 
              'transcriptions'
            );

            this.logger.info('Audio transcription completed successfully', {
              requestId: requestContext.requestId,
              userId: requestContext.user.id,
              metadata: {
                model: request.model,
                textLength: transcription.text?.length || 0
              }
            });

            return this.createSuccessResponse(transcription, requestContext);
          }
        );
      }, {
        body: TranscriptionRequestSchema
      })
      .post('/translations', async (context) => {
        return await this.executeWithContext(
          'create_translation',
          context,
          async (requestContext: RequestContext) => {
            const request = this.validateAndParseTranscriptionRequest(context.body);

            this.logTranscriptionRequestDetails(request, requestContext, 'translation');

            const translation = await this.audioService.audioTranscription(
              request, 
              requestContext.user, 
              'translations'
            );

            this.logger.info('Audio translation completed successfully', {
              requestId: requestContext.requestId,
              userId: requestContext.user.id,
              metadata: {
                model: request.model,
                textLength: translation.text?.length || 0
              }
            });

            return this.createSuccessResponse(translation, requestContext);
          }
        );
      }, {
        body: TranscriptionRequestSchema
      })
      .post('/speech', async (context) => {
        return await this.executeWithContext(
          'create_speech',
          context,
          async (requestContext: RequestContext) => {
            const request = this.validateAndParseSpeechRequest(context.body);

            this.logSpeechRequestDetails(request, requestContext);

            const audioBuffer = await this.audioService.textToSpeech(request, requestContext.user);

            this.logger.info('Speech synthesis completed successfully', {
              requestId: requestContext.requestId,
              userId: requestContext.user.id,
              metadata: {
                model: request.model,
                voice: request.voice,
                outputSize: audioBuffer.byteLength
              }
            });

            return new Response(audioBuffer, {
              headers: {
                'Content-Type': 'audio/mpeg',
                'Content-Length': audioBuffer.byteLength.toString(),
                'X-Request-ID': requestContext.requestId
              }
            });
          }
        );
      }, {
        body: SpeechRequestSchema
      });
  }

  private validateAndParseTranscriptionRequest(body: any): AudioTranscriptionRequest {
    try {
      return this.validateRequestPayload<AudioTranscriptionRequest>(
        body,
        this.isTranscriptionRequest
      );
    } catch (error) {
      this.logger.warn('Invalid transcription request payload', {
        metadata: {
          error: (error as Error).message,
          payloadKeys: Object.keys(body || {})
        }
      });
      throw new Error('Invalid transcription request format');
    }
  }

  private validateAndParseSpeechRequest(body: any): SpeechRequest {
    try {
      return this.validateRequestPayload<SpeechRequest>(
        body,
        this.isSpeechRequest
      );
    } catch (error) {
      this.logger.warn('Invalid speech request payload', {
        metadata: {
          error: (error as Error).message,
          payloadKeys: Object.keys(body || {})
        }
      });
      throw new Error('Invalid speech request format');
    }
  }

  private isTranscriptionRequest(data: any): data is AudioTranscriptionRequest {
    return (
      typeof data === 'object' &&
      data !== null &&
      typeof data.model === 'string' &&
      data.file &&
      typeof data.file === 'object'
    );
  }

  private isSpeechRequest(data: any): data is SpeechRequest {
    return (
      typeof data === 'object' &&
      data !== null &&
      typeof data.model === 'string' &&
      typeof data.input === 'string' &&
      typeof data.voice === 'string'
    );
  }

  private logTranscriptionRequestDetails(
    request: AudioTranscriptionRequest, 
    context: RequestContext,
    type: string = 'transcription'
  ): void {
    this.logger.debug(`Audio ${type} request details`, {
      requestId: context.requestId,
      userId: context.user.id,
      metadata: {
        model: request.model,
        language: request.language,
        fileSize: request.file.size,
        responseFormat: request.response_format,
        temperature: request.temperature
      }
    });
  }

  private logSpeechRequestDetails(request: SpeechRequest, context: RequestContext): void {
    this.logger.debug('Speech synthesis request details', {
      requestId: context.requestId,
      userId: context.user.id,
      metadata: {
        model: request.model,
        voice: request.voice,
        inputLength: request.input.length,
        responseFormat: request.response_format,
        speed: request.speed
      }
    });
  }
}

export const audioController = new AudioController().registerRoutes();