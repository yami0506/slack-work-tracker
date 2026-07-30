import type { Database } from '../client.js';
import { AppError } from '../../utils/errors.js';

const TABLE = 'pending_events';

export type PendingEventStatus = 'pending' | 'created' | 'cancelled' | 'expired';

export interface PendingEventRow {
  id: string;
  slack_event_id: string;
  slack_user_id: string;
  slack_channel_id: string;
  slack_thread_ts: string | null;
  title: string;
  start_at: string;
  end_at: string;
  timezone: string;
  description: string;
  is_all_day: boolean;
  status: PendingEventStatus;
  google_event_id: string | null;
  google_event_link: string | null;
  expires_at: string;
}

export interface CreatePendingEventInput {
  slackEventId: string;
  slackUserId: string;
  slackChannelId: string;
  slackThreadTs: string | null;
  title: string;
  startAt: string;
  endAt: string;
  timezone: string;
  description: string;
  isAllDay: boolean;
  expiresAt: Date;
}

/**
 * 確認待ちの予定を扱う。
 *
 * 二重登録を防ぐ要は `claimForRegistration`。
 * status が pending の行だけを条件付き UPDATE することで、
 * ボタンを連打されても最初の 1 回しか成功しない。
 */
export class PendingEventsRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreatePendingEventInput): Promise<PendingEventRow> {
    const { data, error } = await this.db
      .from(TABLE)
      .insert({
        slack_event_id: input.slackEventId,
        slack_user_id: input.slackUserId,
        slack_channel_id: input.slackChannelId,
        slack_thread_ts: input.slackThreadTs,
        title: input.title,
        start_at: input.startAt,
        end_at: input.endAt,
        timezone: input.timezone,
        description: input.description,
        is_all_day: input.isAllDay,
        status: 'pending',
        expires_at: input.expiresAt.toISOString(),
      })
      .select('*')
      .single<PendingEventRow>();

    if (error) throw databaseError('確認待ち予定の保存に失敗しました', error);
    return data;
  }

  async findById(id: string): Promise<PendingEventRow | null> {
    const { data, error } = await this.db
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .maybeSingle<PendingEventRow>();

    if (error) throw databaseError('確認待ち予定の取得に失敗しました', error);
    return data;
  }

  /**
   * 登録処理の実行権を獲得する（pending → created の条件付き更新）。
   * 既に他の処理が獲得済み、または期限切れなら null を返す。
   */
  async claimForRegistration(id: string): Promise<PendingEventRow | null> {
    const { data, error } = await this.db
      .from(TABLE)
      .update({ status: 'created' })
      .eq('id', id)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .select('*')
      .maybeSingle<PendingEventRow>();

    if (error) throw databaseError('登録処理の獲得に失敗しました', error);
    return data;
  }

  /** Google 登録に失敗したときに pending へ戻し、再試行できるようにする */
  async releaseClaim(id: string): Promise<void> {
    const { error } = await this.db
      .from(TABLE)
      .update({ status: 'pending' })
      .eq('id', id)
      .eq('status', 'created')
      .is('google_event_id', null);

    if (error) throw databaseError('登録処理の解放に失敗しました', error);
  }

  /** Google 側の予定 ID / リンクを記録する */
  async attachGoogleEvent(id: string, googleEventId: string, link: string | null): Promise<void> {
    const { error } = await this.db
      .from(TABLE)
      .update({ google_event_id: googleEventId, google_event_link: link })
      .eq('id', id);

    if (error) throw databaseError('登録結果の保存に失敗しました', error);
  }

  /** キャンセル（pending のときだけ成功する） */
  async markCancelled(id: string): Promise<PendingEventRow | null> {
    const { data, error } = await this.db
      .from(TABLE)
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle<PendingEventRow>();

    if (error) throw databaseError('キャンセル処理に失敗しました', error);
    return data;
  }

  /** 期限切れの pending をまとめて expired にする（任意の定期実行用） */
  async expireOutdated(): Promise<number> {
    const { data, error } = await this.db
      .from(TABLE)
      .update({ status: 'expired' })
      .eq('status', 'pending')
      .lt('expires_at', new Date().toISOString())
      .select('id');

    if (error) throw databaseError('期限切れ予定の更新に失敗しました', error);
    return data?.length ?? 0;
  }
}

function databaseError(userMessage: string, cause: unknown): AppError {
  return new AppError('DATABASE_FAILED', 'データの保存中に問題が発生しました。', {
    cause,
    message: userMessage,
  });
}
