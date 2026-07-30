/**
 * 通知に表示されるフォールバックテキスト。
 * Block Kit を表示できない環境（通知バナーなど）で使われる。
 */
export const FALLBACK_TEXT = {
  confirmation: '予定の登録確認',
  success: 'Googleカレンダーに登録しました',
  cancelled: '予定の登録をキャンセルしました',
  question: '予定の日時を確認させてください',
  googleLink: 'Googleカレンダーとの連携が必要です',
  error: '予定の登録に失敗しました',
  processing: '予定を解析しています…',
} as const;

export const MESSAGES = {
  /** 他人の確認ボタンを押した場合 */
  forbidden: 'この確認メッセージを操作できるのは、依頼したご本人だけです。',
  /** 確認メッセージが古い / 既に処理済み */
  alreadyHandled: 'この予定はすでに処理済みです。',
  expired: 'この確認メッセージは有効期限が切れています。もう一度メンションしてください。',
  notFound: '対象の予定が見つかりませんでした。もう一度メンションしてください。',
  emptyMention: '登録したい予定を教えてください。\n例：`@CalendarBot 明日14時から16時まで資料作成`',
} as const;
