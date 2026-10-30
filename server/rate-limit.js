export class FailureLimiter {
  constructor({ limit = 6, windowMs = 10 * 60 * 1000, clock = () => Date.now() } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.clock = clock;
    this.failures = new Map();
  }

  isBlocked(key) {
    const record = this.failures.get(key);
    if (!record) {
      return false;
    }
    if (record.resetAt <= this.clock()) {
      this.failures.delete(key);
      return false;
    }
    return record.count >= this.limit;
  }

  fail(key) {
    const now = this.clock();
    const record = this.failures.get(key);
    if (!record || record.resetAt <= now) {
      this.failures.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    record.count += 1;
  }

  clear(key) {
    this.failures.delete(key);
  }
}

