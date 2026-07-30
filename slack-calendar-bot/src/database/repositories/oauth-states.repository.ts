import type { Database } from '../client.js';
import { generateRandomToken } from '../../utils/crypto.js';
import { AppError } from '../../utils/errors.js';

const TABLE = 'oauth_states';
const STATE_TTL_MINUTES = 15;

export interface OAuthStateRow {
  id: string;
  state: string;
  slack_user_id: string;
  slack_channel_id: string | null;
  slack_thread_ts: string | null;
  consumed_at: string | null;
  expires_at: string;
}

export interface CreateStateInput {
  slackUserId: string;
  slackChannelId: string | null;
  slackThreadTs: string | null;
}

/**
 * Google OAuth の state を管理する（CSRF 対策）。
 *
 * 連携 URL に Slack User ID を直接載せると他人になりすませてしまうため、
 * 推測不能な state をサーバー側で発行し、DB 側で Slack User ID と結びつける。
 */
export class OAuthStatesRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateStateInput): Promise<string> {
    const state = generateRandomToken(32);
    const expiresAt = new Date(Date.now() + STATE_TTL_MINUTES * 60_000);

    const { error } = await this.db.from(TABLE).insert({
      state,
      slack_user_id: input.slackUserId,
      slack_channel_id: input.slackChannelId,
      slack_thread_ts: input.slackThreadTs,
      expires_at: expiresAt.toISOString(),
    });

    if (error) throw databaseError('OAuth state の保存に失敗しました', error);
    return state;
  }

  /** 参照のみ（/oauth/google/start で Google へリダイレクトする前の確認） */
  async peek(state: string): Promise<OAuthStateRow | null> {
    const { data, error } = await this.db
      .from(TABLE)
      .select('*')
      .eq('state', state)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle<OAuthStateRow>();

    if (error) throw databaseError('OAuth state の取得に失敗しました', error);
    return data;
  }

  /**
   * state を消費する（1 回だけ成功する条件付き更新）。
   * 期限切れ・使用済み・存在しない場合は null。
   */
  async consume(state: string): Promise<OAuthStateRow | null> {
    const { data, error } = await this.db
      .from(TABLE)
      .update({ consumed_at: new Date().toISOString() })
      .eq('state', state)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('*')
      .maybeSingle<OAuthStateRow>();

    if (error) throw databaseError('OAuth state の検証に失敗しました', error);
    return data;
  }
}

function databaseError(userMessage: string, cause: unknown): AppError {
  return new AppError('DATABASE_FAILED', 'データの保存中に問題が発生しました。', {
    cause,
    message: userMessage,
  });
}
