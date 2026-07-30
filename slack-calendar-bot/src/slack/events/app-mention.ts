import type { App } from '@slack/bolt';
import type { ProcessedEventsRepository } from '../../database/repositories/processed-events.repository.js';
import type { ScheduleService } from '../../services/schedule.service.js';
import { toAppError } from '../../utils/errors.js';
import type { Logger } from '../../utils/logger.js';
import { stripMention } from '../../utils/mention.js';
import {
  buildConfirmationBlocks,
  buildErrorBlocks,
  buildGoogleLinkBlocks,
  buildQuestionBlocks,
} from '../messages/blocks.js';
import { FALLBACK_TEXT } from '../messages/texts.js';

export interface AppMentionDeps {
  scheduleService: ScheduleService;
  processedEvents: ProcessedEventsRepository;
  logger: Logger;
}

/**
 * app_mention イベントを受け取り、スレッドへ確認メッセージを返す。
 *
 * Slack はレスポンスが遅い / 失敗した場合に同じイベントを再送するため、
 * event_id を使って冪等性を担保する。
 */
export function registerAppMentionHandler(app: App, deps: AppMentionDeps): void {
  const { scheduleService, processedEvents, logger } = deps;

  app.event('app_mention', async ({ event, body, client, context }) => {
    const slackEventId = body.event_id;
    const channel = event.channel;
    const threadTs = event.thread_ts ?? event.ts;
    const slackUserId = event.user;

    const log = logger.child({ slackEventId, channel, slackUserId });

    if (!slackUserId) {
      log.warn('ユーザー不明のメンションを無視しました');
      return;
    }

    // --- 二重処理の防止（Slack の再送対策）---
    const isFirstTime = await processedEvents.markProcessed(slackEventId);
    if (!isFirstTime) {
      log.info('再送イベントのためスキップしました');
      return;
    }

    const text = stripMention(event.text ?? '', context.botUserId);
    log.info('メンションを受信しました', { textLength: text.length });

    try {
      const outcome = await scheduleService.handleMention({
        slackEventId,
        slackUserId,
        slackChannelId: channel,
        slackThreadTs: threadTs,
        text,
      });

      switch (outcome.kind) {
        case 'google_link_required':
          await client.chat.postMessage({
            channel,
            thread_ts: threadTs,
            text: FALLBACK_TEXT.googleLink,
            blocks: buildGoogleLinkBlocks(outcome.linkUrl),
          });
          return;

        case 'question':
          await client.chat.postMessage({
            channel,
            thread_ts: threadTs,
            text: FALLBACK_TEXT.question,
            blocks: buildQuestionBlocks(outcome.question),
          });
          return;

        case 'confirmation':
          await client.chat.postMessage({
            channel,
            thread_ts: threadTs,
            text: FALLBACK_TEXT.confirmation,
            blocks: buildConfirmationBlocks({
              pendingId: outcome.pendingId,
              event: outcome.event,
              calendarLabel: outcome.calendarLabel,
            }),
          });
          return;
      }
    } catch (error) {
      const appError = toAppError(error);
      // 技術詳細はログにのみ残し、ユーザーには平易な文言を返す
      log.error('メンション処理に失敗しました', {
        code: appError.code,
        error: appError,
        details: appError.details,
      });

      try {
        await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: FALLBACK_TEXT.error,
          blocks: buildErrorBlocks(appError.userMessage),
        });
      } catch (postError) {
        log.error('エラーメッセージの送信にも失敗しました', { error: postError });
      }
    }
  });
}
