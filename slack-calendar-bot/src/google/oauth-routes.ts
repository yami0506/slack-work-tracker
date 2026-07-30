import type { Express, Request, Response } from 'express';
import type { WebClient } from '@slack/web-api';
import type { OAuthStatesRepository } from '../database/repositories/oauth-states.repository.js';
import type { Logger } from '../utils/logger.js';
import type { GoogleAuthService } from './auth.js';

export interface OAuthRouteDeps {
  googleAuth: GoogleAuthService;
  oauthStates: OAuthStatesRepository;
  logger: Logger;
  /** 連携完了を Slack へ通知するためのクライアント（任意） */
  slackClient?: WebClient;
}

/**
 * Google OAuth のエンドポイントを登録する。
 *
 * - /oauth/google/start    : state を検証してから Google の同意画面へ送る
 * - /oauth/google/callback : state を消費し、Slack ユーザーと Google を紐付ける
 *
 * state は推測不能なランダム値で、DB 側で Slack User ID と対応付けられている。
 * URL に Slack User ID を載せないことで、他人へのなりすまし連携を防ぐ。
 */
export function registerOAuthRoutes(app: Express, deps: OAuthRouteDeps): void {
  const { googleAuth, oauthStates, logger } = deps;

  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/oauth/google/start', (req: Request, res: Response) => {
    void (async () => {
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      if (!state) {
        res.status(400).send(renderPage('リンクが不正です', 'Slack からもう一度お試しください。'));
        return;
      }

      try {
        const record = await oauthStates.peek(state);
        if (!record) {
          res
            .status(400)
            .send(
              renderPage(
                'リンクの有効期限が切れています',
                'Slack でもう一度メンションして、新しい連携リンクを取得してください。',
              ),
            );
          return;
        }

        res.redirect(googleAuth.generateAuthUrl(state));
      } catch (error) {
        logger.error('OAuth 開始処理に失敗しました', { error });
        res
          .status(500)
          .send(renderPage('連携を開始できませんでした', '時間をおいてお試しください。'));
      }
    })();
  });

  app.get('/oauth/google/callback', (req: Request, res: Response) => {
    void (async () => {
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const errorParam = typeof req.query.error === 'string' ? req.query.error : '';

      if (errorParam) {
        logger.warn('ユーザーが Google の連携を拒否しました', { reason: errorParam });
        res
          .status(400)
          .send(renderPage('連携がキャンセルされました', 'Slack からもう一度お試しください。'));
        return;
      }

      if (!code || !state) {
        res
          .status(400)
          .send(renderPage('リクエストが不正です', 'Slack からもう一度お試しください。'));
        return;
      }

      try {
        // state を 1 回だけ消費する（CSRF・リプレイ対策）
        const record = await oauthStates.consume(state);
        if (!record) {
          res
            .status(400)
            .send(
              renderPage(
                'リンクの有効期限が切れています',
                'Slack でもう一度メンションして、新しい連携リンクを取得してください。',
              ),
            );
          return;
        }

        const result = await googleAuth.exchangeCode(code);
        await googleAuth.linkAccount(record.slack_user_id, result);

        logger.info('Google アカウントを連携しました', {
          slackUserId: record.slack_user_id,
          googleUserId: result.googleUserId,
        });

        await notifySlack(
          deps,
          record.slack_user_id,
          record.slack_channel_id,
          record.slack_thread_ts,
        );

        res
          .status(200)
          .send(
            renderPage(
              'Googleカレンダーと連携しました',
              'Slack に戻って、もう一度メンションしてください。このタブは閉じて構いません。',
            ),
          );
      } catch (error) {
        logger.error('OAuth コールバック処理に失敗しました', { error });
        res
          .status(500)
          .send(renderPage('連携に失敗しました', 'Slack からもう一度お試しください。'));
      }
    })();
  });
}

async function notifySlack(
  deps: OAuthRouteDeps,
  slackUserId: string,
  channelId: string | null,
  threadTs: string | null,
): Promise<void> {
  if (!deps.slackClient || !channelId) return;
  try {
    await deps.slackClient.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs ?? undefined,
      text: `<@${slackUserId}> Googleカレンダーとの連携が完了しました。もう一度メンションしてください。`,
    });
  } catch (error) {
    deps.logger.warn('連携完了の Slack 通知に失敗しました', { error });
  }
}

/** ブラウザに返す簡易ページ（機微な情報は一切含めない） */
function renderPage(title: string, message: string): string {
  const escape = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
  body { font-family: system-ui, -apple-system, "Hiragino Sans", sans-serif; margin: 0;
         display: grid; place-items: center; min-height: 100vh; background: #f6f7f9; color: #1f2d3d; }
  .card { background: #fff; padding: 2rem 2.5rem; border-radius: 12px; max-width: 28rem;
          box-shadow: 0 1px 3px rgba(0,0,0,.1); text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 .75rem; }
  p { margin: 0; line-height: 1.7; color: #52606d; }
</style>
</head>
<body>
  <div class="card">
    <h1>${escape(title)}</h1>
    <p>${escape(message)}</p>
  </div>
</body>
</html>`;
}
