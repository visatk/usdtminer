import { InlineKeyboard } from 'grammy';
import { User } from '../types';

export const MINING_RATE_PER_HR = 0.05;
export const REFERRAL_BONUS = 0.25;
export const MIN_WITHDRAWAL = 15.0;
export const MAX_MINING_HOURS = 24;

export function calculateClaimable(lastClaimTime: number, currentTime: number): number {
  const diffMs = currentTime - lastClaimTime;
  const hours = diffMs / 3600000;
  const cappedHours = Math.min(hours, MAX_MINING_HOURS);
  return cappedHours * MINING_RATE_PER_HR;
}

export function generateDashboard(user: User, botUsername: string) {
  const claimable = calculateClaimable(user.last_claim_time, Date.now());
  const balance = user.balance;

  const text = `👋 <b>Welcome back, ${user.first_name}!</b>

🚀 <b>Aero USDT Miner</b>
━━━━━━━━━━━━━━━━━━━━
⚡️ <b>Mining Rate:</b> <code>0.05 USDT/hr</code>
🎁 <b>Referral Bonus:</b> <code>0.25 USDT</code>
💰 <b>Total Balance:</b> <code>${balance.toFixed(4)} USDT</code>
👥 <b>Total Referrals:</b> <code>${user.referral_count}</code>

💎 <b>Ready to Claim:</b> <code>${claimable.toFixed(4)} USDT</code> ⛏️
━━━━━━━━━━━━━━━━━━━━
🔗 <b>Your Referral Link:</b>
https://t.me/${botUsername}?start=ref_${user.telegram_id}`;

  const keyboard = new InlineKeyboard()
    .text(`⛏️ Claim ${claimable.toFixed(4)} USDT`, 'claim').row()
    .text('💳 My Wallet', 'wallet')
    .text('📊 Statistics', 'stats').row()
    .url('🚀 Share & Earn', `https://t.me/share/url?url=https://t.me/${botUsername}?start=ref_${user.telegram_id}&text=Join%20me%20and%20mine%20USDT%20for%20free!`)
    .text('🔗 Referrals', 'refer');

  return { text, keyboard };
}
