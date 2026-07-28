# 実利用開始チェックリスト

このチェックリストは、Slack Work Trackerを実際のSlackワークスペースで使える状態にするための確認表です。

## Supabase

- [ ] Supabaseプロジェクトを作成した
- [ ] SQL Editorで `supabase.sql` を実行した
- [ ] `work_sessions` テーブルが作成されている
- [ ] `one_active_session_per_user` インデックスが作成されている
- [ ] チャンネル常設パネルを使う場合、`migrations/002_app_settings.sql` を実行した
- [ ] `SUPABASE_URL` を取得した
- [ ] サーバー用Secret key、またはLegacy `service_role` keyを取得した

## Slack

- [ ] Slackアプリを作成した
- [ ] Socket ModeをONにした
- [ ] InteractivityをONにした
- [ ] App-Level Tokenに `connections:write` を付けた
- [ ] Bot Token Scopesに `chat:write` を付けた
- [ ] Bot Token Scopesに `commands` を付けた
- [ ] Slash Command `/work` を作成した
- [ ] Slackアプリをワークスペースにインストールした
- [ ] `SLACK_BOT_TOKEN` を取得した
- [ ] `SLACK_SIGNING_SECRET` を取得した
- [ ] `SLACK_APP_TOKEN` を取得した

## ローカル

- [ ] `.env.example` を `.env` にコピーした
- [ ] `.env` にSlackとSupabaseの値を入れた
- [ ] チャンネル常設パネルを使う場合、`.env` に `WORK_PANEL_CHANNEL_ID` を入れた
- [ ] チャンネル通知を使う場合、`.env` に `PUBLIC_ACTIVITY_NOTIFICATIONS=true` を入れた
- [ ] `npm install` を実行した
- [ ] `npm run check:supabase` が成功した
- [ ] `npm run check:slack` が成功した
- [ ] `npm start` で起動した

## Slack上の確認

- [ ] `/work` でボタンが表示される
- [ ] チャンネル常設パネルを使う場合、起動時にチャンネルへボタンが投稿または更新される
- [ ] チャンネル常設パネルに現在作業中のメンバーが表示される
- [ ] チャンネル通知を使う場合、開始・終了が常設パネルのスレッドに投稿される
- [ ] `▶ 作業開始` で開始時刻が表示される
- [ ] Supabaseに開始レコードが作成される
- [ ] 作業中に再度開始しても重複登録されない
- [ ] `■ 作業終了` で終了時刻と作業時間が表示される
- [ ] Supabaseの対象レコードに `ended_at` と `duration_minutes` が入る
- [ ] 作業開始前に終了すると案内メッセージが表示される

## チーム利用

- [ ] 3人のメンバーが同じSlackワークスペースにいる
- [ ] それぞれのユーザーで `/work` を実行できる
- [ ] あるユーザーの終了操作が別ユーザーのセッションを更新しない
- [ ] 常時利用する場合、ホスティング先に環境変数を設定した
- [ ] 常時利用する場合、ホスティング先で `npm start` が起動している
- [ ] 無料Render運用の場合、UptimeRobotまたはcron-job.orgで `/healthz` を5分間隔で監視している
