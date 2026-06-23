import { InlineKeyboard } from 'grammy';
import { User } from '../types';
import { PLANS } from './crypto';

export const MAX_MINING_HOURS = 24;
export const REFERRAL_BONUS = 0.25;
export const MIN_WITHDRAWAL = 15.0;

export function calculateClaimable(user: User, currentTime: number): number {
  const plan = PLANS[user.plan_id as keyof typeof PLANS] || PLANS[0];
  const hourlyRate = plan.rate;
  const maxCapacity = hourlyRate * MAX_MINING_HOURS;
  
  const elapsedMs = currentTime - user.last_claim_time;
  const elapsedHours = elapsedMs / 3600000;
  
  let claimable = elapsedHours * hourlyRate;
  
  if (claimable > maxCapacity) {
    claimable = maxCapacity;
  }
  
  return claimable;
}

export function generateDashboard(user: User, botUsername: string) {
  const claimable = calculateClaimable(user, Date.now());
  const plan = PLANS[user.plan_id as keyof typeof PLANS] || PLANS[0];
  const balance = user.balance;

  const text = `👋 <b>Welcome back, ${user.first_name}!</b>

🚀 <b>Aero USDT Miner</b>
━━━━━━━━━━━━━━━━━━━━
⭐ <b>Current Plan:</b> <code>${plan.name}</code>
⚡️ <b>Mining Rate:</b> <code>${plan.rate} USDT/hr</code>
💰 <b>Total Balance:</b> <code>${balance.toFixed(4)} USDT</code>
👥 <b>Total Referrals:</b> <code>${user.referral_count}</code>

💎 <b>Ready to Claim:</b> <code>${claimable.toFixed(4)} USDT</code> ⛏️
━━━━━━━━━━━━━━━━━━━━
🔗 <b>Your Referral Link:</b>
https://t.me/${botUsername}?start=ref_${user.telegram_id}`;

  const keyboard = new InlineKeyboard()
    .text(`⛏ Claim ${claimable.toFixed(4)} USDT`, 'claim').row()
    .text('⭐ Upgrade Plan', 'upgrade_plan')
    .text('💰 My Wallet', 'wallet').row()
    .text('📊 Statistics', 'stats')
    .text('👥 Referrals', 'refer').row()
    .url('🚀 Share & Earn', `https://t.me/share/url?url=https://t.me/${botUsername}?start=ref_${user.telegram_id}&text=Join%20me%20and%20mine%20USDT%20for%20free!`);

  return { text, keyboard };
}
