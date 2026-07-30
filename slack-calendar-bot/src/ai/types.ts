import type { DateTime } from 'luxon';
import type { ParsedCalendarEvent } from '../schemas/parsed-event.js';

export interface ParseScheduleInput {
  /** メンションを除去した本文 */
  text: string;
  /** 「今日」「明日」の基準となる日時 */
  now: DateTime;
  /** 解釈に使うタイムゾーン */
  timezone: string;
}

/**
 * 自然言語 → 予定情報の解析器。
 *
 * 実装を差し替えられるようにインターフェースを切っている
 * （現在は Gemini 無料枠。Claude API などへ移行する場合はここを実装するだけでよい）。
 */
export interface ScheduleParser {
  parse(input: ParseScheduleInput): Promise<ParsedCalendarEvent>;
}
