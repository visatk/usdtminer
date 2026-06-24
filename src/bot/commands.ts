import { Bot } from 'grammy';
import { BotContext, User, QueueMessage } from '../types';
import { REFERRAL_BONUS, generateDashboard } from './ui';

import { cachedStats, STATS_CACHE_TTL, updateCachedStats } from './cache';

export function registerCommands(bot: Bot<BotContext>) {
  bot.command('start', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const firstName = ctx.from?.first_name || 'User';
    const payload = ctx.match; 
    const db = ctx.env.DB;
    const now = Date.now();

    try {
      let user = ctx.sessionUser;

      if (user) {
        // User exists, just reset state and update name
        await db.prepare('UPDATE users SET first_name = ?, state = NULL, state_data = NULL WHERE telegram_id = ?')
            .bind(firstName, telegramId)
            .run();
        user.first_name = firstName;
        user.state = null;
        user.state_data = null;
      } else {
        // New user
        let referrerId = null;
        const isAdmin = (ctx.env.ADMIN_TELEGRAM_ID && telegramId.toString() === ctx.env.ADMIN_TELEGRAM_ID) ? 1 : 0;
        let statements: any[] = [];

        if (payload && payload.startsWith('ref_')) {
          const potentialReferrer = parseInt(payload.replace('ref_', ''), 10);
          if (!isNaN(potentialReferrer) && potentialReferrer !== telegramId) {
            const referrer: User | null = await db.prepare('SELECT telegram_id FROM users WHERE telegram_id = ?').bind(potentialReferrer).first();
            if (referrer) {
              referrerId = potentialReferrer;
              statements.push(
                db.prepare('UPDATE users SET balance = balance + ?, referral_count = referral_count + 1 WHERE telegram_id = ?').bind(REFERRAL_BONUS, referrerId)
              );
            }
          }
        }

        statements.push(
          db.prepare('INSERT OR IGNORE INTO users (telegram_id, first_name, balance, last_claim_time, referral_count, referrer_id, created_at, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(telegramId, firstName, 0, now, 0, referrerId, now, isAdmin)
        );

        await db.batch(statements);
        user = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(telegramId).first();
      }

      if (user) {
        const botUsername = ctx.me?.username || 'AeroUSDTMinerBot';
        const { text, keyboard } = generateDashboard(user, botUsername);
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
      }
    } catch (err) {
      console.error("Error on /start:", err);
      await ctx.reply("An error occurred. Please try again later.");
    }
  });

  bot.command('admin', async (ctx) => {
    const user = ctx.sessionUser;
    
    if (!user || user.is_admin === 0) {
      return ctx.reply("You do not have permission to use this command.");
    }

    const db = ctx.env.DB;
    const now = Date.now();
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

    const text = `👑 <b>Admin Dashboard</b>
──────────────────────────────
👥 <b>Total Users:</b> <code>${totalUsers.toLocaleString()}</code>
💎 <b>Total User Balances:</b> <code>${Number(totalMined).toFixed(4)} USDT</code>

📢 To broadcast a message to all users, use:
<code>/broadcast Your message here</code>`;
    
    await ctx.reply(text, { parse_mode: 'HTML' });
  });

  bot.command('broadcast', async (ctx) => {
    const user = ctx.sessionUser;
    
    if (!user || user.is_admin === 0) {
      return ctx.reply("You do not have permission to use this command.");
    }

    const messageText = ctx.match;
    if (!messageText) {
      return ctx.reply("Please provide a message to broadcast.\nExample: `/broadcast Hello everyone!`", { parse_mode: 'Markdown' });
    }

    await ctx.reply("⏳ Preparing broadcast... The system will begin dispatching messages in the background.");

    try {
      // Instead of querying all users synchronously and blocking the request,
      // we queue an init message that the Queue consumer will process in chunks.
      await ctx.env.QUEUE.send({
        type: 'admin_broadcast_init',
        text: messageText,
        offset: 0
      });
      await ctx.reply(`✅ Broadcast successfully initialized!`);
    } catch (err) {
      console.error("Broadcast init error:", err);
      await ctx.reply("Failed to initialize broadcast. Please check logs.");
    }
  });

  bot.on('message:text', async (ctx) => {
    const user = ctx.sessionUser;
    if (!user) return;
    
    if (user.state === 'awaiting_txid') {
      const { handleTxIdInput } = await import('./payment');
      await handleTxIdInput(ctx, user);
      return;
    }

    if (user.state === 'awaiting_withdrawal_address') {
      const address = ctx.message.text;
      const db = ctx.env.DB;

      if (!address || address.length < 10) {
        return ctx.reply("Please provide a valid USDT TRC20 wallet address.");
      }

      const amount = user.balance;
      if (amount < 15) {
        await db.prepare('UPDATE users SET state = NULL WHERE telegram_id = ?').bind(user.telegram_id).run();
        return ctx.reply("Insufficient balance for withdrawal.");
      }

      try {
        // Deduct balance and clear state
        await db.prepare('UPDATE users SET balance = 0, state = NULL WHERE telegram_id = ?').bind(user.telegram_id).run();

        // Create withdrawal record
        const insertRes: any = await db.prepare('INSERT INTO withdrawals (telegram_id, amount, address, created_at) VALUES (?, ?, ?, ?) RETURNING id')
          .bind(user.telegram_id, amount, address, Date.now())
          .first();
          
        const withdrawalId = insertRes?.id;

        await ctx.reply(`✅ <b>Withdrawal Requested!</b>\n\nAmount: <code>${amount.toFixed(4)} USDT</code>\nAddress: <code>${address}</code>\n\nYour request has been sent to the administrators for approval.`, { parse_mode: 'HTML' });

        // Notify Admin
        if (ctx.env.ADMIN_TELEGRAM_ID) {
          const adminKeyboard = {
            inline_keyboard: [
              [
                { text: '✅ Approve', callback_data: `admin_approve_${withdrawalId}` },
                { text: '❌ Reject', callback_data: `admin_reject_${withdrawalId}` }
              ]
            ]
          };
          
          const adminMsg = `🚨 <b>New Withdrawal Request!</b>\n\n<b>ID:</b> ${withdrawalId}\n<b>User ID:</b> <code>${user.telegram_id}</code>\n<b>User Name:</b> ${user.first_name}\n<b>Amount:</b> <code>${amount.toFixed(4)} USDT</code>\n<b>Address:</b> <code>${address}</code>`;
          
          await ctx.api.sendMessage(ctx.env.ADMIN_TELEGRAM_ID, adminMsg, { reply_markup: adminKeyboard, parse_mode: 'HTML' });
        }
      } catch (err) {
        console.error("Withdrawal error:", err);
        await ctx.reply("Failed to process withdrawal. Please contact support.");
      }
      return;
    }
  });
}
