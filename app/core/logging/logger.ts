import { injectable } from 'inversify';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

export interface LogContext {
  requestId?: string;
  userId?: string;
  operation?: string;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export interface ILogger {
  error(message: string, error?: Error, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  createChild(namespace: string): ILogger;
}

@injectable()
export class Logger implements ILogger {
  private readonly logger: winston.Logger;
  private readonly namespace: string;

  constructor(namespace: string = 'Application') {
    this.namespace = namespace;
    this.logger = this.createLogger();
  }

  private createLogger(): winston.Logger {
    const logFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
      winston.format.printf(({ timestamp, level, message, namespace, context, stack, ...meta }) => {
        const logEntry: Record<string, any> = {
          timestamp,
          level,
          namespace: namespace || this.namespace,
          message
        };

        if (context) {
          logEntry.context = context;
        }

        if (stack) {
          logEntry.stack = stack;
        }

        if (Object.keys(meta).length > 0) {
          logEntry.meta = meta;
        }

        return JSON.stringify(logEntry);
      })
    );

    const transports: winston.transport[] = [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple(),
          winston.format.printf(({ timestamp, level, message, namespace }) => {
            return `${timestamp} [${level}] [${namespace || this.namespace}] ${message}`;
          })
        )
      }),
      new DailyRotateFile({
        filename: 'logs/application-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '14d',
        format: logFormat
      }),
      new DailyRotateFile({
        filename: 'logs/error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: '20m',
        maxFiles: '30d',
        format: logFormat
      })
    ];

    return winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: logFormat,
      transports,
      exitOnError: false
    });
  }

  error(message: string, error?: Error, context?: LogContext): void {
    const logData: Record<string, any> = {
      namespace: this.namespace
    };

    if (context) {
      logData.context = context;
    }

    if (error) {
      logData.error = {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
    }

    this.logger.error(message, logData);
  }

  warn(message: string, context?: LogContext): void {
    const logData: Record<string, any> = {
      namespace: this.namespace
    };

    if (context) {
      logData.context = context;
    }

    this.logger.warn(message, logData);
  }

  info(message: string, context?: LogContext): void {
    const logData: Record<string, any> = {
      namespace: this.namespace
    };

    if (context) {
      logData.context = context;
    }

    this.logger.info(message, logData);
  }

  debug(message: string, context?: LogContext): void {
    const logData: Record<string, any> = {
      namespace: this.namespace
    };

    if (context) {
      logData.context = context;
    }

    this.logger.debug(message, logData);
  }

  createChild(namespace: string): ILogger {
    return new Logger(`${this.namespace}:${namespace}`);
  }
}