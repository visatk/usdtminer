import { Bot, InlineKeyboard, GrammyError, HttpError } from 'grammy';
import { BotContext, User, QueueMessage } from './types';

const MINING_RATE_PER_HR = 0.05;
const REFERRAL_BONUS = 0.25;
const MIN_WITHDRAWAL = 15.0;

export function createBot(token: string) {
  const bot = new Bot<BotContext>(token);

  // --- Global Error Handler ---
  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`);
    const e = err.error;
    if (e instanceof GrammyError) {
      console.error("Error in request:", e.description);
    } else if (e instanceof HttpError) {
      console.error("Could not contact Telegram:", e);
    } else {
      console.error("Unknown error:", e);
    }
  });

  // --- Middleware to ensure User exists ---
  bot.use(async (ctx, next) => {
    if (ctx.from?.id && !ctx.inlineQuery) { 
      const db = ctx.env.DB;
      const telegramId = ctx.from.id;
      
      let user: User | null = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(telegramId).first();
      
      // Auto upgrade admin if matches env var
      if (user && user.is_admin === 0 && ctx.env.ADMIN_TELEGRAM_ID && telegramId.toString() === ctx.env.ADMIN_TELEGRAM_ID) {
        await db.prepare('UPDATE users SET is_admin = 1 WHERE telegram_id = ?').bind(telegramId).run();
        user.is_admin = 1;
      }
      
      if (!user) {
        if (ctx.hasCommand('start')) {
          await next();
        } else if (ctx.callbackQuery) {
          await ctx.answerCallbackQuery({ text: 'Please send /start to register first.', show_alert: true });
        } else {
          await ctx.reply('Please send /start to begin mining USDT.');
        }
        return;
      }
    }
    await next();
  });

  // --- Commands ---
  bot.command('start', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const firstName = ctx.from?.first_name || 'User';
    const payload = ctx.match; 
    const db = ctx.env.DB;
    const now = Date.now();

    try {
      let user: User | null = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(telegramId).first();

      if (!user) {
        let referrerId = null;
        if (payload && payload.startsWith('ref_')) {
          const potentialReferrer = parseInt(payload.replace('ref_', ''), 10);
          if (!isNaN(potentialReferrer) && potentialReferrer !== telegramId) {
            const referrer: User | null = await db.prepare('SELECT telegram_id FROM users WHERE telegram_id = ?').bind(potentialReferrer).first();
            if (referrer) {
              referrerId = potentialReferrer;
              await db.prepare('UPDATE users SET balance = balance + ?, referral_count = referral_count + 1 WHERE telegram_id = ?')
                .bind(REFERRAL_BONUS, referrerId)
                .run();
            }
          }
        }

        const isAdmin = (ctx.env.ADMIN_TELEGRAM_ID && telegramId.toString() === ctx.env.ADMIN_TELEGRAM_ID) ? 1 : 0;

        await db.prepare('INSERT INTO users (telegram_id, first_name, balance, last_claim_time, referral_count, referrer_id, created_at, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(telegramId, firstName, 0, now, 0, referrerId, now, isAdmin)
          .run();

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

    const text = `👑 <b>Admin Dashboard</b>\n━━━━━━━━━━━━━━━━━━━━\n\n👥 <b>Total Users:</b> <code>${totalUsers.toLocaleString()}</code>\n💎 <b>Total User Balances:</b> <code>${Number(totalMined).toFixed(4)} USDT</code>\n\n📢 To broadcast a message to all users, use:\n<code>/broadcast Your message here</code>`;
    
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
      // For 34,000 users, fetching all IDs at once is ~150KB, which is fine for D1.
      // If the userbase grows to >100k, we should paginate the queue pushing via scheduled triggers instead.
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


  // --- Callback Queries ---
  bot.callbackQuery('claim', async (ctx) => {
    const telegramId = ctx.from.id;
    const db = ctx.env.DB;
    const now = Date.now();

    try {
      const user: User | null = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(telegramId).first();
      if (!user) return ctx.answerCallbackQuery('User not found. Try /start.');

      const claimable = calculateClaimable(user.last_claim_time, now);
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
      .url('💬 Share Link', `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent('Join me and mine USDT for free!')}`).row()
      .text('🔙 Back', 'dashboard');
    
    await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML', disable_web_page_preview: true });
    await ctx.answerCallbackQuery();
  });

  return bot;
}

function calculateClaimable(lastClaimTime: number, currentTime: number): number {
  const diffMs = currentTime - lastClaimTime;
  const hours = diffMs / 3600000;
  return hours * MINING_RATE_PER_HR;
}

function generateDashboard(user: User, botUsername: string) {
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
