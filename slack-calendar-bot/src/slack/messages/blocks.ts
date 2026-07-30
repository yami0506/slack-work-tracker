import type { KnownBlock } from '@slack/types';
import type { NormalizedEvent } from '../../services/event-normalizer.js';
import { formatEventRange, formatEventRangeShort } from '../../utils/datetime.js';

export const ACTION_REGISTER = 'calendar_register';
export const ACTION_CANCEL = 'calendar_cancel';

export interface ConfirmationInput {
  pendingId: string;
  event: NormalizedEvent;
  calendarLabel: string;
}

/**
 * 登録前の確認メッセージ。
 * Actions Block に「登録する」「キャンセル」を配置する。
 */
export function buildConfirmationBlocks({
  pendingId,
  event,
  calendarLabel,
}: ConfirmationInput): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '次の予定を登録します。' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*予定名*\n${escapeMrkdwn(event.title)}` },
        { type: 'mrkdwn', text: `*日時*\n${formatEventRange(event)}` },
        { type: 'mrkdwn', text: `*カレンダー*\n${escapeMrkdwn(calendarLabel)}` },
        { type: 'mrkdwn', text: `*タイムゾーン*\n${event.timezone}` },
      ],
    },
  ];

  if (event.description) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*メモ*\n${escapeMrkdwn(event.description)}` },
    });
  }

  for (const warning of event.warnings) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `:warning: ${escapeMrkdwn(warning)}` }],
    });
  }

  blocks.push({
    type: 'actions',
    block_id: `calendar_confirm:${pendingId}`,
    elements: [
      {
        type: 'button',
        action_id: ACTION_REGISTER,
        text: { type: 'plain_text', text: '登録する', emoji: false },
        style: 'primary',
        value: pendingId,
      },
      {
        type: 'button',
        action_id: ACTION_CANCEL,
        text: { type: 'plain_text', text: 'キャンセル', emoji: false },
        value: pendingId,
      },
    ],
  });

  return blocks;
}

export interface SuccessInput {
  event: NormalizedEvent;
  htmlLink: string | null;
}

/** 登録完了メッセージ */
export function buildSuccessBlocks({ event, htmlLink }: SuccessInput): KnownBlock[] {
  const lines = [
    ':white_check_mark: Googleカレンダーに登録しました。',
    `*${escapeMrkdwn(event.title)}*`,
    formatEventRangeShort(event),
  ];
  if (htmlLink) {
    lines.push(`<${htmlLink}|Googleカレンダーで開く>`);
  }

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: lines.join('\n') },
    },
  ];
}

/** キャンセルメッセージ */
export function buildCancelledBlocks(): KnownBlock[] {
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '予定の登録をキャンセルしました。' },
    },
  ];
}

/** 日時が曖昧なときの質問メッセージ */
export function buildQuestionBlocks(question: string): KnownBlock[] {
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: escapeMrkdwn(question) },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '例：\n`@CalendarBot 明日14時から16時まで資料作成`',
        },
      ],
    },
  ];
}

/** Google 未連携のときの案内 */
export function buildGoogleLinkBlocks(linkUrl: string): KnownBlock[] {
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: 'Googleカレンダーとの連携が必要です。' },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          action_id: 'google_link',
          text: { type: 'plain_text', text: 'Googleアカウントを連携する', emoji: false },
          style: 'primary',
          url: linkUrl,
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '連携が完了したら、もう一度メンションしてください。（リンクの有効期限は15分です）',
        },
      ],
    },
  ];
}

/** エラーメッセージ（技術詳細は含めない） */
export function buildErrorBlocks(userMessage: string): KnownBlock[] {
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `:warning: ${escapeMrkdwn(userMessage)}` },
    },
  ];
}

/**
 * Slack の mrkdwn 記法で解釈される文字をエスケープする。
 * ユーザー入力や AI 出力をそのまま埋め込まないための最低限の防御。
 */
export function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
