import { describe, expect, it } from 'vitest';
import { AiScheduleParser, stripCodeFence } from '../src/ai/calendar-parser.js';
import { normalizeParsedEvent } from '../src/services/event-normalizer.js';
import { AppError } from '../src/utils/errors.js';
import { NOW, TZ, aiJson, failingAiClient, silentLogger, stubAiClient } from './helpers/fakes.js';

const parseInput = { text: '明日14時から16時まで資料作成', now: NOW, timezone: TZ };

describe('AiScheduleParser', () => {
  it('正しい JSON をそのまま受け入れる', async () => {
    const client = stubAiClient([
      aiJson({
        title: '資料作成',
        start: '2026-07-31T14:00:00+09:00',
        end: '2026-07-31T16:00:00+09:00',
      }),
    ]);
    const parser = new AiScheduleParser(client, silentLogger());

    const result = await parser.parse(parseInput);

    expect(result.title).toBe('資料作成');
    expect(client.calls).toBe(1);
  });

  it('null が返っても空文字へ正規化する', async () => {
    const client = stubAiClient([
      JSON.stringify({
        title: '打ち合わせ',
        start: '2026-08-01T10:00:00+09:00',
        end: null,
        timezone: TZ,
        description: null,
        isAllDay: false,
        needsConfirmation: false,
        confirmationQuestion: null,
      }),
    ]);
    const parser = new AiScheduleParser(client, silentLogger());

    const result = await parser.parse(parseInput);

    expect(result.end).toBe('');
    expect(result.confirmationQuestion).toBe('');
  });

  it('不正な JSON が返った場合は1回だけ再解析する', async () => {
    const client = stubAiClient([
      'これはJSONではありません',
      aiJson({
        title: '資料作成',
        start: '2026-07-31T14:00:00+09:00',
        end: '2026-07-31T16:00:00+09:00',
      }),
    ]);
    const parser = new AiScheduleParser(client, silentLogger());

    const result = await parser.parse(parseInput);

    expect(result.title).toBe('資料作成');
    expect(client.calls).toBe(2);
  });

  it('スキーマ違反が続く場合はユーザー向けエラーを投げる', async () => {
    const client = stubAiClient([JSON.stringify({ title: 123 }), JSON.stringify({ foo: 'bar' })]);
    const parser = new AiScheduleParser(client, silentLogger());

    await expect(parser.parse(parseInput)).rejects.toMatchObject({
      code: 'AI_PARSE_FAILED',
    });
    expect(client.calls).toBe(2);
  });

  it('API 呼び出しに失敗した場合はリトライせずエラーにする', async () => {
    const parser = new AiScheduleParser(failingAiClient(), silentLogger());

    await expect(parser.parse(parseInput)).rejects.toBeInstanceOf(AppError);
  });

  it('空文字の入力を拒否する', async () => {
    const parser = new AiScheduleParser(stubAiClient([aiJson()]), silentLogger());

    await expect(parser.parse({ ...parseInput, text: '   ' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('長すぎる入力を拒否する', async () => {
    const parser = new AiScheduleParser(stubAiClient([aiJson()]), silentLogger());

    await expect(parser.parse({ ...parseInput, text: 'あ'.repeat(2001) })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('コードブロックで囲まれた JSON も解釈できる', async () => {
    const client = stubAiClient([
      '```json\n' +
        aiJson({
          title: 'ジム',
          start: '2026-07-30T19:00:00+09:00',
          end: '2026-07-30T20:00:00+09:00',
        }) +
        '\n```',
    ]);
    const parser = new AiScheduleParser(client, silentLogger());

    const result = await parser.parse(parseInput);
    expect(result.title).toBe('ジム');
  });
});

describe('stripCodeFence', () => {
  it('```json ブロックを剥がす', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('素の JSON はそのまま返す', () => {
    expect(stripCodeFence('  {"a":1}  ')).toBe('{"a":1}');
  });
});

describe('解析から正規化までの通し', () => {
  it('日付がない場合は質問を返す', async () => {
    const client = stubAiClient([
      aiJson({
        title: '打ち合わせ',
        needsConfirmation: true,
        confirmationQuestion: 'いつの予定でしょうか？',
      }),
    ]);
    const parser = new AiScheduleParser(client, silentLogger());

    const parsed = await parser.parse({ ...parseInput, text: '今度打ち合わせ' });
    const normalized = normalizeParsedEvent(parsed, { now: NOW, defaultTimezone: TZ });

    expect(normalized.ok).toBe(false);
  });

  it('AI が needsConfirmation=false でも日時が壊れていれば登録しない', async () => {
    const client = stubAiClient([
      aiJson({ title: '会議', start: 'まったく日付ではない', needsConfirmation: false }),
    ]);
    const parser = new AiScheduleParser(client, silentLogger());

    const parsed = await parser.parse(parseInput);
    const normalized = normalizeParsedEvent(parsed, { now: NOW, defaultTimezone: TZ });

    expect(normalized.ok).toBe(false);
  });
});
