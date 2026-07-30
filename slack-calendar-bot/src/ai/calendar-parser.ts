import {
  PARSED_EVENT_JSON_SCHEMA,
  parsedCalendarEventSchema,
  type ParsedCalendarEvent,
} from '../schemas/parsed-event.js';
import { AppError } from '../utils/errors.js';
import type { Logger } from '../utils/logger.js';
import type { JsonGenerationClient } from './client.js';
import { buildRetryPrompt, buildSystemPrompt, buildUserPrompt } from './prompts.js';
import type { ParseScheduleInput, ScheduleParser } from './types.js';

const MAX_INPUT_LENGTH = 2000;

/**
 * 生成 AI を使って自然言語から予定情報を抽出する。
 *
 * - 出力は必ず Zod で検証する
 * - 検証に失敗した場合は 1 回だけ再解析する
 * - それでも失敗したら AppError を投げ、ユーザーへ入力し直しを案内する
 */
export class AiScheduleParser implements ScheduleParser {
  constructor(
    private readonly client: JsonGenerationClient,
    private readonly logger: Logger,
  ) {}

  async parse({ text, now, timezone }: ParseScheduleInput): Promise<ParsedCalendarEvent> {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new AppError('INVALID_INPUT', '予定の内容が読み取れませんでした。');
    }
    if (trimmed.length > MAX_INPUT_LENGTH) {
      throw new AppError(
        'INVALID_INPUT',
        `メッセージが長すぎます（${MAX_INPUT_LENGTH}文字以内で入力してください）。`,
      );
    }

    const systemInstruction = buildSystemPrompt(now, timezone);

    const attempts: string[] = [buildUserPrompt(trimmed)];
    let lastError = '';

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const userPrompt = attempts[attempt] ?? buildRetryPrompt(trimmed, lastError);

      let raw: string;
      try {
        raw = await this.client.generateJson({
          systemInstruction,
          userPrompt,
          jsonSchema: PARSED_EVENT_JSON_SCHEMA as unknown as Record<string, unknown>,
        });
      } catch (cause) {
        // API 呼び出し自体の失敗はリトライしても回復しにくいので即座に打ち切る
        throw new AppError(
          'AI_PARSE_FAILED',
          '予定の解析に失敗しました。時間をおいて、もう一度お試しください。',
          { cause, details: { stage: 'api_call', attempt } },
        );
      }

      const parsed = this.validate(raw);
      if (parsed.ok) {
        return parsed.value;
      }

      lastError = parsed.error;
      this.logger.warn('AI の出力がスキーマ検証に失敗しました', {
        attempt,
        error: parsed.error,
      });
      attempts.push(buildRetryPrompt(trimmed, parsed.error));
    }

    throw new AppError(
      'AI_PARSE_FAILED',
      '予定の内容をうまく読み取れませんでした。表現を変えて、もう一度入力してください。',
      { details: { stage: 'schema_validation', lastError } },
    );
  }

  private validate(
    raw: string,
  ): { ok: true; value: ParsedCalendarEvent } | { ok: false; error: string } {
    let json: unknown;
    try {
      json = JSON.parse(stripCodeFence(raw));
    } catch {
      return { ok: false, error: 'JSON として解析できませんでした' };
    }

    const result = parsedCalendarEventSchema.safeParse(json);
    if (!result.success) {
      const summary = result.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join(' / ');
      return { ok: false, error: summary };
    }
    return { ok: true, value: result.data };
  }
}

/** ```json ... ``` で囲まれて返ってきた場合に備えて剥がす */
export function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/u.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}
