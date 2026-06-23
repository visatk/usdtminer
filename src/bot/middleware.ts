import { MiddlewareFn } from 'grammy';
import { BotContext, User } from '../types';

export const authMiddleware: MiddlewareFn<BotContext> = async (ctx, next) => {
  if (ctx.from?.id && !ctx.inlineQuery) { 
    const db = ctx.env.DB;
    const telegramId = ctx.from.id;
    
    let user: User | null = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(telegramId).first();
    
    // Auto upgrade admin if matches env var
    if (user && user.is_admin === 0 && ctx.env.ADMIN_TELEGRAM_ID && telegramId.toString() === ctx.env.ADMIN_TELEGRAM_ID) {
      await db.prepare('UPDATE users SET is_admin = 1 WHERE telegram_id = ?').bind(telegramId).run();
      user.is_admin = 1;
    }
    
    if (user) {
      ctx.sessionUser = user;
    } else {
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
};
