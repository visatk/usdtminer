import { Context } from 'grammy';
import { BotContext, User } from '../types';
import { getLivePrice, verifyTronTransaction, verifyBscTransaction, PLANS } from './crypto';
import { generateDashboard } from './ui';

export async function sendPaymentDetails(ctx: Context & BotContext, method: string, planId: number) {
  const plan = PLANS[planId as keyof typeof PLANS];
  if (!plan) return;

  const db = ctx.env.DB;
  let finalAmount = plan.price;
  let symbol = 'USDT';
  let address = '';

  try {
    if (method === 'TRX') {
      const price = await getLivePrice('TRXUSDT');
      finalAmount = price > 0 ? plan.price / price : plan.price * 8.5; // fallback
      symbol = 'TRX';
      address = 'TR59Wrms64FmmDbUQPdJULdQnsUD98QeYC';
    } else if (method === 'BNB') {
      const price = await getLivePrice('BNBUSDT');
      finalAmount = price > 0 ? plan.price / price : plan.price / 600; // fallback
      symbol = 'BNB';
      address = '0x26C61a35D76656EFf940444b5D7c4261Afb37c95';
    } else if (method === 'USDT') {
      symbol = 'USDT';
      address = 'TR59Wrms64FmmDbUQPdJULdQnsUD98QeYC';
    }

    const stateData = JSON.stringify({ plan_id: planId, method, finalAmount, symbol, address });
    await db.prepare('UPDATE users SET state_data = ? WHERE telegram_id = ?')
      .bind(stateData, ctx.from?.id)
      .run();

    const text = `💳 <b>Payment Details</b>
──────────────────────────────
You are upgrading to the <b>${plan.name} Plan</b>.

Please send exactly <code>${finalAmount.toFixed(6)} ${symbol}</code> to the following address:

<code>${address}</code>

<i>After you have sent the payment, please reply to this message with your <b>Transaction Hash (TxID)</b>.</i>`;
    
    await ctx.editMessageText(text, { parse_mode: 'HTML' });
  } catch (err) {
    await ctx.editMessageText("Failed to generate payment details. Please try again.");
  }
}

export async function handleTxIdInput(ctx: Context & BotContext, user: User) {
  const txId = ctx.message?.text?.trim();
  if (!txId) return;

  const db = ctx.env.DB;
  const stateData = JSON.parse(user.state_data || '{}');
  const { plan_id, method, finalAmount, address } = stateData;

  const msg = await ctx.reply(`💎 <b>Verifying Transaction...</b>\n\nChecking the blockchain for TxID: <code>${txId}</code>\n<i>This may take a few seconds...</i>`, { parse_mode: 'HTML' });

  try {
    const existing = await db.prepare('SELECT id FROM transactions WHERE tx_hash = ?').bind(txId).first();
    if (existing) {
      await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, "❌ This transaction has already been used!");
      return;
    }

    let isValid = false;

    if (method === 'TRX' || method === 'USDT') {
      isValid = await verifyTronTransaction(txId, address, finalAmount, method);
    } else if (method === 'BNB') {
      isValid = await verifyBscTransaction(txId, address, finalAmount, ctx.env.BSCSCAN_API_KEY!);
    }

    if (isValid) {
      const now = Date.now();
      await db.batch([
        db.prepare('INSERT INTO transactions (telegram_id, tx_hash, amount, currency, created_at) VALUES (?, ?, ?, ?, ?)').bind(user.telegram_id, txId, finalAmount, method, now),
        db.prepare('UPDATE users SET plan_id = ?, state = NULL, state_data = NULL WHERE telegram_id = ?').bind(plan_id, user.telegram_id)
      ]);

      const planName = PLANS[plan_id as keyof typeof PLANS]?.name || 'Premium';
      await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, `✅ <b>Payment Verified!</b>\n\nYou have been upgraded to the <b>${planName} Plan</b>. Your mining rate has been boosted!`, { parse_mode: 'HTML' });
      
      const updatedUser: User | null = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(user.telegram_id).first();
      if (updatedUser) {
        const { text, keyboard } = generateDashboard(updatedUser, ctx.me!.username);
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
      }
    } else {
      await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, "❌ <b>Verification Failed.</b>\n\nWe could not find a confirmed transaction matching the exact amount and address. If you just sent it, please wait a minute and send the TxID again.", { parse_mode: 'HTML' });
    }
  } catch (err) {
    console.error("Verification error:", err);
    await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, "⚠️ Error communicating with the blockchain. Please try again later.");
  }
}
