/**
 * アプリケーション内で扱うエラー。
 * `userMessage` は Slack へ表示してよい日本語、`cause` 側の技術詳細はログにのみ出す。
 */
export type AppErrorCode =
  | 'AI_PARSE_FAILED'
  | 'AMBIGUOUS_DATETIME'
  | 'INVALID_INPUT'
  | 'GOOGLE_NOT_LINKED'
  | 'GOOGLE_AUTH_EXPIRED'
  | 'GOOGLE_CALENDAR_FAILED'
  | 'GOOGLE_PERMISSION_DENIED'
  | 'PENDING_NOT_FOUND'
  | 'PENDING_EXPIRED'
  | 'ALREADY_PROCESSED'
  | 'FORBIDDEN'
  | 'DATABASE_FAILED'
  | 'SLACK_API_FAILED'
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly userMessage: string;
  readonly details: Record<string, unknown>;

  constructor(
    code: AppErrorCode,
    userMessage: string,
    options: { cause?: unknown; details?: Record<string, unknown>; message?: string } = {},
  ) {
    super(options.message ?? userMessage, options.cause ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
    this.details = options.details ?? {};
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** 想定外の例外をユーザー向けメッセージ付きの AppError に正規化する */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  return new AppError(
    'INTERNAL',
    '処理中に問題が発生しました。時間をおいて、もう一度お試しください。',
    { cause: error },
  );
}
