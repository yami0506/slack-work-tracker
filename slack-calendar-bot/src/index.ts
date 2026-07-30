import 'dotenv/config';
import { createApplication } from './app.js';
import { ConfigError, loadConfig } from './config/index.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const application = createApplication(config);
  await application.start();

  const shutdown = (signal: string): void => {
    application.logger.info('シャットダウンします', { signal });
    void application
      .stop()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    application.logger.error('未処理の Promise 拒否', { error: reason });
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(`起動に失敗しました: ${String(error)}\n`);
  process.exit(1);
});
