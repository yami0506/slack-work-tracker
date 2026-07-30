import type { App, BlockAction, ButtonAction, SlackActionMiddlewareArgs } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import type { KnownBlock } from '@slack/types';
import type { CalendarRegistrationService } from '../../services/calendar-registration.service.js';
import { toAppError } from '../../utils/errors.js';
import type { Logger } from '../../utils/logger.js';
import {
  ACTION_CANCEL,
  ACTION_REGISTER,
  buildCancelledBlocks,
  buildErrorBlocks,
  buildGoogleLinkBlocks,
  buildSuccessBlocks,
} from '../messages/blocks.js';
import { FALLBACK_TEXT, MESSAGES } from '../messages/texts.js';

export interface ConfirmActionDeps {
  registrationService: CalendarRegistrationService;
  logger: Logger;
}

/**
 * 確認メッセージのボタン操作を処理する。
 *
 * - ack() は最初に必ず呼ぶ（3 秒タイムアウト対策）
 * - 押した本人以外は操作できない
 * - 連打されても登録は 1 件だけ
 */
export function registerConfirmActions(app: App, deps: ConfirmActionDeps): void {
  const { registrationService, logger } = deps;

  app.action<BlockAction<ButtonAction>>(ACTION_REGISTER, async (args) => {
    await args.ack();
    await handle(args, 'register', registrationService, logger);
  });

  app.action<BlockAction<ButtonAction>>(ACTION_CANCEL, async (args) => {
    await args.ack();
    await handle(args, 'cancel', registrationService, logger);
  });

  // URL ボタン（Google 連携）も interaction を送ってくるので ack だけ返す
  app.action('google_link', async ({ ack }) => {
    await ack();
  });
}

type ActionArgs = SlackActionMiddlewareArgs<BlockAction<ButtonAction>> & { client: WebClient };

async function handle(
  args: ActionArgs,
  intent: 'register' | 'cancel',
  registrationService: CalendarRegistrationService,
  logger: Logger,
): Promise<void> {
  const { body, client } = args;
  const action = body.actions[0];
  const pendingId = action?.value ?? '';
  const actingUserId = body.user.id;
  const channel = body.channel?.id;
  const messageTs = body.message?.ts;

  const log = logger.child({ pendingId, actingUserId, intent });

  if (!pendingId || !channel || !messageTs) {
    log.warn('必要な情報が欠けたインタラクションを無視しました');
    return;
  }

  const update = (blocks: KnownBlock[], text: string) =>
    client.chat.update({ channel, ts: messageTs, text, blocks });

  const ephemeral = (text: string) =>
    client.chat.postEphemeral({ channel, user: actingUserId, text });

  try {
    const outcome =
      intent === 'register'
        ? await registrationService.register(pendingId, actingUserId)
        : await registrationService.cancel(pendingId, actingUserId);

    switch (outcome.kind) {
      case 'registered':
        await update(
          buildSuccessBlocks({ event: outcome.event, htmlLink: outcome.htmlLink }),
          FALLBACK_TEXT.success,
        );
        return;

      case 'cancelled':
        await update(buildCancelledBlocks(), FALLBACK_TEXT.cancelled);
        return;

      case 'forbidden':
        // 他人のメッセージは書き換えず、押した本人にだけ知らせる
        await ephemeral(MESSAGES.forbidden);
        return;

      case 'already_handled':
        await ephemeral(MESSAGES.alreadyHandled);
        return;

      case 'expired':
        await update(buildErrorBlocks(MESSAGES.expired), FALLBACK_TEXT.error);
        return;

      case 'not_found':
        await ephemeral(MESSAGES.notFound);
        return;

      case 'google_link_required':
        await update(buildGoogleLinkBlocks(outcome.linkUrl), FALLBACK_TEXT.googleLink);
        return;
    }
  } catch (error) {
    const appError = toAppError(error);
    log.error('ボタン操作の処理に失敗しました', {
      code: appError.code,
      error: appError,
      details: appError.details,
    });

    try {
      await update(buildErrorBlocks(appError.userMessage), FALLBACK_TEXT.error);
    } catch (updateError) {
      log.error('エラーメッセージの表示に失敗しました', { error: updateError });
    }
  }
}
