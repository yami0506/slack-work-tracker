import { DateTime } from 'luxon';

const WEEKDAY_JA = ['月', '火', '水', '木', '金', '土', '日'] as const;

/** 指定タイムゾーンの現在時刻 */
export function nowIn(timezone: string, reference?: Date): DateTime {
  const base = reference ? DateTime.fromJSDate(reference) : DateTime.now();
  return base.setZone(timezone);
}

/** 曜日の日本語表記（月〜日） */
export function weekdayJa(dt: DateTime): string {
  return WEEKDAY_JA[dt.weekday - 1] ?? '';
}

/**
 * AI へ渡す「現在日時」コンテキスト。
 * 「今日」「明日」「来週火曜」を解釈するための基準になる。
 */
export function buildTemporalContext(now: DateTime): string {
  return [
    `現在日時: ${now.toFormat('yyyy-MM-dd HH:mm:ss')}`,
    `現在日付: ${now.toFormat('yyyy年M月d日')}`,
    `曜日: ${weekdayJa(now)}曜日`,
    `タイムゾーン: ${now.zoneName ?? 'Asia/Tokyo'}`,
    `ISO8601形式の現在日時: ${now.toISO()}`,
  ].join('\n');
}

/** ISO 文字列を指定タイムゾーンの DateTime にする。不正なら null */
export function parseIsoInZone(value: string, timezone: string): DateTime | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  // 日付のみ（終日予定）
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.exec(trimmed);
  if (dateOnly) {
    const dt = DateTime.fromISO(trimmed, { zone: timezone });
    return dt.isValid ? dt.startOf('day') : null;
  }

  const dt = DateTime.fromISO(trimmed, { setZone: true });
  if (!dt.isValid) return null;
  return dt.setZone(timezone);
}

export interface FormatRangeInput {
  start: DateTime;
  end: DateTime;
  isAllDay: boolean;
}

/**
 * 確認メッセージ用のフル表記。
 * 例: 2026年8月1日 13:00〜15:00
 */
export function formatEventRange({ start, end, isAllDay }: FormatRangeInput): string {
  if (isAllDay) {
    // 内部表現では end は「最終日（含む）」。Google 送信時のみ排他的な日付へ変換する。
    if (start.hasSame(end, 'day')) {
      return `${start.toFormat('yyyy年M月d日')}（終日）`;
    }
    return `${start.toFormat('yyyy年M月d日')}〜${end.toFormat('yyyy年M月d日')}（終日）`;
  }

  if (start.hasSame(end, 'day')) {
    return `${start.toFormat('yyyy年M月d日')} ${start.toFormat('HH:mm')}〜${end.toFormat('HH:mm')}`;
  }
  return `${start.toFormat('yyyy年M月d日 HH:mm')} 〜 ${end.toFormat('yyyy年M月d日 HH:mm')}`;
}

/**
 * 登録完了メッセージ用の短縮表記。
 * 例: 8月1日 13:00〜15:00
 */
export function formatEventRangeShort({ start, end, isAllDay }: FormatRangeInput): string {
  if (isAllDay) {
    if (start.hasSame(end, 'day')) return `${start.toFormat('M月d日')}（終日）`;
    return `${start.toFormat('M月d日')}〜${end.toFormat('M月d日')}（終日）`;
  }
  if (start.hasSame(end, 'day')) {
    return `${start.toFormat('M月d日')} ${start.toFormat('HH:mm')}〜${end.toFormat('HH:mm')}`;
  }
  return `${start.toFormat('M月d日 HH:mm')} 〜 ${end.toFormat('M月d日 HH:mm')}`;
}
