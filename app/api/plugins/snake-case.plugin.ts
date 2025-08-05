import { Elysia } from 'elysia';
import { container } from '../../core/container';

export class SnakeCasePlugin {
  private readonly pluginName = 'snake-case';

  createPlugin() {
    return new Elysia({ name: this.pluginName })
      .decorate('container', container)
      .onAfterResponse(({ response }) => {
        this.transformResponse(response);
      });
  }

  private transformResponse(response: any): void {
    if (response && typeof response === 'object') {
      try {
        const transformedResponse = this.transformToSnakeCase(response);
        Object.assign(response, transformedResponse);
      } catch {}
    }
  }

  private transformToSnakeCase(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.transformToSnakeCase(item));
    }

    if (typeof obj === 'object' && obj.constructor === Object) {
      const transformed: any = {};
      
      for (const [key, value] of Object.entries(obj)) {
        const snakeKey = this.toSnakeCase(key);
        transformed[snakeKey] = this.transformToSnakeCase(value);
      }
      
      return transformed;
    }

    return obj;
  }

  private toSnakeCase(str: string): string {
    return str
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '')
      .replace(/_{2,}/g, '_');
  }
}

export const snakeCasePlugin = new SnakeCasePlugin().createPlugin();