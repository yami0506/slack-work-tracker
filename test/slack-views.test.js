import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTION_REFRESH_HOME_DASHBOARD,
  ACTION_WORK_END,
  ACTION_WORK_START,
  buildHomeDashboardView,
  buildWorkCommandModalView,
  buildWorkPanelBlocks,
} from '../lib/slack-views.js';

const NOW = new Date('2026-07-29T12:00:00.000Z');
const USER_ID = 'U0123456789';

function getActionIds(view) {
  return view.blocks
    .filter((block) => block.type === 'actions')
    .flatMap((block) => block.elements.map((element) => element.action_id));
}

function getViewText(view) {
  return JSON.stringify(view.blocks);
}

test('待機中のApp Homeには作業開始と更新だけを表示する', () => {
  const view = buildHomeDashboardView({
    activeSessions: [],
    todayTotals: [],
    weekTotals: [],
    recentSessions: [],
    userId: USER_ID,
    now: NOW,
  });

  assert.deepEqual(getActionIds(view), [ACTION_WORK_START, ACTION_REFRESH_HOME_DASHBOARD]);
  assert.match(getViewText(view), /⚪ 待機中/);
  assert.doesNotMatch(getViewText(view), /作業終了/);
});

test('作業中のApp Homeには作業終了と更新だけを表示する', () => {
  const view = buildHomeDashboardView({
    activeSessions: [
      {
        slack_user_id: USER_ID,
        started_at: '2026-07-29T10:30:00.000Z',
      },
    ],
    todayTotals: [
      {
        slackUserId: USER_ID,
        totalMinutes: 90,
        isActive: true,
      },
    ],
    weekTotals: [],
    recentSessions: [],
    userId: USER_ID,
    now: NOW,
  });

  assert.deepEqual(getActionIds(view), [ACTION_WORK_END, ACTION_REFRESH_HOME_DASHBOARD]);
  assert.match(getViewText(view), /🟢 作業中/);
  assert.match(getViewText(view), /経過：1時間30分/);
  assert.doesNotMatch(getViewText(view), /作業開始/);
});

test('App Homeに直近の完了作業を表示する', () => {
  const view = buildHomeDashboardView({
    activeSessions: [],
    todayTotals: [],
    weekTotals: [],
    recentSessions: [
      {
        started_at: '2026-07-29T10:00:00.000Z',
        ended_at: '2026-07-29T11:15:00.000Z',
        duration_minutes: 75,
      },
    ],
    userId: USER_ID,
    now: NOW,
  });

  assert.match(getViewText(view), /あなたの最近の作業/);
  assert.match(getViewText(view), /1時間15分/);
});

test('/workモーダルは現在の状態に合う操作だけを表示する', () => {
  const idleView = buildWorkCommandModalView({ now: NOW });
  const activeView = buildWorkCommandModalView({
    activeSession: {
      started_at: '2026-07-29T10:30:00.000Z',
    },
    now: NOW,
  });

  assert.deepEqual(getActionIds(idleView), [ACTION_WORK_START]);
  assert.deepEqual(getActionIds(activeView), [ACTION_WORK_END]);
});

test('チャンネル共用パネルには開始と終了の両方を表示する', () => {
  const blocks = buildWorkPanelBlocks([], [], NOW);
  const view = { blocks };

  assert.deepEqual(getActionIds(view), [ACTION_WORK_START, ACTION_WORK_END]);
  assert.match(getViewText(view), /更新：7\/29 21:00/);
});
