import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { stripMention } from '../src/utils/mention.js';
import { TokenCipher, generateRandomToken, safeEqual } from '../src/utils/crypto.js';
import {
  buildTemporalContext,
  formatEventRange,
  formatEventRangeShort,
} from '../src/utils/datetime.js';
import { redact } from '../src/utils/logger.js';
import { TZ } from './helpers/fakes.js';

describe('stripMention', () => {
  const BOT = 'U0BOTBOT';

  it('先頭のメンションを取り除く', () => {
    expect(stripMention(`<@${BOT}> 明日14時から16時まで資料作成`, BOT)).toBe(
      '明日14時から16時まで資料作成',
    );
  });

  it('文中のメンションも取り除く', () => {
    expect(stripMention(`明日の予定 <@${BOT}> を登録して`, BOT)).toBe('明日の予定 を登録して');
  });

  it('他ユーザーへのメンションが先頭にあっても除去する', () => {
    expect(stripMention(`<@${BOT}> <@U9999> 明日10時から会議`, BOT)).toBe('明日10時から会議');
  });

  it('botUserId が不明でも先頭のメンションを除去する', () => {
    expect(stripMention('<@U1234567> 今日19時からジム')).toBe('今日19時からジム');
  });

  it('HTML エスケープを元に戻す', () => {
    expect(stripMention(`<@${BOT}> A &amp; B の打ち合わせ`, BOT)).toBe('A & B の打ち合わせ');
  });

  it('全角スペースを含む文字列を整形する', () => {
    expect(stripMention(`<@${BOT}>　明日14時から　会議`, BOT)).toBe('明日14時から 会議');
  });

  it('本文が無い場合は空文字になる', () => {
    expect(stripMention(`<@${BOT}>`, BOT)).toBe('');
  });
});

describe('TokenCipher', () => {
  const key = Buffer.alloc(32, 7).toString('base64');

  it('暗号化して復号できる', () => {
    const cipher = new TokenCipher(key);
    const encrypted = cipher.encrypt('1//refresh-token-value');

    expect(encrypted).not.toContain('refresh-token-value');
    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(cipher.decrypt(encrypted)).toBe('1//refresh-token-value');
  });

  it('同じ平文でも毎回異なる暗号文になる', () => {
    const cipher = new TokenCipher(key);
    expect(cipher.encrypt('same')).not.toBe(cipher.encrypt('same'));
  });

  it('改ざんされた暗号文は復号できない', () => {
    const cipher = new TokenCipher(key);
    const encrypted = cipher.encrypt('secret');
    const parts = encrypted.split(':');
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${Buffer.from('evil').toString('base64')}`;

    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it('鍵長が不正なら生成時に失敗する', () => {
    expect(() => new TokenCipher(Buffer.alloc(16).toString('base64'))).toThrow();
  });

  it('null は null のまま扱える', () => {
    const cipher = new TokenCipher(key);
    expect(cipher.encryptNullable(null)).toBeNull();
    expect(cipher.decryptNullable(null)).toBeNull();
  });
});

describe('generateRandomToken / safeEqual', () => {
  it('毎回異なるトークンを返す', () => {
    expect(generateRandomToken()).not.toBe(generateRandomToken());
  });

  it('同じ文字列だけ true になる', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('日時フォーマット', () => {
  const start = DateTime.fromISO('2026-08-01T13:00:00', { zone: TZ });
  const end = DateTime.fromISO('2026-08-01T15:00:00', { zone: TZ });

  it('同日の予定を「2026年8月1日 13:00〜15:00」と表示する', () => {
    expect(formatEventRange({ start, end, isAllDay: false })).toBe('2026年8月1日 13:00〜15:00');
  });

  it('短縮表記は「8月1日 13:00〜15:00」', () => {
    expect(formatEventRangeShort({ start, end, isAllDay: false })).toBe('8月1日 13:00〜15:00');
  });

  it('日をまたぐ予定は両方の日付を表示する', () => {
    const nextDay = DateTime.fromISO('2026-08-02T02:00:00', { zone: TZ });
    expect(formatEventRange({ start, end: nextDay, isAllDay: false })).toBe(
      '2026年8月1日 13:00 〜 2026年8月2日 02:00',
    );
  });

  it('終日予定は時刻を表示しない', () => {
    expect(formatEventRange({ start, end: start, isAllDay: true })).toBe('2026年8月1日（終日）');
  });

  it('複数日の終日予定は範囲で表示する', () => {
    const last = DateTime.fromISO('2026-08-03T00:00:00', { zone: TZ });
    expect(formatEventRange({ start, end: last, isAllDay: true })).toBe(
      '2026年8月1日〜2026年8月3日（終日）',
    );
  });

  it('AI へ渡すコンテキストに現在日時・曜日・タイムゾーンが含まれる', () => {
    const context = buildTemporalContext(DateTime.fromISO('2026-07-30T10:00:00', { zone: TZ }));

    expect(context).toContain('2026-07-30 10:00:00');
    expect(context).toContain('木曜日');
    expect(context).toContain('Asia/Tokyo');
  });
});

describe('ログのマスキング', () => {
  it('トークン系のキーを伏字にする', () => {
    const masked = redact({
      slackUserId: 'U123',
      google_access_token: 'ya29.secret',
      nested: { refresh_token: '1//secret', title: '会議' },
    }) as Record<string, unknown>;

    expect(masked.slackUserId).toBe('U123');
    expect(masked.google_access_token).toBe('[REDACTED]');
    expect((masked.nested as Record<string, unknown>).refresh_token).toBe('[REDACTED]');
    expect((masked.nested as Record<string, unknown>).title).toBe('会議');
  });

  it('キー名に関係なくトークン形式の文字列を伏字にする', () => {
    expect(redact({ value: 'xoxb-1234-abcd' })).toEqual({ value: '[REDACTED]' });
    expect(redact({ value: 'ya29.a0AfH6' })).toEqual({ value: '[REDACTED]' });
  });
});
