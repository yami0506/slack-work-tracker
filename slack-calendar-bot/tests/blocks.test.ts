import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
  ACTION_CANCEL,
  ACTION_REGISTER,
  buildConfirmationBlocks,
  buildGoogleLinkBlocks,
  buildSuccessBlocks,
  escapeMrkdwn,
} from '../src/slack/messages/blocks.js';
import type { NormalizedEvent } from '../src/services/event-normalizer.js';
import { TZ } from './helpers/fakes.js';

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    title: '明秀 バックログ整理',
    description: '',
    timezone: TZ,
    isAllDay: false,
    start: DateTime.fromISO('2026-08-01T13:00:00', { zone: TZ }),
    end: DateTime.fromISO('2026-08-01T15:00:00', { zone: TZ }),
    warnings: [],
    ...overrides,
  };
}

describe('buildConfirmationBlocks', () => {
  it('予定名・日時・カレンダーを表示する', () => {
    const blocks = buildConfirmationBlocks({
      pendingId: 'pending-1',
      event: makeEvent(),
      calendarLabel: 'メインカレンダー',
    });

    const json = JSON.stringify(blocks);
    expect(json).toContain('次の予定を登録します。');
    expect(json).toContain('明秀 バックログ整理');
    expect(json).toContain('2026年8月1日 13:00〜15:00');
    expect(json).toContain('メインカレンダー');
  });

  it('Actions Block に登録・キャンセルのボタンを置く', () => {
    const blocks = buildConfirmationBlocks({
      pendingId: 'pending-1',
      event: makeEvent(),
      calendarLabel: 'メインカレンダー',
    });

    const actions = blocks.find((block) => block.type === 'actions');
    expect(actions).toBeDefined();
    if (!actions || actions.type !== 'actions') return;

    const ids = actions.elements.map((element) => (element as { action_id: string }).action_id);
    expect(ids).toEqual([ACTION_REGISTER, ACTION_CANCEL]);

    const values = actions.elements.map((element) => (element as { value?: string }).value);
    expect(values).toEqual(['pending-1', 'pending-1']);
  });

  it('警告があれば context として表示する', () => {
    const blocks = buildConfirmationBlocks({
      pendingId: 'p',
      event: makeEvent({ warnings: ['この予定は過去の日時です。'] }),
      calendarLabel: 'メインカレンダー',
    });

    expect(JSON.stringify(blocks)).toContain('この予定は過去の日時です。');
  });
});

describe('buildSuccessBlocks', () => {
  it('登録完了の文言とリンクを含む', () => {
    const blocks = buildSuccessBlocks({
      event: makeEvent(),
      htmlLink: 'https://calendar.google.com/event?eid=abc',
    });

    const json = JSON.stringify(blocks);
    expect(json).toContain('Googleカレンダーに登録しました。');
    expect(json).toContain('明秀 バックログ整理');
    expect(json).toContain('8月1日 13:00〜15:00');
    expect(json).toContain('https://calendar.google.com/event?eid=abc');
  });

  it('リンクが無くても登録完了を表示できる', () => {
    const blocks = buildSuccessBlocks({ event: makeEvent(), htmlLink: null });
    expect(JSON.stringify(blocks)).toContain('Googleカレンダーに登録しました。');
  });
});

describe('buildGoogleLinkBlocks', () => {
  it('連携ボタンに URL を設定する', () => {
    const blocks = buildGoogleLinkBlocks('https://example.com/oauth/google/start?state=abc');
    const json = JSON.stringify(blocks);

    expect(json).toContain('Googleカレンダーとの連携が必要です。');
    expect(json).toContain('Googleアカウントを連携する');
    expect(json).toContain('https://example.com/oauth/google/start?state=abc');
  });
});

describe('escapeMrkdwn', () => {
  it('Slack 記法として解釈される文字をエスケープする', () => {
    expect(escapeMrkdwn('<script>a & b</script>')).toBe('&lt;script&gt;a &amp; b&lt;/script&gt;');
  });
});
