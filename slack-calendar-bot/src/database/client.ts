import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '../config/index.js';

export type Database = SupabaseClient;

/**
 * Supabase クライアント（service_role）。
 * サーバー側からのみ使用し、キーをクライアントへ渡さないこと。
 */
export function createDatabaseClient(
  config: Pick<AppConfig, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>,
): Database {
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Postgres の一意制約違反 */
export const UNIQUE_VIOLATION = '23505';
