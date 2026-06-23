import { BotContext, User } from '../types';
import { PLANS, PAYMENT_ADDRESSES, getLivePrice, verifyTronTransaction, verifyBscTransaction } from './crypto';

export async function sendPaymentDetails(ctx: BotContext, method: string, planId: number) {
  const plan = PLANS[planId as keyof typeof PLANS];
  if (!plan) return;

  const priceUSDT = plan.price;
  let finalAmount = priceUSDT;
  let symbol = 'USDT';
  let address = '';
  
  if (method === 'USDT') {
    address = PAYMENT_ADDRESSES.USDT_TRC20;
    symbol = 'USDT';
  } else if (method === 'TRX') {
    address = PAYMENT_ADDRESSES.TRX;
    symbol = 'TRX';
    const livePrice = await getLivePrice('TRXUSDT');
    if (livePrice > 0) {
      finalAmount = priceUSDT / livePrice;
    } else {
      // fallback
      finalAmount = priceUSDT * 8.5; 
    }
  } else if (method === 'BNB') {
    address = PAYMENT_ADDRESSES.BNB;
    symbol = 'BNB';
    const livePrice = await getLivePrice('BNBUSDT');
    if (livePrice > 0) {
      finalAmount = priceUSDT / livePrice;
    } else {
      // fallback
      finalAmount = priceUSDT / 600;
    }
  }

  const text = `💳 <b>Payment Details</b>\n━━━━━━━━━━━━━━━━━━━━\n\nYou are upgrading to the <b>${plan.name} Plan</b>.\n\nPlease send exactly <code>${finalAmount.toFixed(6)} ${symbol}</code> to the following address:\n\n<code>${address}</code>\n\n<i>After you have sent the payment, please reply to this message with your <b>Transaction Hash (TxID)</b>.</i>`;
  
  await ctx.editMessageText(text, { parse_mode: 'HTML' });
}

export async function handleTxIdInput(ctx: BotContext, user: User) {
  const txHash = ctx.message?.text?.trim();
  if (!txHash) return;
  
  // Acknowledge receipt
  const pendingMsg = await ctx.reply(`⏳ <i>Verifying transaction <code>${txHash}</code>... This may take a few seconds.</i>`, { parse_mode: 'HTML' });
  
  try {
    const db = ctx.env.DB;
    // Check if txHash already used
    const existingTx = await db.prepare('SELECT tx_hash FROM transactions WHERE tx_hash = ?').bind(txHash).first();
    if (existingTx) {
      await ctx.api.editMessageText(ctx.chat!.id, pendingMsg.message_id, `❌ <b>Verification Failed</b>\nThis transaction hash has already been used.`, { parse_mode: 'HTML' });
      return;
    }

    const stateData = JSON.parse(user.state_data || '{}');
    const planId = stateData.plan_id;
    const method = stateData.method;
    const plan = PLANS[planId as keyof typeof PLANS];
    if (!plan || !method) throw new Error("Invalid state");

    let finalAmount = plan.price;
    if (method === 'TRX') {
      const livePrice = await getLivePrice('TRXUSDT');
      finalAmount = livePrice > 0 ? plan.price / livePrice : plan.price * 8.5;
    } else if (method === 'BNB') {
      const livePrice = await getLivePrice('BNBUSDT');
      finalAmount = livePrice > 0 ? plan.price / livePrice : plan.price / 600;
    }

    let isValid = false;
    if (method === 'TRX' || method === 'USDT') {
      isValid = await verifyTronTransaction(txHash, method, finalAmount);
    } else if (method === 'BNB') {
      isValid = await verifyBscTransaction(txHash, ctx.env.BSCSCAN_API_KEY || '', finalAmount);
    }

    if (isValid) {
      // Success! Update DB
      let statements = [
        db.prepare('INSERT INTO transactions (tx_hash, telegram_id, amount, currency, timestamp) VALUES (?, ?, ?, ?, ?)')
          .bind(txHash, user.telegram_id, finalAmount, method, Date.now()),
        db.prepare('UPDATE users SET plan_id = ?, state = NULL, state_data = NULL WHERE telegram_id = ?')
          .bind(planId, user.telegram_id)
      ];
      await db.batch(statements);

      await ctx.api.editMessageText(ctx.chat!.id, pendingMsg.message_id, `✅ <b>Payment Verified!</b>\n\nCongratulations! You have been upgraded to the <b>${plan.name} Plan</b>! Your new mining rate is ${plan.rate} USDT/hr.\n\nUse /start to see your new dashboard.`, { parse_mode: 'HTML' });
    } else {
      await ctx.api.editMessageText(ctx.chat!.id, pendingMsg.message_id, `❌ <b>Verification Failed</b>\n\nWe could not verify this transaction. Ensure the transaction is confirmed on the blockchain, the amount is correct, and it was sent to the correct address.\n\nSend the TxID again to retry, or use /start to cancel.`, { parse_mode: 'HTML' });
    }
  } catch (err) {
    console.error(err);
    await ctx.api.editMessageText(ctx.chat!.id, pendingMsg.message_id, `⚠️ An error occurred while verifying the transaction. Please try again later.`, { parse_mode: 'HTML' });
  }
}
