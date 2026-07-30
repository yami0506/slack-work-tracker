import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { DateTime } from 'luxon';
import { AppError } from '../utils/errors.js';
import type { Logger } from '../utils/logger.js';

export interface CreateEventInput {
  calendarId: string;
  title: string;
  description: string;
  start: DateTime;
  /** 終日の場合は「最終日（含む）」。Google へは排他的な日付に変換して送る */
  end: DateTime;
  timezone: string;
  isAllDay: boolean;
  /**
   * Google 側のイベント ID。
   * 同じ ID で再送すると 409 になるため、リトライ時の二重登録を防げる。
   */
  eventId?: string;
}

export interface CreatedEvent {
  id: string;
  htmlLink: string | null;
  /** 既存の予定が見つかった（＝二重登録を防いだ）場合は true */
  alreadyExisted: boolean;
}

export class GoogleCalendarService {
  constructor(private readonly logger: Logger) {}

  async createEvent(auth: OAuth2Client, input: CreateEventInput): Promise<CreatedEvent> {
    const calendar = google.calendar({ version: 'v3', auth });
    const requestBody = buildEventRequestBody(input);

    try {
      const response = await calendar.events.insert({
        calendarId: input.calendarId,
        requestBody,
      });

      const id = response.data.id;
      if (!id) {
        throw new AppError('GOOGLE_CALENDAR_FAILED', 'Googleカレンダーへの登録に失敗しました。', {
          message: 'events.insert が id を返しませんでした',
        });
      }

      return { id, htmlLink: response.data.htmlLink ?? null, alreadyExisted: false };
    } catch (error) {
      // 同じ eventId で既に登録済み → 二重登録を防いだケース
      if (input.eventId && getHttpStatus(error) === 409) {
        this.logger.warn('同一 eventId の予定が既に存在します', { eventId: input.eventId });
        const existing = await this.fetchEvent(calendar, input.calendarId, input.eventId);
        if (existing) return { ...existing, alreadyExisted: true };
      }
      throw this.toAppError(error);
    }
  }

  private async fetchEvent(
    calendar: ReturnType<typeof google.calendar>,
    calendarId: string,
    eventId: string,
  ): Promise<{ id: string; htmlLink: string | null } | null> {
    try {
      const response = await calendar.events.get({ calendarId, eventId });
      if (!response.data.id) return null;
      return { id: response.data.id, htmlLink: response.data.htmlLink ?? null };
    } catch (error) {
      this.logger.warn('既存予定の取得に失敗しました', { eventId, error });
      return null;
    }
  }

  private toAppError(error: unknown): AppError {
    const status = getHttpStatus(error);

    if (status === 401) {
      return new AppError(
        'GOOGLE_AUTH_EXPIRED',
        'Googleとの連携の有効期限が切れました。お手数ですが、もう一度連携してください。',
        { cause: error },
      );
    }
    if (status === 403) {
      return new AppError(
        'GOOGLE_PERMISSION_DENIED',
        'カレンダーへの書き込み権限がありません。連携内容を確認してください。',
        { cause: error },
      );
    }
    if (status === 404) {
      return new AppError(
        'GOOGLE_CALENDAR_FAILED',
        '対象のカレンダーが見つかりませんでした。連携をやり直してください。',
        { cause: error },
      );
    }
    return new AppError(
      'GOOGLE_CALENDAR_FAILED',
      'Googleカレンダーへの登録に失敗しました。時間をおいて、もう一度お試しください。',
      { cause: error },
    );
  }
}

/**
 * Google Calendar API の events.insert に渡すリクエストボディを組み立てる。
 * 終日予定は date、時刻付き予定は dateTime + timeZone を使う。
 */
export function buildEventRequestBody(input: CreateEventInput): Record<string, unknown> {
  const base: Record<string, unknown> = {
    summary: input.title,
    description: input.description || undefined,
  };

  if (input.eventId) {
    base.id = input.eventId;
  }

  if (input.isAllDay) {
    return {
      ...base,
      start: { date: input.start.toFormat('yyyy-MM-dd') },
      // Google の終日予定の end は排他的なので +1 日する
      end: { date: input.end.plus({ days: 1 }).toFormat('yyyy-MM-dd') },
    };
  }

  return {
    ...base,
    start: { dateTime: input.start.toISO(), timeZone: input.timezone },
    end: { dateTime: input.end.toISO(), timeZone: input.timezone },
  };
}

/**
 * Google Calendar のイベント ID に使える文字は base32hex（0-9, a-v）で 5〜1024 文字。
 * UUID のハイフンを除いた 32 桁の 16 進数はこの条件を満たすため、そのまま使える。
 */
export function toGoogleEventId(uuid: string): string {
  const normalized = uuid.replace(/-/g, '').toLowerCase();
  return /^[0-9a-v]{5,1024}$/.test(normalized) ? normalized : '';
}

function getHttpStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  for (const value of [candidate.status, candidate.code, candidate.response?.status]) {
    if (typeof value === 'number') return value;
  }
  return null;
}
