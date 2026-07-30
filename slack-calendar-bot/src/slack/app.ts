import { App, ExpressReceiver, LogLevel } from '@slack/bolt';
import type { Express } from 'express';
import type { AppConfig } from '../config/index.js';

export interface SlackAppBundle {
  app: App;
  /** HTTP モードのときだけ存在する */
  receiver: ExpressReceiver | null;
}

/**
 * Slack アプリを生成する。
 *
 * - socket: ローカル開発用。外部公開 URL 不要。
 * - http  : 本番用。Events API を HTTP で受信し、Bolt が署名検証を行う。
 *
 * どちらのモードでも同じ Express アプリ（OAuth / ヘルスチェック）を共有する。
 */
export function createSlackApp(config: AppConfig, expressApp: Express): SlackAppBundle {
  const logLevel = toBoltLogLevel(config.LOG_LEVEL);

  if (config.SLACK_MODE === 'http') {
    const receiver = new ExpressReceiver({
      signingSecret: config.SLACK_SIGNING_SECRET,
      // Slack 署名検証は既定で有効。無効化しないこと。
      signatureVerification: true,
      endpoints: '/slack/events',
      app: expressApp,
    });

    const app = new App({
      token: config.SLACK_BOT_TOKEN,
      receiver,
      logLevel,
    });

    return { app, receiver };
  }

  const app = new App({
    token: config.SLACK_BOT_TOKEN,
    appToken: config.SLACK_APP_TOKEN,
    socketMode: true,
    logLevel,
  });

  return { app, receiver: null };
}

function toBoltLogLevel(level: AppConfig['LOG_LEVEL']): LogLevel {
  switch (level) {
    case 'debug':
      return LogLevel.DEBUG;
    case 'warn':
      return LogLevel.WARN;
    case 'error':
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO;
  }
}
