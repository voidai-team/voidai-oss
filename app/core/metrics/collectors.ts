import { injectable, inject } from 'inversify';
import { register, Counter, Gauge, Histogram, Summary, collectDefaultMetrics } from 'prom-client';
import type { ILogger } from '../logging';
import { TYPES } from '../container';
import {
  IMetricsCollector,
  MetricLabels,
  CounterMetric,
  GaugeMetric,
  HistogramMetric,
  SummaryMetric,
  MetricsConfig
} from './types';

@injectable()
export class PrometheusCollector implements IMetricsCollector {
  private readonly logger: ILogger;
  private readonly counters: Map<string, Counter<string>> = new Map();
  private readonly gauges: Map<string, Gauge<string>> = new Map();
  private readonly histograms: Map<string, Histogram<string>> = new Map();
  private readonly summaries: Map<string, Summary<string>> = new Map();
  private readonly config: MetricsConfig;

  constructor(@inject(TYPES.Logger) logger: ILogger) {
    this.logger = logger.createChild('PrometheusCollector');
    this.config = this.buildConfig();
    
    if (this.config.collectDefaultMetrics) {
      this.initializeDefaultMetrics();
    }
    
    this.initializeApplicationMetrics();
  }

  incrementCounter(name: string, labels?: MetricLabels, value: number = 1): void {
    try {
      const counter = this.getOrCreateCounter(name);
      
      if (labels) {
        counter.inc(labels, value);
      } else {
        counter.inc(value);
      }
      
      this.logger.debug('Counter incremented', {
        metadata: { name, labels, value }
      });
    } catch (error) {
      this.logger.error('Failed to increment counter', error as Error, {
        metadata: { name, labels, value }
      });
    }
  }

  setGauge(name: string, value: number, labels?: MetricLabels): void {
    try {
      const gauge = this.getOrCreateGauge(name);
      
      if (labels) {
        gauge.set(labels, value);
      } else {
        gauge.set(value);
      }
      
      this.logger.debug('Gauge set', {
        metadata: { name, labels, value }
      });
    } catch (error) {
      this.logger.error('Failed to set gauge', error as Error, {
        metadata: { name, labels, value }
      });
    }
  }

  observeHistogram(name: string, value: number, labels?: MetricLabels): void {
    try {
      const histogram = this.getOrCreateHistogram(name);
      
      if (labels) {
        histogram.observe(labels, value);
      } else {
        histogram.observe(value);
      }
      
      this.logger.debug('Histogram observed', {
        metadata: { name, labels, value }
      });
    } catch (error) {
      this.logger.error('Failed to observe histogram', error as Error, {
        metadata: { name, labels, value }
      });
    }
  }

  observeSummary(name: string, value: number, labels?: MetricLabels): void {
    try {
      const summary = this.getOrCreateSummary(name);
      
      if (labels) {
        summary.observe(labels, value);
      } else {
        summary.observe(value);
      }
      
      this.logger.debug('Summary observed', {
        metadata: { name, labels, value }
      });
    } catch (error) {
      this.logger.error('Failed to observe summary', error as Error, {
        metadata: { name, labels, value }
      });
    }
  }

  startTimer(name: string, labels?: MetricLabels): () => void {
    try {
      const histogram = this.getOrCreateHistogram(name);
      const endTimer = labels ? histogram.startTimer(labels) : histogram.startTimer();
      
      this.logger.debug('Timer started', {
        metadata: { name, labels }
      });
      
      return () => {
        const duration = endTimer();
        this.logger.debug('Timer ended', {
          metadata: { name, labels, duration }
        });
      };
    } catch (error) {
      this.logger.error('Failed to start timer', error as Error, {
        metadata: { name, labels }
      });
      
      return () => {};
    }
  }

  async getMetrics(): Promise<string> {
    try {
      const metrics = await register.metrics();
      
      this.logger.debug('Metrics collected', {
        metadata: { metricsLength: metrics.length }
      });
      
      return metrics;
    } catch (error) {
      this.logger.error('Failed to get metrics', error as Error);
      return '';
    }
  }

  reset(): void {
    try {
      register.clear();
      this.counters.clear();
      this.gauges.clear();
      this.histograms.clear();
      this.summaries.clear();
      
      this.logger.info('Metrics registry reset');
    } catch (error) {
      this.logger.error('Failed to reset metrics', error as Error);
    }
  }

  private buildConfig(): MetricsConfig {
    return {
      enabled: process.env.METRICS_ENABLED !== 'false',
      prefix: process.env.METRICS_PREFIX || 'app',
      defaultLabels: {
        service: process.env.SERVICE_NAME || 'voidai',
        version: process.env.SERVICE_VERSION || '1.0.0',
        environment: process.env.NODE_ENV || 'development'
      },
      collectDefaultMetrics: process.env.COLLECT_DEFAULT_METRICS !== 'false'
    };
  }

  private initializeDefaultMetrics(): void {
    collectDefaultMetrics({
      prefix: `${this.config.prefix}_`,
      gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
      eventLoopMonitoringPrecision: 10
    });
    
    this.logger.info('Default metrics collection initialized');
  }

  private initializeApplicationMetrics(): void {
    this.createCounter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labels: ['method', 'route', 'status_code']
    });

    this.createHistogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labels: ['method', 'route', 'status_code'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5]
    });

    this.createGauge({
      name: 'active_connections',
      help: 'Number of active connections'
    });

    this.createCounter({
      name: 'queue_jobs_total',
      help: 'Total number of queue jobs processed',
      labels: ['queue', 'status']
    });

    this.createGauge({
      name: 'queue_size',
      help: 'Current queue size',
      labels: ['queue']
    });

    this.createGauge({
      name: 'provider_latency_p50_milliseconds',
      help: 'Provider P50 latency in milliseconds',
      labels: ['provider']
    });

    this.createGauge({
      name: 'provider_latency_p95_milliseconds',
      help: 'Provider P95 latency in milliseconds',
      labels: ['provider']
    });

    this.createGauge({
      name: 'provider_latency_p99_milliseconds',
      help: 'Provider P99 latency in milliseconds',
      labels: ['provider']
    });

    this.createGauge({
      name: 'provider_consecutive_errors',
      help: 'Number of consecutive errors for provider',
      labels: ['provider']
    });

    this.createGauge({
      name: 'provider_health_status',
      help: 'Provider health status (0=unhealthy, 1=degraded, 2=healthy)',
      labels: ['provider']
    });

    this.createCounter({
      name: 'provider_requests_total',
      help: 'Total number of provider requests',
      labels: ['provider', 'status']
    });

    this.createCounter({
      name: 'provider_tokens_total',
      help: 'Total number of tokens processed by provider',
      labels: ['provider']
    });

    this.logger.info('Application metrics initialized');
  }

  private createCounter(config: CounterMetric): Counter<string> {
    const name = `${this.config.prefix}_${config.name}`;
    const counter = new Counter({
      name,
      help: config.help,
      labelNames: config.labels || [],
      registers: [register]
    });
    
    this.counters.set(config.name, counter);
    return counter;
  }

  private createGauge(config: GaugeMetric): Gauge<string> {
    const name = `${this.config.prefix}_${config.name}`;
    const gauge = new Gauge({
      name,
      help: config.help,
      labelNames: config.labels || [],
      registers: [register]
    });
    
    this.gauges.set(config.name, gauge);
    return gauge;
  }

  private createHistogram(config: HistogramMetric): Histogram<string> {
    const name = `${this.config.prefix}_${config.name}`;
    const histogram = new Histogram({
      name,
      help: config.help,
      labelNames: config.labels || [],
      buckets: config.buckets,
      registers: [register]
    });
    
    this.histograms.set(config.name, histogram);
    return histogram;
  }

  private createSummary(config: SummaryMetric): Summary<string> {
    const name = `${this.config.prefix}_${config.name}`;
    const summary = new Summary({
      name,
      help: config.help,
      labelNames: config.labels || [],
      percentiles: config.percentiles,
      registers: [register]
    });
    
    this.summaries.set(config.name, summary);
    return summary;
  }

  private getOrCreateCounter(name: string): Counter<string> {
    if (!this.counters.has(name)) {
      return this.createCounter({
        name,
        help: `Auto-generated counter: ${name}`
      });
    }
    return this.counters.get(name)!;
  }

  private getOrCreateGauge(name: string): Gauge<string> {
    if (!this.gauges.has(name)) {
      return this.createGauge({
        name,
        help: `Auto-generated gauge: ${name}`
      });
    }
    return this.gauges.get(name)!;
  }

  private getOrCreateHistogram(name: string): Histogram<string> {
    if (!this.histograms.has(name)) {
      return this.createHistogram({
        name,
        help: `Auto-generated histogram: ${name}`,
        buckets: [0.001, 0.01, 0.1, 1, 2, 5]
      });
    }
    return this.histograms.get(name)!;
  }

  private getOrCreateSummary(name: string): Summary<string> {
    if (!this.summaries.has(name)) {
      return this.createSummary({
        name,
        help: `Auto-generated summary: ${name}`
      });
    }
    return this.summaries.get(name)!;
  }
}