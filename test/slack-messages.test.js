import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildThreadReplyMessage,
  resolvePanelThreadTs,
  shouldRecreateWorkPanel,
} from '../lib/slack-messages.js';

test('スレッド返信には親メッセージIDと非ブロードキャスト指定を必ず含める', () => {
  assert.deepEqual(
    buildThreadReplyMessage({
      channelId: 'C0123456789',
      threadTs: '1785290000.123456',
      text: '作業を開始しました',
    }),
    {
      channel: 'C0123456789',
      text: '作業を開始しました',
      thread_ts: '1785290000.123456',
      reply_broadcast: false,
    },
  );
});

test('親メッセージIDが不正な場合は通知を組み立てない', () => {
  assert.throws(
    () =>
      buildThreadReplyMessage({
        channelId: 'C0123456789',
        threadTs: null,
        text: '作業を終了しました',
      }),
    /valid Slack thread timestamp/,
  );
});

test('保存済みパネルは同じチャンネルかつ正しいIDのときだけ使用する', () => {
  assert.equal(
    resolvePanelThreadTs({
      channelId: 'C0123456789',
      panelInfo: {
        channel_id: 'C0123456789',
        message_ts: '1785290000.123456',
      },
    }),
    '1785290000.123456',
  );

  assert.equal(
    resolvePanelThreadTs({
      channelId: 'C0123456789',
      panelInfo: {
        channel_id: 'C9999999999',
        message_ts: '1785290000.123456',
      },
    }),
    null,
  );
});

test('パネルを再投稿するのは親メッセージが削除済みの場合だけ', () => {
  assert.equal(shouldRecreateWorkPanel('message_not_found'), true);
  assert.equal(shouldRecreateWorkPanel('ratelimited'), false);
  assert.equal(shouldRecreateWorkPanel('slack_webapi_platform_error'), false);
});
