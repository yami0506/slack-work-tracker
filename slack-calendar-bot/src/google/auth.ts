import { OAuth2Client } from 'google-auth-library';
import type { AppConfig } from '../config/index.js';
import type { UsersRepository } from '../database/repositories/users.repository.js';
import { AppError } from '../utils/errors.js';
import type { Logger } from '../utils/logger.js';

/**
 * 必要最小限のスコープだけを要求する。
 * calendar.events は「予定の読み書き」のみで、カレンダー自体の削除権限は含まない。
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

export interface ExchangeResult {
  googleUserId: string;
  email: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}

type GoogleAuthConfig = Pick<
  AppConfig,
  | 'GOOGLE_CLIENT_ID'
  | 'GOOGLE_CLIENT_SECRET'
  | 'GOOGLE_REDIRECT_URI'
  | 'DEFAULT_CALENDAR_ID'
  | 'DEFAULT_TIMEZONE'
>;

export class GoogleAuthService {
  constructor(
    private readonly config: GoogleAuthConfig,
    private readonly users: UsersRepository,
    private readonly logger: Logger,
  ) {}

  private createClient(): OAuth2Client {
    return new OAuth2Client({
      clientId: this.config.GOOGLE_CLIENT_ID,
      clientSecret: this.config.GOOGLE_CLIENT_SECRET,
      redirectUri: this.config.GOOGLE_REDIRECT_URI,
    });
  }

  /** Google の同意画面 URL。state は呼び出し側で発行・検証する */
  generateAuthUrl(state: string): string {
    return this.createClient().generateAuthUrl({
      access_type: 'offline', // refresh_token を得るために必須
      prompt: 'consent', // 再連携時も refresh_token を確実に受け取る
      scope: [...GOOGLE_SCOPES],
      state,
      include_granted_scopes: true,
    });
  }

  /** 認可コードをトークンへ交換し、Google ユーザーを特定する */
  async exchangeCode(code: string): Promise<ExchangeResult> {
    const client = this.createClient();

    let tokens;
    try {
      const response = await client.getToken(code);
      tokens = response.tokens;
    } catch (cause) {
      throw new AppError('GOOGLE_AUTH_EXPIRED', 'Google との連携に失敗しました。', {
        cause,
        message: '認可コードの交換に失敗しました',
      });
    }

    if (!tokens.access_token) {
      throw new AppError('GOOGLE_AUTH_EXPIRED', 'Google との連携に失敗しました。', {
        message: 'アクセストークンが返却されませんでした',
      });
    }

    // id_token を検証して Google ユーザー ID（sub）を得る
    let googleUserId: string | null = null;
    let email: string | null = null;
    if (tokens.id_token) {
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: this.config.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      googleUserId = payload?.sub ?? null;
      email = payload?.email ?? null;
    }

    if (!googleUserId) {
      throw new AppError('GOOGLE_AUTH_EXPIRED', 'Google アカウントを特定できませんでした。', {
        message: 'id_token から sub を取得できませんでした',
      });
    }

    return {
      googleUserId,
      email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    };
  }

  /** 認可コード交換後、Slack ユーザーと紐付けて保存する */
  async linkAccount(slackUserId: string, result: ExchangeResult): Promise<void> {
    await this.users.linkGoogleAccount({
      slackUserId,
      googleUserId: result.googleUserId,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt,
      calendarId: this.config.DEFAULT_CALENDAR_ID,
      timezone: this.config.DEFAULT_TIMEZONE,
    });
  }

  /**
   * Slack ユーザーの Google 認証済みクライアントを返す。
   * アクセストークンが期限切れなら refresh_token で自動更新し、結果を暗号化保存する。
   */
  async getAuthorizedClient(
    slackUserId: string,
  ): Promise<{ client: OAuth2Client; calendarId: string; timezone: string }> {
    const account = await this.users.findBySlackUserId(slackUserId);

    if (!account || !account.googleUserId || !account.refreshToken) {
      throw new AppError('GOOGLE_NOT_LINKED', 'Googleカレンダーとの連携が必要です。', {
        details: { slackUserId },
      });
    }

    const client = this.createClient();
    client.setCredentials({
      access_token: account.accessToken ?? undefined,
      refresh_token: account.refreshToken,
      expiry_date: account.expiresAt?.getTime() ?? undefined,
    });

    // ライブラリが自動リフレッシュした結果を保存する（トークンはログに出さない）
    client.on('tokens', (tokens) => {
      if (!tokens.access_token) return;
      void this.users
        .updateTokens({
          slackUserId,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? null,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        })
        .then(() => {
          this.logger.info('Google アクセストークンを更新しました', { slackUserId });
        })
        .catch((error: unknown) => {
          this.logger.error('更新後のトークン保存に失敗しました', { slackUserId, error });
        });
    });

    // 期限切れなら明示的に更新して、失効を早期に検出する
    const expiresAt = account.expiresAt?.getTime() ?? 0;
    if (expiresAt <= Date.now() + 60_000) {
      try {
        await client.getAccessToken();
      } catch (cause) {
        throw new AppError(
          'GOOGLE_AUTH_EXPIRED',
          'Googleとの連携の有効期限が切れました。お手数ですが、もう一度連携してください。',
          { cause, details: { slackUserId } },
        );
      }
    }

    return {
      client,
      calendarId: account.calendarId || this.config.DEFAULT_CALENDAR_ID,
      timezone: account.timezone || this.config.DEFAULT_TIMEZONE,
    };
  }
}
