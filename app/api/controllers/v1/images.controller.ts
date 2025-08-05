import { t } from 'elysia';
import { injectable } from 'inversify';
import { TYPES } from '../../../core/container/types';
import type { ImagesService } from '../../../application/services';
import type { ImageGenerationRequest, ImageEditRequest } from '../../../application/types';
import { BaseController, type RequestContext, type ControllerConfiguration } from '../base.controller';

const ImageGenerationRequestSchema = t.Object({
  model: t.Optional(t.String()),
  prompt: t.String(),
  n: t.Optional(t.Number()),
  quality: t.Optional(t.Union([t.Literal('standard'), t.Literal('hd')])),
  response_format: t.Optional(t.Union([t.Literal('url'), t.Literal('b64_json')])),
  size: t.Optional(t.Union([
    t.Literal('256x256'),
    t.Literal('512x512'),
    t.Literal('1024x1024'),
    t.Literal('1792x1024'),
    t.Literal('1024x1792')
  ])),
  style: t.Optional(t.Union([t.Literal('vivid'), t.Literal('natural')])),
  user: t.Optional(t.String())
});

const ImageEditRequestSchema = t.Object({
  image: t.File(),
  model: t.Optional(t.String()),
  prompt: t.String(),
  mask: t.Optional(t.File()),
  n: t.Optional(t.Number()),
  size: t.Optional(t.Union([
    t.Literal('256x256'),
    t.Literal('512x512'),
    t.Literal('1024x1024')
  ])),
  response_format: t.Optional(t.Union([t.Literal('url'), t.Literal('b64_json')])),
  user: t.Optional(t.String())
});

@injectable()
export class ImagesController extends BaseController {
  private readonly imagesService: ImagesService;

  constructor() {
    const configuration: ControllerConfiguration = {
      prefix: '/v1/images',
      enableAuth: true,
      enableMetrics: true,
      enableErrorHandling: true,
      rateLimitConfig: {
        maxRequests: 30,
        windowMs: 60000
      }
    };

    super(configuration);
    this.imagesService = this.getService<ImagesService>(TYPES.ImagesService);
  }

  public registerRoutes() {
    return this.createApplication()
      .post('/generations', async (context) => {
        return await this.executeWithContext(
          'generate_images',
          context,
          async (requestContext: RequestContext) => {
            const request = this.validateAndParseGenerationRequest(context.body);

            this.logGenerationRequestDetails(request, requestContext);

            const images = await this.imagesService.generateImages(request, requestContext.user);

            this.logger.info('Images generated successfully', {
              requestId: requestContext.requestId,
              userId: requestContext.user.id,
              metadata: {
                model: request.model,
                imageCount: images.data.length,
                size: request.size
              }
            });

            return this.createSuccessResponse(images, requestContext);
          }
        );
      }, {
        body: ImageGenerationRequestSchema
      })
      .post('/edits', async (context) => {
        return await this.executeWithContext(
          'edit_images',
          context,
          async (requestContext: RequestContext) => {
            const request = this.validateAndParseEditRequest(context.body);

            this.logEditRequestDetails(request, requestContext);

            const images = await this.imagesService.editImages(request, requestContext.user);

            this.logger.info('Images edited successfully', {
              requestId: requestContext.requestId,
              userId: requestContext.user.id,
              metadata: {
                model: request.model,
                imageCount: images.data.length,
                size: request.size,
                hasMask: !!request.mask
              }
            });

            return this.createSuccessResponse(images, requestContext);
          }
        );
      }, {
        body: ImageEditRequestSchema
      })
  }

  private validateAndParseGenerationRequest(body: any): ImageGenerationRequest {
    try {
      return this.validateRequestPayload<ImageGenerationRequest>(
        body,
        this.isImageGenerationRequest
      );
    } catch (error) {
      this.logger.warn('Invalid image generation request payload', {
        metadata: {
          error: (error as Error).message,
          payloadKeys: Object.keys(body || {})
        }
      });
      throw new Error('Invalid image generation request format');
    }
  }

  private validateAndParseEditRequest(body: any): ImageEditRequest {
    try {
      return this.validateRequestPayload<ImageEditRequest>(
        body,
        this.isImageEditRequest
      );
    } catch (error) {
      this.logger.warn('Invalid image edit request payload', {
        metadata: {
          error: (error as Error).message,
          payloadKeys: Object.keys(body || {})
        }
      });
      throw new Error('Invalid image edit request format');
    }
  }

  private isImageGenerationRequest(data: any): data is ImageGenerationRequest {
    return (
      typeof data === 'object' &&
      data !== null &&
      typeof data.prompt === 'string'
    );
  }

  private isImageEditRequest(data: any): data is ImageEditRequest {
    return (
      typeof data === 'object' &&
      data !== null &&
      typeof data.prompt === 'string' &&
      data.image &&
      typeof data.image === 'object'
    );
  }

  private logGenerationRequestDetails(request: ImageGenerationRequest, context: RequestContext): void {
    this.logger.debug('Image generation request details', {
      requestId: context.requestId,
      userId: context.user.id,
      metadata: {
        model: request.model,
        promptLength: request.prompt.length,
        imageCount: request.n || 1,
        size: request.size
      }
    });
  }

  private logEditRequestDetails(request: ImageEditRequest, context: RequestContext): void {
    this.logger.debug('Image edit request details', {
      requestId: context.requestId,
      userId: context.user.id,
      metadata: {
        model: request.model,
        promptLength: request.prompt.length,
        imageCount: request.n || 1,
        size: request.size,
        hasMask: !!request.mask
      }
    });
  }
}

export const imagesController = new ImagesController().registerRoutes();