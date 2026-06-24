import { Bot } from 'grammy';
import { BotContext, User } from '../types';
import { calculateClaimable, generateDashboard, REFERRAL_BONUS, MIN_WITHDRAWAL } from './ui';
import { sendPaymentDetails } from './payment';
import { cachedStats, STATS_CACHE_TTL, updateCachedStats } from './cache';

export function registerCallbacks(bot: Bot<BotContext>) {
  bot.callbackQuery('claim', async (ctx) => {
    const telegramId = ctx.from.id;
    const db = ctx.env.DB;
    const now = Date.now();

    try {
      const user = ctx.sessionUser;
      if (!user) return ctx.answerCallbackQuery('User not found. Try /start.');

      const claimable = calculateClaimable(user, now);
      if (claimable > 0) {
        const result = await db.prepare('UPDATE users SET balance = balance + ?, last_claim_time = ? WHERE telegram_id = ? AND last_claim_time = ?')
          .bind(claimable, now, telegramId, user.last_claim_time)
          .run();
        
        if (result.meta && result.meta.changes === 0) {
           return ctx.answerCallbackQuery({ text: 'Already claimed or processing!', show_alert: true });
        }
        
        user.balance += claimable;
        user.last_claim_time = now;
        
        const botUsername = ctx.me?.username || 'AeroUSDTMinerBot';
        const { text, keyboard } = generateDashboard(user, botUsername);
        await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
        await ctx.answerCallbackQuery(`Successfully claimed ${claimable.toFixed(4)} USDT!`);
      } else {
        await ctx.answerCallbackQuery('Nothing to claim yet.');
      }
    } catch (err) {
      console.error("DB Error on claim:", err);
      await ctx.answerCallbackQuery('Database error occurred.');
    }
  });

  bot.callbackQuery('dashboard', async (ctx) => {
    const user = ctx.sessionUser;
    if (!user) return;
    
    const botUsername = ctx.me?.username || 'AeroUSDTMinerBot';
    const { text, keyboard } = generateDashboard(user, botUsername);
    await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('refresh', async (ctx) => {
    const user = ctx.sessionUser;
    if (!user) return;
    
    const botUsername = ctx.me?.username || 'AeroUSDTMinerBot';
    const { text, keyboard } = generateDashboard(user, botUsername);
    try {
      await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
      await ctx.answerCallbackQuery('Dashboard Refreshed 🔄');
    } catch (err) {
      // Ignore "message is not modified" error which happens if they click refresh too fast
      await ctx.answerCallbackQuery('Up to date!');
    }
  });

  bot.callbackQuery('wallet', async (ctx) => {
    const user = ctx.sessionUser;
    if (!user) return;

    const text = `💳 <b>My Wallet</b>
──────────────────────────────
💰 Balance: <code>${user.balance.toFixed(4)} USDT</code>
📈 Total Earned: <code>${user.balance.toFixed(4)} USDT</code>
🗃 Referrals: <code>${user.referral_count}</code>
──────────────────────────────
⚠️ <b>Withdrawal Rules</b>
• Minimum USDT: ${MIN_WITHDRAWAL} USDT
• Cooldown: 14 days`;

    const keyboard = {
      inline_keyboard: [
        [{ text: '💳 Withdraw', callback_data: 'withdraw' }],
        [{ text: '🔙 Back', callback_data: 'dashboard' }]
      ]
    };
    
    await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('withdraw', async (ctx) => {
    const user = ctx.sessionUser;
    if (!user) return;

    if (user.balance >= MIN_WITHDRAWAL) {
      const db = ctx.env.DB;
      await db.prepare('UPDATE users SET state = ? WHERE telegram_id = ?')
        .bind('awaiting_withdrawal_address', user.telegram_id)
        .run();
        
      await ctx.editMessageText(`🏦 <b>Withdrawal Request</b>\n──────────────────────────────\nAvailable Balance: <code>${user.balance.toFixed(4)} USDT</code>\n\nPlease reply with your <b>USDT (TRC20)</b> wallet address:`, { parse_mode: 'HTML' });
      await ctx.answerCallbackQuery();
    } else {
      await ctx.answerCallbackQuery({ text: `You need at least ${MIN_WITHDRAWAL} USDT to withdraw.`, show_alert: true });
    }
  });

  bot.callbackQuery('stats', async (ctx) => {
    const db = ctx.env.DB;
    const now = Date.now();
    
    try {
      let totalUsers = 0;
      let totalMined = 0;

      if (cachedStats && (now - cachedStats.timestamp < STATS_CACHE_TTL)) {
        totalUsers = cachedStats.totalUsers;
        totalMined = cachedStats.totalMined;
      } else {
        const statsQuery: any = await db.prepare('SELECT COUNT(*) as total_users, SUM(balance) as total_mined FROM users').first();
        totalUsers = statsQuery?.total_users || 0;
        totalMined = statsQuery?.total_mined || 0;
        
        updateCachedStats(totalUsers, totalMined);
      }

      const text = `📊 <b>Global Statistics</b>
──────────────────────────────
👥 Total Users: <code>${totalUsers.toLocaleString()}</code>
💎 Total USDT Mined: <code>${Number(totalMined).toFixed(4)}</code>

<i>Keep mining to be part of our growing community!</i>`;

      const keyboard = {
        inline_keyboard: [
          [{ text: '🔙 Back', callback_data: 'dashboard' }]
        ]
      };
      
      await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
      await ctx.answerCallbackQuery();
    } catch (err) {
      await ctx.answerCallbackQuery('Failed to load stats.');
    }
  });

  bot.callbackQuery('refer', async (ctx) => {
    const user = ctx.sessionUser;
    if (!user) return;

    const botUsername = ctx.me?.username || 'AeroUSDTMinerBot';
    const refLink = `https://t.me/${botUsername}?start=ref_${user.telegram_id}`;
    const text = `🏷 <b>Refer & Earn</b>
──────────────────────────────
💰 Per Referral: <code>${REFERRAL_BONUS} USDT</code>
📈 Your Referrals: <code>${user.referral_count}</code>

💬 <b>Link:</b>
<code>${refLink}</code>`;
    
    const keyboard = {
      inline_keyboard: [
        [{ text: '💬 Share Link', url: `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent('Join me and mine USDT for free!')}` }],
        [{ text: '🔙 Back', callback_data: 'dashboard' }]
      ]
    };
    
    await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML', disable_web_page_preview: true });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('upgrade_plan', async (ctx) => {
    const text = `⭐ <b>Upgrade Mining Plan</b>
──────────────────────────────
Choose a plan to boost your mining rate. Plans are permanent.

<b>1. Pro Plan</b>
Price: 10 USDT
Rate: 0.20 USDT/hr

<b>2. Elite Plan</b>
Price: 50 USDT
Rate: 1.20 USDT/hr`;
    
    const keyboard = {
      inline_keyboard: [
        [{ text: '⭐ Buy Pro (10 USDT)', callback_data: 'buy_plan_1' }],
        [{ text: '💎 Buy Elite (50 USDT)', callback_data: 'buy_plan_2' }],
        [{ text: '🔙 Back', callback_data: 'dashboard' }]
      ]
    };
      
    await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^buy_plan_(\d+)$/, async (ctx) => {
    const planId = parseInt(ctx.match[1], 10);
    const planName = planId === 1 ? 'Pro' : 'Elite';
    
    const text = `🛒 <b>Select Payment Method</b>
──────────────────────────────
You are buying the <b>${planName} Plan</b>.

Select your preferred cryptocurrency to pay with:`;
    
    const keyboard = {
      inline_keyboard: [
        [{ text: 'USDT (TRC20)', callback_data: `pay_method_USDT_${planId}` }],
        [{ text: 'TRX (Tron)', callback_data: `pay_method_TRX_${planId}` }],
        [{ text: 'BNB (BEP20)', callback_data: `pay_method_BNB_${planId}` }],
        [{ text: '🔙 Back', callback_data: 'upgrade_plan' }]
      ]
    };
      
    await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^pay_method_(USDT|TRX|BNB)_(\d+)$/, async (ctx) => {
    const method = ctx.match[1];
    const planId = parseInt(ctx.match[2], 10);
    
    // Defer the callback answer because we might do an API call
    await ctx.answerCallbackQuery('Generating payment details...');
    
    const db = ctx.env.DB;
    // Set state
    const stateData = JSON.stringify({ plan_id: planId, method: method });
    await db.prepare('UPDATE users SET state = ?, state_data = ? WHERE telegram_id = ?')
      .bind('awaiting_txid', stateData, ctx.from.id)
      .run();
      
    const text = `⏳ <b>Payment Instructions</b>\n━━━━━━━━━━━━━━━━━━━━\n\nMethod: <b>${method}</b>\n\n<i>Generating deposit address and calculating live amount...</i>`;
    await ctx.editMessageText(text, { parse_mode: 'HTML' });
    
    // Actually await the payment details response
    await sendPaymentDetails(ctx, method, planId);
  });

  bot.callbackQuery(/^admin_approve_(\d+)$/, async (ctx) => {
    const user = ctx.sessionUser;
    if (!user || user.is_admin === 0) return ctx.answerCallbackQuery('Unauthorized');

    const withdrawalId = parseInt(ctx.match[1], 10);
    const db = ctx.env.DB;

    const withdrawal: any = await db.prepare('SELECT * FROM withdrawals WHERE id = ?').bind(withdrawalId).first();
    if (!withdrawal) return ctx.answerCallbackQuery('Withdrawal not found');
    if (withdrawal.status !== 'pending') return ctx.answerCallbackQuery(`Already ${withdrawal.status}`);

    await db.prepare('UPDATE withdrawals SET status = ? WHERE id = ?').bind('approved', withdrawalId).run();
    
    // Notify user
    try {
      await ctx.api.sendMessage(withdrawal.telegram_id, `✅ <b>Withdrawal Approved!</b>\n\nYour withdrawal of <code>${withdrawal.amount.toFixed(4)} USDT</code> has been approved and sent to your wallet.\n\nAddress: <code>${withdrawal.address}</code>`, { parse_mode: 'HTML' });
    } catch(e) { console.error(e); }

    const newText = ctx.callbackQuery.message?.text + '\n\n✅ <b>Status: APPROVED</b>';
    await ctx.editMessageText(newText, { parse_mode: 'HTML' });
    await ctx.answerCallbackQuery('Approved!');
  });

  bot.callbackQuery(/^admin_reject_(\d+)$/, async (ctx) => {
    const user = ctx.sessionUser;
    if (!user || user.is_admin === 0) return ctx.answerCallbackQuery('Unauthorized');

    const withdrawalId = parseInt(ctx.match[1], 10);
    const db = ctx.env.DB;

    const withdrawal: any = await db.prepare('SELECT * FROM withdrawals WHERE id = ?').bind(withdrawalId).first();
    if (!withdrawal) return ctx.answerCallbackQuery('Withdrawal not found');
    if (withdrawal.status !== 'pending') return ctx.answerCallbackQuery(`Already ${withdrawal.status}`);

    // Update status and refund user
    await db.batch([
      db.prepare('UPDATE withdrawals SET status = ? WHERE id = ?').bind('rejected', withdrawalId),
      db.prepare('UPDATE users SET balance = balance + ? WHERE telegram_id = ?').bind(withdrawal.amount, withdrawal.telegram_id)
    ]);
    
    // Notify user
    try {
      await ctx.api.sendMessage(withdrawal.telegram_id, `❌ <b>Withdrawal Rejected</b>\n\nYour withdrawal of <code>${withdrawal.amount.toFixed(4)} USDT</code> was rejected by the administrator.\nThe funds have been refunded to your bot balance.`, { parse_mode: 'HTML' });
    } catch(e) { console.error(e); }

    const newText = ctx.callbackQuery.message?.text + '\n\n❌ <b>Status: REJECTED & REFUNDED</b>';
    await ctx.editMessageText(newText, { parse_mode: 'HTML' });
    await ctx.answerCallbackQuery('Rejected and refunded!');
  });
}
