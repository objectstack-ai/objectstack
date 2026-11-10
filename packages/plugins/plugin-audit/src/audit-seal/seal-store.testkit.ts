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

function matches(row: Row, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([field, cond]) => {
    const value = comparable(row[field]);
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      const ops = cond as Record<string, unknown>;
      if ('$gte' in ops && !((value as number) >= (comparable(ops.$gte) as number))) return false;
      if ('$lt' in ops && !((value as number) < (comparable(ops.$lt) as number))) return false;
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
