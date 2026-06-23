export const PAYMENT_ADDRESSES = {
  USDT_TRC20: 'TR59Wrms64FmmDbUQPdJULdQnsUD98QeYC',
  TRX: 'TR59Wrms64FmmDbUQPdJULdQnsUD98QeYC',
  BNB: '0x26C61a35D76656EFf940444b5D7c4261Afb37c95',
  USDT_BEP20: '0x26C61a35D76656EFf940444b5D7c4261Afb37c95'
};

export const PLANS = {
  0: { name: 'Free', price: 0, rate: 0.05 }, // Default
  1: { name: 'Pro', price: 10, rate: 0.20 },
  2: { name: 'Elite', price: 50, rate: 1.20 }
};

const priceCache: Record<string, { price: number, timestamp: number }> = {};

export async function getLivePrice(symbol: string): Promise<number> {
  if (symbol === 'USDTUSDT') return 1;

  const now = Date.now();
  if (priceCache[symbol] && now - priceCache[symbol].timestamp < 60000) {
    return priceCache[symbol].price; // Return cached price if < 60s old
  }

  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    if (!res.ok) return priceCache[symbol]?.price || 0; // fallback to stale cache
    const data: any = await res.json();
    const price = parseFloat(data.price);
    
    priceCache[symbol] = { price, timestamp: now };
    return price;
  } catch (e) {
    return priceCache[symbol]?.price || 0; // fallback to stale cache
  }
}

export async function verifyTronTransaction(txHash: string, currency: 'USDT' | 'TRX', requiredAmount: number): Promise<boolean> {
  try {
    const res = await fetch(`https://apilist.tronscan.org/api/transaction-info?hash=${txHash}`);
    if (!res.ok) return false;
    const data: any = await res.json();
    
    if (data.contractRet !== 'SUCCESS') return false;

    const toAddress = PAYMENT_ADDRESSES.TRX;
    
    if (currency === 'TRX') {
      // TRX transfer is usually in contractData
      if (data.contractType !== 1) return false; // TransferContract
      if (data.contractData.to_address !== toAddress) return false;
      const amountTRX = data.contractData.amount / 1_000_000;
      // Allow 1% slippage for price fluctuations
      if (amountTRX < requiredAmount * 0.99) return false;
      return true;
    } else if (currency === 'USDT') {
      // USDT TRC20 transfer is contractType 31 (TriggerSmartContract)
      if (data.contractType !== 31) return false;
      const trc20TransferInfo = data.trc20TransferInfo?.[0];
      if (!trc20TransferInfo) return false;
      if (trc20TransferInfo.to_address !== toAddress) return false;
      // USDT contract address TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
      if (trc20TransferInfo.contract_address !== 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t') return false;
      
      const amountUSDT = parseFloat(trc20TransferInfo.amount_str) / 1_000_000;
      if (amountUSDT < requiredAmount) return false;
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

export async function verifyBscTransaction(txHash: string, apiKey: string, requiredAmount: number): Promise<boolean> {
  try {
    const res = await fetch(`https://api.bscscan.com/api?module=proxy&action=eth_getTransactionByHash&txhash=${txHash}&apikey=${apiKey}`);
    if (!res.ok) return false;
    const data: any = await res.json();
    if (!data.result) return false;
    
    const toAddress = PAYMENT_ADDRESSES.BNB.toLowerCase();
    if (data.result.to.toLowerCase() !== toAddress) return false;
    
    // Value is in wei hex
    const valueWei = BigInt(data.result.value);
    const valueBNB = Number(valueWei) / 1e18;
    
    // Check if the transaction receipt is successful
    const receiptRes = await fetch(`https://api.bscscan.com/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}&apikey=${apiKey}`);
    const receiptData: any = await receiptRes.json();
    if (!receiptData.result || receiptData.result.status !== '0x1') return false;
    
    // Allow 1% slippage
    if (valueBNB < requiredAmount * 0.99) return false;
    
    return true;
  } catch (e) {
    return false;
  }
}
