-- ============================================================
-- Slack Calendar Bot - Supabase スキーマ
-- Supabase ダッシュボードの SQL Editor に貼り付けて実行してください。
-- すべてサーバー側（service_role）からのみアクセスするため RLS は有効化し、
-- ポリシーは作成しません（service_role は RLS をバイパスします）。
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- users: Slack ユーザーと Google アカウントの紐付け
--   *_token 列にはアプリ側で AES-256-GCM 暗号化した文字列を保存する
-- ------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  slack_user_id text not null unique,
  google_user_id text,
  google_access_token text,
  google_refresh_token text,
  token_expires_at timestamptz,
  calendar_id text not null default 'primary',
  timezone text not null default 'Asia/Tokyo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists users_google_user_id_idx on public.users (google_user_id);

-- ------------------------------------------------------------
-- pending_events: 確認待ちの予定
-- ------------------------------------------------------------
do $$ begin
  create type public.pending_event_status as enum ('pending', 'created', 'cancelled', 'expired');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.pending_events (
  id uuid primary key default gen_random_uuid(),
  slack_event_id text not null,
  slack_user_id text not null,
  slack_channel_id text not null,
  slack_thread_ts text,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null default 'Asia/Tokyo',
  description text not null default '',
  is_all_day boolean not null default false,
  status public.pending_event_status not null default 'pending',
  google_event_id text,
  google_event_link text,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pending_events_slack_user_idx on public.pending_events (slack_user_id);
create index if not exists pending_events_status_idx on public.pending_events (status);
create index if not exists pending_events_slack_event_idx on public.pending_events (slack_event_id);

-- ------------------------------------------------------------
-- processed_events: Slack イベント再送による二重処理の防止
--   slack_event_id の UNIQUE 制約が冪等性の要
-- ------------------------------------------------------------
create table if not exists public.processed_events (
  id uuid primary key default gen_random_uuid(),
  slack_event_id text not null unique,
  processed_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- oauth_states: Google OAuth の state 検証用（CSRF 対策）
-- ------------------------------------------------------------
create table if not exists public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  state text not null unique,
  slack_user_id text not null,
  slack_channel_id text,
  slack_thread_ts text,
  consumed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now()
);

create index if not exists oauth_states_expires_at_idx on public.oauth_states (expires_at);

-- ------------------------------------------------------------
-- updated_at 自動更新
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at before update on public.users
  for each row execute function public.set_updated_at();

drop trigger if exists pending_events_set_updated_at on public.pending_events;
create trigger pending_events_set_updated_at before update on public.pending_events
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- RLS（service_role からのみアクセスする想定）
-- ------------------------------------------------------------
alter table public.users enable row level security;
alter table public.pending_events enable row level security;
alter table public.processed_events enable row level security;
alter table public.oauth_states enable row level security;
