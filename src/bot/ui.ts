import { InlineKeyboard } from 'grammy';
import { User } from '../types';
import { PLANS } from './crypto';

export const MAX_MINING_HOURS = 24;
export const REFERRAL_BONUS = 0.25;
export const MIN_WITHDRAWAL = 15.0;

export const EMOJIS = {
  welcome: "5994750571041525522",
  diamond: "6028530359975548369",
  phone: "5877316724830768997",
  tag: "5854776233950188167",
  bag: "5778318458802409852",
  chart: "5994378914636500516",
  chat: "5891169510483823323",
  card: "5927169041595634481",
  box: "6028226658543082010",
  rocket: "5854776233950188167",
  star: "5994750571041525522",
  claim: "5877316724830768997",
  stats: "5994378914636500516",
};

export function pe(emojiId: string, fallback: string): string {
  return `<tg-emoji emoji-id="${emojiId}">${fallback}</tg-emoji>`;
}

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

  const text = `${pe(EMOJIS.welcome, '👋')} Welcome back, <b>${user.first_name}</b>!

${pe(EMOJIS.diamond, '💎')} <b>USDT Mining Dashboard</b>
──────────────────────────────
${pe(EMOJIS.star, '⭐')} Current Plan: <code>${plan.name}</code>
${pe(EMOJIS.phone, '📱')} Mining Rate: <code>${plan.rate} USDT/hr</code>
${pe(EMOJIS.bag, '💰')} Total Balance: <code>${balance.toFixed(4)} USDT</code>
${pe(EMOJIS.chart, '📈')} Total Referrals: <code>${user.referral_count}</code>

${pe(EMOJIS.box, '🎁')} <b>Ready to Claim:</b> <code>${claimable.toFixed(4)} USDT</code>
──────────────────────────────
${pe(EMOJIS.chat, '💬')} <b>Your Referral Link:</b>
<code>https://t.me/${botUsername}?start=ref_${user.telegram_id}</code>`;

  const inline_keyboard = [
    [
      { text: `Claim ${claimable.toFixed(4)} USDT`, callback_data: 'claim', style: 'success', icon_custom_emoji_id: EMOJIS.claim }
    ],
    [
      { text: 'Upgrade Plan', callback_data: 'upgrade_plan', style: 'primary', icon_custom_emoji_id: EMOJIS.star },
      { text: 'My Wallet', callback_data: 'wallet', style: 'secondary', icon_custom_emoji_id: EMOJIS.card }
    ],
    [
      { text: 'Statistics', callback_data: 'stats', style: 'secondary', icon_custom_emoji_id: EMOJIS.stats },
      { text: 'Referrals', callback_data: 'refer', style: 'secondary', icon_custom_emoji_id: EMOJIS.box }
    ],
    [
      { text: 'Share & Earn', url: `https://t.me/share/url?url=https://t.me/${botUsername}?start=ref_${user.telegram_id}&text=Join%20me%20and%20mine%20USDT%20for%20free!`, style: 'secondary', icon_custom_emoji_id: EMOJIS.rocket }
    ]
  ];

  return { text, keyboard: { inline_keyboard } };
}
