export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** ログに絶対に出してはいけないキー（部分一致で伏字にする） */
const SENSITIVE_KEY_PATTERN =
  /(token|secret|api[-_]?key|password|authorization|refresh|credential|code)/i;

const REDACTED = '[REDACTED]';

/**
 * ログ出力前に、トークン等の秘密情報を再帰的に伏字化する。
 * アクセストークンをログへ出力しないための最後の砦。
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(val, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') {
    // 素のトークン文字列が直接渡された場合も伏字にする
    if (/^(xoxb-|xapp-|xoxp-|sk-ant-|ya29\.|1\/\/)/.test(value)) return REDACTED;
    return value;
  }
  return value;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(
  level: LogLevel = 'info',
  bindings: Record<string, unknown> = {},
): Logger {
  const threshold = LEVEL_ORDER[level];

  const write = (logLevel: LogLevel, message: string, meta?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[logLevel] < threshold) return;
    const payload = {
      time: new Date().toISOString(),
      level: logLevel,
      message,
      ...(redact(bindings) as Record<string, unknown>),
      ...(meta ? (redact(meta) as Record<string, unknown>) : {}),
    };
    const line = JSON.stringify(payload);
    if (logLevel === 'error' || logLevel === 'warn') {
      console.error(line);
    } else {
      process.stdout.write(`${line}\n`);
    }
  };

  return {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
    child: (extra) => createLogger(level, { ...bindings, ...extra }),
  };
}
