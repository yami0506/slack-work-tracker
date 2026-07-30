import { describe, expect, it } from 'vitest';
import { normalizeParsedEvent } from '../src/services/event-normalizer.js';
import { NOW, TZ, parsedEvent } from './helpers/fakes.js';

const options = { now: NOW, defaultTimezone: TZ };

describe('normalizeParsedEvent - 正常系', () => {
  it('「明日14時から16時まで資料作成」を正しく正規化する', () => {
    const result = normalizeParsedEvent(
      parsedEvent({
        title: '資料作成',
        start: '2026-07-31T14:00:00+09:00',
        end: '2026-07-31T16:00:00+09:00',
      }),
      options,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.title).toBe('資料作成');
    expect(result.event.start.toISO()).toBe('2026-07-31T14:00:00.000+09:00');
    expect(result.event.end.toISO()).toBe('2026-07-31T16:00:00.000+09:00');
    expect(result.event.isAllDay).toBe(false);
    expect(result.event.warnings).toHaveLength(0);
  });

  it('「8月5日10時から1時間、定例」の終了時刻を受け入れる', () => {
    const result = normalizeParsedEvent(
      parsedEvent({
        title: '定例',
        start: '2026-08-05T10:00:00+09:00',
        end: '2026-08-05T11:00:00+09:00',
      }),
      options,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.end.diff(result.event.start, 'minutes').minutes).toBe(60);
  });

  it('「今日19時からジム」のように終了時刻がない場合は1時間の予定にする', () => {
    const result = normalizeParsedEvent(
      parsedEvent({ title: 'ジム', start: '2026-07-30T19:00:00+09:00', end: '' }),
      options,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.end.toISO()).toBe('2026-07-30T20:00:00.000+09:00');
  });

  it('「来週火曜の午後2時から16時まで作業」を正規化する', () => {
    const result = normalizeParsedEvent(
      parsedEvent({
        title: '作業',
        start: '2026-08-04T14:00:00+09:00',
        end: '2026-08-04T16:00:00+09:00',
      }),
      options,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.start.hour).toBe(14);
    expect(result.event.end.hour).toBe(16);
  });

  it('終日予定は日付だけで扱う', () => {
    const result = normalizeParsedEvent(
      parsedEvent({ title: '夏季休暇', start: '2026-08-10', end: '2026-08-10', isAllDay: true }),
      options,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.isAllDay).toBe(true);
    expect(result.event.start.toFormat('yyyy-MM-dd')).toBe('2026-08-10');
    expect(result.event.start.hour).toBe(0);
  });

  it('過去の日時は警告を付けつつ登録可能にする', () => {
    const result = normalizeParsedEvent(
      parsedEvent({
        title: '振り返り',
        start: '2026-07-29T14:00:00+09:00',
        end: '2026-07-29T15:00:00+09:00',
      }),
      options,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.warnings).toHaveLength(1);
    expect(result.event.warnings[0]).toContain('過去');
  });
});

describe('normalizeParsedEvent - 曖昧・不正な入力', () => {
  it('AI が確認要と判断した場合は質問を返す', () => {
    const result = normalizeParsedEvent(
      parsedEvent({
        title: '打ち合わせ',
        needsConfirmation: true,
        confirmationQuestion: '何時からの予定ですか？',
      }),
      options,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.question).toBe('何時からの予定ですか？');
  });

  it('日付・時刻が特定できない場合は登録しない', () => {
    const result = normalizeParsedEvent(parsedEvent({ title: '打ち合わせ', start: '' }), options);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.question).toContain('開始日時');
  });

  it('予定名が読み取れない場合は登録しない', () => {
    const result = normalizeParsedEvent(
      parsedEvent({ title: '   ', start: '2026-08-01T14:00:00+09:00' }),
      options,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.question).toContain('予定名');
  });

  it('存在しない日付は不正として扱う', () => {
    const result = normalizeParsedEvent(
      parsedEvent({ title: '記念日', start: '2026-02-30T10:00:00+09:00' }),
      options,
    );

    expect(result.ok).toBe(false);
  });

  it('終了時刻が開始時刻以前ならエラーにする', () => {
    const result = normalizeParsedEvent(
      parsedEvent({
        title: '打ち合わせ',
        start: '2026-08-01T15:00:00+09:00',
        end: '2026-08-01T14:00:00+09:00',
      }),
      options,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.question).toContain('終了時刻');
  });

  it('開始と終了が同時刻ならエラーにする', () => {
    const result = normalizeParsedEvent(
      parsedEvent({
        title: '打ち合わせ',
        start: '2026-08-01T15:00:00+09:00',
        end: '2026-08-01T15:00:00+09:00',
      }),
      options,
    );

    expect(result.ok).toBe(false);
  });

  it('30日を超える予定は解析ミスとして拒否する', () => {
    const result = normalizeParsedEvent(
      parsedEvent({
        title: '長期プロジェクト',
        start: '2026-08-01T10:00:00+09:00',
        end: '2026-10-01T10:00:00+09:00',
      }),
      options,
    );

    expect(result.ok).toBe(false);
  });

  it('不正なタイムゾーンは既定値へフォールバックする', () => {
    const result = normalizeParsedEvent(
      parsedEvent({
        title: '会議',
        start: '2026-08-01T14:00:00+09:00',
        end: '2026-08-01T15:00:00+09:00',
        timezone: 'Invalid/Zone',
      }),
      options,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.timezone).toBe(TZ);
  });
});
