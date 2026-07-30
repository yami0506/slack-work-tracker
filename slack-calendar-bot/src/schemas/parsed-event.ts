import { z } from 'zod';

/**
 * AI が返す JSON のスキーマ。
 *
 * AI の出力は絶対に信用せず、必ずこのスキーマで検証してから
 * アプリケーション側の日時バリデーションへ渡す。
 *
 * null と "" の両方を受け付け、内部的には "" に正規化する。
 * （プロバイダによって nullable の扱いが異なるため）
 */
const nullableString = z.preprocess(
  (value) => (value === null || value === undefined ? '' : value),
  z.string(),
);

export const parsedCalendarEventSchema = z.object({
  /** 予定名 */
  title: nullableString,
  /** 開始日時 ISO8601（例: 2026-08-01T13:00:00+09:00）。終日なら YYYY-MM-DD。不明なら "" */
  start: nullableString,
  /** 終了日時 ISO8601。不明なら "" */
  end: nullableString,
  /** タイムゾーン（常に Asia/Tokyo を想定） */
  timezone: nullableString,
  /** 補足説明。無ければ "" */
  description: nullableString,
  /** 終日予定かどうか */
  isAllDay: z.boolean(),
  /** 日時が曖昧で確認が必要かどうか */
  needsConfirmation: z.boolean(),
  /** 確認が必要な場合の質問文。不要なら "" */
  confirmationQuestion: nullableString,
});

export type ParsedCalendarEvent = z.infer<typeof parsedCalendarEventSchema>;

/**
 * 生成 AI へ渡す JSON Schema。
 * nullable を使わず、不明な値は空文字にさせることでプロバイダ差異を吸収する。
 */
export const PARSED_EVENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: '予定のタイトル。分からない場合は空文字',
    },
    start: {
      type: 'string',
      description:
        '開始日時。ISO8601（例: 2026-08-01T13:00:00+09:00）。終日予定なら YYYY-MM-DD。特定できない場合は空文字',
    },
    end: {
      type: 'string',
      description:
        '終了日時。ISO8601（例: 2026-08-01T15:00:00+09:00）。終日予定なら最終日の YYYY-MM-DD。特定できない場合は空文字',
    },
    timezone: {
      type: 'string',
      description: 'IANA タイムゾーン。常に Asia/Tokyo',
    },
    description: {
      type: 'string',
      description: '予定の補足説明。無ければ空文字',
    },
    isAllDay: {
      type: 'boolean',
      description: '終日予定なら true',
    },
    needsConfirmation: {
      type: 'boolean',
      description: '日時が曖昧で、ユーザーへ確認が必要なら true',
    },
    confirmationQuestion: {
      type: 'string',
      description: 'needsConfirmation が true のときにユーザーへ尋ねる日本語の質問。不要なら空文字',
    },
  },
  required: [
    'title',
    'start',
    'end',
    'timezone',
    'description',
    'isAllDay',
    'needsConfirmation',
    'confirmationQuestion',
  ],
  additionalProperties: false,
} as const;
