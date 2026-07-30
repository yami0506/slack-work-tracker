import type { PendingEventsRepository } from '../database/repositories/pending-events.repository.js';
import type { GoogleAuthService } from '../google/auth.js';
import { GoogleCalendarService, toGoogleEventId } from '../google/calendar.js';
import { isAppError } from '../utils/errors.js';
import type { Logger } from '../utils/logger.js';
import { restoreEvent, type ScheduleService } from './schedule.service.js';
import type { NormalizedEvent } from './event-normalizer.js';

export type RegistrationOutcome =
  | { kind: 'registered'; event: NormalizedEvent; htmlLink: string | null }
  | { kind: 'cancelled' }
  | { kind: 'already_handled' }
  | { kind: 'forbidden' }
  | { kind: 'expired' }
  | { kind: 'not_found' }
  | { kind: 'google_link_required'; linkUrl: string };

/**
 * 「登録する」「キャンセル」ボタン押下後の処理。
 *
 * 二重登録防止は 2 段構え:
 *   1. pending → created の条件付き UPDATE（DB レベルの排他）
 *   2. Google 側の eventId を pending_events.id 由来で固定（API レベルの冪等性）
 */
export class CalendarRegistrationService {
  constructor(
    private readonly pendingEvents: PendingEventsRepository,
    private readonly googleAuth: GoogleAuthService,
    private readonly calendar: GoogleCalendarService,
    private readonly scheduleService: ScheduleService,
    private readonly logger: Logger,
  ) {}

  async register(pendingId: string, actingSlackUserId: string): Promise<RegistrationOutcome> {
    const pending = await this.pendingEvents.findById(pendingId);
    if (!pending) return { kind: 'not_found' };

    // 他人のボタンは押せない
    if (pending.slack_user_id !== actingSlackUserId) {
      this.logger.warn('他ユーザーによる操作を拒否しました', {
        pendingId,
        owner: pending.slack_user_id,
        actor: actingSlackUserId,
      });
      return { kind: 'forbidden' };
    }

    if (pending.status !== 'pending') {
      return { kind: 'already_handled' };
    }
    if (new Date(pending.expires_at).getTime() <= Date.now()) {
      return { kind: 'expired' };
    }

    // 実行権を獲得できたプロセスだけが登録へ進む（連打対策）
    const claimed = await this.pendingEvents.claimForRegistration(pendingId);
    if (!claimed) {
      this.logger.info('既に他の処理が登録を進めています', { pendingId });
      return { kind: 'already_handled' };
    }

    const event = restoreEvent(claimed);

    try {
      const { client, calendarId } = await this.googleAuth.getAuthorizedClient(actingSlackUserId);

      const created = await this.calendar.createEvent(client, {
        calendarId,
        title: event.title,
        description: event.description,
        start: event.start,
        end: event.end,
        timezone: event.timezone,
        isAllDay: event.isAllDay,
        eventId: toGoogleEventId(pendingId) || undefined,
      });

      await this.pendingEvents.attachGoogleEvent(pendingId, created.id, created.htmlLink);

      this.logger.info('カレンダーへ登録しました', {
        pendingId,
        slackUserId: actingSlackUserId,
        alreadyExisted: created.alreadyExisted,
      });

      return { kind: 'registered', event, htmlLink: created.htmlLink };
    } catch (error) {
      // 失敗したら pending へ戻し、ユーザーが再試行できるようにする
      await this.safeRelease(pendingId);

      if (isAppError(error) && error.code === 'GOOGLE_NOT_LINKED') {
        const linkUrl = await this.scheduleService.createLinkUrl({
          slackUserId: actingSlackUserId,
          slackChannelId: pending.slack_channel_id,
          slackThreadTs: pending.slack_thread_ts,
        });
        return { kind: 'google_link_required', linkUrl };
      }
      throw error;
    }
  }

  async cancel(pendingId: string, actingSlackUserId: string): Promise<RegistrationOutcome> {
    const pending = await this.pendingEvents.findById(pendingId);
    if (!pending) return { kind: 'not_found' };

    if (pending.slack_user_id !== actingSlackUserId) {
      return { kind: 'forbidden' };
    }

    const cancelled = await this.pendingEvents.markCancelled(pendingId);
    if (!cancelled) return { kind: 'already_handled' };

    this.logger.info('登録をキャンセルしました', { pendingId, slackUserId: actingSlackUserId });
    return { kind: 'cancelled' };
  }

  private async safeRelease(pendingId: string): Promise<void> {
    try {
      await this.pendingEvents.releaseClaim(pendingId);
    } catch (error) {
      this.logger.error('登録処理の解放に失敗しました', { pendingId, error });
    }
  }
}
