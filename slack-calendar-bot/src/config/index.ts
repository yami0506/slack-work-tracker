import { z } from 'zod';

/**
 * 環境変数の検証と型付け。
 * 起動時に一度だけ実行し、以降はこの型を通してのみ設定へアクセスする。
 */
const envSchema = z
  .object({
    // --- 動作モード ---
    SLACK_MODE: z.enum(['socket', 'http']).default('http'),
    PORT: z.coerce.number().int().positive().default(8080),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    APP_BASE_URL: z.string().min(1).default('http://localhost:8080'),

    // --- Slack ---
    SLACK_BOT_TOKEN: z.string().min(1),
    SLACK_SIGNING_SECRET: z.string().default(''),
    SLACK_APP_TOKEN: z.string().default(''),

    // --- 自然言語解析 (Google AI Studio / Gemini 無料枠) ---
    GEMINI_API_KEY: z.string().min(1),
    GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),
    /** 0 で thinking を無効化（無料枠の消費とレイテンシを抑える） */
    GEMINI_THINKING_BUDGET: z.coerce.number().int().min(0).default(0),

    // --- Supabase ---
    SUPABASE_URL: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

    // --- Google OAuth / Calendar ---
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    GOOGLE_REDIRECT_URI: z.string().min(1),

    // --- 暗号化 ---
    TOKEN_ENCRYPTION_KEY: z.string().min(1),

    // --- 既定値 ---
    DEFAULT_TIMEZONE: z.string().min(1).default('Asia/Tokyo'),
    DEFAULT_CALENDAR_ID: z.string().min(1).default('primary'),
    PENDING_EVENT_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  })
  .superRefine((env, ctx) => {
    if (env.SLACK_MODE === 'socket' && env.SLACK_APP_TOKEN.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['SLACK_APP_TOKEN'],
        message: 'SLACK_MODE=socket のときは SLACK_APP_TOKEN (xapp-...) が必須です',
      });
    }
    if (env.SLACK_MODE === 'http' && env.SLACK_SIGNING_SECRET.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['SLACK_SIGNING_SECRET'],
        message: 'SLACK_MODE=http のときは SLACK_SIGNING_SECRET が必須です（署名検証に使用）',
      });
    }
    // AES-256-GCM の鍵は 32 バイトちょうどでなければならない
    const keyLength = Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64').length;
    if (keyLength !== 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['TOKEN_ENCRYPTION_KEY'],
        message: `base64 で 32 バイトの鍵を指定してください（現在 ${keyLength} バイト）。生成: openssl rand -base64 32`,
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`環境変数の設定に問題があります:\n${details}`);
  }
  return result.data;
}

/** OAuth 連携開始 URL（Slack のボタンから開く） */
export function buildGoogleLinkUrl(baseUrl: string, state: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/oauth/google/start?state=${encodeURIComponent(state)}`;
}
