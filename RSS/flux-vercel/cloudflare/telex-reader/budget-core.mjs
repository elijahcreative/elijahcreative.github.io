const DEFAULT_LIMITS = Object.freeze({
  clientPerMinute: 12,
  globalPerMinute: 20,
  globalPerDay: 500
});

const NEGATIVE_TTLS = Object.freeze({
  source_blocked: 120,
  source_challenge: 120,
  source_timeout: 30,
  source_unavailable: 30,
  invalid_content: 30,
  response_too_large: 30,
  redirect_blocked: 30
});

const NEGATIVE_CODES = new Set([...Object.keys(NEGATIVE_TTLS), 'source_rate_limited']);

function readLimit(env, name, fallback, maximum) {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const value = String(raw);
  if (!/^\d+$/.test(value)) throw new Error(`Invalid ${name}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`Invalid ${name}`);
  }
  return parsed;
}

export function readBudgetLimits(env = {}) {
  const limits = {
    clientPerMinute: readLimit(env, 'TELEX_CLIENT_LIMIT_PER_MINUTE', DEFAULT_LIMITS.clientPerMinute, 500),
    globalPerMinute: readLimit(env, 'TELEX_GLOBAL_LIMIT_PER_MINUTE', DEFAULT_LIMITS.globalPerMinute, 500),
    globalPerDay: readLimit(env, 'TELEX_GLOBAL_LIMIT_PER_DAY', DEFAULT_LIMITS.globalPerDay, 50000)
  };
  if (limits.globalPerDay < limits.globalPerMinute) {
    throw new Error('TELEX_GLOBAL_LIMIT_PER_DAY must be at least TELEX_GLOBAL_LIMIT_PER_MINUTE');
  }
  return limits;
}

function validateWindow(now) {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid budget timestamp');
}

function validateClientKey(clientKey) {
  if (clientKey !== 'anonymous' && !/^[a-f0-9]{64}$/.test(clientKey || '')) {
    throw new Error('Invalid client key');
  }
}

function validateUrlKey(urlKey) {
  if (!/^[a-f0-9]{64}$/.test(urlKey || '')) throw new Error('Invalid URL key');
}

function retryUntil(windowStart, durationMs, now) {
  return Math.max(1, Math.ceil((windowStart + durationMs - now) / 1000));
}

export class ReaderBudgetEngine {
  constructor(store, env = {}) {
    this.store = store;
    this.limits = readBudgetLimits(env);
  }

  admit({ clientKey = 'anonymous', urlKey, now = Date.now() }) {
    validateClientKey(clientKey);
    validateUrlKey(urlKey);
    validateWindow(now);

    const minuteStart = Math.floor(now / 60000) * 60000;
    const dayStart = Math.floor(now / 86400000) * 86400000;

    return this.store.transactionSync(() => {
      this.store.deleteExpiredNegatives(now);
      this.store.deleteCountersBefore(dayStart);

      const negative = this.store.getNegative(urlKey, now);
      if (negative) return { kind: 'negative', ...negative };

      const checks = [
        { key: 'global-minute', windowStart: minuteStart, limit: this.limits.globalPerMinute, kind: 'reader_rate_limited' },
        { key: `client-minute:${clientKey}`, windowStart: minuteStart, limit: this.limits.clientPerMinute, kind: 'reader_rate_limited' },
        { key: 'global-day', windowStart: dayStart, limit: this.limits.globalPerDay, kind: 'reader_daily_limit' }
      ];

      for (const check of checks) {
        if (this.store.getCounter(check.key, check.windowStart) >= check.limit) {
          const duration = check.kind === 'reader_daily_limit' ? 86400000 : 60000;
          return {
            kind: check.kind,
            retryAfter: retryUntil(check.windowStart, duration, now)
          };
        }
      }

      for (const check of checks) {
        const used = this.store.getCounter(check.key, check.windowStart);
        this.store.setCounter(check.key, check.windowStart, used + 1);
      }
      return { kind: 'ok' };
    });
  }

  reserveFallback({ clientKey = 'anonymous', now = Date.now() } = {}) {
    validateClientKey(clientKey);
    validateWindow(now);
    const minuteStart = Math.floor(now / 60000) * 60000;
    const dayStart = Math.floor(now / 86400000) * 86400000;

    return this.store.transactionSync(() => {
      this.store.deleteCountersBefore(dayStart);
      const checks = [
        { key: 'global-minute', windowStart: minuteStart, limit: this.limits.globalPerMinute, kind: 'reader_rate_limited' },
        { key: `client-minute:${clientKey}`, windowStart: minuteStart, limit: this.limits.clientPerMinute, kind: 'reader_rate_limited' },
        { key: 'global-day', windowStart: dayStart, limit: this.limits.globalPerDay, kind: 'reader_daily_limit' }
      ];

      for (const check of checks) {
        if (this.store.getCounter(check.key, check.windowStart) >= check.limit) {
          const duration = check.kind === 'reader_daily_limit' ? 86400000 : 60000;
          return {
            allowed: false,
            kind: check.kind,
            retryAfter: retryUntil(check.windowStart, duration, now)
          };
        }
      }

      for (const check of checks) {
        const used = this.store.getCounter(check.key, check.windowStart);
        this.store.setCounter(check.key, check.windowStart, used + 1);
      }
      return { allowed: true };
    });
  }

  recordNegative({ urlKey, code, upstreamStatus = null, retryAfter = 0, now = Date.now() }) {
    validateUrlKey(urlKey);
    validateWindow(now);
    if (!NEGATIVE_CODES.has(code)) throw new Error('Invalid negative-cache code');
    if (upstreamStatus !== null && (!Number.isInteger(upstreamStatus) || upstreamStatus < 100 || upstreamStatus > 599)) {
      throw new Error('Invalid upstream status');
    }
    if (!Number.isInteger(retryAfter) || retryAfter < 0 || retryAfter > 86400) {
      throw new Error('Invalid negative-cache retryAfter');
    }

    // Retain the URL denial until the provider's clamped Retry-After expires.
    const ttl = code === 'source_rate_limited'
      ? Math.min(86400, Math.max(5, retryAfter || 5))
      : NEGATIVE_TTLS[code];
    const value = {
      code,
      upstreamStatus,
      retryAfter: ttl,
      expiresAt: now + ttl * 1000
    };
    return this.store.transactionSync(() => {
      this.store.putNegative(urlKey, value);
      return { stored: true, expiresAt: value.expiresAt };
    });
  }
}

export const readerBudgetDefaults = DEFAULT_LIMITS;
