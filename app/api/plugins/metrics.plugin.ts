import { Elysia } from 'elysia';
import { container, TYPES } from '../../core/container';
import type { MetricsService } from '../../core/metrics';

export class MetricsPlugin {
  private readonly pluginName = 'metrics';

  createPlugin() {
    return new Elysia({ name: this.pluginName })
      .decorate('container', container)
      .derive(() => {
        return { startTime: Date.now() };
      })
      .onAfterResponse(({ request, response, startTime, container }) => {
        this.recordHttpMetrics(request, response as Response, startTime, container);
      })
      .onError(({ request, error, container }) => {
        this.recordErrorMetrics(request, error, container);
      });
  }

  private recordHttpMetrics(request: Request, response: Response, startTime: number, container: any): void {
    try {
      const metricsService = container.get(TYPES.MetricsService) as MetricsService;
      const duration = Date.now() - (startTime || Date.now());
      const path = this.extractPathFromRequest(request);
      const status = response.status || 200;
      
      metricsService.recordHttpRequest(request.method, path, status, duration);
    } catch {}
  }

  private recordErrorMetrics(request: Request, error: unknown, container: any): void {
    try {
      const metricsService = container.get(TYPES.MetricsService) as MetricsService;
      const path = this.extractPathFromRequest(request);
      const errorType = this.getErrorType(error);
      
      metricsService.recordError(errorType, path);
    } catch {}
  }

  private extractPathFromRequest(request: Request): string {
    try {
      return new URL(request.url).pathname;
    } catch {
      return '/unknown';
    }
  }

  private getErrorType(error: unknown): string {
    if (error instanceof Error) {
      return error.constructor.name;
    }
    return 'UnknownError';
  }
}

export const metricsPlugin = new MetricsPlugin().createPlugin();