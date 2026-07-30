import type { Database } from '../client.js';
import type { TokenCipher } from '../../utils/crypto.js';
import { AppError } from '../../utils/errors.js';

const TABLE = 'users';

/** DB 上の行（トークンは暗号化済み文字列） */
interface UserRow {
  id: string;
  slack_user_id: string;
  google_user_id: string | null;
  google_access_token: string | null;
  google_refresh_token: string | null;
  token_expires_at: string | null;
  calendar_id: string;
  timezone: string;
}

/** アプリ内で扱う復号済みの Google アカウント情報（メモリ上のみ） */
export interface GoogleAccount {
  userId: string;
  slackUserId: string;
  googleUserId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  calendarId: string;
  timezone: string;
}

export interface LinkGoogleAccountInput {
  slackUserId: string;
  googleUserId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  calendarId: string;
  timezone: string;
}

export interface UpdateTokensInput {
  slackUserId: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: Date | null;
}

/**
 * Slack ユーザーと Google アカウントの紐付けを扱う。
 * 暗号化・復号はこのクラスの内側で完結させ、DB には平文を渡さない。
 */
export class UsersRepository {
  constructor(
    private readonly db: Database,
    private readonly cipher: TokenCipher,
  ) {}

  async findBySlackUserId(slackUserId: string): Promise<GoogleAccount | null> {
    const { data, error } = await this.db
      .from(TABLE)
      .select('*')
      .eq('slack_user_id', slackUserId)
      .maybeSingle<UserRow>();

    if (error) throw databaseError('ユーザー情報の取得に失敗しました', error);
    if (!data) return null;
    return this.toGoogleAccount(data);
  }

  /** Google 連携が完了しているか（リフレッシュトークンまで揃っているか） */
  async isLinked(slackUserId: string): Promise<boolean> {
    const account = await this.findBySlackUserId(slackUserId);
    return Boolean(account?.googleUserId && account.refreshToken);
  }

  async linkGoogleAccount(input: LinkGoogleAccountInput): Promise<GoogleAccount> {
    // 再連携時にリフレッシュトークンが返らないことがあるため、既存値を温存する
    const existing = await this.findBySlackUserId(input.slackUserId);
    const refreshToken = input.refreshToken ?? existing?.refreshToken ?? null;

    const { data, error } = await this.db
      .from(TABLE)
      .upsert(
        {
          slack_user_id: input.slackUserId,
          google_user_id: input.googleUserId,
          google_access_token: this.cipher.encryptNullable(input.accessToken),
          google_refresh_token: this.cipher.encryptNullable(refreshToken),
          token_expires_at: input.expiresAt?.toISOString() ?? null,
          calendar_id: input.calendarId,
          timezone: input.timezone,
        },
        { onConflict: 'slack_user_id' },
      )
      .select('*')
      .single<UserRow>();

    if (error) throw databaseError('Google アカウントの連携保存に失敗しました', error);
    return this.toGoogleAccount(data);
  }

  /** アクセストークン更新（リフレッシュ時） */
  async updateTokens({
    slackUserId,
    accessToken,
    refreshToken,
    expiresAt,
  }: UpdateTokensInput): Promise<void> {
    const patch: Record<string, unknown> = {
      google_access_token: this.cipher.encryptNullable(accessToken),
      token_expires_at: expiresAt?.toISOString() ?? null,
    };
    if (refreshToken) {
      patch.google_refresh_token = this.cipher.encryptNullable(refreshToken);
    }

    const { error } = await this.db.from(TABLE).update(patch).eq('slack_user_id', slackUserId);
    if (error) throw databaseError('トークンの更新に失敗しました', error);
  }

  private toGoogleAccount(row: UserRow): GoogleAccount {
    return {
      userId: row.id,
      slackUserId: row.slack_user_id,
      googleUserId: row.google_user_id,
      accessToken: this.cipher.decryptNullable(row.google_access_token),
      refreshToken: this.cipher.decryptNullable(row.google_refresh_token),
      expiresAt: row.token_expires_at ? new Date(row.token_expires_at) : null,
      calendarId: row.calendar_id,
      timezone: row.timezone,
    };
  }
}

function databaseError(userMessage: string, cause: unknown): AppError {
  return new AppError('DATABASE_FAILED', 'データの保存中に問題が発生しました。', {
    cause,
    message: userMessage,
  });
}
