import express, { type Express } from 'express';
import { AiScheduleParser } from './ai/calendar-parser.js';
import { GeminiClient } from './ai/client.js';
import type { AppConfig } from './config/index.js';
import { createDatabaseClient } from './database/client.js';
import { OAuthStatesRepository } from './database/repositories/oauth-states.repository.js';
import { PendingEventsRepository } from './database/repositories/pending-events.repository.js';
import { ProcessedEventsRepository } from './database/repositories/processed-events.repository.js';
import { UsersRepository } from './database/repositories/users.repository.js';
import { GoogleAuthService } from './google/auth.js';
import { GoogleCalendarService } from './google/calendar.js';
import { registerOAuthRoutes } from './google/oauth-routes.js';
import { CalendarRegistrationService } from './services/calendar-registration.service.js';
import { ScheduleService } from './services/schedule.service.js';
import { registerConfirmActions } from './slack/actions/confirm.js';
import { createSlackApp } from './slack/app.js';
import { registerAppMentionHandler } from './slack/events/app-mention.js';
import { TokenCipher } from './utils/crypto.js';
import { createLogger, type Logger } from './utils/logger.js';

export interface Application {
  start(): Promise<void>;
  stop(): Promise<void>;
  logger: Logger;
}

/**
 * 依存関係の組み立て（コンポジションルート）。
 * ここ以外で new を呼ばないことで、テスト時の差し替えを容易にする。
 */
export function createApplication(config: AppConfig): Application {
  const logger = createLogger(config.LOG_LEVEL, { mode: config.SLACK_MODE });

  // --- インフラ層 ---
  const cipher = new TokenCipher(config.TOKEN_ENCRYPTION_KEY);
  const db = createDatabaseClient(config);

  const users = new UsersRepository(db, cipher);
  const pendingEvents = new PendingEventsRepository(db);
  const processedEvents = new ProcessedEventsRepository(db);
  const oauthStates = new OAuthStatesRepository(db);

  // --- 外部サービス ---
  const googleAuth = new GoogleAuthService(config, users, logger);
  const calendar = new GoogleCalendarService(logger);
  const parser = new AiScheduleParser(new GeminiClient(config), logger);

  // --- ユースケース ---
  const scheduleService = new ScheduleService(
    parser,
    users,
    pendingEvents,
    oauthStates,
    config,
    logger,
  );
  const registrationService = new CalendarRegistrationService(
    pendingEvents,
    googleAuth,
    calendar,
    scheduleService,
    logger,
  );

  // --- Web / Slack ---
  const expressApp: Express = express();
  const { app: slackApp } = createSlackApp(config, expressApp);

  registerOAuthRoutes(expressApp, {
    googleAuth,
    oauthStates,
    logger,
    slackClient: slackApp.client,
  });

  registerAppMentionHandler(slackApp, { scheduleService, processedEvents, logger });
  registerConfirmActions(slackApp, { registrationService, logger });

  slackApp.error(async (error) => {
    logger.error('Slack アプリで未捕捉のエラーが発生しました', { error });
  });

  let httpServer: ReturnType<Express['listen']> | null = null;

  return {
    logger,

    async start() {
      if (config.SLACK_MODE === 'http') {
        // ExpressReceiver が Express ごと起動する
        await slackApp.start(config.PORT);
        logger.info('HTTP モードで起動しました', {
          port: config.PORT,
          eventsUrl: `${config.APP_BASE_URL}/slack/events`,
        });
      } else {
        await slackApp.start();
        httpServer = expressApp.listen(config.PORT, () => {
          logger.info('OAuth 用 HTTP サーバーを起動しました', { port: config.PORT });
        });
        logger.info('Socket モードで起動しました');
      }
    },

    async stop() {
      await slackApp.stop().catch(() => undefined);
      if (httpServer) {
        await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
      }
    },
  };
}
