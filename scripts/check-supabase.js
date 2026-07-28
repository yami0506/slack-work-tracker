import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const REQUIRED_ENV_NAMES = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const TABLE_NAME = 'work_sessions';
const APP_SETTINGS_TABLE_NAME = 'app_settings';

function loadSupabaseConfig() {
  const missingNames = REQUIRED_ENV_NAMES.filter((name) => !process.env[name]?.trim());

  if (missingNames.length > 0) {
    throw new Error(`必要な環境変数が不足しています: ${missingNames.join(', ')}`);
  }

  const supabaseUrl = process.env.SUPABASE_URL.trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY.trim();

  try {
    new URL(supabaseUrl);
  } catch {
    throw new Error('SUPABASE_URL は有効なURLを指定してください。');
  }

  return { supabaseUrl, supabaseServiceRoleKey };
}

async function checkSupabaseConnection() {
  const { supabaseUrl, supabaseServiceRoleKey } = loadSupabaseConfig();
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      transport: WebSocket,
    },
  });

  const { error } = await supabase.from(TABLE_NAME).select('id').limit(1);

  if (error) {
    throw new Error(
      [
        'Supabase接続またはwork_sessionsテーブルの確認に失敗しました。',
        `code: ${error.code || 'unknown'}`,
        `message: ${error.message || 'unknown'}`,
        'SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、supabase.sqlの実行状況を確認してください。',
      ].join('\n'),
    );
  }

  if (process.env.WORK_PANEL_CHANNEL_ID?.trim()) {
    const { error: appSettingsError } = await supabase
      .from(APP_SETTINGS_TABLE_NAME)
      .select('key')
      .limit(1);

    if (appSettingsError) {
      throw new Error(
        [
          'app_settingsテーブルの確認に失敗しました。',
          `code: ${appSettingsError.code || 'unknown'}`,
          `message: ${appSettingsError.message || 'unknown'}`,
          'チャンネル常設パネルを使う場合は migrations/002_app_settings.sql をSupabase SQL Editorで実行してください。',
        ].join('\n'),
      );
    }
  }

  console.log('Supabaseへの接続とwork_sessionsテーブルの確認に成功しました。');
}

try {
  await checkSupabaseConnection();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
