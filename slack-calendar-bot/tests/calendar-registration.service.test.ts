import { describe, expect, it, vi } from 'vitest';
import { CalendarRegistrationService } from '../src/services/calendar-registration.service.js';
import type { PendingEventRow } from '../src/database/repositories/pending-events.repository.js';
import { AppError } from '../src/utils/errors.js';
import { silentLogger } from './helpers/fakes.js';

const OWNER = 'U_OWNER';
const OTHER = 'U_OTHER';
const PENDING_ID = '11111111-2222-4333-8444-555555555555';

function makeRow(overrides: Partial<PendingEventRow> = {}): PendingEventRow {
  return {
    id: PENDING_ID,
    slack_event_id: 'Ev123',
    slack_user_id: OWNER,
    slack_channel_id: 'C123',
    slack_thread_ts: '1700000000.000100',
    title: '明秀PoCの実装',
    start_at: '2026-07-31T14:00:00+09:00',
    end_at: '2026-07-31T16:00:00+09:00',
    timezone: 'Asia/Tokyo',
    description: '',
    is_all_day: false,
    status: 'pending',
    google_event_id: null,
    google_event_link: null,
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    ...overrides,
  };
}

/**
 * pending_events の条件付き UPDATE を模したインメモリ実装。
 * claimForRegistration は status が pending のときだけ成功する。
 */
function fakePendingRepo(initial: PendingEventRow) {
  let row = { ...initial };
  return {
    row: () => row,
    findById: vi.fn(async () => ({ ...row })),
    claimForRegistration: vi.fn(async () => {
      if (row.status !== 'pending') return null;
      if (new Date(row.expires_at).getTime() <= Date.now()) return null;
      row = { ...row, status: 'created' };
      return { ...row };
    }),
    releaseClaim: vi.fn(async () => {
      if (row.status === 'created' && row.google_event_id === null) {
        row = { ...row, status: 'pending' };
      }
    }),
    attachGoogleEvent: vi.fn(async (_id: string, eventId: string, link: string | null) => {
      row = { ...row, google_event_id: eventId, google_event_link: link };
    }),
    markCancelled: vi.fn(async () => {
      if (row.status !== 'pending') return null;
      row = { ...row, status: 'cancelled' };
      return { ...row };
    }),
    expireOutdated: vi.fn(async () => 0),
  };
}

function fakeGoogleAuth(overrides: Partial<{ throws: unknown }> = {}) {
  return {
    getAuthorizedClient: vi.fn(async () => {
      if (overrides.throws) throw overrides.throws;
      return { client: {} as never, calendarId: 'primary', timezone: 'Asia/Tokyo' };
    }),
  };
}

function fakeCalendar(result?: { id: string; htmlLink: string | null }) {
  return {
    createEvent: vi.fn(async () => ({
      id: result?.id ?? 'google-event-id',
      htmlLink: result?.htmlLink ?? 'https://calendar.google.com/event?eid=abc',
      alreadyExisted: false,
    })),
  };
}

function fakeScheduleService() {
  return { createLinkUrl: vi.fn(async () => 'https://example.com/oauth/google/start?state=xyz') };
}

const asAny = (value: unknown): any => value;

function buildService(parts: {
  pending: ReturnType<typeof fakePendingRepo>;
  auth?: ReturnType<typeof fakeGoogleAuth>;
  calendar?: ReturnType<typeof fakeCalendar>;
  schedule?: ReturnType<typeof fakeScheduleService>;
}) {
  return new CalendarRegistrationService(
    asAny(parts.pending),
    asAny(parts.auth ?? fakeGoogleAuth()),
    asAny(parts.calendar ?? fakeCalendar()),
    asAny(parts.schedule ?? fakeScheduleService()),
    silentLogger(),
  );
}

describe('CalendarRegistrationService.register', () => {
  it('本人が押した場合はカレンダーへ登録する', async () => {
    const pending = fakePendingRepo(makeRow());
    const calendar = fakeCalendar();
    const service = buildService({ pending, calendar });

    const outcome = await service.register(PENDING_ID, OWNER);

    expect(outcome.kind).toBe('registered');
    expect(calendar.createEvent).toHaveBeenCalledTimes(1);
    expect(pending.row().google_event_id).toBe('google-event-id');
  });

  it('Google 側の eventId に pending_events.id を使い冪等性を確保する', async () => {
    const pending = fakePendingRepo(makeRow());
    const calendar = fakeCalendar();
    const service = buildService({ pending, calendar });

    await service.register(PENDING_ID, OWNER);

    const arg = calendar.createEvent.mock.calls[0]?.[1] as unknown as { eventId?: string };
    expect(arg.eventId).toBe('11111111222243338444555555555555');
  });

  it('ボタンを二重に押しても登録は1件だけ', async () => {
    const pending = fakePendingRepo(makeRow());
    const calendar = fakeCalendar();
    const service = buildService({ pending, calendar });

    const [first, second] = await Promise.all([
      service.register(PENDING_ID, OWNER),
      service.register(PENDING_ID, OWNER),
    ]);

    const kinds = [first.kind, second.kind].sort();
    expect(kinds).toEqual(['already_handled', 'registered']);
    expect(calendar.createEvent).toHaveBeenCalledTimes(1);
  });

  it('他の Slack ユーザーが押しても登録しない', async () => {
    const pending = fakePendingRepo(makeRow());
    const calendar = fakeCalendar();
    const service = buildService({ pending, calendar });

    const outcome = await service.register(PENDING_ID, OTHER);

    expect(outcome.kind).toBe('forbidden');
    expect(calendar.createEvent).not.toHaveBeenCalled();
    expect(pending.claimForRegistration).not.toHaveBeenCalled();
  });

  it('期限切れの確認メッセージは登録しない', async () => {
    const pending = fakePendingRepo(
      makeRow({ expires_at: new Date(Date.now() - 60_000).toISOString() }),
    );
    const service = buildService({ pending });

    const outcome = await service.register(PENDING_ID, OWNER);

    expect(outcome.kind).toBe('expired');
  });

  it('存在しない pending は not_found', async () => {
    const pending = fakePendingRepo(makeRow());
    pending.findById = vi.fn(async () => null) as never;
    const service = buildService({ pending });

    const outcome = await service.register(PENDING_ID, OWNER);

    expect(outcome.kind).toBe('not_found');
  });

  it('Google 未連携なら連携 URL を返し、pending へ戻す', async () => {
    const pending = fakePendingRepo(makeRow());
    const auth = fakeGoogleAuth({
      throws: new AppError('GOOGLE_NOT_LINKED', 'Googleカレンダーとの連携が必要です。'),
    });
    const service = buildService({ pending, auth });

    const outcome = await service.register(PENDING_ID, OWNER);

    expect(outcome.kind).toBe('google_link_required');
    expect(pending.row().status).toBe('pending');
  });

  it('トークン期限切れなら pending へ戻して再試行可能にする', async () => {
    const pending = fakePendingRepo(makeRow());
    const auth = fakeGoogleAuth({
      throws: new AppError('GOOGLE_AUTH_EXPIRED', 'Googleとの連携の有効期限が切れました。'),
    });
    const service = buildService({ pending, auth });

    await expect(service.register(PENDING_ID, OWNER)).rejects.toMatchObject({
      code: 'GOOGLE_AUTH_EXPIRED',
    });
    expect(pending.row().status).toBe('pending');
    expect(pending.releaseClaim).toHaveBeenCalled();
  });
});

describe('CalendarRegistrationService.cancel', () => {
  it('本人ならキャンセルできる', async () => {
    const pending = fakePendingRepo(makeRow());
    const service = buildService({ pending });

    const outcome = await service.cancel(PENDING_ID, OWNER);

    expect(outcome.kind).toBe('cancelled');
    expect(pending.row().status).toBe('cancelled');
  });

  it('他人はキャンセルできない', async () => {
    const pending = fakePendingRepo(makeRow());
    const service = buildService({ pending });

    const outcome = await service.cancel(PENDING_ID, OTHER);

    expect(outcome.kind).toBe('forbidden');
    expect(pending.row().status).toBe('pending');
  });

  it('登録済みの予定はキャンセルできない', async () => {
    const pending = fakePendingRepo(makeRow({ status: 'created' }));
    const service = buildService({ pending });

    const outcome = await service.cancel(PENDING_ID, OWNER);

    expect(outcome.kind).toBe('already_handled');
  });
});
