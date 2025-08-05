import { injectable, inject } from 'inversify';
import type { ILogger } from '../logging';
import { TYPES } from '../container';
import type {
  IMetricsCollector,
  MetricLabels,
  SystemMetrics,
  ApplicationMetrics
} from './types';

export interface IMetricsService {
  recordHttpRequest(method: string, route: string, statusCode: number, duration: number): void;
  recordQueueJob(queue: string, status: 'completed' | 'failed', duration?: number): void;
  updateActiveConnections(count: number): void;
  updateQueueSize(queue: string, size: number): void;
  recordError(type: string, operation?: string): void;
  updateProviderMetrics(providerId: string, metrics: {
    p50Latency: number;
    p95Latency: number;
    p99Latency: number;
    consecutiveErrors: number;
    healthStatus: 'healthy' | 'degraded' | 'unhealthy';
  }): void;
  recordProviderRequest(providerId: string, status: 'success' | 'error', tokensUsed?: number): void;
  getSystemMetrics(): SystemMetrics;
  getApplicationMetrics(): Promise<ApplicationMetrics>;
  getMetricsEndpoint(): Promise<string>;
  startPeriodicCollection(): void;
  stopPeriodicCollection(): void;
}

@injectable()
export class MetricsService implements IMetricsService {
  private readonly logger: ILogger;
  private readonly collector: IMetricsCollector;
  private periodicCollectionInterval?: NodeJS.Timeout;
  private readonly collectionIntervalMs = 30000;

  constructor(
    @inject(TYPES.Logger) logger: ILogger,
    @inject(TYPES.MetricsCollector) collector: IMetricsCollector
  ) {
    this.logger = logger.createChild('MetricsService');
    this.collector = collector;
  }

  recordHttpRequest(method: string, route: string, statusCode: number, duration: number): void {
    try {
      const labels: MetricLabels = {
        method: method.toUpperCase(),
        route,
        status_code: statusCode.toString()
      };

      this.collector.incrementCounter('http_requests_total', labels);
      this.collector.observeHistogram('http_request_duration_seconds', duration / 1000, labels);

      this.logger.debug('HTTP request metrics recorded', {
        metadata: { method, route, statusCode, duration }
      });
    } catch (error) {
      this.logger.error('Failed to record HTTP request metrics', error as Error, {
        metadata: { method, route, statusCode, duration }
      });
    }
  }

  recordQueueJob(queue: string, status: 'completed' | 'failed', duration?: number): void {
    try {
      const labels: MetricLabels = { queue, status };

      this.collector.incrementCounter('queue_jobs_total', labels);

      if (duration !== undefined) {
        this.collector.observeHistogram('queue_job_duration_seconds', duration / 1000, { queue });
      }

      this.logger.debug('Queue job metrics recorded', {
        metadata: { queue, status, duration }
      });
    } catch (error) {
      this.logger.error('Failed to record queue job metrics', error as Error, {
        metadata: { queue, status, duration }
      });
    }
  }

  updateActiveConnections(count: number): void {
    try {
      this.collector.setGauge('active_connections', count);

      this.logger.debug('Active connections updated', {
        metadata: { count }
      });
    } catch (error) {
      this.logger.error('Failed to update active connections', error as Error, {
        metadata: { count }
      });
    }
  }

  updateQueueSize(queue: string, size: number): void {
    try {
      this.collector.setGauge('queue_size', size, { queue });

      this.logger.debug('Queue size updated', {
        metadata: { queue, size }
      });
    } catch (error) {
      this.logger.error('Failed to update queue size', error as Error, {
        metadata: { queue, size }
      });
    }
  }

  recordError(type: string, operation?: string): void {
    try {
      const labels: MetricLabels = { error_type: type };
      
      if (operation) {
        labels.operation = operation;
      }

      this.collector.incrementCounter('errors_total', labels);

      this.logger.debug('Error metrics recorded', {
        metadata: { type, operation }
      });
    } catch (error) {
      this.logger.error('Failed to record error metrics', error as Error, {
        metadata: { type, operation }
      });
    }
  }

  updateProviderMetrics(providerId: string, metrics: {
    p50Latency: number;
    p95Latency: number;
    p99Latency: number;
    consecutiveErrors: number;
    healthStatus: 'healthy' | 'degraded' | 'unhealthy';
  }): void {
    try {
      const labels: MetricLabels = { provider: providerId };

      this.collector.setGauge('provider_latency_p50_milliseconds', metrics.p50Latency, labels);
      this.collector.setGauge('provider_latency_p95_milliseconds', metrics.p95Latency, labels);
      this.collector.setGauge('provider_latency_p99_milliseconds', metrics.p99Latency, labels);
      this.collector.setGauge('provider_consecutive_errors', metrics.consecutiveErrors, labels);

      const healthStatusValue = metrics.healthStatus === 'healthy' ? 2 :
                               metrics.healthStatus === 'degraded' ? 1 : 0;
      this.collector.setGauge('provider_health_status', healthStatusValue, labels);

      this.logger.debug('Provider metrics updated', {
        metadata: { providerId, ...metrics }
      });
    } catch (error) {
      this.logger.error('Failed to update provider metrics', error as Error, {
        metadata: { providerId, metrics }
      });
    }
  }

  recordProviderRequest(providerId: string, status: 'success' | 'error', tokensUsed?: number): void {
    try {
      const labels: MetricLabels = { provider: providerId, status };

      this.collector.incrementCounter('provider_requests_total', labels);

      if (tokensUsed && tokensUsed > 0) {
        this.collector.incrementCounter('provider_tokens_total', { provider: providerId }, tokensUsed);
      }

      this.logger.debug('Provider request recorded', {
        metadata: { providerId, status, tokensUsed }
      });
    } catch (error) {
      this.logger.error('Failed to record provider request', error as Error, {
        metadata: { providerId, status, tokensUsed }
      });
    }
  }

  getSystemMetrics(): SystemMetrics {
    try {
      const memoryUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      const metrics: SystemMetrics = {
        cpuUsage: (cpuUsage.user + cpuUsage.system) / 1000000,
        memoryUsage: {
          rss: memoryUsage.rss,
          heapTotal: memoryUsage.heapTotal,
          heapUsed: memoryUsage.heapUsed,
          external: memoryUsage.external
        },
        uptime: process.uptime(),
        eventLoopLag: this.measureEventLoopLag()
      };

      this.logger.debug('System metrics collected', {
        metadata: {
          cpuUsage: metrics.cpuUsage,
          memoryRss: metrics.memoryUsage.rss,
          uptime: metrics.uptime,
          eventLoopLag: metrics.eventLoopLag
        }
      });

      return metrics;
    } catch (error) {
      this.logger.error('Failed to get system metrics', error as Error);
      
      return {
        cpuUsage: 0,
        memoryUsage: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0 },
        uptime: 0,
        eventLoopLag: 0
      };
    }
  }

  async getApplicationMetrics(): Promise<ApplicationMetrics> {
    try {
      const metrics: ApplicationMetrics = {
        requestsTotal: 0,
        requestDuration: 0,
        activeConnections: 0,
        errorRate: 0,
        queueSize: 0
      };

      this.logger.debug('Application metrics collected', {
        metadata: {
          requestsTotal: metrics.requestsTotal,
          requestDuration: metrics.requestDuration,
          activeConnections: metrics.activeConnections,
          errorRate: metrics.errorRate,
          queueSize: metrics.queueSize
        }
      });

      return metrics;
    } catch (error) {
      this.logger.error('Failed to get application metrics', error as Error);
      
      return {
        requestsTotal: 0,
        requestDuration: 0,
        activeConnections: 0,
        errorRate: 0,
        queueSize: 0
      };
    }
  }

  async getMetricsEndpoint(): Promise<string> {
    try {
      const metrics = await this.collector.getMetrics();
      
      this.logger.debug('Metrics endpoint data retrieved', {
        metadata: { metricsLength: metrics.length }
      });

      return metrics;
    } catch (error) {
      this.logger.error('Failed to get metrics endpoint data', error as Error);
      return '';
    }
  }

  startPeriodicCollection(): void {
    if (this.periodicCollectionInterval) {
      this.logger.warn('Periodic collection already started');
      return;
    }

    this.periodicCollectionInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, this.collectionIntervalMs);

    this.logger.info('Periodic metrics collection started', {
      metadata: { intervalMs: this.collectionIntervalMs }
    });
  }

  stopPeriodicCollection(): void {
    if (this.periodicCollectionInterval) {
      clearInterval(this.periodicCollectionInterval);
      this.periodicCollectionInterval = undefined;
      
      this.logger.info('Periodic metrics collection stopped');
    }
  }

  private collectSystemMetrics(): void {
    try {
      const systemMetrics = this.getSystemMetrics();
      
      this.collector.setGauge('system_cpu_usage', systemMetrics.cpuUsage);
      this.collector.setGauge('system_memory_rss_bytes', systemMetrics.memoryUsage.rss);
      this.collector.setGauge('system_memory_heap_total_bytes', systemMetrics.memoryUsage.heapTotal);
      this.collector.setGauge('system_memory_heap_used_bytes', systemMetrics.memoryUsage.heapUsed);
      this.collector.setGauge('system_memory_external_bytes', systemMetrics.memoryUsage.external);
      this.collector.setGauge('system_uptime_seconds', systemMetrics.uptime);
      this.collector.setGauge('system_event_loop_lag_seconds', systemMetrics.eventLoopLag);

      this.logger.debug('System metrics collected and recorded');
    } catch (error) {
      this.logger.error('Failed to collect system metrics', error as Error);
    }
  }

  private measureEventLoopLag(): number {
    const start = process.hrtime.bigint();
    setImmediate(() => {
      const lag = Number(process.hrtime.bigint() - start) / 1e9;
      this.collector.setGauge('nodejs_eventloop_lag_seconds', lag);
    });
    return 0;
  }
}