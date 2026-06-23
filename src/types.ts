import { Context } from 'grammy';

export type QueueMessage = 
  | { type: 'claim_reminder'; telegram_id: number; claimable_amount: number }
  | { type: 'admin_broadcast'; telegram_id: number; text: string };

export interface Env {
  DB: D1Database;
  QUEUE: Queue<QueueMessage>;
  TELEGRAM_BOT_TOKEN: string;
  ADMIN_TELEGRAM_ID?: string;
}

export interface User {
  telegram_id: number;
  first_name: string;
  balance: number;
  last_claim_time: number;
  referral_count: number;
  referrer_id: number | null;
  created_at: number;
  is_admin: number;
}

export interface BotContext extends Context {
  env: Env;
}
