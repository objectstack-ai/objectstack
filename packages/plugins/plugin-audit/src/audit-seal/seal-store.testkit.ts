// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { CryptoContext, CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';
import type { AuditSealerEngine } from './sealer.js';
import type { SealStorageDriver } from './signer.js';

type Row = Record<string, unknown>;

/** A comparable form of a stored value: datetimes as epoch ms, everything else as it is. */
function comparable(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return Date.parse(value);
  return value;
}

/**
 * A `where` judged the way a SQL driver judges it: a comparison with a NULL
 * column is never true (`NULL >= 0` is unknown, where JavaScript's
 * `null >= 0` is `true`), and `{ $null: true }` is `IS NULL`.
 */
function matches(row: Row, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([field, cond]) => {
    if (field === '$and') return (cond as Row[]).every((w) => matches(row, w));
    if (field === '$or') return (cond as Row[]).some((w) => matches(row, w));
    const value = comparable(row[field]);
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      const ops = cond as Record<string, unknown>;
      const isNull = value === null || value === undefined;
      if ('$null' in ops && ops.$null !== isNull) return false;
      if (isNull && ['$gte', '$gt', '$lt', '$in'].some((op) => op in ops)) return false;
      if ('$gte' in ops && !((value as number) >= (comparable(ops.$gte) as number))) return false;
      if ('$gt' in ops && !((value as number) > (comparable(ops.$gt) as number))) return false;
      if ('$lt' in ops && !((value as number) < (comparable(ops.$lt) as number))) return false;
      if ('$in' in ops && !(ops.$in as unknown[]).some((v) => comparable(v) === value)) return false;
      return true;
    }
    return value === comparable(cond);
  });
}

/** One datasource: tables by object name, with the driver surface the sealer reads. */
export class MemoryStore implements SealStorageDriver {
  readonly tables = new Map<string, Row[]>();
  readonly creates: Array<{ object: string; row: Row }> = [];

  table(object: string): Row[] {
    if (!this.tables.has(object)) this.tables.set(object, []);
    return this.tables.get(object)!;
  }

  async find(object: string, query: Record<string, unknown>): Promise<Row[]> {
    let rows = this.table(object).filter((row) => matches(row, query.where as Record<string, unknown>));
    for (const { field, order } of [...((query.orderBy as Array<{ field: string; order: string }>) ?? [])].reverse()) {
      rows = [...rows].sort((a, b) => {
        const x = comparable(a[field]) as number;
        const y = comparable(b[field]) as number;
        return (x < y ? -1 : x > y ? 1 : 0) * (order === 'desc' ? -1 : 1);
      });
    }
    const offset = (query.offset as number) ?? 0;
    return rows.slice(offset, query.limit === undefined ? undefined : offset + (query.limit as number)).map((r) => ({ ...r }));
  }

  async count(object: string, query: Record<string, unknown> = {}): Promise<number> {
    return this.table(object).filter((row) => matches(row, query.where as Record<string, unknown>)).length;
  }

  async create(object: string, row: Row): Promise<Row> {
    this.creates.push({ object, row: { ...row } });
    this.table(object).push({ ...row });
    return row;
  }

  async delete(object: string, id: string): Promise<boolean> {
    const rows = this.table(object);
    const at = rows.findIndex((r) => r.id === id);
    if (at >= 0) rows.splice(at, 1);
    return at >= 0;
  }
}

/**
 * An engine double over one hot store and, optionally, an `archive`
 * datasource. `insert` records each engine write (the doors that run hooks),
 * apart from the driver writes the store records.
 */
export function memoryEngine(objects: ReadonlyArray<{ name: string; fields?: unknown; lifecycle?: unknown }>) {
  const hot = new MemoryStore();
  const archive = new MemoryStore();
  const inserts: Array<{ object: string; row: Row }> = [];
  const engine: AuditSealerEngine = {
    registry: { getAllObjects: () => objects },
    getDriverForObject: () => hot,
    datasource: (name: string) => (name === 'archive' ? archive : undefined),
    async insert(object, row) {
      inserts.push({ object, row: { ...row } });
      if (object === 'sys_audit_checkpoint') {
        const taken = hot.table(object).some((r) => r.sealed_object === row.sealed_object && r.chain_key === row.chain_key && r.sequence === row.sequence);
        if (taken) throw new Error('UNIQUE constraint failed: sys_audit_checkpoint.sealed_object, chain_key, sequence');
      }
      hot.table(object).push({ ...row });
      return row;
    },
  };
  return { engine, hot, archive, inserts };
}

/**
 * A crypto provider double that binds each ciphertext to its context the way
 * a real one does: AES-256-GCM with the JCS of `(scope, namespace, key)` as
 * the AAD, so a handle opened under another context fails.
 */
export function bindingCrypto(): ICryptoProvider & { encrypts: CryptoContext[] } {
  const master = randomBytes(32);
  const aad = (ctx: CryptoContext) => createHash('sha256').update(JSON.stringify([ctx.scope, ctx.namespace, ctx.key])).digest();
  const encrypts: CryptoContext[] = [];
  const provider: ICryptoProvider & { encrypts: CryptoContext[] } = {
    encrypts,
    async encrypt(plain: string, ctx: CryptoContext): Promise<CryptoHandle> {
      encrypts.push(ctx);
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', master, iv);
      cipher.setAAD(aad(ctx));
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return { id: randomUUID(), kmsKeyId: 'test-kms', alg: 'aes-256-gcm', version: 1, ciphertext: Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64') };
    },
    async decrypt(handle: CryptoHandle, ctx: CryptoContext): Promise<string> {
      const blob = Buffer.from(handle.ciphertext, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', master, blob.subarray(0, 12));
      decipher.setAAD(aad(ctx));
      decipher.setAuthTag(blob.subarray(12, 28));
      return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString('utf8');
    },
    async rotateKey(handle: CryptoHandle): Promise<CryptoHandle> {
      return handle;
    },
    digest(plain: string): string {
      return createHash('sha256').update(plain).digest('hex');
    },
    async keyedDigest(plain: string): Promise<string> {
      return createHash('sha256').update(plain).digest('hex');
    },
  };
  return provider;
}

/** A logger double that keeps every line. */
export function recordingLogger() {
  const lines: Array<{ level: 'info' | 'warn' | 'error'; message: string }> = [];
  return {
    lines,
    info: (message: string) => void lines.push({ level: 'info', message }),
    warn: (message: string) => void lines.push({ level: 'warn', message }),
    error: (message: string) => void lines.push({ level: 'error', message }),
  };
}

/** A statement one session of a {@link sessionLockDatabase} ran. */
export interface SessionStatement {
  readonly session: number;
  readonly sql: string;
  readonly bindings: readonly unknown[];
}

/**
 * A database that keeps session locks the way Postgres keeps advisory locks
 * (and MySQL `GET_LOCK`): held by the session that took them, until that
 * session unlocks or ends. A blocking lock really waits, until the lock is
 * free or the session's `lock_timeout` runs out (`55P03`). It answers the
 * statements `@objectstack/objectql`'s database session lock runs, and
 * nothing else.
 *
 * `face` is what a SQL driver adds to a store (`dialectName`, `getKnex()`):
 * on a {@link MemoryStore} ({@link lockableStore}), that store is a datasource
 * the lock can be taken on. `kill(session)` ends a session as a dropped
 * connection would, which releases every lock it held.
 */
export function sessionLockDatabase(dialect: 'postgres' | 'mysql' = 'postgres') {
  const holders = new Map<string, number>();
  const sessions = new Map<number, { alive: boolean; lockTimeoutMs: number }>();
  const statements: SessionStatement[] = [];
  let next = 1;
  const shape = (row: Row) => (dialect === 'mysql' ? [[row], []] : { rows: [row] });
  const end = (id: number) => {
    const session = sessions.get(id);
    if (session) session.alive = false;
    for (const [key, holder] of holders) if (holder === id) holders.delete(key);
  };
  const take = (id: number, key: string): boolean => {
    const holder = holders.get(key);
    if (holder !== undefined && holder !== id) return false;
    holders.set(key, id);
    return true;
  };
  const wait = async (id: number, key: string, timeoutMs: number): Promise<boolean> => {
    const until = Date.now() + timeoutMs;
    for (;;) {
      if (!sessions.get(id)?.alive) throw new Error('Connection terminated unexpectedly');
      if (take(id, key)) return true;
      if (Date.now() >= until) return false;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  };
  const run = async (id: number, sql: string, bindings: readonly unknown[]): Promise<unknown> => {
    const session = sessions.get(id);
    if (!session?.alive) throw new Error('Connection terminated unexpectedly');
    statements.push({ session: id, sql, bindings });
    const key = String(bindings[0]);
    switch (sql) {
      case 'select pg_try_advisory_lock(?::bigint) as locked':
        return shape({ locked: take(id, key) });
      case 'select GET_LOCK(?, 0) as locked':
        return shape({ locked: take(id, key) ? 1 : 0 });
      // A run's session marker, and the check that the session holding a lock here holds a marker.
      case 'select pg_try_advisory_lock(?::bigint) as marked':
        return shape({ marked: take(id, key) });
      case 'select GET_LOCK(?, 0) as marked':
        return shape({ marked: take(id, key) ? 1 : 0 });
      case 'select IS_USED_LOCK(?) = IS_USED_LOCK(?) as seen': {
        const [marker, lock] = [holders.get(key), holders.get(String(bindings[1]))];
        return shape({ seen: marker === undefined || lock === undefined ? null : Number(marker === lock) });
      }
      case 'select pg_advisory_lock(?::bigint)':
        if (await wait(id, key, session.lockTimeoutMs)) return shape({});
        throw Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
      case 'select GET_LOCK(?, ?) as locked':
        return shape({ locked: (await wait(id, key, Number(bindings[1]) * 1000)) ? 1 : 0 });
      case 'select pg_advisory_unlock(?::bigint)':
      case 'select RELEASE_LOCK(?)':
        if (holders.get(key) === id) holders.delete(key);
        return shape({});
      case 'select 1 as held':
        return shape({ held: 1 });
      default: {
        if (sql.startsWith('select exists (select 1 from pg_locks m join pg_locks l on l.pid = m.pid')) {
          // classid and objid, the high and low 32 bits of each key, back to the key.
          const keyOf = (high: unknown, low: unknown) => BigInt.asIntN(64, (BigInt(String(high)) << 32n) | BigInt(String(low))).toString();
          const [marker, lock] = [holders.get(keyOf(bindings[0], bindings[1])), holders.get(keyOf(bindings[2], bindings[3]))];
          return shape({ seen: marker !== undefined && marker === lock });
        }
        const timeout = /^set lock_timeout = (\d+)$/.exec(sql);
        if (timeout) {
          session.lockTimeoutMs = Number(timeout[1]);
          return shape({});
        }
        throw new Error(`sessionLockDatabase: no answer for ${sql}`);
      }
    }
  };
  const knex = {
    client: {
      async acquireRawConnection(): Promise<{ id: number }> {
        const id = next++;
        sessions.set(id, { alive: true, lockTimeoutMs: Number.POSITIVE_INFINITY });
        return { id };
      },
      async destroyRawConnection(connection: unknown): Promise<void> {
        end((connection as { id: number }).id);
      },
    },
    raw: (sql: string, bindings: readonly unknown[] = []) => ({
      connection: (connection: unknown) => run((connection as { id: number }).id, sql, bindings),
    }),
  };
  return {
    statements,
    face: { dialectName: dialect, getKnex: () => knex },
    /** The session holding the lock under `key` (a Postgres key, or a MySQL name), if any. */
    holder: (key: string): number | undefined => holders.get(key),
    /** Every session opened and not yet ended. */
    open: (): number[] => [...sessions].filter(([, s]) => s.alive).map(([id]) => id),
    kill: end,
    /** Take the lock under `key` on a session of the test's own, as another process would. */
    async hold(key: string): Promise<{ session: number; release(): void }> {
      const { id } = await knex.client.acquireRawConnection();
      if (!take(id, key)) throw new Error(`sessionLockDatabase: '${key}' is already held`);
      return { session: id, release: () => end(id) };
    },
  };
}

/**
 * `store`, made a datasource the database session lock can be taken on: `db`'s
 * `face` on it. A face naming another dialect (`'sqlite'`) makes a datasource
 * that offers no session lock.
 */
export function lockableStore<T extends object>(store: T, db: { face: { dialectName: string; getKnex(): unknown } }): T {
  return Object.assign(store, db.face);
}
