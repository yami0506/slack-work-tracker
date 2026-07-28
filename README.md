# Slack Work Tracker

Slackの `/work` コマンドから、3人チームの作業開始・作業終了を記録する最小構成のSlackアプリです。

JIRAに登録されていない作業も含めて、Slack上のボタン操作だけで作業時間をSupabaseに保存します。

## 1. このアプリの概要

- Slackで `/work` と入力すると、本人だけに見えるephemeralメッセージでボタンが表示されます。
- 任意で、チーム用チャンネルに常設の作業ボタンを投稿できます。
- 常設パネルには、現在作業中のメンバーが表示されます。
- `▶ 作業開始` を押すと、Supabaseに開始時刻を保存します。
- `■ 作業終了` を押すと、未終了セッションを終了し、作業時間を分単位で保存します。
- 詳細な開始・終了結果は本人に表示され、共有通知を有効にするとパネルのスレッドにも開始・終了が流れます。
- 1ユーザーにつき、同時に存在できる未終了セッションは1件だけです。

## 最短セットアップの流れ

1. Supabaseプロジェクトを作成します。
2. Supabase SQL Editorで `supabase.sql` を実行します。
3. `slack-app-manifest.json` を使ってSlackアプリを作成します。
4. Socket ModeとInteractivityが有効になっていることを確認します。
5. Slackアプリをワークスペースにインストールします。
6. `.env.example` を `.env` にコピーして、SlackとSupabaseの値を入れます。
7. `npm install` を実行します。
8. `npm run check:supabase` でSupabase接続を確認します。
9. `npm run check:slack` でSlackトークンを確認します。
10. 任意で、チャンネル常設パネル用の `WORK_PANEL_CHANNEL_ID` を設定します。
11. `npm start` でアプリを起動します。
12. Slackで `/work`、またはチャンネル常設パネルのボタンを使います。

## 2. 必要なもの

- Node.js 18以上
- npm
- Slackワークスペースの管理権限、またはSlackアプリを追加できる権限
- Supabaseアカウント

## 3. Supabaseプロジェクトの作成方法

1. [Supabase](https://supabase.com/) にログインします。
2. `New project` を選択します。
3. Organization、Project name、Database Password、Regionを入力します。
4. プロジェクト作成が完了するまで待ちます。

## 4. SQLの実行方法

1. Supabaseのプロジェクト画面を開きます。
2. 左メニューから `SQL Editor` を開きます。
3. `New query` を選択します。
4. このリポジトリの `supabase.sql` の内容を貼り付けます。
5. `Run` を押して実行します。

`supabase.sql` では、未終了セッションを1ユーザー1件に制限する部分ユニークインデックスも作成します。

## 5. Slackアプリの作成方法

### Manifestを使う方法

このリポジトリには [slack-app-manifest.json](./slack-app-manifest.json) を用意しています。
Slackアプリを新規作成するときは、手入力よりこちらが簡単です。

1. [Slack API Apps](https://api.slack.com/apps) を開きます。
2. `Create New App` を押します。
3. `From an app manifest` を選択します。
4. インストール先のSlackワークスペースを選択します。
5. `JSON` を選択し、`slack-app-manifest.json` の内容を貼り付けます。
6. 内容を確認してアプリを作成します。

ManifestにはトークンやSecretは含まれていません。

URLから作成フローを開きたい場合は、以下でSlackアプリ作成URLを出力できます。

```bash
npm run slack:manifest-url
```

表示されたURLをブラウザで開くと、Manifest入りの作成フローに進めます。

### 手動で作成する方法

1. [Slack API Apps](https://api.slack.com/apps) を開きます。
2. `Create New App` を押します。
3. `From scratch` を選択します。
4. App Nameに任意の名前を入力します。例: `Work Tracker`
5. インストール先のSlackワークスペースを選択します。

## 6. Socket Modeの有効化方法

1. Slackアプリ設定画面で `Socket Mode` を開きます。
2. `Enable Socket Mode` をONにします。
3. App-Level Tokenの作成を求められた場合は、次の手順で作成します。
4. ボタン操作を受け取るため、`Interactivity & Shortcuts` を開いて `Interactivity` もONにします。
5. Request URL欄が表示される場合は、Socket Mode利用時でも入力が必要なことがあります。その場合は `https://example.com/slack/interactivity` のようなHTTPS URLを入力してください。

## 7. App-Level Tokenの作成方法

1. Slackアプリ設定画面で `Basic Information` を開きます。
2. `App-Level Tokens` までスクロールします。
3. `Generate Token and Scopes` を押します。
4. Token Nameに任意の名前を入力します。例: `socket-mode`
5. Scopeに `connections:write` を追加します。
6. 作成された `xapp-` で始まるトークンを `.env` の `SLACK_APP_TOKEN` に設定します。

## 8. Bot Token Scopesの設定方法

1. Slackアプリ設定画面で `OAuth & Permissions` を開きます。
2. `Bot Token Scopes` に以下を追加します。
   - `chat:write`
   - `commands`
3. スコープ変更後は、アプリをワークスペースに再インストールしてください。

## 9. /work コマンドの作成方法

1. Slackアプリ設定画面で `Slash Commands` を開きます。
2. `Create New Command` を押します。
3. Commandに `/work` を入力します。
4. Request URL欄が表示される場合は、Socket Mode利用時でも入力が必要なことがあります。その場合は `https://example.com/slack/commands` のようなHTTPS URLを入力してください。
5. Short Descriptionに `作業時間を記録する` などを入力します。
6. 保存します。

## 10. Slackアプリのワークスペースへのインストール方法

1. Slackアプリ設定画面で `Install App` を開きます。
2. `Install to Workspace` を押します。
3. 権限を確認して許可します。
4. `OAuth & Permissions` の `Bot User OAuth Token` に表示される `xoxb-` で始まる値を `.env` の `SLACK_BOT_TOKEN` に設定します。

## 11. 環境変数の設定方法

`.env.example` をコピーして `.env` を作成します。

```bash
cp .env.example .env
```

`.env` に以下を設定します。

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-slack-signing-secret
SLACK_APP_TOKEN=xapp-your-app-level-token
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
WORK_PANEL_CHANNEL_ID=
PUBLIC_ACTIVITY_NOTIFICATIONS=false
PORT=3000
```

`SLACK_SIGNING_SECRET` はSlackアプリ設定の `Basic Information` にあります。

`SUPABASE_URL` はSupabaseの `Project Settings` → `API`、またはプロジェクトの `Connect` ダイアログから確認できます。

`SUPABASE_SERVICE_ROLE_KEY` には、サーバー用のSecret key、またはLegacy API Keysの `service_role` keyを設定してください。

この値は強い権限を持つため、絶対に公開しないでください。

`WORK_PANEL_CHANNEL_ID` は任意です。設定すると、起動時に指定チャンネルへチーム用の作業ボタンを投稿または更新します。

`PUBLIC_ACTIVITY_NOTIFICATIONS=true` にすると、作業開始・作業終了を常設パネルのスレッドに投稿します。

`PORT` はRenderなどのWebサービスでヘルスチェックを受けるためのHTTPポートです。ローカルでは通常 `3000` のままで構いません。

## 12. npm installの方法

```bash
npm install
```

## 13. Supabase接続確認方法

`.env` にSupabaseの値を設定したあと、以下を実行します。

```bash
npm run check:supabase
```

成功すると以下のように表示されます。

```text
Supabaseへの接続とwork_sessionsテーブルの確認に成功しました。
```

## 14. Slack接続確認方法

`.env` にSlackの値を設定したあと、以下を実行します。

```bash
npm run check:slack
```

成功すると以下のように表示されます。

```text
Slack Bot Tokenの確認に成功しました。
Slack App-Level Tokenの確認に成功しました。Socket Modeに接続できます。
```

## 15. ローカル起動方法

```bash
npm start
```

起動に成功すると、以下のようなログが表示されます。

```text
Slack Work Trackerを起動しました。Socket Modeで接続中です。
```

ローカルPCで起動している間は、同じSlackワークスペースに入っているメンバーも `/work` を使えます。
ただし、PCを閉じたりプロセスを停止したりするとアプリも止まります。チームで常時使う場合は、Render、Fly.io、Railway、AWS、GCPなどのサーバーに配置してください。

## 16. チャンネル常設パネルを使う方法

毎回 `/work` を入力するのが面倒な場合は、チーム用チャンネルに常設の作業ボタンを出せます。

### 追加SQLを実行する

既存のSupabaseプロジェクトでは、まず以下のファイルをSupabase SQL Editorで実行してください。

[migrations/002_app_settings.sql](./migrations/002_app_settings.sql)

このテーブルには、チャンネルに投稿した作業パネルのメッセージIDだけを保存します。再起動時に同じ投稿を更新するためです。

### SlackチャンネルIDを取得する

1. Slackで作業パネルを置きたいチャンネルを開きます。
2. チャンネルにBotを招待します。

```text
/invite @Work Tracker
```

3. チャンネルを右クリックして `リンクをコピー` します。
4. コピーしたURLの `/archives/` の後ろにある `C...` または `G...` で始まる文字列を控えます。

例:

```text
https://your-workspace.slack.com/archives/C0123456789
```

この場合、チャンネルIDは `C0123456789` です。

### .envに設定する

```env
WORK_PANEL_CHANNEL_ID=C0123456789
```

設定後、確認します。

```bash
npm run check:supabase
npm start
```

起動すると、指定チャンネルに `作業時間トラッカー` のボタンが投稿されます。
再起動した場合は、同じチャンネル内の既存パネルを更新します。
常設パネルには、現在作業中のメンバーと開始時刻も表示されます。

### 使い方

メンバーはチャンネル上の `▶ 作業開始` / `■ 作業終了` を押すだけです。
詳細な開始時刻・終了時刻・作業時間は、押した本人にephemeralメッセージで表示されます。

### 作業開始・終了をパネルのスレッドに通知する

みんなに作業状況をゆるく共有したい場合は、`.env` に以下を設定します。

```env
PUBLIC_ACTIVITY_NOTIFICATIONS=true
```

通知はチャンネル本体ではなく、常設パネルのスレッドにまとまります。
チャンネルを散らかしにくくしつつ、あとから流れを追える形です。

通知例:

```text
▶ @ユーザー が作業を開始しました（7/29 19:30）
```

```text
■ @ユーザー が作業を終了しました
作業時間：2時間15分
```

重複開始や、開始していない状態で終了した場合は、チャンネル通知は出しません。

## 17. Slack上での動作確認方法

1. Slackで `/work` と入力します。
2. `▶ 作業開始` と `■ 作業終了` のボタンが表示されることを確認します。
3. `▶ 作業開始` を押します。
4. `▶ 作業を開始しました。` と開始時刻が表示されることを確認します。
5. Supabaseの `work_sessions` テーブルにレコードが追加されることを確認します。
6. 作業中にもう一度 `▶ 作業開始` を押し、重複登録されないことを確認します。
7. `■ 作業終了` を押します。
8. 終了時刻と作業時間が表示されることを確認します。
9. Supabaseの対象レコードに `ended_at` と `duration_minutes` が保存されることを確認します。
10. 作業開始前に `■ 作業終了` を押し、案内メッセージが表示されることを確認します。
11. `WORK_PANEL_CHANNEL_ID` を設定した場合は、チャンネル上の常設ボタンでも同じ確認をします。
12. 常設パネルの「現在作業中」が開始・終了に合わせて更新されることを確認します。
13. `PUBLIC_ACTIVITY_NOTIFICATIONS=true` の場合は、開始・終了通知が常設パネルのスレッドにまとまることを確認します。

## 18. 常時稼働させる場合

ローカル起動は検証には便利ですが、チームで毎日使うならサーバー上で常時起動してください。

このアプリはSocket Modeで動くため、外部公開URLは必須ではありません。Webサービスではなく、常時起動するWorkerとして配置するのが分かりやすいです。

ただし、無料枠だけで使いたい場合は、RenderのFree Web Serviceとして配置するのが現実的です。
Renderの無料対象はWeb Serviceで、Background Workerは無料対象ではありません。
そのため、このアプリは `/healthz` のHTTPヘルスチェックも受けられるようにしています。

例:

- Render: Free Web Serviceを作成し、Start Commandを `npm start` にします。
- Railway: Node.jsサービスとして作成し、Start Commandを `npm start` にします。
- Fly.io: 常時起動するNode.jsアプリとしてデプロイします。
- Docker対応の環境: [Dockerfile](./Dockerfile) を使ってWorkerとして起動します。

配置先にもローカルと同じ環境変数を設定してください。
チャンネル常設パネルを使う場合は、配置先にも `WORK_PANEL_CHANNEL_ID` を設定します。

Renderに置く場合は [render.yaml](./render.yaml) も用意しています。
GitHubにこのプロジェクトを置いたあと、RenderのBlueprintから `render.yaml` を使うと、Free Web Serviceとして作成できます。

Render Free Web Serviceは15分間インバウンド通信がないとスピンダウンします。
完全無料でなるべく起こしておきたい場合は、UptimeRobotやcron-job.orgで `https://your-render-app.onrender.com/healthz` を5分間隔で監視してください。

この構成は無料枠の範囲で始めやすい一方、業務上とても重要な勤怠記録にする場合は、有料の常時起動プランを検討してください。

`Procfile` には以下を用意しています。

```text
worker: npm start
```

## 19. 開発用チェック

構文チェックとテストをまとめて実行できます。

```bash
npm run check
```

時間表示と作業時間表示だけを確認したい場合は、以下を実行します。

```bash
npm test
```

## 20. 補助ファイル

- [docs/setup-checklist.md](./docs/setup-checklist.md): 実利用開始までのチェックリスト
- [docs/where-to-work.md](./docs/where-to-work.md): デプロイ時に開く画面と作業場所の整理
- [docs/free-render-deploy.md](./docs/free-render-deploy.md): 無料Render運用の手順
- [docs/supabase-queries.sql](./docs/supabase-queries.sql): Supabaseで履歴や作業中セッションを確認するSQL
- [migrations/002_app_settings.sql](./migrations/002_app_settings.sql): チャンネル常設パネル用の追加SQL
- [slack-app-manifest.json](./slack-app-manifest.json): Slackアプリ作成用Manifest
- [Procfile](./Procfile): Workerとして起動するホスティング向け設定

## 21. よくあるエラーと解決方法

### 必要な環境変数が不足しています

`.env` が存在しない、または値が空です。`.env.example` をコピーして必要な値を設定してください。

### SLACK_BOT_TOKEN は xoxb- で始まるBot User OAuth Tokenを指定してください

Slackの `OAuth & Permissions` にある `Bot User OAuth Token` を設定してください。

### SLACK_APP_TOKEN は xapp- で始まるApp-Level Tokenを指定してください

`Basic Information` の `App-Level Tokens` で、`connections:write` スコープ付きのトークンを作成してください。

### /work を入力しても反応しない

- アプリが `npm start` で起動しているか確認してください。
- Socket Modeが有効になっているか確認してください。
- `/work` コマンドがSlackアプリに登録されているか確認してください。
- Slackアプリをワークスペースに再インストールしたか確認してください。

### ボタンを押しても反応しない

- `Interactivity & Shortcuts` が有効になっているか確認してください。
- Socket Modeが有効になっているか確認してください。
- アプリのログにエラーが出ていないか確認してください。

### Supabaseに保存されない

- `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` が正しいか確認してください。
- 新しいSupabase API Keysを使う場合は、公開用のPublishable keyではなくサーバー用のSecret keyを使ってください。
- `supabase.sql` を実行済みか確認してください。
- `work_sessions` テーブルが存在するか確認してください。

### 作業開始を連打したら重複しないか

アプリ側で未終了セッションを確認し、さらにSupabase側の部分ユニークインデックスで重複を防いでいます。

### .envをGitにコミットしたくない

`.gitignore` に `.env` と `.env.*` を入れています。`.env.example` だけはGit管理対象にできます。

## 実装メモ

- 時刻表示は `Asia/Tokyo` の `M/D HH:mm` 形式です。
- 作業時間は分未満を切り捨てます。
- MVPのため、作業内容、カテゴリー、Jira連携、GitHub連携、Googleカレンダー連携、週次集計、管理画面、認証画面、AI分析は未実装です。
- `SUPABASE_SERVICE_ROLE_KEY` を使うため、このアプリは信頼できるサーバー上で実行してください。フロントエンドに埋め込んではいけません。
