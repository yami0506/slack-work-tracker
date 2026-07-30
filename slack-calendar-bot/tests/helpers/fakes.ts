import { DateTime } from 'luxon';
import type { JsonGenerationClient } from '../../src/ai/client.js';
import type { Logger } from '../../src/utils/logger.js';
import type { ParsedCalendarEvent } from '../../src/schemas/parsed-event.js';

export const TZ = 'Asia/Tokyo';

/** テストの基準時刻: 2026-07-30(木) 10:00 JST */
export const NOW = DateTime.fromISO('2026-07-30T10:00:00', { zone: TZ });

export function silentLogger(): Logger {
  const noop = (): void => undefined;
  const logger: Logger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger,
  };
  return logger;
}

/** AI が返すはずの JSON を固定で返すスタブ */
export function stubAiClient(responses: string[]): JsonGenerationClient & { calls: number } {
  const client = {
    calls: 0,
    async generateJson(): Promise<string> {
      const response = responses[client.calls] ?? responses[responses.length - 1] ?? '{}';
      client.calls += 1;
      return response;
    },
  };
  return client;
}

/** API 呼び出し自体が失敗するスタブ */
export function failingAiClient(message = 'network error'): JsonGenerationClient {
  return {
    async generateJson(): Promise<string> {
      throw new Error(message);
    },
  };
}

export function aiJson(overrides: Partial<ParsedCalendarEvent> = {}): string {
  return JSON.stringify({
    title: '',
    start: '',
    end: '',
    timezone: TZ,
    description: '',
    isAllDay: false,
    needsConfirmation: false,
    confirmationQuestion: '',
    ...overrides,
  });
}

export function parsedEvent(overrides: Partial<ParsedCalendarEvent> = {}): ParsedCalendarEvent {
  return {
    title: '',
    start: '',
    end: '',
    timezone: TZ,
    description: '',
    isAllDay: false,
    needsConfirmation: false,
    confirmationQuestion: '',
    ...overrides,
  };
}
