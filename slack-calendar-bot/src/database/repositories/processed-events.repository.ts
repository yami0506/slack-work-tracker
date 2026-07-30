import { UNIQUE_VIOLATION, type Database } from '../client.js';
import { AppError } from '../../utils/errors.js';

const TABLE = 'processed_events';

/**
 * Slack イベントの再送による二重処理を防ぐ。
 *
 * slack_event_id に UNIQUE 制約があるため、INSERT が成功したプロセスだけが
 * 「初回処理」とみなされる。競合時は一意制約違反になり false を返す。
 */
export class ProcessedEventsRepository {
  constructor(private readonly db: Database) {}

  /**
   * @returns 初回処理なら true、既に処理済み（再送）なら false
   */
  async markProcessed(slackEventId: string): Promise<boolean> {
    const { error } = await this.db.from(TABLE).insert({ slack_event_id: slackEventId });

    if (!error) return true;
    if (error.code === UNIQUE_VIOLATION) return false;

    throw new AppError('DATABASE_FAILED', 'データの保存中に問題が発生しました。', {
      cause: error,
      message: '処理済みイベントの記録に失敗しました',
    });
  }

  async isProcessed(slackEventId: string): Promise<boolean> {
    const { data, error } = await this.db
      .from(TABLE)
      .select('id')
      .eq('slack_event_id', slackEventId)
      .maybeSingle<{ id: string }>();

    if (error) {
      throw new AppError('DATABASE_FAILED', 'データの取得中に問題が発生しました。', {
        cause: error,
        message: '処理済みイベントの確認に失敗しました',
      });
    }
    return data !== null;
  }
}
