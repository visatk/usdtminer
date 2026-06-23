import { Bot, GrammyError, HttpError } from 'grammy';
import { BotContext, Env } from '../types';
import { authMiddleware } from './middleware';
import { registerCommands } from './commands';
import { registerCallbacks } from './callbacks';

export function createBot(token: string, env?: Env) {
  const bot = new Bot<BotContext>(token);

  if (env) {
    bot.use(async (ctx, next) => {
      ctx.env = env;
      await next();
    });
  }

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

  // --- Middleware ---
  bot.use(authMiddleware);

  // --- Register Routes ---
  registerCommands(bot);
  registerCallbacks(bot);

  return bot;
}
