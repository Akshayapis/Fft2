import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEFAULT_CONFIG = {
  appName: 'Fire Arena',
  tagline: 'Premium Free Fire Tournaments',
  currency: 'INR',
  minDeposit: 10,
  maxDeposit: 10000,
  minWithdrawal: 50,
  maxWithdrawal: 5000,
  registrationBonus: 25,
  upiId: 'firearena@upi',
  supportEmail: 'support@firearena.gg',
  supportWhatsapp: '+91 90000 00000',
  maintenanceMode: false,
  allowRegistration: true,
  payoutWindowHours: 24,
};

function emptyData() {
  return {
    meta: { version: 1, createdAt: new Date().toISOString() },
    config: { ...DEFAULT_CONFIG },
    users: [],
    sessions: [],
    devices: [],
    matches: [],
    transactions: [],
    deposits: [],
    withdrawals: [],
    notifications: [],
    supportTickets: [],
    securityEvents: [],
    distributions: [],
    jobRuns: [],
  };
}

/**
 * A tiny, dependency-free JSON store with serialized, rollback-safe transactions.
 *
 * Every mutation runs inside `tx()`, which:
 *  - queues behind all previous transactions (no interleaved writes),
 *  - works on a deep clone snapshot,
 *  - restores the snapshot if the transaction throws (atomicity),
 *  - persists to disk with write-temp + fsync + rename (no torn files).
 *
 * This mirrors the Firestore transaction semantics used in production and makes the
 * financial ledger safe under concurrent HTTP requests in a single Node process.
 */
export class Store {
  constructor({ file = null, data = null } = {}) {
    this.file = file;
    this.queue = Promise.resolve();
    if (data) {
      this.data = JSON.parse(JSON.stringify(data));
      this.ready = Promise.resolve();
    } else if (file && fs.existsSync(file)) {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.ready = Promise.resolve();
    } else {
      this.data = emptyData();
      this.ready = this.persist();
    }
    this.ensureShape();
  }

  ensureShape() {
    const base = emptyData();
    for (const key of Object.keys(base)) {
      if (this.data[key] === undefined) this.data[key] = base[key];
    }
    this.data.config = { ...DEFAULT_CONFIG, ...this.data.config };
  }

  /** Read-only access; callers must not mutate. */
  get state() {
    return this.data;
  }

  /** Run a mutation atomically. */
  tx(fn) {
    const run = async () => {
      const snapshot = JSON.parse(JSON.stringify(this.data));
      try {
        const result = await fn(this.data);
        await this.persist();
        return result;
      } catch (error) {
        this.data = snapshot;
        throw error;
      }
    };
    const next = this.queue.then(run, run);
    // Keep the queue alive even if a transaction rejects.
    this.queue = next.catch(() => undefined);
    return next;
  }

  async persist() {
    if (!this.file) return;
    const dir = path.dirname(this.file);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    const payload = JSON.stringify(this.data, null, 2);
    const handle = await fs.promises.open(tmp, 'w');
    try {
      await handle.writeFile(payload, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(tmp, this.file);
  }

  async flush() {
    await this.queue;
    await this.persist();
  }
}

export function createStoreFromEnv() {
  const file = process.env.DATA_FILE || path.resolve(process.cwd(), 'data', 'arena.json');
  return new Store({ file });
}
