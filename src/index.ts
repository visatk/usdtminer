import { webhookCallback, GrammyError } from 'grammy';
import { createBot } from './bot';
import { Env, QueueMessage } from './types';

const MINING_RATE_PER_HR = 0.05;
const THRESHOLD = 0.0010;

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/webhook') {
      const bot = createBot(env.TELEGRAM_BOT_TOKEN);
      bot.use(async (botCtx, next) => {
        botCtx.env = env;
        await next();
      });
      const handleUpdate = webhookCallback(bot, 'cloudflare-mod');
      return handleUpdate(request);
    }
		return new Response("Bot is running!");
	},

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = Date.now();
    const requiredDiffMs = THRESHOLD / (MINING_RATE_PER_HR / 3600000);
    const timeThreshold = now - requiredDiffMs;

    try {
      const { results } = await env.DB.prepare(
        'SELECT telegram_id, last_claim_time FROM users WHERE last_claim_time <= ?'
      ).bind(timeThreshold).all();

      if (results && results.length > 0) {
        let currentBatch: MessageSendRequest<QueueMessage>[] = [];
        
        for (const row of results) {
          const claimable = ((now - (row.last_claim_time as number)) / 3600000) * MINING_RATE_PER_HR;
          currentBatch.push({ body: { type: 'claim_reminder', telegram_id: row.telegram_id as number, claimable_amount: claimable } });
          
          if (currentBatch.length === 100) {
            await env.QUEUE.sendBatch(currentBatch);
            currentBatch = [];
          }
        }
        
        if (currentBatch.length > 0) {
          await env.QUEUE.sendBatch(currentBatch);
        }
      }
    } catch (err) {
      console.error("Scheduled task error:", err);
    }
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    const bot = createBot(env.TELEGRAM_BOT_TOKEN);

    for (const msg of batch.messages) {
      const payload = msg.body;
      const telegram_id = payload.telegram_id;
      let text = '';

      if (payload.type === 'claim_reminder') {
        text = `⛏️ ${payload.claimable_amount.toFixed(4)} USDT ready to claim!\n\n👉 Open the bot and press Claim USDT to add it to your wallet.`;
      } else if (payload.type === 'admin_broadcast') {
        text = payload.text;
      }
      
      try {
        await bot.api.sendMessage(telegram_id, text, { parse_mode: payload.type === 'admin_broadcast' ? undefined : 'HTML' });
        msg.ack();
      } catch (error) {
        console.error(`Failed to send message to ${telegram_id}:`, error);
        if (error instanceof GrammyError && error.error_code === 403) {
          console.log(`User ${telegram_id} blocked the bot.`);
          msg.ack();
        } else {
          msg.retry();
        }
      }
    }
  }
};
