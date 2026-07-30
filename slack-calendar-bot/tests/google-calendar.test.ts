import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { buildEventRequestBody, toGoogleEventId } from '../src/google/calendar.js';
import { TZ } from './helpers/fakes.js';

const start = DateTime.fromISO('2026-08-01T13:00:00', { zone: TZ });
const end = DateTime.fromISO('2026-08-01T15:00:00', { zone: TZ });

describe('buildEventRequestBody', () => {
  it('時刻付き予定は dateTime + timeZone で送る', () => {
    const body = buildEventRequestBody({
      calendarId: 'primary',
      title: '明秀PoCの実装',
      description: '',
      start,
      end,
      timezone: TZ,
      isAllDay: false,
    });

    expect(body).toMatchObject({
      summary: '明秀PoCの実装',
      start: { dateTime: '2026-08-01T13:00:00.000+09:00', timeZone: TZ },
      end: { dateTime: '2026-08-01T15:00:00.000+09:00', timeZone: TZ },
    });
  });

  it('説明が空なら description を送らない', () => {
    const body = buildEventRequestBody({
      calendarId: 'primary',
      title: '会議',
      description: '',
      start,
      end,
      timezone: TZ,
      isAllDay: false,
    });

    expect(body.description).toBeUndefined();
  });

  it('終日予定は date で送り、end は排他的な翌日にする', () => {
    const body = buildEventRequestBody({
      calendarId: 'primary',
      title: '夏季休暇',
      description: '',
      start: DateTime.fromISO('2026-08-10T00:00:00', { zone: TZ }),
      end: DateTime.fromISO('2026-08-10T00:00:00', { zone: TZ }),
      timezone: TZ,
      isAllDay: true,
    });

    expect(body.start).toEqual({ date: '2026-08-10' });
    expect(body.end).toEqual({ date: '2026-08-11' });
  });

  it('複数日の終日予定も最終日の翌日を end にする', () => {
    const body = buildEventRequestBody({
      calendarId: 'primary',
      title: '合宿',
      description: '',
      start: DateTime.fromISO('2026-08-10T00:00:00', { zone: TZ }),
      end: DateTime.fromISO('2026-08-12T00:00:00', { zone: TZ }),
      timezone: TZ,
      isAllDay: true,
    });

    expect(body.end).toEqual({ date: '2026-08-13' });
  });

  it('eventId を指定すると id として送る（再送時の二重登録防止）', () => {
    const body = buildEventRequestBody({
      calendarId: 'primary',
      title: '会議',
      description: '',
      start,
      end,
      timezone: TZ,
      isAllDay: false,
      eventId: 'abc12',
    });

    expect(body.id).toBe('abc12');
  });
});

describe('toGoogleEventId', () => {
  it('UUID をハイフンなしの ID へ変換する', () => {
    expect(toGoogleEventId('11111111-2222-4333-8444-555555555555')).toBe(
      '11111111222243338444555555555555',
    );
  });

  it('使用できない文字が含まれる場合は空文字を返す', () => {
    expect(toGoogleEventId('zzzz')).toBe('');
  });
});
