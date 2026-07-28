import 'dotenv/config';

const REQUIRED_ENV_NAMES = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN'];
const SLACK_API_BASE_URL = 'https://slack.com/api';

function loadSlackConfig() {
  const missingNames = REQUIRED_ENV_NAMES.filter((name) => !process.env[name]?.trim());

  if (missingNames.length > 0) {
    throw new Error(`必要な環境変数が不足しています: ${missingNames.join(', ')}`);
  }

  const slackBotToken = process.env.SLACK_BOT_TOKEN.trim();
  const slackAppToken = process.env.SLACK_APP_TOKEN.trim();
  const validationErrors = [];

  if (!slackBotToken.startsWith('xoxb-')) {
    validationErrors.push('SLACK_BOT_TOKEN は xoxb- で始まるBot User OAuth Tokenを指定してください。');
  }

  if (!slackAppToken.startsWith('xapp-')) {
    validationErrors.push('SLACK_APP_TOKEN は xapp- で始まるApp-Level Tokenを指定してください。');
  }

  if (validationErrors.length > 0) {
    throw new Error(validationErrors.join('\n'));
  }

  return { slackBotToken, slackAppToken };
}

async function postSlackApi(method, token) {
  const response = await fetch(`${SLACK_API_BASE_URL}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  if (!response.ok) {
    throw new Error(`${method} へのHTTPリクエストに失敗しました: ${response.status}`);
  }

  return response.json();
}

async function checkSlackTokens() {
  const { slackBotToken, slackAppToken } = loadSlackConfig();

  const authTest = await postSlackApi('auth.test', slackBotToken);

  if (!authTest.ok) {
    throw new Error(
      [
        'SLACK_BOT_TOKENの確認に失敗しました。',
        `error: ${authTest.error || 'unknown'}`,
        'Bot User OAuth Tokenとワークスペースへのインストール状況を確認してください。',
      ].join('\n'),
    );
  }

  const connectionTest = await postSlackApi('apps.connections.open', slackAppToken);

  if (!connectionTest.ok) {
    throw new Error(
      [
        'SLACK_APP_TOKENの確認に失敗しました。',
        `error: ${connectionTest.error || 'unknown'}`,
        'App-Level Tokenにconnections:writeスコープがあるか確認してください。',
      ].join('\n'),
    );
  }

  console.log(`Slack Bot Tokenの確認に成功しました。team=${authTest.team}, user=${authTest.user}`);
  console.log('Slack App-Level Tokenの確認に成功しました。Socket Modeに接続できます。');
}

try {
  await checkSlackTokens();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
