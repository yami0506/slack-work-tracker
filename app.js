import 'dotenv/config';
import http from 'node:http';
import slackBolt from '@slack/bolt';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { calculateDurationMinutes, formatDuration, formatTokyoDateTime } from './lib/time.js';

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
const ACTION_WORK_START = 'work_start';
const ACTION_WORK_END = 'work_end';
const DEFAULT_PORT = 3000;
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

function startHealthServer(port) {
  const server = http.createServer((request, response) => {
    if (request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, service: 'slack-work-tracker' }));
      return;
    }

    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Slack Work Tracker is running.\n');
  });

  server.listen(port, () => {
    console.log(`ヘルスチェック用HTTPサーバーを起動しました。port=${port}`);
  });

  server.on('error', (error) => {
    console.error('ヘルスチェック用HTTPサーバーでエラーが発生しました。', error);
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

function buildWorkActionBlock() {
  return {
    type: 'actions',
    elements: [
      {
        type: 'button',
        action_id: ACTION_WORK_START,
        text: {
          type: 'plain_text',
          text: '▶ 作業開始',
          emoji: true,
        },
        style: 'primary',
        value: 'start',
      },
      {
        type: 'button',
        action_id: ACTION_WORK_END,
        text: {
          type: 'plain_text',
          text: '■ 作業終了',
          emoji: true,
        },
        style: 'danger',
        value: 'end',
      },
    ],
  };
}

function buildWorkCommandBlocks() {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '作業の開始または終了を選択してください。',
      },
    },
    buildWorkActionBlock(),
  ];
}

function buildActiveSessionsText(activeSessions) {
  if (activeSessions.length === 0) {
    return '*現在作業中*\n作業中のメンバーはいません。';
  }

  const rows = activeSessions.map((session) => {
    return `• <@${session.slack_user_id}> ${formatTokyoDateTime(session.started_at)}〜`;
  });

  return ['*現在作業中*', ...rows].join('\n');
}

function buildWorkPanelBlocks(activeSessions = []) {
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
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '作業を始める時と終える時に、下のボタンを押してください。',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: buildActiveSessionsText(activeSessions),
      },
    },
    buildWorkActionBlock(),
  ];
}

async function respondEphemeral(respond, text, blocks = undefined) {
  try {
    await respond({
      response_type: 'ephemeral',
      replace_original: false,
      text,
      blocks,
    });
  } catch (error) {
    console.error('Slackへのメッセージ送信に失敗しました。', error);
  }
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

async function getWorkPanelInfo(supabase, channelId) {
  if (!channelId) {
    return null;
  }

  return getAppSetting(supabase, getWorkPanelSettingKey(channelId));
}

async function postPublicActivityNotification({ client, config, supabase, text }) {
  if (!config.publicActivityNotifications) {
    return;
  }

  if (!config.workPanelChannelId) {
    console.error('PUBLIC_ACTIVITY_NOTIFICATIONS=true ですが WORK_PANEL_CHANNEL_ID が未設定です。');
    return;
  }

  try {
    const panelInfo = await getWorkPanelInfo(supabase, config.workPanelChannelId);

    await client.chat.postMessage({
      channel: config.workPanelChannelId,
      text,
      thread_ts: panelInfo?.message_ts,
    });
  } catch (error) {
    console.error('作業状況のチャンネル通知に失敗しました。', getSlackErrorCode(error));
  }
}

async function refreshWorkPanel({ client, config, supabase }) {
  if (!config.workPanelChannelId) {
    return;
  }

  try {
    await publishOrUpdateWorkPanel({
      client,
      supabase,
      channelId: config.workPanelChannelId,
    });
  } catch (error) {
    console.error('作業パネルの更新に失敗しました。', getSlackErrorCode(error));
  }
}

async function handleWorkStart({ body, client, config, respond, supabase }) {
  const slackUserId = getSlackUserId(body);
  const slackUserName = getSlackUserName(body?.user);

  if (!slackUserId) {
    console.error('作業開始処理でSlackユーザーIDを取得できませんでした。', body);
    await respondEphemeral(respond, 'ユーザー情報を確認できませんでした。もう一度お試しください。');
    return;
  }

  try {
    const activeSession = await findActiveSession(supabase, slackUserId);

    if (activeSession) {
      await respondEphemeral(
        respond,
        `すでに作業中です。\n開始時刻：${formatTokyoDateTime(activeSession.started_at)}`,
      );
      return;
    }

    const createdSession = await createWorkSession(supabase, slackUserId, slackUserName);

    await refreshWorkPanel({ client, config, supabase });

    await postPublicActivityNotification({
      client,
      config,
      supabase,
      text: `▶ <@${slackUserId}> が作業を開始しました（${formatTokyoDateTime(createdSession.started_at)}）`,
    });

    await respondEphemeral(
      respond,
      `▶ 作業を開始しました。\n開始時刻：${formatTokyoDateTime(createdSession.started_at)}`,
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      console.error('作業開始が重複しました。既存セッションを確認します。', error);

      try {
        const activeSession = await findActiveSession(supabase, slackUserId);

        if (activeSession) {
          await respondEphemeral(
            respond,
            `すでに作業中です。\n開始時刻：${formatTokyoDateTime(activeSession.started_at)}`,
          );
          return;
        }
      } catch (fetchError) {
        console.error('重複発生後の未終了セッション取得に失敗しました。', fetchError);
      }
    } else {
      console.error('作業開始処理でエラーが発生しました。', error);
    }

    await respondEphemeral(
      respond,
      '作業開始を記録できませんでした。少し時間をおいてもう一度お試しください。',
    );
  }
}

async function handleWorkEnd({ body, client, config, respond, supabase }) {
  const slackUserId = getSlackUserId(body);

  if (!slackUserId) {
    console.error('作業終了処理でSlackユーザーIDを取得できませんでした。', body);
    await respondEphemeral(respond, 'ユーザー情報を確認できませんでした。もう一度お試しください。');
    return;
  }

  try {
    const activeSession = await findActiveSession(supabase, slackUserId);

    if (!activeSession) {
      await respondEphemeral(
        respond,
        '開始中の作業がありません。先に「作業開始」を押してください。',
      );
      return;
    }

    const updatedSession = await finishWorkSession(supabase, activeSession, slackUserId);

    if (!updatedSession) {
      await respondEphemeral(
        respond,
        '開始中の作業がありません。すでに終了済みの可能性があります。',
      );
      return;
    }

    await respondEphemeral(
      respond,
      [
        '■ 作業を終了しました。',
        `開始：${formatTokyoDateTime(updatedSession.started_at)}`,
        `終了：${formatTokyoDateTime(updatedSession.ended_at)}`,
        `作業時間：${formatDuration(updatedSession.duration_minutes)}`,
      ].join('\n'),
    );

    await refreshWorkPanel({ client, config, supabase });

    await postPublicActivityNotification({
      client,
      config,
      supabase,
      text: [
        `■ <@${slackUserId}> が作業を終了しました`,
        `作業時間：${formatDuration(updatedSession.duration_minutes)}`,
      ].join('\n'),
    });
  } catch (error) {
    console.error('作業終了処理でエラーが発生しました。', error);
    await respondEphemeral(
      respond,
      '作業終了を記録できませんでした。少し時間をおいてもう一度お試しください。',
    );
  }
}

function getSlackErrorCode(error) {
  return error?.data?.error || error?.code || error?.message || 'unknown_error';
}

async function publishOrUpdateWorkPanel({ client, supabase, channelId }) {
  const settingKey = getWorkPanelSettingKey(channelId);
  const text = '作業時間トラッカー';
  const activeSessions = await findActiveSessions(supabase);
  const blocks = buildWorkPanelBlocks(activeSessions);
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
      return;
    } catch (error) {
      console.error('既存の作業パネル更新に失敗しました。新しく投稿します。', getSlackErrorCode(error));
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
}

let config;

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

app.command('/work', async ({ ack, respond }) => {
  await ack();

  await respondEphemeral(
    respond,
    '作業の開始または終了を選択してください。',
    buildWorkCommandBlocks(),
  );
});

app.action(ACTION_WORK_START, async ({ ack, body, client, respond }) => {
  await ack();
  await handleWorkStart({ body, client, config, respond, supabase });
});

app.action(ACTION_WORK_END, async ({ ack, body, client, respond }) => {
  await ack();
  await handleWorkEnd({ body, client, config, respond, supabase });
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
