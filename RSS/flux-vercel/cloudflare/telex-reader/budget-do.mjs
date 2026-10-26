import { DurableObject } from 'cloudflare:workers';
import { ReaderBudgetEngine } from './budget-core.mjs';

class SQLiteBudgetStore {
  constructor(storage) {
    this.storage = storage;
    this.sql = storage.sql;
  }

  transactionSync(callback) {
    return this.storage.transactionSync(callback);
  }

  getCounter(key, windowStart) {
    const row = this.sql.exec(
      'SELECT count FROM counters WHERE bucket = ? AND window_start = ?', key, windowStart
    ).toArray()[0];
    return row ? Number(row.count) : 0;
  }

  setCounter(key, windowStart, count) {
    this.sql.exec(
      `INSERT INTO counters (bucket, window_start, count) VALUES (?, ?, ?)
       ON CONFLICT(bucket, window_start) DO UPDATE SET count = excluded.count`,
      key, windowStart, count
    );
  }

  deleteCountersBefore(windowStart) {
    this.sql.exec('DELETE FROM counters WHERE window_start < ?', windowStart);
  }

  deleteExpiredNegatives(now) {
    this.sql.exec('DELETE FROM negative_cache WHERE expires_at <= ?', now);
  }

  getNegative(urlKey, now) {
    const row = this.sql.exec(
      'SELECT code, upstream_status, expires_at FROM negative_cache WHERE url_key = ?', urlKey
    ).toArray()[0];
    if (!row || Number(row.expires_at) <= now) return null;
    return {
      code: row.code,
      upstreamStatus: row.upstream_status === null ? null : Number(row.upstream_status),
      retryAfter: Math.max(1, Math.ceil((Number(row.expires_at) - now) / 1000))
    };
  }

  putNegative(urlKey, value) {
    this.sql.exec(
      `INSERT INTO negative_cache (url_key, code, upstream_status, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(url_key) DO UPDATE SET
         code = excluded.code,
         upstream_status = excluded.upstream_status,
         expires_at = excluded.expires_at`,
      urlKey, value.code, value.upstreamStatus, value.expiresAt
    );
  }
}

export class ReaderBudget extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const sql = this.ctx.storage.sql;
      sql.exec(`
        CREATE TABLE IF NOT EXISTS counters (
          bucket TEXT NOT NULL,
          window_start INTEGER NOT NULL,
          count INTEGER NOT NULL,
          PRIMARY KEY (bucket, window_start)
        );
        CREATE TABLE IF NOT EXISTS negative_cache (
          url_key TEXT PRIMARY KEY,
          code TEXT NOT NULL,
          upstream_status INTEGER,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS negative_cache_expiry ON negative_cache (expires_at);
      `);
      this.engine = new ReaderBudgetEngine(new SQLiteBudgetStore(this.ctx.storage), this.env);
    });
  }

  async admit(input) {
    return this.engine.admit(input);
  }

  async recordNegative(input) {
    return this.engine.recordNegative(input);
  }

  async reserveFallback(input) {
    return this.engine.reserveFallback(input);
  }
}
