-- 最近の作業履歴を確認する
select
  id,
  slack_user_id,
  slack_user_name,
  started_at,
  ended_at,
  duration_minutes,
  created_at
from work_sessions
order by started_at desc
limit 50;

-- 現在作業中のセッションだけを確認する
select
  id,
  slack_user_id,
  slack_user_name,
  started_at,
  created_at
from work_sessions
where ended_at is null
order by started_at desc;

-- ユーザーごとの合計作業時間を確認する
select
  slack_user_id,
  max(slack_user_name) as slack_user_name,
  count(*) as session_count,
  sum(duration_minutes) as total_duration_minutes
from work_sessions
where ended_at is not null
group by slack_user_id
order by total_duration_minutes desc;

-- チャンネル常設パネルの保存状態を確認する
select
  key,
  value,
  updated_at
from app_settings
order by updated_at desc;
