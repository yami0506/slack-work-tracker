import 'dotenv/config';
import http from 'node:http';
import slackBolt from '@slack/bolt';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import {
  calculateDurationMinutes,
  formatDuration,
  formatTokyoDateTime,
  getTokyoDayRange,
  getTokyoWeekRange,
} from './lib/time.js';
import {
  buildThreadReplyMessage,
  resolvePanelThreadTs,
  shouldRecreateWorkPanel,
} from './lib/slack-messages.js';
import {
  ACTION_REFRESH_HOME_DASHBOARD,
  ACTION_WORK_END,
  ACTION_WORK_START,
  buildHomeDashboardView,
  buildNoticeModalView,
  buildWorkCommandModalView,
  buildWorkPanelBlocks,
} from './lib/slack-views.js';

const { App } = slackBolt;

const REQUIRED_ENV_NAMES = [
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'SLACK_APP_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

const TABLE_NAME = 'work_sessions';
const APP_SETTINGS_TABLE_NAME = 'app_settings';
const DEFAULT_PORT = 3000;
const RECENT_SESSION_LIMIT = 5;
const SESSION_COLUMNS =
  'id, slack_user_id, slack_user_name, started_at, ended_at, duration_minutes, created_at';

function loadConfig() {
  const missingNames = REQUIRED_ENV_NAMES.filter((name) => !process.env[name]?.trim());

  if (missingNames.length > 0) {
    throw new Error(`必要な環境変数が不足しています: ${missingNames.join(', ')}`);
  }

  const config = {
    slackBotToken: process.env.SLACK_BOT_TOKEN.trim(),
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET.trim(),
    slackAppToken: process.env.SLACK_APP_TOKEN.trim(),
    supabaseUrl: process.env.SUPABASE_URL.trim(),
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY.trim(),
    workPanelChannelId: process.env.WORK_PANEL_CHANNEL_ID?.trim() || null,
    publicActivityNotifications: process.env.PUBLIC_ACTIVITY_NOTIFICATIONS?.trim() === 'true',
    allowLocalSocketMode: process.env.ALLOW_LOCAL_SOCKET_MODE?.trim() === 'true',
    isRender: process.env.RENDER?.trim() === 'true',
    port: Number(process.env.PORT || DEFAULT_PORT),
  };

  const validationErrors = [];

  if (!config.slackBotToken.startsWith('xoxb-')) {
    validationErrors.push('SLACK_BOT_TOKEN は xoxb- で始まるBot User OAuth Tokenを指定してください。');
  }

  if (!config.slackAppToken.startsWith('xapp-')) {
    validationErrors.push('SLACK_APP_TOKEN は xapp- で始まるApp-Level Tokenを指定してください。');
  }

  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    validationErrors.push('PORT は1から65535までの数値を指定してください。');
  }

  if (config.publicActivityNotifications && !config.workPanelChannelId) {
    validationErrors.push(
      'PUBLIC_ACTIVITY_NOTIFICATIONS=true の場合は WORK_PANEL_CHANNEL_ID も設定してください。',
    );
  }

  if (!config.isRender && !config.allowLocalSocketMode) {
    validationErrors.push(
      'Render版との二重接続を防ぐため、ローカルでのSocket Mode起動を停止しました。ローカル検証が必要な場合だけ ALLOW_LOCAL_SOCKET_MODE=true を設定してください。',
    );
  }

  try {
    new URL(config.supabaseUrl);
  } catch {
    validationErrors.push('SUPABASE_URL は有効なURLを指定してください。');
  }

  if (validationErrors.length > 0) {
    throw new Error(validationErrors.join('\n'));
  }

  return config;
}

function writeJsonResponse(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function startHealthServer(port) {
  const server = http.createServer((request, response) => {
    if (request.url === '/healthz') {
      writeJsonResponse(response, 200, {
        ok: true,
        service: 'slack-work-tracker',
        uptime_seconds: Math.floor(process.uptime()),
      });
      return;
    }

    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Slack Work Tracker is running.\n');
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`ヘルスチェック用HTTPサーバーを起動しました。host=0.0.0.0, port=${port}`);
  });

  server.on('error', (error) => {
    console.error('ヘルスチェック用HTTPサーバーでエラーが発生しました。', error);
  });
}

function registerProcessErrorHandlers() {
  process.on('unhandledRejection', (reason) => {
    console.error('未処理のPromiseエラーが発生しました。', reason);
  });

  process.on('uncaughtException', (error) => {
    console.error('未処理の例外が発生しました。プロセスを終了します。', error);
    process.exit(1);
  });
}

function createSupabaseClient(config) {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      transport: WebSocket,
    },
  });
}

function getSlackUserName(user) {
  const rawName = user?.username || user?.name;

  if (typeof rawName !== 'string') {
    return null;
  }

  const trimmedName = rawName.trim();
  return trimmedName.length > 80 ? trimmedName.slice(0, 80) : trimmedName || null;
}

function isUniqueViolation(error) {
  return error?.code === '23505' || error?.message?.includes('duplicate key');
}

async function openWorkCommandModal({ body, client, supabase }) {
  let openedView;

  try {
    const result = await client.views.open({
      trigger_id: body.trigger_id,
      view: buildWorkCommandModalView({ loading: true }),
    });
    openedView = result.view;
  } catch (error) {
    console.error('作業操作モーダルの表示に失敗しました。', getSlackErrorCode(error));
    return;
  }

  if (!openedView?.id) {
    console.error('作業操作モーダルのView IDを取得できませんでした。');
    return;
  }

  try {
    const slackUserId = getSlackUserId(body);
    const activeSession = slackUserId
      ? await findActiveSession(supabase, slackUserId)
      : null;

    await client.views.update({
      view_id: openedView.id,
      view: buildWorkCommandModalView({ activeSession }),
    });
  } catch (error) {
    console.error('作業操作モーダルの状態更新に失敗しました。', getSlackErrorCode(error));

    try {
      await client.views.update({
        view_id: openedView.id,
        view: buildNoticeModalView(
          '確認できません',
          '現在の作業状況を確認できませんでした。少し時間をおいてもう一度お試しください。',
        ),
      });
    } catch (noticeError) {
      console.error(
        '作業操作モーダルのエラー表示に失敗しました。',
        getSlackErrorCode(noticeError),
      );
    }
  }
}

async function showUserNotice({ body, client, title, text }) {
  const view = buildNoticeModalView(title, text);

  try {
    if (isModalInteraction(body)) {
      await client.views.update({
        view_id: body.view.id,
        view,
      });
      return true;
    }

    if (body?.trigger_id) {
      await client.views.open({
        trigger_id: body.trigger_id,
        view,
      });
      return true;
    }
  } catch (error) {
    console.error('個別案内モーダルの表示に失敗しました。', getSlackErrorCode(error));
  }

  return false;
}

async function findActiveSession(supabase, slackUserId) {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select(SESSION_COLUMNS)
    .eq('slack_user_id', slackUserId)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function findActiveSessions(supabase) {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select(SESSION_COLUMNS)
    .is('ended_at', null)
    .order('started_at', { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

async function findSessionsInRange(supabase, range) {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select(SESSION_COLUMNS)
    .lt('started_at', range.end.toISOString())
    .or(`ended_at.gte.${range.start.toISOString()},ended_at.is.null`)
    .order('started_at', { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

async function findRecentCompletedSessions(supabase, slackUserId, limit = RECENT_SESSION_LIMIT) {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select(SESSION_COLUMNS)
    .eq('slack_user_id', slackUserId)
    .not('ended_at', 'is', null)
    .order('ended_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return data || [];
}

function calculateSessionMinutesWithinRange(session, range, now = new Date()) {
  const startedAtTime = new Date(session.started_at).getTime();
  const endedAtTime = session.ended_at ? new Date(session.ended_at).getTime() : now.getTime();
  const rangeStartTime = range.start.getTime();
  const rangeEndTime = range.end.getTime();

  if (Number.isNaN(startedAtTime) || Number.isNaN(endedAtTime)) {
    return 0;
  }

  const effectiveStartTime = Math.max(startedAtTime, rangeStartTime);
  const effectiveEndTime = Math.min(endedAtTime, rangeEndTime);
  const durationMs = Math.max(0, effectiveEndTime - effectiveStartTime);

  return Math.floor(durationMs / 1000 / 60);
}

function summarizeSessions(sessions, range, now = new Date()) {
  const summariesByUser = new Map();

  for (const session of sessions) {
    const totalMinutes = calculateSessionMinutesWithinRange(session, range, now);
    const isActive = !session.ended_at;

    if (totalMinutes === 0 && !isActive) {
      continue;
    }

    const existingSummary = summariesByUser.get(session.slack_user_id) || {
      slackUserId: session.slack_user_id,
      totalMinutes: 0,
      isActive: false,
    };

    existingSummary.totalMinutes += totalMinutes;
    existingSummary.isActive = existingSummary.isActive || isActive;
    summariesByUser.set(session.slack_user_id, existingSummary);
  }

  return [...summariesByUser.values()].sort((a, b) => {
    if (b.totalMinutes !== a.totalMinutes) {
      return b.totalMinutes - a.totalMinutes;
    }

    return a.slackUserId.localeCompare(b.slackUserId);
  });
}

function getWorkPanelSettingKey(channelId) {
  return `work_panel:${channelId}`;
}

async function getAppSetting(supabase, key) {
  const { data, error } = await supabase
    .from(APP_SETTINGS_TABLE_NAME)
    .select('key, value')
    .eq('key', key)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.value || null;
}

async function setAppSetting(supabase, key, value) {
  const { error } = await supabase.from(APP_SETTINGS_TABLE_NAME).upsert({
    key,
    value,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw error;
  }
}

async function createWorkSession(supabase, slackUserId, slackUserName) {
  const startedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert({
      slack_user_id: slackUserId,
      slack_user_name: slackUserName,
      started_at: startedAt,
    })
    .select(SESSION_COLUMNS)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function finishWorkSession(supabase, session, slackUserId) {
  const endedAt = new Date().toISOString();
  const durationMinutes = calculateDurationMinutes(session.started_at, endedAt);

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update({
      ended_at: endedAt,
      duration_minutes: durationMinutes,
    })
    .eq('id', session.id)
    .eq('slack_user_id', slackUserId)
    .is('ended_at', null)
    .select(SESSION_COLUMNS)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

function getSlackUserId(body) {
  return body?.user?.id || body?.user_id || null;
}

function isModalInteraction(body) {
  return body?.view?.type === 'modal';
}

async function getWorkPanelInfo(supabase, channelId) {
  if (!channelId) {
    return null;
  }

  return getAppSetting(supabase, getWorkPanelSettingKey(channelId));
}

async function postPublicActivityNotification({ client, config, supabase, text, threadTs = null }) {
  if (!config.publicActivityNotifications) {
    return false;
  }

  if (!config.workPanelChannelId) {
    console.error('PUBLIC_ACTIVITY_NOTIFICATIONS=true ですが WORK_PANEL_CHANNEL_ID が未設定です。');
    return false;
  }

  try {
    const panelInfo = threadTs ? null : await getWorkPanelInfo(supabase, config.workPanelChannelId);
    const targetThreadTs = resolvePanelThreadTs({
      channelId: config.workPanelChannelId,
      explicitThreadTs: threadTs,
      panelInfo,
    });

    if (!targetThreadTs) {
      console.error(
        '有効な作業パネルのスレッドIDを取得できないため、公開通知をスキップしました。',
      );
      return false;
    }

    const result = await client.chat.postMessage(
      buildThreadReplyMessage({
        channelId: config.workPanelChannelId,
        threadTs: targetThreadTs,
        text,
      }),
    );

    console.log(
      `作業通知をパネルのスレッドに投稿しました。channel=${config.workPanelChannelId}, thread_ts=${targetThreadTs}, ts=${result.ts}`,
    );

    return true;
  } catch (error) {
    console.error('作業状況のチャンネル通知に失敗しました。', getSlackErrorCode(error));
    return false;
  }
}

async function refreshWorkPanel({ client, config, supabase }) {
  if (!config.workPanelChannelId) {
    return null;
  }

  try {
    return await publishOrUpdateWorkPanel({
      client,
      supabase,
      channelId: config.workPanelChannelId,
    });
  } catch (error) {
    console.error('作業パネルの更新に失敗しました。', getSlackErrorCode(error));
    return null;
  }
}

async function loadDashboardData(supabase, now = new Date()) {
  const todayRange = getTokyoDayRange(now);
  const weekRange = getTokyoWeekRange(now);

  const [activeSessions, todaySessions, weekSessions] = await Promise.all([
    findActiveSessions(supabase),
    findSessionsInRange(supabase, todayRange),
    findSessionsInRange(supabase, weekRange),
  ]);

  return {
    activeSessions,
    todayTotals: summarizeSessions(todaySessions, todayRange, now),
    weekTotals: summarizeSessions(weekSessions, weekRange, now),
  };
}

async function publishHomeDashboard({ client, supabase, userId }) {
  const now = new Date();
  const [dashboardData, recentSessions] = await Promise.all([
    loadDashboardData(supabase, now),
    findRecentCompletedSessions(supabase, userId),
  ]);

  await client.views.publish({
    user_id: userId,
    view: buildHomeDashboardView({
      ...dashboardData,
      recentSessions,
      userId,
      now,
    }),
  });
}

async function refreshHomeDashboard({ client, supabase, userId }) {
  try {
    await publishHomeDashboard({ client, supabase, userId });
  } catch (error) {
    console.error('App Homeダッシュボードの更新に失敗しました。', getSlackErrorCode(error));
  }
}

async function handleWorkStart({ body, client, config, supabase }) {
  const slackUserId = getSlackUserId(body);
  const slackUserName = getSlackUserName(body?.user);

  if (!slackUserId) {
    console.error('作業開始処理でSlackユーザーIDを取得できませんでした。', body);
    await showUserNotice({
      body,
      client,
      title: '確認できません',
      text: 'ユーザー情報を確認できませんでした。もう一度お試しください。',
    });
    return;
  }

  try {
    const activeSession = await findActiveSession(supabase, slackUserId);

    if (activeSession) {
      await showUserNotice({
        body,
        client,
        title: '作業中です',
        text: `すでに作業中です。\n開始時刻：${formatTokyoDateTime(activeSession.started_at)}`,
      });
      return;
    }

    const createdSession = await createWorkSession(supabase, slackUserId, slackUserName);

    const panelInfo = await refreshWorkPanel({ client, config, supabase });

    const startNotificationText = [
      `▶ <@${slackUserId}> が作業を開始しました`,
      `開始：${formatTokyoDateTime(createdSession.started_at)}`,
    ].join('\n');

    await postPublicActivityNotification({
      client,
      config,
      supabase,
      text: startNotificationText,
      threadTs: panelInfo?.messageTs,
    });

    await refreshHomeDashboard({ client, supabase, userId: slackUserId });

    if (isModalInteraction(body)) {
      await showUserNotice({
        body,
        client,
        title: '作業開始',
        text: `▶ 作業を開始しました。\n開始時刻：${formatTokyoDateTime(createdSession.started_at)}`,
      });
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      console.error('作業開始が重複しました。既存セッションを確認します。', error);

      try {
        const activeSession = await findActiveSession(supabase, slackUserId);

        if (activeSession) {
          await showUserNotice({
            body,
            client,
            title: '作業中です',
            text: `すでに作業中です。\n開始時刻：${formatTokyoDateTime(activeSession.started_at)}`,
          });
          return;
        }
      } catch (fetchError) {
        console.error('重複発生後の未終了セッション取得に失敗しました。', fetchError);
      }
    } else {
      console.error('作業開始処理でエラーが発生しました。', error);
    }

    await showUserNotice({
      body,
      client,
      title: '記録できません',
      text: '作業開始を記録できませんでした。少し時間をおいてもう一度お試しください。',
    });
  }
}

async function handleWorkEnd({ body, client, config, supabase }) {
  const slackUserId = getSlackUserId(body);

  if (!slackUserId) {
    console.error('作業終了処理でSlackユーザーIDを取得できませんでした。', body);
    await showUserNotice({
      body,
      client,
      title: '確認できません',
      text: 'ユーザー情報を確認できませんでした。もう一度お試しください。',
    });
    return;
  }

  try {
    const activeSession = await findActiveSession(supabase, slackUserId);

    if (!activeSession) {
      await showUserNotice({
        body,
        client,
        title: '作業がありません',
        text: '開始中の作業がありません。先に「作業開始」を押してください。',
      });
      return;
    }

    const updatedSession = await finishWorkSession(supabase, activeSession, slackUserId);

    if (!updatedSession) {
      await showUserNotice({
        body,
        client,
        title: '終了済みです',
        text: '開始中の作業がありません。すでに終了済みの可能性があります。',
      });
      return;
    }

    const panelInfo = await refreshWorkPanel({ client, config, supabase });

    await postPublicActivityNotification({
      client,
      config,
      supabase,
      text: [
        `■ <@${slackUserId}> が作業を終了しました`,
        `開始：${formatTokyoDateTime(updatedSession.started_at)}`,
        `終了：${formatTokyoDateTime(updatedSession.ended_at)}`,
        `作業時間：${formatDuration(updatedSession.duration_minutes)}`,
      ].join('\n'),
      threadTs: panelInfo?.messageTs,
    });

    await refreshHomeDashboard({ client, supabase, userId: slackUserId });

    const endNoticeText = [
      '■ 作業を終了しました。',
      `開始：${formatTokyoDateTime(updatedSession.started_at)}`,
      `終了：${formatTokyoDateTime(updatedSession.ended_at)}`,
      `作業時間：${formatDuration(updatedSession.duration_minutes)}`,
    ].join('\n');

    if (isModalInteraction(body)) {
      await showUserNotice({
        body,
        client,
        title: '作業終了',
        text: endNoticeText,
      });
    }
  } catch (error) {
    console.error('作業終了処理でエラーが発生しました。', error);
    await showUserNotice({
      body,
      client,
      title: '記録できません',
      text: '作業終了を記録できませんでした。少し時間をおいてもう一度お試しください。',
    });
  }
}

function getSlackErrorCode(error) {
  return error?.data?.error || error?.code || error?.message || 'unknown_error';
}

async function publishOrUpdateWorkPanel({ client, supabase, channelId }) {
  const settingKey = getWorkPanelSettingKey(channelId);
  const text = '作業時間トラッカー';
  const { activeSessions, todayTotals } = await loadDashboardData(supabase);
  const blocks = buildWorkPanelBlocks(activeSessions, todayTotals);
  const savedPanel = await getAppSetting(supabase, settingKey);
  const savedMessageTs = savedPanel?.message_ts;

  if (savedMessageTs) {
    try {
      await client.chat.update({
        channel: channelId,
        ts: savedMessageTs,
        text,
        blocks,
      });
      console.log(`作業パネルを更新しました。channel=${channelId}, ts=${savedMessageTs}`);
      return {
        channelId,
        messageTs: savedMessageTs,
      };
    } catch (error) {
      const errorCode = getSlackErrorCode(error);

      if (!shouldRecreateWorkPanel(errorCode)) {
        console.error(
          '既存の作業パネル更新に失敗しました。一時エラーの可能性があるため、新しいチャンネル投稿は作成しません。',
          errorCode,
        );
        throw error;
      }

      console.warn('保存済みの作業パネルが見つからないため、新しく投稿します。');
    }
  }

  const result = await client.chat.postMessage({
    channel: channelId,
    text,
    blocks,
  });

  await setAppSetting(supabase, settingKey, {
    channel_id: channelId,
    message_ts: result.ts,
  });

  console.log(`作業パネルを投稿しました。channel=${channelId}, ts=${result.ts}`);

  return {
    channelId,
    messageTs: result.ts,
  };
}

let config;

registerProcessErrorHandlers();

try {
  config = loadConfig();
} catch (error) {
  console.error('起動設定に問題があります。');
  console.error(error.message);
  process.exit(1);
}

const supabase = createSupabaseClient(config);

const app = new App({
  token: config.slackBotToken,
  signingSecret: config.slackSigningSecret,
  socketMode: true,
  appToken: config.slackAppToken,
});

app.command('/work', async ({ ack, body, client }) => {
  await ack();

  await openWorkCommandModal({ body, client, supabase });
});

app.action(ACTION_WORK_START, async ({ ack, body, client }) => {
  await ack();
  await handleWorkStart({ body, client, config, supabase });
});

app.action(ACTION_WORK_END, async ({ ack, body, client }) => {
  await ack();
  await handleWorkEnd({ body, client, config, supabase });
});

app.action(ACTION_REFRESH_HOME_DASHBOARD, async ({ ack, body, client }) => {
  await ack();

  const slackUserId = getSlackUserId(body);

  if (!slackUserId) {
    console.error('App Home更新処理でSlackユーザーIDを取得できませんでした。', body);
    return;
  }

  await refreshHomeDashboard({ client, supabase, userId: slackUserId });
});

app.event('app_home_opened', async ({ event, client }) => {
  if (event.tab && event.tab !== 'home') {
    return;
  }

  await refreshHomeDashboard({ client, supabase, userId: event.user });
});

app.error(async (error) => {
  console.error('Slack Boltでエラーが発生しました。', error);
});

async function startApp() {
  try {
    startHealthServer(config.port);
    await app.start();
    console.log('Slack Work Trackerを起動しました。Socket Modeで接続中です。');

    if (config.workPanelChannelId) {
      try {
        await publishOrUpdateWorkPanel({
          client: app.client,
          supabase,
          channelId: config.workPanelChannelId,
        });
      } catch (error) {
        console.error(
          '作業パネルの投稿または更新に失敗しました。WORK_PANEL_CHANNEL_ID、Botのチャンネル参加、app_settingsテーブルを確認してください。',
          getSlackErrorCode(error),
        );
      }
    } else {
      console.log('WORK_PANEL_CHANNEL_ID が未設定のため、チャンネル常設パネルは投稿しません。');
    }
  } catch (error) {
    console.error('Slack Work Trackerの起動に失敗しました。', error);
    process.exit(1);
  }
}

startApp();
