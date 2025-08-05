import { ApplicationBootstrap } from './bootstrap';
import { ApplicationServer } from './server';

async function main(): Promise<void> {
  try {
    const bootstrap = new ApplicationBootstrap({
      environment: (process.env.NODE_ENV as any) || 'development',
      enableMetrics: process.env.ENABLE_METRICS !== 'false',
      enableTracing: process.env.ENABLE_TRACING === 'true',
      logLevel: (process.env.LOG_LEVEL as any) || 'info'
    });

    const server = new ApplicationServer(bootstrap);
    await server.start();

  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Unhandled error in main:', error);
    process.exit(1);
  });
}

export { main };