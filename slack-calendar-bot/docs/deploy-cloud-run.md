# Cloud Run へのデプロイ手順（無料枠）

Cloud Run は `min-instances=0` にしておけばアイドル時に課金されず、
月 200 万リクエスト / 18 万 vCPU 秒の無料枠に収まります。

## 前提

- `gcloud` CLI がインストール済み・ログイン済み
- Supabase のスキーマ適用済み（`supabase/schema.sql`）
- Slack App / Gemini API キー / Google OAuth クライアントが準備済み

```bash
export PROJECT_ID=your-project-id
export REGION=asia-northeast1
export SERVICE=slack-calendar-bot

gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com
```

## 1. シークレットの登録

秘密情報は環境変数へ直接書かず、Secret Manager に登録します。

```bash
create_secret() {
  printf '%s' "$2" | gcloud secrets create "$1" --data-file=- 2>/dev/null \
    || printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=-
}

create_secret slack-bot-token          'xoxb-...'
create_secret slack-signing-secret     '...'
create_secret gemini-api-key           '...'
create_secret supabase-service-role    '...'
create_secret google-client-secret     '...'
create_secret token-encryption-key     "$(openssl rand -base64 32)"
```

> `token-encryption-key` は **一度決めたら変更しないでください**。
> 変更すると保存済みの Google トークンを復号できなくなり、全ユーザーの再連携が必要になります。

## 2. 初回デプロイ（URL を確定させる）

`APP_BASE_URL` と `GOOGLE_REDIRECT_URI` にはサービス URL が必要ですが、
URL はデプロイ後に確定するため、まず仮の値でデプロイします。

```bash
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=3 \
  --memory=512Mi \
  --set-env-vars "SLACK_MODE=http,LOG_LEVEL=info,DEFAULT_TIMEZONE=Asia/Tokyo,DEFAULT_CALENDAR_ID=primary,GEMINI_MODEL=gemini-2.5-flash,GEMINI_THINKING_BUDGET=0,APP_BASE_URL=https://placeholder,GOOGLE_REDIRECT_URI=https://placeholder/oauth/google/callback,SUPABASE_URL=https://xxx.supabase.co,GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com" \
  --set-secrets "SLACK_BOT_TOKEN=slack-bot-token:latest,SLACK_SIGNING_SECRET=slack-signing-secret:latest,GEMINI_API_KEY=gemini-api-key:latest,SUPABASE_SERVICE_ROLE_KEY=supabase-service-role:latest,GOOGLE_CLIENT_SECRET=google-client-secret:latest,TOKEN_ENCRYPTION_KEY=token-encryption-key:latest"
```

サービス URL を取得します。

```bash
export SERVICE_URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')
echo "$SERVICE_URL"
```

## 3. URL を確定して再デプロイ

```bash
gcloud run services update "$SERVICE" \
  --region "$REGION" \
  --update-env-vars "APP_BASE_URL=${SERVICE_URL},GOOGLE_REDIRECT_URI=${SERVICE_URL}/oauth/google/callback"
```

## 4. Google Cloud Console 側の設定

**APIとサービス → 認証情報 → OAuth クライアント ID** を開き、
**承認済みのリダイレクト URI** に以下を追加します。

```
https://<service-url>/oauth/google/callback
```

`GOOGLE_REDIRECT_URI` と 1 文字でも違うと `redirect_uri_mismatch` になります。

## 5. Slack App の設定を HTTP モードへ切り替え

1. **Settings → Socket Mode** を **オフ**にする
2. **Event Subscriptions**
   - Enable Events: オン
   - Request URL: `https://<service-url>/slack/events`
   - URL 検証が成功することを確認（`Verified ✓`）
   - Subscribe to bot events: `app_mention`
3. **Interactivity & Shortcuts**
   - Interactivity: オン
   - Request URL: `https://<service-url>/slack/events`
4. 変更後に **Reinstall to Workspace**

> URL 検証は Bot が起動している状態で行ってください。
> 検証リクエストにも署名検証がかかるため、`SLACK_SIGNING_SECRET` が正しい必要があります。

## 6. 動作確認

```bash
curl -s "${SERVICE_URL}/healthz"
# {"status":"ok"}
```

Slack のチャンネルに Bot を招待してメンションします。

```
/invite @CalendarBot
@CalendarBot 明日14時から16時まで動作確認
```

## ログの確認

```bash
gcloud run services logs read "$SERVICE" --region "$REGION" --limit 50
```

ログは JSON 形式で出力され、トークン類は `[REDACTED]` に置換されています。

## コールドスタートについて

`min-instances=0` ではリクエストが無い間インスタンスが停止するため、
最初のメンションで数秒の遅延が発生します。

- Slack のイベント受信は Bolt が即座に ack するためタイムアウトしません
- 常時起動したい場合は `--min-instances=1` にできますが、**無料枠を超えます**

## 更新デプロイ

```bash
gcloud run deploy "$SERVICE" --source . --region "$REGION"
```

環境変数・シークレットは維持されます。
