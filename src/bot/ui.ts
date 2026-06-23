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

  const text = `👋 Welcome back, <b>${user.first_name}</b>!

💎 <b>USDT Mining Dashboard</b>
──────────────────────────────
⭐ Current Plan: <code>${plan.name}</code>
📱 Mining Rate: <code>${plan.rate} USDT/hr</code>
💰 Total Balance: <code>${balance.toFixed(4)} USDT</code>
📈 Total Referrals: <code>${user.referral_count}</code>

🎁 <b>Ready to Claim:</b> <code>${claimable.toFixed(4)} USDT</code>
──────────────────────────────
💬 <b>Your Referral Link:</b>
<code>https://t.me/${botUsername}?start=ref_${user.telegram_id}</code>`;

  const inline_keyboard = [
    [
      { text: `🚀 Claim ${claimable.toFixed(4)} USDT`, callback_data: 'claim' }
    ],
    [
      { text: '⭐ Upgrade Plan', callback_data: 'upgrade_plan' },
      { text: '💳 My Wallet', callback_data: 'wallet' }
    ],
    [
      { text: '📊 Statistics', callback_data: 'stats' },
      { text: '🎁 Referrals', callback_data: 'refer' }
    ],
    [
      { text: '📣 Share & Earn', url: `https://t.me/share/url?url=https://t.me/${botUsername}?start=ref_${user.telegram_id}&text=Join%20me%20and%20mine%20USDT%20for%20free!` }
    ]
  ];

  return { text, keyboard: { inline_keyboard } };
}
