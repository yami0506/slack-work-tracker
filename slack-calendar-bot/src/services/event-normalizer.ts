import { DateTime } from 'luxon';
import type { ParsedCalendarEvent } from '../schemas/parsed-event.js';
import { parseIsoInZone } from '../utils/datetime.js';

/** 正規化・検証済みの予定。ここから先はアプリが責任を持つ値だけを使う。 */
export interface NormalizedEvent {
  title: string;
  description: string;
  timezone: string;
  isAllDay: boolean;
  /** 開始日時（終日の場合はその日の 00:00） */
  start: DateTime;
  /** 終了日時（終日の場合は「最終日」の 00:00。Google へ送る際に排他的な日付へ変換する） */
  end: DateTime;
  /** ユーザーへ注意喚起したい内容（過去日時など）。登録は阻害しない */
  warnings: string[];
}

export type NormalizeResult =
  { ok: true; event: NormalizedEvent } | { ok: false; question: string };

/** 終了時刻が指定されていない場合の既定の長さ */
const DEFAULT_DURATION_MINUTES = 60;
/** 常識的な上限。これを超える場合は解析ミスとみなす */
const MAX_DURATION_DAYS = 30;

const DEFAULT_QUESTION =
  '予定の日時を特定できませんでした。\n開始日時を含めて、もう一度入力してください。';

export interface NormalizeOptions {
  now: DateTime;
  defaultTimezone: string;
}

/**
 * AI の出力をアプリ側で再検証し、カレンダー登録可能な形へ正規化する。
 *
 * AI が needsConfirmation=false と言っていても、日時が破綻していれば登録しない。
 * 「AI の出力をそのまま信用しない」ための層。
 */
export function normalizeParsedEvent(
  parsed: ParsedCalendarEvent,
  { now, defaultTimezone }: NormalizeOptions,
): NormalizeResult {
  const timezone = isValidTimezone(parsed.timezone) ? parsed.timezone : defaultTimezone;

  // 1. AI 自身が曖昧と判断した場合は登録しない
  if (parsed.needsConfirmation) {
    return { ok: false, question: parsed.confirmationQuestion.trim() || DEFAULT_QUESTION };
  }

  // 2. 予定名
  const title = parsed.title.trim();
  if (title.length === 0) {
    return {
      ok: false,
      question: '予定名を読み取れませんでした。\n予定名を含めて、もう一度入力してください。',
    };
  }

  // 3. 開始日時（必須）
  const start = parseIsoInZone(parsed.start, timezone);
  if (!start || !start.isValid) {
    return { ok: false, question: DEFAULT_QUESTION };
  }

  // 4. 終了日時（無ければ補完する）
  const parsedEnd = parseIsoInZone(parsed.end, timezone);
  let end: DateTime;
  if (parsedEnd && parsedEnd.isValid) {
    end = parsedEnd;
  } else if (parsed.isAllDay) {
    end = start;
  } else {
    end = start.plus({ minutes: DEFAULT_DURATION_MINUTES });
  }

  // 5. 前後関係の検証
  if (parsed.isAllDay) {
    if (end < start.startOf('day')) {
      return {
        ok: false,
        question:
          '終了日が開始日より前になっています。\n日付を確認して、もう一度入力してください。',
      };
    }
  } else if (end <= start) {
    return {
      ok: false,
      question:
        '終了時刻が開始時刻より前か同じになっています。\n開始と終了を確認して、もう一度入力してください。',
    };
  }

  // 6. 長さの上限（解析ミスの検出）
  if (end.diff(start, 'days').days > MAX_DURATION_DAYS) {
    return {
      ok: false,
      question: `予定の長さが${MAX_DURATION_DAYS}日を超えています。\n日時を確認して、もう一度入力してください。`,
    };
  }

  // 7. 過去日時は警告（登録自体は許可する）
  const warnings: string[] = [];
  if (start < now) {
    warnings.push('この予定は過去の日時です。日付が意図どおりか確認してください。');
  }

  return {
    ok: true,
    event: {
      title,
      description: parsed.description.trim(),
      timezone,
      isAllDay: parsed.isAllDay,
      start: parsed.isAllDay ? start.startOf('day') : start,
      end: parsed.isAllDay ? end.startOf('day') : end,
      warnings,
    },
  };
}

export function isValidTimezone(timezone: string): boolean {
  if (!timezone) return false;
  return DateTime.now().setZone(timezone).isValid;
}
