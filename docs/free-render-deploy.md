# 無料で常時起動に近づける手順

このアプリはSlack Socket Modeで動くため、Node.jsプロセスをどこかで起動し続ける必要があります。

無料で始める場合は、以下の構成が現実的です。

```text
Render Free Web Service
+ UptimeRobot または cron-job.org の5分ヘルスチェック
+ Supabase
+ Slack Socket Mode
```

## 注意点

- Render Free Web Serviceは15分間インバウンド通信がないとスピンダウンします。
- UptimeRobotやcron-job.orgで `/healthz` を5分間隔で叩くと、スピンダウンしにくくなります。
- 無料枠には制限があります。重要な勤怠運用にする場合は、有料の常時起動プランを検討してください。
- SlackやSupabaseのトークンはRenderのEnvironment Variablesに入れ、GitHubには入れません。

## 1. GitHubに置く

この `slack-work-tracker` ディレクトリをGitHubリポジトリにpushします。

`.env` は `.gitignore` で除外されているため、pushしません。

おすすめは、GitHubリポジトリのルートがこのフォルダになる形です。

```text
/Users/nishiharu/Documents/勤怠/slack-work-tracker
```

GitHubリポジトリを親フォルダ `/Users/nishiharu/Documents/勤怠` から作る場合は、Render側でRoot Directoryに以下を設定してください。

```text
slack-work-tracker
```

## 2. RenderでWeb Serviceを作る

1. Renderにログインします。
2. `New` → `Web Service` を選びます。
3. GitHubリポジトリを選びます。
4. Instance Typeは `Free` を選びます。
5. Build Commandを設定します。

```bash
npm ci
```

6. Start Commandを設定します。

```bash
npm start
```

7. Health Check Pathが入力できる場合は、以下を設定します。

```text
/healthz
```

## 3. Renderの環境変数を設定する

RenderのEnvironment Variablesに以下を設定します。

```env
NODE_VERSION=22
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-...
SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
WORK_PANEL_CHANNEL_ID=C...
PUBLIC_ACTIVITY_NOTIFICATIONS=false
```

チャンネル通知を使う場合は以下にします。

```env
PUBLIC_ACTIVITY_NOTIFICATIONS=true
```

この通知はチャンネル本体ではなく、常設パネルのスレッドにまとまります。
常設パネル自体には、現在作業中のメンバーと本日の作業時間も表示されます。

## 4. デプロイする

Renderで `Deploy` を実行します。

ログに以下が出れば起動成功です。

```text
Slack Work Trackerを起動しました。Socket Modeで接続中です。
Now connected to Slack
```

## 5. UptimeRobotまたはcron-job.orgで起こしておく

RenderのURLが以下だとします。

```text
https://slack-work-tracker.onrender.com
```

UptimeRobotまたはcron-job.orgで、5分間隔で以下にHTTP GETしてください。

```text
https://slack-work-tracker.onrender.com/healthz
```

UptimeRobotでは以下を推奨します。

- Monitor Type: `HTTP(s)`
- URL: `https://slack-work-tracker.onrender.com/healthz`
- Monitoring Interval: `5 minutes`
- HTTP Method: `GET`
- Timeout: 無料プランで選べる範囲の最大値

Render Free Web Serviceは15分間インバウンド通信がないとスピンダウンします。
5分間隔の監視で起こし続ける運用にできますが、無料枠のため一時的な502や再起動は完全にはゼロにできません。

成功レスポンスは以下です。

```json
{"ok":true,"service":"slack-work-tracker","uptime_seconds":123}
```

`uptime_seconds` が小さい場合は、直前にRenderのプロセスが再起動またはスリープ復帰した可能性があります。

## 6. 落ちた時の確認手順

Slackでボタンが反応しない場合は、以下の順番で確認してください。

1. ブラウザで `https://slack-work-tracker.onrender.com/healthz` を開く
2. `ok:true` が出るか確認する
3. 出ない場合はRender Dashboardの `Logs` を開く
4. `Slack Work Trackerを起動しました。Socket Modeで接続中です。` が出ているか確認する
5. `未処理のPromiseエラー` または `未処理の例外` が出ていれば、その前後のログを見る
6. UptimeRobotの監視間隔が5分になっているか確認する

## 7. Slackで確認する

対象チャンネルに常設パネルが投稿または更新されていることを確認します。

ボタンを押して、Supabaseの `work_sessions` に履歴が増えれば成功です。
