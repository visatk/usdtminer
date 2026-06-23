import { Context } from 'grammy';

export type QueueMessage = 
  | { type: 'claim_reminder'; telegram_id: number; claimable_amount: number }
  | { type: 'admin_broadcast_init'; text: string; offset: number }
  | { type: 'admin_broadcast_send'; telegram_id: number; text: string }
  | { type: 'scheduled_reminders_init'; offset: number };

export interface Env {
  DB: D1Database;
  QUEUE: Queue<QueueMessage>;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  ADMIN_TELEGRAM_ID?: string;
  BSCSCAN_API_KEY?: string;
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
  plan_id: number;
  state: string | null;
  state_data: string | null;
}

export interface BotContext extends Context {
  env: Env;
  sessionUser?: User;
}
