/**
 * Slack メッセージから Bot へのメンション文字列を取り除く。
 *
 * Slack のテキストは `<@U12345678> 明日14時から16時まで資料作成` の形で届く。
 * Bot 自身のメンションだけでなく、先頭に並んだ他のメンションも除去して、
 * 予定本文だけを AI へ渡す。
 */
export function stripMention(text: string, botUserId?: string): string {
  if (!text) return '';

  let result = text;

  // 1. Bot 自身のメンションはどこにあっても除去する
  if (botUserId) {
    const botPattern = new RegExp(`<@${escapeRegExp(botUserId)}(\\|[^>]*)?>`, 'g');
    result = result.replace(botPattern, ' ');
  }

  // 2. 先頭に連続して並ぶメンション（<@U...> / <!here> など）を除去する
  result = result.replace(/^(\s*(<@[^>]+>|<!(here|channel|everyone)(\|[^>]*)?>)\s*)+/u, '');

  // 3. Slack のエスケープを戻す
  result = result.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  // 4. 前後の空白と全角スペースを整理
  return result.replace(/[\s　]+/gu, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
