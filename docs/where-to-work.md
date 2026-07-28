# 作業する場所まとめ

無料ホスティングへ移すときに、あなたが触る場所は5つです。

```text
1. Macのターミナル
2. GitHub
3. Render
4. UptimeRobot または cron-job.org
5. Slack
```

秘密キーはGitHubやこのチャットには貼らず、RenderのEnvironment Variablesにだけ入れます。

## 1. Macのターミナル

場所:

```bash
cd /Users/nishiharu/Documents/勤怠/slack-work-tracker
```

ここでやること:

- 動作確認
- GitHubへpushする準備
- ローカル起動テスト

確認コマンド:

```bash
npm run check
npm run check:supabase
npm run check:slack
npm start
```

`npm start` はローカル確認用です。
Renderへ移したあとは、普段はMacで起動し続ける必要はありません。

## 2. GitHub

場所:

```text
https://github.com/
```

ここでやること:

- `slack-work-tracker` 用のリポジトリを作る
- このフォルダのコードをpushする
- RenderとGitHubを連携する

おすすめ:

- GitHubリポジトリ名は `slack-work-tracker`
- GitHubに置くルートは `/Users/nishiharu/Documents/勤怠/slack-work-tracker`
- `.env` はpushしない

GitHubに入れてよいもの:

- `app.js`
- `package.json`
- `package-lock.json`
- `README.md`
- `render.yaml`
- `supabase.sql`
- `migrations/`
- `docs/`

GitHubに入れてはいけないもの:

- `.env`
- Slackトークン
- Supabase Secret key
- `node_modules/`

## 3. Render

場所:

```text
https://dashboard.render.com/
```

ここでやること:

- GitHubリポジトリからFree Web Serviceを作る
- 環境変数を入れる
- デプロイログを見る

Renderで選ぶもの:

```text
New
→ Web Service
→ GitHubの slack-work-tracker リポジトリ
→ Instance Type: Free
```

設定値:

```text
Build Command: npm ci
Start Command: npm start
Health Check Path: /healthz
```

Environment Variables:

```env
NODE_VERSION=22
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-...
SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
WORK_PANEL_CHANNEL_ID=C...
PUBLIC_ACTIVITY_NOTIFICATIONS=true
```

最初は `PUBLIC_ACTIVITY_NOTIFICATIONS=false` でもOKです。
常設パネルのスレッドに「誰が開始・終了したか」を流したくなったら `true` にします。

## 4. UptimeRobot または cron-job.org

場所:

```text
https://uptimerobot.com/
```

または

```text
https://cron-job.org/
```

ここでやること:

- Renderの無料Web Serviceが寝にくいように、5分ごとに `/healthz` を叩く

RenderのURLがこれなら:

```text
https://slack-work-tracker.onrender.com
```

監視URLはこれです:

```text
https://slack-work-tracker.onrender.com/healthz
```

期待レスポンス:

```json
{"ok":true,"service":"slack-work-tracker"}
```

## 5. Slack

場所:

```text
IGS SolutionのSlackワークスペース
```

ここでやること:

- 対象チャンネルに `Work Tracker` Botを招待する
- 常設ボタンを確認する
- 3人で作業開始・終了を試す

Bot招待:

```text
/invite @Work Tracker
```

普段の使い方:

- 作業開始時に `▶ 作業開始`
- 作業終了時に `■ 作業終了`

結果は本人だけに表示されます。
常設パネルには現在作業中のメンバーが表示されます。
`PUBLIC_ACTIVITY_NOTIFICATIONS=true` の場合は、開始・終了の簡単な通知だけ常設パネルのスレッドに流れます。

## 次にやる順番

1. Macのターミナルで最終チェック
2. GitHubにリポジトリを作る
3. コードをGitHubにpush
4. RenderでFree Web Serviceを作る
5. Renderに環境変数を入れる
6. Renderでデプロイ
7. UptimeRobotまたはcron-job.orgで `/healthz` を5分監視
8. Slackでボタンを押して確認
