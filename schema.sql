CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  first_name TEXT,
  balance REAL DEFAULT 0,
  last_claim_time INTEGER,
  referral_count INTEGER DEFAULT 0,
  referrer_id INTEGER,
  created_at INTEGER,
  is_admin INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_last_claim ON users(last_claim_time);
