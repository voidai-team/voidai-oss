export interface MetricLabels {
  [key: string]: string | number;
}

export interface CounterMetric {
  name: string;
  help: string;
  labels?: string[];
}

export interface GaugeMetric {
  name: string;
  help: string;
  labels?: string[];
}

export interface HistogramMetric {
  name: string;
  help: string;
  labels?: string[];
  buckets?: number[];
}

export interface SummaryMetric {
  name: string;
  help: string;
  labels?: string[];
  percentiles?: number[];
}

export interface MetricsConfig {
  enabled: boolean;
  prefix: string;
  defaultLabels: MetricLabels;
  collectDefaultMetrics: boolean;
}

export interface SystemMetrics {
  cpuUsage: number;
  memoryUsage: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  uptime: number;
  eventLoopLag: number;
}

export interface ApplicationMetrics {
  requestsTotal: number;
  requestDuration: number;
  activeConnections: number;
  errorRate: number;
  queueSize: number;
}

export interface IMetricsCollector {
  incrementCounter(name: string, labels?: MetricLabels, value?: number): void;
  setGauge(name: string, value: number, labels?: MetricLabels): void;
  observeHistogram(name: string, value: number, labels?: MetricLabels): void;
  observeSummary(name: string, value: number, labels?: MetricLabels): void;
  startTimer(name: string, labels?: MetricLabels): () => void;
  getMetrics(): Promise<string>;
  reset(): void;
}