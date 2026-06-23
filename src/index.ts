import { webhookCallback, GrammyError } from 'grammy';
import { createBot } from './bot/index';
import { Env, QueueMessage } from './types';
import { calculateClaimable } from './bot/ui';

const THRESHOLD = 0.0010;

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === '/webhook') {
      const secretToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (env.TELEGRAM_WEBHOOK_SECRET && secretToken !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }
      
      const bot = createBot(env.TELEGRAM_BOT_TOKEN, env);
      const handleUpdate = webhookCallback(bot, 'cloudflare-mod');
      return handleUpdate(request);
    }
    
		return new Response("Aero USDT Miner Bot is running!");
	},

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      // Trigger paginated reminder process to prevent hitting D1 limits
      await env.QUEUE.send({ type: 'scheduled_reminders_init', offset: 0 });
    } catch (err) {
      console.error("Scheduled task error:", err);
    }
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    const bot = createBot(env.TELEGRAM_BOT_TOKEN);

    for (const msg of batch.messages) {
      const payload = msg.body;

      try {
        if (payload.type === 'admin_broadcast_init') {
          const { results } = await env.DB.prepare('SELECT telegram_id FROM users LIMIT 1000 OFFSET ?')
            .bind(payload.offset).all();
            
          if (results && results.length > 0) {
            let currentBatch: MessageSendRequest<QueueMessage>[] = [];
            for (const row of results) {
              currentBatch.push({ body: { type: 'admin_broadcast_send', telegram_id: row.telegram_id as number, text: payload.text } });
              
              if (currentBatch.length === 100) {
                await env.QUEUE.sendBatch(currentBatch);
                currentBatch = [];
              }
            }
            if (currentBatch.length > 0) {
              await env.QUEUE.sendBatch(currentBatch);
            }
            
            // Queue next chunk
            await env.QUEUE.send({ type: 'admin_broadcast_init', text: payload.text, offset: payload.offset + 1000 });
          }
          msg.ack();
          continue;
        }

        if (payload.type === 'scheduled_reminders_init') {
          const now = Date.now();
          const timeThreshold = now - (10 * 60 * 1000);
          const lowerBoundThreshold = timeThreshold - 3600000;
          
          const { results } = await env.DB.prepare(
            'SELECT telegram_id, last_claim_time, plan_id FROM users WHERE last_claim_time <= ? AND last_claim_time > ? LIMIT 1000 OFFSET ?'
          ).bind(timeThreshold, lowerBoundThreshold, payload.offset).all();

          if (results && results.length > 0) {
            let currentBatch: MessageSendRequest<QueueMessage>[] = [];
            for (const row of results) {
              const mockUser = { plan_id: row.plan_id || 0, last_claim_time: row.last_claim_time };
              const claimable = calculateClaimable(mockUser as any, now);
              
              if (claimable >= THRESHOLD) {
                currentBatch.push({ body: { type: 'claim_reminder', telegram_id: row.telegram_id as number, claimable_amount: claimable } });
              }
              
              if (currentBatch.length === 100) {
                await env.QUEUE.sendBatch(currentBatch);
                currentBatch = [];
              }
            }
            if (currentBatch.length > 0) {
              await env.QUEUE.sendBatch(currentBatch);
            }
            
            // Queue next chunk
            await env.QUEUE.send({ type: 'scheduled_reminders_init', offset: payload.offset + 1000 });
          }
          msg.ack();
          continue;
        }

        // Direct sends
        if (payload.type === 'claim_reminder' || payload.type === 'admin_broadcast_send') {
          const telegram_id = payload.telegram_id;
          let text = '';

          if (payload.type === 'claim_reminder') {
            text = `⛏️ ${payload.claimable_amount.toFixed(4)} USDT ready to claim!\n\n👉 Open the bot and press Claim USDT to add it to your wallet.`;
          } else {
            text = payload.text;
          }
          
          try {
            await bot.api.sendMessage(telegram_id, text, { parse_mode: payload.type === 'admin_broadcast_send' ? undefined : 'HTML' });
            msg.ack();
          } catch (error) {
            if (error instanceof GrammyError && error.error_code === 403) {
              msg.ack(); // User blocked bot
            } else {
              msg.retry();
            }
          }
        }
      } catch (err) {
        console.error("Queue handler error:", err);
        msg.retry();
      }
    }
  }
};
