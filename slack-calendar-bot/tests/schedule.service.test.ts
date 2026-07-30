import { describe, expect, it, vi } from 'vitest';
import { AiScheduleParser } from '../src/ai/calendar-parser.js';
import { ScheduleService } from '../src/services/schedule.service.js';
import { ProcessedEventsRepository } from '../src/database/repositories/processed-events.repository.js';
import { UNIQUE_VIOLATION } from '../src/database/client.js';
import { aiJson, silentLogger, stubAiClient } from './helpers/fakes.js';

const config = {
  APP_BASE_URL: 'https://bot.example.com',
  DEFAULT_TIMEZONE: 'Asia/Tokyo',
  DEFAULT_CALENDAR_ID: 'primary',
  PENDING_EVENT_TTL_MINUTES: 30,
};

const mentionInput = {
  slackEventId: 'Ev0001',
  slackUserId: 'U_OWNER',
  slackChannelId: 'C0001',
  slackThreadTs: '1700000000.000100',
  text: '明日14時から16時まで明秀PoCの実装',
};

const asAny = (value: unknown): any => value;

function fakeUsers(linked: boolean) {
  return { isLinked: vi.fn(async () => linked) };
}

function fakePendingEvents() {
  return {
    create: vi.fn(async (input: Record<string, unknown>) => ({ id: 'pending-1', ...input })),
  };
}

function fakeOAuthStates() {
  return { create: vi.fn(async () => 'state-token-123') };
}

function buildService(parts: {
  linked: boolean;
  aiResponses: string[];
  pending?: ReturnType<typeof fakePendingEvents>;
  states?: ReturnType<typeof fakeOAuthStates>;
}) {
  const parser = new AiScheduleParser(stubAiClient(parts.aiResponses), silentLogger());
  const pending = parts.pending ?? fakePendingEvents();
  const states = parts.states ?? fakeOAuthStates();
  const users = fakeUsers(parts.linked);

  const service = new ScheduleService(
    parser,
    asAny(users),
    asAny(pending),
    asAny(states),
    config,
    silentLogger(),
  );

  return { service, pending, states, users };
}

describe('ScheduleService.handleMention', () => {
  it('Google 未連携なら解析せずに連携 URL を返す', async () => {
    const { service, states, pending } = buildService({ linked: false, aiResponses: [aiJson()] });

    const outcome = await service.handleMention(mentionInput);

    expect(outcome.kind).toBe('google_link_required');
    if (outcome.kind !== 'google_link_required') return;
    expect(outcome.linkUrl).toBe(
      'https://bot.example.com/oauth/google/start?state=state-token-123',
    );
    expect(states.create).toHaveBeenCalledWith({
      slackUserId: 'U_OWNER',
      slackChannelId: 'C0001',
      slackThreadTs: '1700000000.000100',
    });
    expect(pending.create).not.toHaveBeenCalled();
  });

  it('解析できたら確認待ちとして保存する', async () => {
    const { service, pending } = buildService({
      linked: true,
      aiResponses: [
        aiJson({
          title: '明秀PoCの実装',
          start: '2026-07-31T14:00:00+09:00',
          end: '2026-07-31T16:00:00+09:00',
        }),
      ],
    });

    const outcome = await service.handleMention(mentionInput);

    expect(outcome.kind).toBe('confirmation');
    if (outcome.kind !== 'confirmation') return;
    expect(outcome.event.title).toBe('明秀PoCの実装');
    expect(outcome.calendarLabel).toBe('メインカレンダー');
    expect(pending.create).toHaveBeenCalledTimes(1);

    const saved = pending.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(saved.slack_event_id ?? saved.slackEventId).toBe('Ev0001');
    expect(saved.status).toBeUndefined();
  });

  it('曖昧な場合は保存せず質問を返す', async () => {
    const { service, pending } = buildService({
      linked: true,
      aiResponses: [
        aiJson({
          title: '打ち合わせ',
          needsConfirmation: true,
          confirmationQuestion: '何時からの予定ですか？',
        }),
      ],
    });

    const outcome = await service.handleMention({
      ...mentionInput,
      text: '明日の午後に打ち合わせ',
    });

    expect(outcome.kind).toBe('question');
    expect(pending.create).not.toHaveBeenCalled();
  });

  it('本文が空なら案内メッセージを返す', async () => {
    const { service } = buildService({ linked: true, aiResponses: [aiJson()] });

    await expect(service.handleMention({ ...mentionInput, text: '  ' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });
});

describe('ProcessedEventsRepository（Slack イベント再送対策）', () => {
  function fakeDb(errors: Array<{ code?: string } | null>) {
    let index = 0;
    return asAny({
      from: () => ({
        insert: async () => {
          const error = errors[index] ?? null;
          index += 1;
          return { error };
        },
      }),
    });
  }

  it('初回は true を返す', async () => {
    const repo = new ProcessedEventsRepository(fakeDb([null]));
    expect(await repo.markProcessed('Ev0001')).toBe(true);
  });

  it('同じ event_id の再送は false を返す（一意制約違反）', async () => {
    const repo = new ProcessedEventsRepository(fakeDb([null, { code: UNIQUE_VIOLATION }]));

    expect(await repo.markProcessed('Ev0001')).toBe(true);
    expect(await repo.markProcessed('Ev0001')).toBe(false);
  });

  it('想定外の DB エラーは例外にする', async () => {
    const repo = new ProcessedEventsRepository(fakeDb([{ code: '08006' }]));

    await expect(repo.markProcessed('Ev0001')).rejects.toMatchObject({
      code: 'DATABASE_FAILED',
    });
  });
});
