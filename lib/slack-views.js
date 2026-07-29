import {
  calculateDurationMinutes,
  formatDuration,
  formatTokyoDateTime,
} from './time.js';

export const ACTION_WORK_START = 'work_start';
export const ACTION_WORK_END = 'work_end';
export const ACTION_REFRESH_HOME_DASHBOARD = 'refresh_home_dashboard';

function buildWorkStartButton() {
  return {
    type: 'button',
    action_id: ACTION_WORK_START,
    text: {
      type: 'plain_text',
      text: '▶ 作業開始',
      emoji: true,
    },
    style: 'primary',
    value: 'start',
  };
}

function buildWorkEndButton() {
  return {
    type: 'button',
    action_id: ACTION_WORK_END,
    text: {
      type: 'plain_text',
      text: '■ 作業終了',
      emoji: true,
    },
    style: 'danger',
    value: 'end',
  };
}

function buildRefreshHomeDashboardButton() {
  return {
    type: 'button',
    action_id: ACTION_REFRESH_HOME_DASHBOARD,
    text: {
      type: 'plain_text',
      text: '↻ 更新',
      emoji: true,
    },
    value: 'refresh',
  };
}

function buildActionsBlock(elements) {
  return {
    type: 'actions',
    elements,
  };
}

function buildSection(text) {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text,
    },
  };
}

function buildActiveSessionsText(activeSessions) {
  if (activeSessions.length === 0) {
    return '*現在作業中*\n⚪ 作業中のメンバーはいません。';
  }

  const rows = activeSessions.map((session) => {
    return `🟢 <@${session.slack_user_id}>　開始 ${formatTokyoDateTime(session.started_at)}`;
  });

  return ['*現在作業中*', ...rows].join('\n');
}

function buildTotalsText(title, totals) {
  if (totals.length === 0) {
    return `*${title}*\n記録はまだありません。`;
  }

  const rows = totals.map((summary) => {
    const activeLabel = summary.isActive ? '　🟢 作業中' : '';
    return `• <@${summary.slackUserId}>　${formatDuration(summary.totalMinutes)}${activeLabel}`;
  });

  return [`*${title}*`, ...rows].join('\n');
}

function buildUserStatusText({ activeSessions, todayTotals, userId, now }) {
  const activeSession = activeSessions.find((session) => session.slack_user_id === userId);
  const todaySummary = todayTotals.find((summary) => summary.slackUserId === userId);
  const todayDuration = todaySummary ? formatDuration(todaySummary.totalMinutes) : '0分';

  if (activeSession) {
    const elapsedMinutes = calculateDurationMinutes(activeSession.started_at, now);

    return [
      '*あなたの状況*',
      '🟢 作業中',
      `開始：${formatTokyoDateTime(activeSession.started_at)}`,
      `経過：${formatDuration(elapsedMinutes)}`,
      `本日合計：${todayDuration}`,
    ].join('\n');
  }

  return ['*あなたの状況*', '⚪ 待機中', `本日合計：${todayDuration}`].join('\n');
}

function buildRecentSessionsText(recentSessions) {
  if (recentSessions.length === 0) {
    return '*あなたの最近の作業*\n完了した作業はまだありません。';
  }

  const rows = recentSessions.map((session) => {
    const durationMinutes =
      session.duration_minutes ??
      calculateDurationMinutes(session.started_at, session.ended_at);

    return [
      `• ${formatTokyoDateTime(session.started_at)} 〜 ${formatTokyoDateTime(session.ended_at)}`,
      `　${formatDuration(durationMinutes)}`,
    ].join('\n');
  });

  return ['*あなたの最近の作業*', ...rows].join('\n');
}

export function buildWorkCommandModalView({
  activeSession = null,
  loading = false,
  now = new Date(),
} = {}) {
  let blocks;

  if (loading) {
    blocks = [buildSection('現在の作業状況を確認しています…')];
  } else if (activeSession) {
    const elapsedMinutes = calculateDurationMinutes(activeSession.started_at, now);
    blocks = [
      buildSection(
        [
          '*🟢 現在作業中です*',
          `開始：${formatTokyoDateTime(activeSession.started_at)}`,
          `経過：${formatDuration(elapsedMinutes)}`,
        ].join('\n'),
      ),
      buildActionsBlock([buildWorkEndButton()]),
    ];
  } else {
    blocks = [
      buildSection('*⚪ 現在は待機中です*\n作業を始める準備ができています。'),
      buildActionsBlock([buildWorkStartButton()]),
    ];
  }

  return {
    type: 'modal',
    callback_id: 'work_command_modal',
    title: {
      type: 'plain_text',
      text: '作業トラッカー',
      emoji: true,
    },
    close: {
      type: 'plain_text',
      text: '閉じる',
      emoji: true,
    },
    blocks,
  };
}

export function buildNoticeModalView(title, text) {
  return {
    type: 'modal',
    title: {
      type: 'plain_text',
      text: title.slice(0, 24),
      emoji: true,
    },
    close: {
      type: 'plain_text',
      text: '閉じる',
      emoji: true,
    },
    blocks: [buildSection(text)],
  };
}

export function buildHomeDashboardView({
  activeSessions,
  todayTotals,
  weekTotals,
  recentSessions = [],
  userId,
  now = new Date(),
}) {
  const isActive = activeSessions.some((session) => session.slack_user_id === userId);
  const primaryAction = isActive ? buildWorkEndButton() : buildWorkStartButton();

  return {
    type: 'home',
    callback_id: 'work_dashboard_home',
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '作業時間ダッシュボード',
          emoji: true,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `最終更新：${formatTokyoDateTime(now)}`,
          },
        ],
      },
      buildSection(buildUserStatusText({ activeSessions, todayTotals, userId, now })),
      buildActionsBlock([primaryAction, buildRefreshHomeDashboardButton()]),
      {
        type: 'divider',
      },
      buildSection(buildActiveSessionsText(activeSessions)),
      buildSection(buildTotalsText('本日の作業時間（作業中含む）', todayTotals)),
      buildSection(buildTotalsText('今週の作業時間（月〜日、作業中含む）', weekTotals)),
      {
        type: 'divider',
      },
      buildSection(buildRecentSessionsText(recentSessions)),
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '直近5件の完了した作業を表示しています。',
          },
        ],
      },
    ],
  };
}

export function buildWorkPanelBlocks(activeSessions = [], todayTotals = [], now = new Date()) {
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '作業時間トラッカー',
        emoji: true,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `開始・終了は下のボタンから　｜　更新：${formatTokyoDateTime(now)}`,
        },
      ],
    },
    buildSection(buildActiveSessionsText(activeSessions)),
    buildSection(buildTotalsText('本日の作業時間（作業中含む）', todayTotals)),
    buildActionsBlock([buildWorkStartButton(), buildWorkEndButton()]),
  ];
}
