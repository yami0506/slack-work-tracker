import { DateTime } from 'luxon';
import type { ScheduleParser } from '../ai/types.js';
import { buildGoogleLinkUrl, type AppConfig } from '../config/index.js';
import type { OAuthStatesRepository } from '../database/repositories/oauth-states.repository.js';
import type { PendingEventsRepository } from '../database/repositories/pending-events.repository.js';
import type { UsersRepository } from '../database/repositories/users.repository.js';
import { AppError } from '../utils/errors.js';
import type { Logger } from '../utils/logger.js';
import { nowIn } from '../utils/datetime.js';
import { normalizeParsedEvent, type NormalizedEvent } from './event-normalizer.js';

export interface HandleMentionInput {
  slackEventId: string;
  slackUserId: string;
  slackChannelId: string;
  slackThreadTs: string;
  /** メンションを除去済みの本文 */
  text: string;
}

export type MentionOutcome =
  | { kind: 'google_link_required'; linkUrl: string }
  | { kind: 'question'; question: string }
  | { kind: 'confirmation'; pendingId: string; event: NormalizedEvent; calendarLabel: string };

type ScheduleServiceConfig = Pick<
  AppConfig,
  'APP_BASE_URL' | 'DEFAULT_TIMEZONE' | 'DEFAULT_CALENDAR_ID' | 'PENDING_EVENT_TTL_MINUTES'
>;

/**
 * メンション受信から「確認メッセージを出すまで」を担当する。
 * この時点ではカレンダーへ一切書き込まない。
 */
export class ScheduleService {
  constructor(
    private readonly parser: ScheduleParser,
    private readonly users: UsersRepository,
    private readonly pendingEvents: PendingEventsRepository,
    private readonly oauthStates: OAuthStatesRepository,
    private readonly config: ScheduleServiceConfig,
    private readonly logger: Logger,
  ) {}

  async handleMention(input: HandleMentionInput): Promise<MentionOutcome> {
    const text = input.text.trim();
    if (text.length === 0) {
      throw new AppError(
        'INVALID_INPUT',
        '登録したい予定を教えてください。\n例：`@CalendarBot 明日14時から16時まで資料作成`',
      );
    }

    // 1. Google 連携チェック（未連携なら解析すら行わない）
    const linked = await this.users.isLinked(input.slackUserId);
    if (!linked) {
      const linkUrl = await this.createLinkUrl(input);
      return { kind: 'google_link_required', linkUrl };
    }

    // 2. AI で解析（出力は Zod 検証済み）
    const timezone = this.config.DEFAULT_TIMEZONE;
    const now = nowIn(timezone);
    const parsed = await this.parser.parse({ text, now, timezone });

    // 3. アプリ側でも日時を再検証する
    const normalized = normalizeParsedEvent(parsed, { now, defaultTimezone: timezone });
    if (!normalized.ok) {
      this.logger.info('日時が曖昧なため確認を返します', {
        slackUserId: input.slackUserId,
        question: normalized.question,
      });
      return { kind: 'question', question: normalized.question };
    }

    // 4. 確認待ちとして保存する
    const event = normalized.event;
    const pending = await this.pendingEvents.create({
      slackEventId: input.slackEventId,
      slackUserId: input.slackUserId,
      slackChannelId: input.slackChannelId,
      slackThreadTs: input.slackThreadTs,
      title: event.title,
      startAt: event.start.toISO() ?? '',
      endAt: event.end.toISO() ?? '',
      timezone: event.timezone,
      description: event.description,
      isAllDay: event.isAllDay,
      expiresAt: new Date(Date.now() + this.config.PENDING_EVENT_TTL_MINUTES * 60_000),
    });

    return {
      kind: 'confirmation',
      pendingId: pending.id,
      event,
      calendarLabel: 'メインカレンダー',
    };
  }

  /** Google 連携用の URL を発行する（state はサーバー側で保持する） */
  async createLinkUrl(input: {
    slackUserId: string;
    slackChannelId: string;
    slackThreadTs: string | null;
  }): Promise<string> {
    const state = await this.oauthStates.create({
      slackUserId: input.slackUserId,
      slackChannelId: input.slackChannelId,
      slackThreadTs: input.slackThreadTs,
    });
    return buildGoogleLinkUrl(this.config.APP_BASE_URL, state);
  }
}

/** DB の行から表示用の NormalizedEvent を復元する */
export function restoreEvent(row: {
  title: string;
  description: string;
  start_at: string;
  end_at: string;
  timezone: string;
  is_all_day: boolean;
}): NormalizedEvent {
  return {
    title: row.title,
    description: row.description,
    timezone: row.timezone,
    isAllDay: row.is_all_day,
    start: DateTime.fromISO(row.start_at, { zone: row.timezone }),
    end: DateTime.fromISO(row.end_at, { zone: row.timezone }),
    warnings: [],
  };
}
