import { Bot, InlineKeyboard } from 'grammy';
import { BotContext, User } from '../types';
import { calculateClaimable, generateDashboard, REFERRAL_BONUS, MIN_WITHDRAWAL } from './ui';
import { sendPaymentDetails } from './payment';

export function registerCallbacks(bot: Bot<BotContext>) {
  bot.callbackQuery('claim', async (ctx) => {
    const telegramId = ctx.from.id;
    const db = ctx.env.DB;
    const now = Date.now();

    try {
      const user: User | null = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(telegramId).first();
      if (!user) return ctx.answerCallbackQuery('User not found. Try /start.');

      const claimable = calculateClaimable(user, now);
      if (claimable > 0) {
        const result = await db.prepare('UPDATE users SET balance = balance + ?, last_claim_time = ? WHERE telegram_id = ? AND last_claim_time = ?')
          .bind(claimable, now, telegramId, user.last_claim_time)
          .run();
        
        if (result.meta && result.meta.changes === 0) {
           return ctx.answerCallbackQuery({ text: 'Already claimed or processing!', show_alert: true });
        }
        
        const updatedUser: User | null = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(telegramId).first();
        if (updatedUser) {
          const { text, keyboard } = generateDashboard(updatedUser, ctx.me.username);
          await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
          await ctx.answerCallbackQuery(`Successfully claimed ${claimable.toFixed(4)} USDT!`);
        }
      } else {
        await ctx.answerCallbackQuery('Nothing to claim yet.');
      }
    } catch (err) {
      console.error("DB Error on claim:", err);
      await ctx.answerCallbackQuery('Database error occurred.');
    }
  });

  bot.callbackQuery('dashboard', async (ctx) => {
    const db = ctx.env.DB;
    const user: User | null = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(ctx.from.id).first();
    if (!user) return;
    
    const { text, keyboard } = generateDashboard(user, ctx.me.username);
    await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('wallet', async (ctx) => {
    const db = ctx.env.DB;
    const user: User | null = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(ctx.from.id).first();
    if (!user) return;

    const text = `💳 <b>My Wallet</b>\n━━━━━━━━━━━━━━━━━━━━\n\n💰 <b>Current Balance:</b> <code>${user.balance.toFixed(4)} USDT</code>\n\n<i>Minimum withdrawal is ${MIN_WITHDRAWAL} USDT.</i>`;
    const keyboard = new InlineKeyboard()
      .text('💸 Withdraw', 'withdraw').row()
      .text('🔙 Back', 'dashboard');
    
    await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('withdraw', async (ctx) => {
    const db = ctx.env.DB;
    const user: User | null = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(ctx.from.id).first();
    if (!user) return;

    if (user.balance >= MIN_WITHDRAWAL) {
      await ctx.answerCallbackQuery({ text: 'Withdrawal requests are currently being processed manually. Please contact support.', show_alert: true });
    } else {
      await ctx.answerCallbackQuery({ text: `You need at least ${MIN_WITHDRAWAL} USDT to withdraw.`, show_alert: true });
    }
  });

  bot.callbackQuery('stats', async (ctx) => {
    const db = ctx.env.DB;
    
    try {
      const statsQuery: any = await db.prepare('SELECT COUNT(*) as total_users, SUM(balance) as total_mined FROM users').first();
      const totalUsers = statsQuery?.total_users || 0;
      const totalMined = statsQuery?.total_mined || 0;

      const text = `📊 <b>Global Statistics</b>\n━━━━━━━━━━━━━━━━━━━━\n\n👥 <b>Total Users:</b> <code>${totalUsers.toLocaleString()}</code>\n💎 <b>Total USDT Mined:</b> <code>${Number(totalMined).toFixed(4)}</code>\n\n<i>Keep mining to be part of our growing community!</i>`;
      const keyboard = new InlineKeyboard().text('🔙 Back', 'dashboard');
      
      await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
      await ctx.answerCallbackQuery();
    } catch (err) {
      await ctx.answerCallbackQuery('Failed to load stats.');
    }
  });

  bot.callbackQuery('refer', async (ctx) => {
    const db = ctx.env.DB;
    const user: User | null = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(ctx.from.id).first();
    if (!user) return;

    const refLink = `https://t.me/${ctx.me.username}?start=ref_${user.telegram_id}`;
    const text = `🔗 <b>Refer & Earn</b>\n━━━━━━━━━━━━━━━━━━━━\n\nInvite friends and earn <b>${REFERRAL_BONUS} USDT</b> for every valid referral!\n\n👥 <b>Your Total Referrals:</b> <code>${user.referral_count}</code>\n💰 <b>Earnings from Referrals:</b> <code>${(user.referral_count * REFERRAL_BONUS).toFixed(4)} USDT</code>\n\n👇 <b>Your Referral Link:</b>\n${refLink}`;
    
    const keyboard = new InlineKeyboard()
      .url('🚀 Share Link', `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent('Join me and mine USDT for free!')}`).row()
      .text('🔙 Back', 'dashboard');
    
    await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML', disable_web_page_preview: true });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('upgrade_plan', async (ctx) => {
    const text = `⭐ <b>Upgrade Mining Plan</b>\n━━━━━━━━━━━━━━━━━━━━\n\nChoose a plan to boost your mining rate. Plans are permanent.\n\n<b>1. Pro Plan</b>\nPrice: 10 USDT\nRate: 0.20 USDT/hr\n\n<b>2. Elite Plan</b>\nPrice: 50 USDT\nRate: 1.20 USDT/hr`;
    
    const keyboard = new InlineKeyboard()
      .text('🛒 Buy Pro (10 USDT)', 'buy_plan_1').row()
      .text('🛒 Buy Elite (50 USDT)', 'buy_plan_2').row()
      .text('🔙 Back', 'dashboard');
      
    await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^buy_plan_(\d+)$/, async (ctx) => {
    const planId = parseInt(ctx.match[1], 10);
    const planName = planId === 1 ? 'Pro' : 'Elite';
    
    const text = `🛒 <b>Select Payment Method</b>\n━━━━━━━━━━━━━━━━━━━━\n\nYou are buying the <b>${planName} Plan</b>.\n\nSelect your preferred cryptocurrency to pay with:`;
    const keyboard = new InlineKeyboard()
      .text('USDT (TRC20)', `pay_method_USDT_${planId}`).row()
      .text('TRX (Tron)', `pay_method_TRX_${planId}`).row()
      .text('BNB (BEP20)', `pay_method_BNB_${planId}`).row()
      .text('🔙 Back', 'upgrade_plan');
      
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
}
