import { Bot } from 'grammy';
import { BotContext, User, QueueMessage } from '../types';
import { REFERRAL_BONUS, generateDashboard, EMOJIS, pe } from './ui';

export function registerCommands(bot: Bot<BotContext>) {
  bot.command('start', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const firstName = ctx.from?.first_name || 'User';
    const payload = ctx.match; 
    const db = ctx.env.DB;
    const now = Date.now();

    try {
      await db.prepare('UPDATE users SET first_name = ?, state = NULL, state_data = NULL WHERE telegram_id = ?')
          .bind(firstName, telegramId)
          .run();

      let user: User | null = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(telegramId).first();

      if (!user) {
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
          db.prepare('INSERT INTO users (telegram_id, first_name, balance, last_claim_time, referral_count, referrer_id, created_at, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(telegramId, firstName, 0, now, 0, referrerId, now, isAdmin)
        );

        await db.batch(statements);

        user = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(telegramId).first();
      }

      if (user) {
        const { text, keyboard } = generateDashboard(user, ctx.me.username);
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
      }
    } catch (err) {
      console.error("DB Error on /start:", err);
      await ctx.reply("An error occurred. Please try again later.");
    }
  });

  bot.command('admin', async (ctx) => {
    const db = ctx.env.DB;
    const user: User | null = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(ctx.from?.id).first();
    
    if (!user || user.is_admin === 0) {
      return ctx.reply("You do not have permission to use this command.");
    }

    const statsQuery: any = await db.prepare('SELECT COUNT(*) as total_users, SUM(balance) as total_mined FROM users').first();
    const totalUsers = statsQuery?.total_users || 0;
    const totalMined = statsQuery?.total_mined || 0;

    const text = `${pe(EMOJIS.star, '👑')} <b>Admin Dashboard</b>
──────────────────────────────
${pe(EMOJIS.tag, '👥')} <b>Total Users:</b> <code>${totalUsers.toLocaleString()}</code>
${pe(EMOJIS.diamond, '💎')} <b>Total User Balances:</b> <code>${Number(totalMined).toFixed(4)} USDT</code>

📢 To broadcast a message to all users, use:
<code>/broadcast Your message here</code>`;
    
    await ctx.reply(text, { parse_mode: 'HTML' });
  });

  bot.command('broadcast', async (ctx) => {
    const db = ctx.env.DB;
    const user: User | null = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(ctx.from?.id).first();
    
    if (!user || user.is_admin === 0) {
      return ctx.reply("You do not have permission to use this command.");
    }

    const messageText = ctx.match;
    if (!messageText) {
      return ctx.reply("Please provide a message to broadcast.\nExample: `/broadcast Hello everyone!`", { parse_mode: 'Markdown' });
    }

    await ctx.reply("⏳ Preparing broadcast... This may take a moment to enqueue.");

    try {
      const { results } = await db.prepare('SELECT telegram_id FROM users').all();
      
      let currentBatch: MessageSendRequest<QueueMessage>[] = [];
      let totalQueued = 0;

      for (const row of results) {
        currentBatch.push({ body: { type: 'admin_broadcast', telegram_id: row.telegram_id as number, text: messageText } });
        
        if (currentBatch.length === 100) {
          await ctx.env.QUEUE.sendBatch(currentBatch);
          totalQueued += 100;
          currentBatch = [];
        }
      }

      if (currentBatch.length > 0) {
        await ctx.env.QUEUE.sendBatch(currentBatch);
        totalQueued += currentBatch.length;
      }

      await ctx.reply(`✅ Broadcast successfully queued for ${totalQueued} users!`);
    } catch (err) {
      console.error("Broadcast queue error:", err);
      await ctx.reply("Failed to queue broadcast. Please check logs.");
    }
  });

  bot.on('message:text', async (ctx) => {
    const db = ctx.env.DB;
    const user: User | null = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(ctx.from.id).first();
    
    if (user && user.state === 'awaiting_txid') {
      const { handleTxIdInput } = await import('./payment');
      await handleTxIdInput(ctx, user);
      return;
    }
  });
}
