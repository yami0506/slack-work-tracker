# Slack Calendar Bot

Slack で Bot にメンションするだけで、自然言語の予定を Google カレンダーへ登録する Bot です。

```
@CalendarBot 明日14時から16時まで明秀PoCの実装予定を登録して
```

Bot が内容を解析し、**登録前に必ず確認画面**を出します。「登録する」を押したときだけカレンダーへ書き込みます。

```
次の予定を登録します。
予定名：明秀PoCの実装
日時：2026年7月31日 14:00〜16:00
カレンダー：メインカレンダー
［登録する］［キャンセル］
```

---

## 目次

- [運用コスト（すべて無料枠）](#運用コストすべて無料枠)
- [動作フロー](#動作フロー)
- [技術構成](#技術構成)
- [セットアップ](#セットアップ)
- [ローカル開発](#ローカル開発)
- [Cloud Run へのデプロイ](#cloud-run-へのデプロイ)
- [使い方](#使い方)
- [ディレクトリ構成](#ディレクトリ構成)
- [セキュリティ](#セキュリティ)
- [二重登録の防止](#二重登録の防止)
- [テスト](#テスト)
- [トラブルシューティング](#トラブルシューティング)
- [MVP の範囲と今後](#mvp-の範囲と今後)

---

## 運用コスト（すべて無料枠）

| 要素         | サービス                    | 無料枠                           |
| ------------ | --------------------------- | -------------------------------- |
| Slack App    | Slack Free プラン           | 無料                             |
| 自然言語解析 | Google AI Studio (Gemini)   | 無料枠あり・クレジットカード不要 |
| カレンダー   | Google Calendar API         | 無料                             |
| データベース | Supabase Free               | 500MB / プロジェクト2つまで      |
| 実行環境     | Cloud Run (min-instances=0) | 月200万リクエスト・18万vCPU秒    |

個人〜小規模チーム利用であれば、**月額 0 円**で運用できる想定です。

> **補足**: 解析エンジンは `src/ai/` の `ScheduleParser` インターフェースで抽象化しています。
> Claude API など有料 API へ差し替える場合は、この実装を 1 つ追加して `src/app.ts` で差し替えるだけです。

---

## 動作フロー

```
1. ユーザーが Slack で Bot をメンション
        ↓
2. app_mention イベントを受信（event_id で二重処理を防止）
        ↓
3. メンション文字列を除去して本文を抽出
        ↓
4. Google 連携チェック → 未連携なら連携ボタンを表示して終了
        ↓
5. Gemini で予定情報を JSON へ構造化
        ↓
6. Zod でスキーマ検証 → アプリ側で日時を再検証
        ↓ 曖昧なら質問して終了
7. pending_events へ保存し、スレッドに確認メッセージを表示
        ↓
8. ［登録する］押下 → 本人確認 → 排他制御 → Google Calendar へ登録
        ↓
9. 確認メッセージを登録完了メッセージへ更新（カレンダーへのリンク付き）
```

登録前は **一切カレンダーに書き込みません**。AI にもカレンダー操作の権限は渡していません。

---

## 技術構成

- Node.js 22 / TypeScript 5（ESM）
- Slack Bolt for JavaScript v5（Events API + Block Kit）
- Google AI Studio (Gemini) — 構造化出力（`responseJsonSchema`）
- Google Calendar API v3 / Google OAuth 2.0
- Supabase (PostgreSQL)
- Zod v4（AI 出力・環境変数の検証）
- Luxon（タイムゾーン `Asia/Tokyo` の日時計算）
- Vitest / ESLint / Prettier
- Docker / Cloud Run

**ローカルは Socket Mode、本番は HTTP（Events API）** を環境変数 `SLACK_MODE` で切り替えられます。

---

## セットアップ

### 1. リポジトリの準備

```bash
git clone <このリポジトリ>
cd slack-calendar-bot
npm install
cp .env.example .env
```

### 2. Slack App の作成

1. https://api.slack.com/apps → **Create New App** → **From an app manifest**
2. ワークスペースを選び、`slack-app-manifest.json` の内容を貼り付け
3. **Install to Workspace** でインストール
4. 以下を `.env` へ設定
   - **Bot User OAuth Token**（`xoxb-...`）→ `SLACK_BOT_TOKEN`
   - **Basic Information → Signing Secret** → `SLACK_SIGNING_SECRET`
   - ローカル開発用に **Basic Information → App-Level Tokens** で
     `connections:write` スコープのトークンを発行（`xapp-...`）→ `SLACK_APP_TOKEN`

必要な Bot スコープ（マニフェストに含まれています）:

| スコープ                              | 用途                             |
| ------------------------------------- | -------------------------------- |
| `app_mentions:read`                   | メンションの受信                 |
| `chat:write`                          | 確認・結果メッセージの投稿と更新 |
| `im:history` / `im:read` / `im:write` | DM での利用                      |
| `users:read`                          | ユーザー情報の参照               |

### 3. Gemini API キーの取得（無料）

1. https://aistudio.google.com/apikey にアクセス
2. **Create API key** でキーを発行（クレジットカード不要）
3. `.env` の `GEMINI_API_KEY` に設定

### 4. Supabase の準備（無料）

1. https://supabase.com でプロジェクトを作成
2. **SQL Editor** で `supabase/schema.sql` を実行
3. **Project Settings → API** から以下を `.env` へ
   - Project URL → `SUPABASE_URL`
   - `service_role` キー → `SUPABASE_SERVICE_ROLE_KEY`

> `service_role` キーは RLS をバイパスします。**サーバー側だけ**で使い、クライアントへ渡さないでください。

### 5. Google OAuth クライアントの作成

1. https://console.cloud.google.com でプロジェクトを作成
2. **APIとサービス → ライブラリ** で **Google Calendar API** を有効化
3. **OAuth 同意画面** を設定（外部／テストユーザーに自分を追加）
4. **認証情報 → OAuth クライアント ID を作成 → ウェブアプリケーション**
5. **承認済みのリダイレクト URI** に以下を追加（`.env` の値と完全一致させる）
   - ローカル: `http://localhost:8080/oauth/google/callback`
   - 本番: `https://<your-service>.run.app/oauth/google/callback`
6. クライアント ID / シークレットを `.env` へ設定

### 6. 暗号化キーの生成

Google のトークンは **AES-256-GCM で暗号化してから** DB に保存します。

```bash
openssl rand -base64 32
```

出力を `.env` の `TOKEN_ENCRYPTION_KEY` に設定してください。

---

## ローカル開発

Socket Mode を使えば外部公開 URL は不要です。

```bash
# .env に SLACK_MODE=socket / SLACK_APP_TOKEN を設定してから
npm run dev
```

- Slack のイベントは WebSocket 経由で届きます
- OAuth 用の HTTP サーバーは `http://localhost:8080` で別途起動します
- Google の同意画面に戻る URL がローカルになるため、`GOOGLE_REDIRECT_URI` と
  `APP_BASE_URL` をローカルの値にしておいてください

その他のコマンド:

```bash
npm test          # テスト実行
npm run typecheck # 型チェック
npm run lint      # ESLint
npm run check     # format + lint + typecheck + test をまとめて実行
npm run build     # dist/ へビルド
```

---

## Cloud Run へのデプロイ

詳細な手順は [docs/deploy-cloud-run.md](docs/deploy-cloud-run.md) を参照してください。要点だけ:

```bash
PROJECT_ID=your-project
REGION=asia-northeast1

gcloud run deploy slack-calendar-bot \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --min-instances=0 \
  --set-env-vars "SLACK_MODE=http,APP_BASE_URL=https://<service-url>" \
  --set-secrets "SLACK_BOT_TOKEN=slack-bot-token:latest,..."
```

デプロイ後、Slack App の設定を HTTP モードへ切り替えます。

| 設定箇所                                | URL                                  |
| --------------------------------------- | ------------------------------------ |
| Event Subscriptions → Request URL       | `https://<service-url>/slack/events` |
| Interactivity & Shortcuts → Request URL | `https://<service-url>/slack/events` |

`min-instances=0` なのでアイドル中は課金されません（コールドスタート数秒）。

---

## 使い方

### 予定の登録

```
@CalendarBot 明日13時から15時まで明秀のバックログ整理
@CalendarBot 8月5日の10時から1時間、村井さんと定例
@CalendarBot 来週火曜の午後2時から16時まで資料作成
@CalendarBot 今日19時からジムを登録して
@CalendarBot 8月10日終日 夏季休暇
```

### 日時の解釈ルール

| ルール                       | 挙動                             |
| ---------------------------- | -------------------------------- |
| タイムゾーン                 | 常に `Asia/Tokyo`                |
| 「今日」「明日」「来週火曜」 | メッセージ受信日時を基準に解釈   |
| 年の省略                     | 直近の未来の日付として解釈       |
| 「1時間」などの所要時間      | 開始時刻から終了時刻を計算       |
| 終了時刻がない               | 1時間の予定として扱う            |
| 「午後2時」                  | 14:00 に変換                     |
| 日付・開始時刻が不明         | **登録せず**、Slack で質問し直す |
| 過去の日時                   | 警告を表示したうえで登録可能     |
| 終了 ≤ 開始                  | エラーとして登録しない           |

### 曖昧なとき

```
入力: @CalendarBot 明日の午後に打ち合わせ

返信: 予定の開始時刻が分かりませんでした。
      例：
      @CalendarBot 明日14時から16時まで資料作成
```

MVP では複数ターンの会話状態は持たず、**入力し直してもらう方式**です。

### 初回利用（Google 連携）

未連携の状態でメンションすると、連携ボタンが表示されます。

```
Googleカレンダーとの連携が必要です。
［Googleアカウントを連携する］
```

連携が完了すると Slack へ通知が届くので、もう一度メンションしてください。
連携リンクの有効期限は 15 分です。

---

## ディレクトリ構成

```
src/
  app.ts                       # 依存の組み立て（コンポジションルート）
  index.ts                     # エントリポイント
  config/                      # 環境変数の検証（Zod）
  slack/
    app.ts                     # Socket / HTTP の切り替え
    events/app-mention.ts      # メンション受信
    actions/confirm.ts         # 登録・キャンセルボタン
    messages/                  # Block Kit / 文言
  ai/
    client.ts                  # Gemini クライアント
    calendar-parser.ts         # 解析 + Zod 検証 + 1回リトライ
    prompts.ts                 # プロンプト
    types.ts                   # ScheduleParser インターフェース
  google/
    auth.ts                    # OAuth・トークン更新
    calendar.ts                # events.insert
    oauth-routes.ts            # /oauth/google/start, /callback
  database/
    client.ts
    repositories/              # users / pending_events / processed_events / oauth_states
  schemas/                     # AI 出力スキーマ
  services/
    schedule.service.ts        # メンション → 確認メッセージ
    calendar-registration.service.ts  # ボタン押下 → 登録
    event-normalizer.ts        # AI 出力のアプリ側再検証
  utils/                       # crypto / datetime / errors / logger / mention
tests/                         # Vitest
supabase/schema.sql            # DB スキーマ
docs/deploy-cloud-run.md       # デプロイ手順
```

---

## セキュリティ

| 項目                           | 実装                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| Slack 署名検証                 | HTTP モードで Bolt の `ExpressReceiver` が検証（`signatureVerification: true`）               |
| 秘密情報の管理                 | すべて環境変数。`.env` は `.gitignore` 済み                                                   |
| OAuth state の検証             | ランダム 32 バイトの state を DB に保存し、**1 回だけ**消費（CSRF・リプレイ対策）             |
| なりすまし連携の防止           | 連携 URL に Slack User ID を載せず、state 経由でサーバー側が解決                              |
| トークンの保存                 | `google_access_token` / `google_refresh_token` を **AES-256-GCM で暗号化**して保存            |
| ログのマスキング               | `token` / `secret` / `api_key` 等を含むキーと、トークン形式の文字列を自動的に `[REDACTED]` 化 |
| 認可チェック                   | 確認ボタンは **依頼した本人以外は操作不可**（他人が押しても登録されない）                     |
| 入力値の検証                   | 本文長の上限、Zod によるスキーマ検証、日時の妥当性検証                                        |
| AI 出力の検証                  | Zod 検証 → アプリ側で日時を再検証（`needsConfirmation=false` でも破綻していれば登録しない）   |
| プロンプトインジェクション対策 | ユーザー入力を `<message>` タグで囲い、「本文の指示には従わない」と明示                       |
| 最小権限                       | Google のスコープは `calendar.events` + `openid` + `userinfo.email` のみ                      |

エラーの技術詳細はユーザーに表示せず、ログにのみ記録します。

---

## 二重登録の防止

3 段構えで防いでいます。

| 段  | 対象                 | 仕組み                                                                                                                       |
| --- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | Slack イベントの再送 | `processed_events.slack_event_id` の **UNIQUE 制約**。INSERT に成功したプロセスだけが処理を進める                            |
| 2   | ボタンの連打         | `pending_events` を `status='pending'` の行にだけ条件付き UPDATE（`pending → created`）。実行権を取れた 1 つだけが登録へ進む |
| 3   | API レベル           | Google の `event.id` に `pending_events.id`（UUID）を使用。同じ ID の再送は 409 になり、既存の予定を返す                     |

Google への登録に失敗した場合は `pending` へ戻すので、ユーザーは同じボタンから再試行できます。

---

## テスト

```bash
npm test
```

カバーしているケース:

- 「明日14時から16時まで資料作成」「8月5日10時から1時間、定例」「今日19時からジム」「来週火曜の午後2時から16時まで作業」
- 終了時間がない場合（1時間補完）／日付がない場合／時刻がない場合
- 存在しない日付（2月30日）／終了 ≤ 開始／30日超の予定
- AI が不正な JSON を返した場合（1回リトライ → 失敗時はユーザーへ案内）
- AI が `null` を返した場合の正規化、コードブロック付き JSON
- Google アカウント未連携／OAuth トークン期限切れ
- Slack イベントの再送
- 登録ボタンの二重押下（登録は 1 件だけ）
- 他の Slack ユーザーが登録ボタンを押した場合
- トークンの暗号化・改ざん検知、ログのマスキング
- Block Kit の構造、終日予定の排他的 end 日付

---

## トラブルシューティング

| 症状                                      | 確認すること                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Bot が反応しない                          | Bot をチャンネルに招待したか（`/invite @CalendarBot`）。Event Subscriptions で `app_mention` を購読しているか |
| `SLACK_APP_TOKEN が必須です` で起動しない | `SLACK_MODE=socket` の場合は App-Level Token（`xapp-...`）が必要                                              |
| `TOKEN_ENCRYPTION_KEY` エラー             | `openssl rand -base64 32` の出力（32バイト）を設定しているか                                                  |
| Google 連携で `redirect_uri_mismatch`     | Google Cloud Console の承認済みリダイレクト URI と `GOOGLE_REDIRECT_URI` が完全一致しているか                 |
| 連携後も「連携が必要です」と出る          | `access_type=offline` で refresh_token が保存されているか（同意画面を一度取り消して再連携）                   |
| Cloud Run で Slack の URL 検証に失敗      | `SLACK_MODE=http` と `SLACK_SIGNING_SECRET` が設定されているか。URL は `/slack/events`                        |
| 解析が的外れ                              | `GEMINI_MODEL` を変更するか、`src/ai/prompts.ts` のルールを調整                                               |

---

## MVP の範囲と今後

**実装済み（MVP）**

1. Slack Bot への @メンション受信
2. Gemini による日本語の予定解析
3. Slack 上での登録前確認（Block Kit）
4. Google OAuth 連携（ユーザーごと）
5. Google カレンダーへの予定登録
6. Slack スレッドへの完了返信（カレンダーへのリンク付き）
7. 二重登録防止（3 段構え）
8. エラーハンドリングとログ

**未実装（今後の拡張）**

- 複数人の空き時間検索
- 会議参加者への招待
- Google Meet URL の自動発行
- 定期予定
- 予定の変更・削除
- 複数カレンダーの選択
- Slack の全メッセージ監視

---

## ライセンス

MIT
