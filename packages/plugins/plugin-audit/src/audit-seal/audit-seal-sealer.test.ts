// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { IAuditCheckpointSigner, IClusterService, LockHandle } from '@objectstack/spec/contracts';
import { describe, expect, it } from 'vitest';
import { checkpointBodyFromRow, checkpointDigest, signedBodyBytes } from './index.js';
import { bindingCrypto, memoryEngine, recordingLogger } from './seal-store.testkit.js';
import { AUDIT_SEALER_LOCK, AuditSealer } from './sealer.js';
import { LocalCheckpointSigner } from './signer.js';

/**
 * ADR-0154 D3 — the sealer, over an in-memory engine double: which windows it
 * seals and in what order, the late pass, the backlog, the watermark, the
 * lock, the S1 loop, and each way it refuses to seal.
 */

const H = 60 * 60 * 1000;
const DAY0 = Date.UTC(2026, 10, 10);
const at = (h: number, m: number) => new Date(DAY0 + h * H + m * 60_000).toISOString();

const LEDGER = {
  name: 'ledger_probe',
  fields: { id: { type: 'text' }, created_at: { type: 'datetime' }, action: { type: 'text' }, tenant_id: { type: 'lookup' }, payload: { type: 'textarea' } },
  lifecycle: { class: 'audit', retention: { maxAge: '90d' }, archive: { after: '90d', to: 'archive' }, seal: { valueFields: ['payload'] } },
};

const row = (id: string, created: string, tenant: string | null = 'org_a') => ({ id, created_at: created, action: 'update', tenant_id: tenant, payload: `{"v":"${id}"}` });

function setup(options: { objects?: unknown[]; crypto?: boolean; signer?: IAuditCheckpointSigner; cluster?: IClusterService } = {}) {
  const store = memoryEngine((options.objects ?? [LEDGER]) as never);
  const crypto = bindingCrypto();
  const logger = recordingLogger();
  const signer = options.signer ?? new LocalCheckpointSigner({ engine: store.engine, crypto });
  const clock = { now: DAY0 + 12 * H + 30 * 60_000 }; // 12:30 — windows up to 11:00–12:00 are due
  const sealer = new AuditSealer({
    engine: store.engine,
    ...(options.crypto === false ? {} : { crypto }),
    signer: () => signer,
    cluster: () => options.cluster,
    logger,
    now: () => clock.now,
  });
  const checkpoints = () => store.hot.table('sys_audit_checkpoint').map((r) => checkpointBodyFromRow(r));
  return { ...store, crypto, logger, signer, clock, sealer, checkpoints };
}

/** A cluster double that grants every acquire its own held lease, and counts renewals. */
function grantingCluster() {
  const cluster = { renews: 0, lock: { acquire: async () => ({ key: AUDIT_SEALER_LOCK, fencingToken: 1n, renew: async () => void (cluster.renews += 1), release: async () => {}, isHeld: () => true }) } };
  return cluster as unknown as IClusterService & { renews: number };
}

describe('windows: the backlog oldest first, one checkpoint per chain per window (D3, D5)', () => {
  it('seals every due window that holds a row, skips the empty one and the one not yet settled', async () => {
    const s = setup();
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)), row('r2', at(8, 20), null), row('r3', at(10, 5)), row('r4', at(11, 59)), row('r5', at(12, 1)));
    expect(await s.sealer.runPass()).toBe(4);
    expect(s.checkpoints().map((c) => [c.window_start, c.tenant_id, c.kind, c.sequence, c.row_ids])).toEqual([
      [at(8, 0), null, 'window', 0, ['r2']],
      [at(8, 0), 'org_a', 'window', 0, ['r1']],
      [at(10, 0), 'org_a', 'window', 1, ['r3']],
      [at(11, 0), 'org_a', 'window', 2, ['r4']],
    ]);
  });

  it('chains each checkpoint to its chain head, and carries the watermark of the windows completed before it', async () => {
    const s = setup();
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)), row('r2', at(8, 20), null), row('r3', at(10, 5)));
    await s.sealer.runPass();
    const [deployment, a0, a1] = s.checkpoints();
    expect(a1.previous_digest).toBe(checkpointDigest(a0));
    expect(deployment.previous_digest).toBeNull();
    expect([deployment, a0, a1].map((c) => c.sealed_through)).toEqual([at(8, 0), at(8, 0), at(10, 0)]);
  });

  it('signs each body, and the signer vouches for the key that signed it', async () => {
    const s = setup();
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)));
    await s.sealer.runPass();
    const [stored] = s.hot.table('sys_audit_checkpoint');
    const body = checkpointBodyFromRow(stored);
    const { verify, createPublicKey } = await import('node:crypto');
    const pub = await s.signer.trustedPublicKey(body.signing_key_id);
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(pub!, 'base64').toString('base64url') }, format: 'jwk' });
    expect(verify(null, signedBodyBytes(body), key, Buffer.from(stored.signature as string, 'base64'))).toBe(true);
  });

  it('reads the archive into the backlog (Q3 (a)), a row both stores hold once', async () => {
    const s = setup();
    s.archive.table('ledger_probe').push(row('cold', at(7, 10)), row('both', at(8, 30)));
    s.hot.table('ledger_probe').push(row('both', at(8, 30)), row('hot', at(8, 40)));
    await s.sealer.runPass();
    expect(s.checkpoints().map((c) => [c.window_start, c.row_ids])).toEqual([[at(7, 0), ['cold']], [at(8, 0), ['both', 'hot']]]);
  });

  it('pages a window by (created_at, id), so rows the Archiver moves between pages are not skipped (S2)', async () => {
    const s = setup();
    const rows = Array.from({ length: 510 }, (_, i) => row(`r${String(i).padStart(3, '0')}`, new Date(DAY0 + 8 * H + i * 5_000).toISOString()));
    s.hot.table('ledger_probe').push(...rows);
    const find = s.hot.find.bind(s.hot);
    s.hot.find = async (object, query) => {
      const page = await find(object, query);
      if (page.length === 500) s.archive.table('ledger_probe').push(...s.hot.table('ledger_probe').splice(0, 10)); // copied, then deleted
      return page;
    };
    await s.sealer.runPass();
    expect(s.checkpoints().flatMap((c) => c.row_ids)).toEqual(rows.map((r) => r.id));
  });

  it('writes nothing on a second pass with nothing new', async () => {
    const s = setup();
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)));
    await s.sealer.runPass();
    expect(await s.sealer.runPass()).toBe(0);
  });
});

describe('late rows: re-counted and sealed as late, before the pass seals its windows (D3)', () => {
  it('seals a row that arrived in a sealed window into a late checkpoint, then the new window', async () => {
    const s = setup();
    s.hot.table('ledger_probe').push(row('r1', at(10, 5)), row('r2', at(11, 5)));
    await s.sealer.runPass();
    s.hot.table('ledger_probe').push(row('late', at(10, 30)), row('r3', at(12, 5)));
    s.clock.now = DAY0 + 13 * H + 15 * 60_000;
    expect(await s.sealer.runPass()).toBe(2);
    expect(s.checkpoints().slice(2).map((c) => [c.kind, c.window_start, c.sequence, c.row_ids, c.sealed_through])).toEqual([
      ['late', at(10, 0), 2, ['late'], at(11, 0)],
      ['window', at(12, 0), 3, ['r3'], at(12, 0)],
    ]);
  });

  it('re-counts each window of the horizon on its own, renewing the lease, so a delete in one cannot mask a late row in another (S6)', async () => {
    const cluster = grantingCluster();
    const s = setup({ cluster });
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)), row('r2', at(8, 20)), row('r3', at(9, 5)));
    await s.sealer.runPass();
    s.hot.table('ledger_probe').splice(0, 1);
    s.hot.table('ledger_probe').push(row('late', at(9, 30)));
    cluster.renews = 0;
    expect(await s.sealer.runPass()).toBe(1);
    expect(s.checkpoints().slice(2).map((c) => [c.kind, c.window_start, c.row_ids])).toEqual([['late', at(9, 0), ['late']]]);
    expect(cluster.renews).toBeGreaterThanOrEqual(166); // one per window from 7d back to the last sealed one
  });

  it("resumes a window a stopped pass left: the chain it never reached gets a window checkpoint, not a late one", async () => {
    const s = setup();
    s.hot.table('ledger_probe').push(row('a', at(8, 10)), row('b', at(8, 20), 'org_b'));
    const insert = s.engine.insert.bind(s.engine);
    let failed = false;
    s.engine.insert = async (object, r, o) => {
      if (object === 'sys_audit_checkpoint' && r.tenant_id === 'org_b' && !failed) {
        failed = true;
        throw new Error('connection reset');
      }
      return insert(object, r, o);
    };
    expect(await s.sealer.runPass()).toBe(1);
    expect(await s.sealer.runPass()).toBe(1);
    expect(s.checkpoints().map((c) => [c.tenant_id, c.kind, c.row_ids])).toEqual([['org_a', 'window', ['a']], ['org_b', 'window', ['b']]]);
    expect(s.hot.table('sys_secret')).toHaveLength(4); // the key's half, two seeds, and the unstored write's seed kept as an orphan (M1)
  });
});

describe('the lock: audit.sealer, its fencing token on each checkpoint (D3, Q2 (a))', () => {
  const lockedCluster = (token: bigint | null, onAcquire: (key: string) => void = () => {}) => {
    let held = token !== null;
    const handle: LockHandle | null = token === null ? null : {
      key: AUDIT_SEALER_LOCK, fencingToken: token, renew: async () => {}, release: async () => { held = false; }, isHeld: () => held,
    };
    return { lock: { acquire: async (key: string) => (onAcquire(key), handle), withLock: async () => null, close: async () => {} } } as unknown as IClusterService;
  };

  it('holds the cluster lock and records its fencing token', async () => {
    const keys: string[] = [];
    const s = setup({ cluster: lockedCluster(42n, (k) => keys.push(k)) });
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)));
    await s.sealer.runPass();
    expect(keys).toEqual(['audit.sealer']);
    expect(s.checkpoints()[0].fencing_token).toBe('42');
  });

  it('writes nothing while another replica holds the lock', async () => {
    const s = setup({ cluster: lockedCluster(null) });
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)));
    expect(await s.sealer.runPass()).toBe(0);
    expect(s.hot.table('sys_audit_checkpoint')).toEqual([]);
  });

  it('stores nothing when the lease lapsed before the write, and drops the seed it sealed', async () => {
    const cluster = lockedCluster(7n);
    const s = setup({ cluster });
    const acquire = cluster.lock.acquire.bind(cluster.lock);
    cluster.lock.acquire = async (k, o) => {
      const h = await acquire(k, o);
      return h && { ...h, isHeld: () => false, renew: h.renew, release: h.release, key: h.key, fencingToken: h.fencingToken };
    };
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)));
    expect(await s.sealer.runPass()).toBe(0);
    expect(s.hot.table('sys_audit_checkpoint')).toEqual([]);
    expect(s.hot.table('sys_secret').filter((r) => r.namespace === 'ledger_probe')).toEqual([]);
  });

  it('with no cluster service, locks in-process with its own fencing counter and says so once at info', async () => {
    const s = setup();
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)), row('r2', at(9, 10)));
    await s.sealer.runPass();
    s.clock.now += H;
    await s.sealer.runPass();
    const info = s.logger.lines.filter((l) => l.level === 'info');
    expect(info).toHaveLength(1);
    expect(info[0].message).toMatch(/in-process only/);
    expect(BigInt(s.checkpoints()[0].fencing_token)).toBeGreaterThan(0n);
  });

  it('refuses a window checkpoint the chain head, re-read under the lease, already covers: two sealers whose leases overlap (S1)', async () => {
    const cluster = grantingCluster();
    const s = setup({ cluster });
    const other = new AuditSealer({ engine: s.engine, crypto: s.crypto, signer: () => s.signer, cluster: () => cluster, logger: s.logger, now: () => s.clock.now });
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)));
    const find = s.hot.find.bind(s.hot);
    let raced = false;
    s.hot.find = async (object, query) => {
      const page = await find(object, query);
      if (object === 'ledger_probe' && query.limit === 500 && !raced) {
        raced = true;
        await other.runPass(); // seals the window this pass has just read, before this pass writes it
      }
      return page;
    };
    expect(await s.sealer.runPass()).toBe(0);
    expect(s.checkpoints().map((c) => [c.window_start, c.sequence])).toEqual([[at(8, 0), 0]]);
    expect(s.logger.lines.filter((l) => l.level === 'error').map((l) => l.message)).toEqual([expect.stringMatching(/already holds a window checkpoint at or after/)]);
  });
});

describe('the S1 loop: built with the expected key id, rebuilt on a mismatch, never stored mismatched (D6)', () => {
  const rotating = (answers: string[]) => {
    const signed: Array<{ keyId: string; bytes: string }> = [];
    const signer = {
      activeKeyId: async () => 'k1',
      sign: async (bytes: Uint8Array) => {
        const keyId = answers[Math.min(signed.length, answers.length - 1)];
        signed.push({ keyId, bytes: Buffer.from(bytes).toString('utf8') });
        return { keyId, signature: Buffer.from(`sig:${signed.length}`).toString('base64') };
      },
      trustedPublicKey: async () => null,
    };
    return { signer, signed };
  };

  it('re-signs a body rebuilt with the key id the signer answered, and stores only that signature', async () => {
    const { signer, signed } = rotating(['k2', 'k2']);
    const s = setup({ signer });
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)));
    await s.sealer.runPass();
    const [stored] = s.hot.table('sys_audit_checkpoint');
    expect(JSON.parse(signed[0].bytes).signing_key_id).toBe('k1');
    expect(JSON.parse(signed[1].bytes).signing_key_id).toBe('k2');
    expect(stored.signing_key_id).toBe('k2');
    expect(stored.signature).toBe(Buffer.from('sig:2').toString('base64'));
    expect(Buffer.from(signedBodyBytes(checkpointBodyFromRow(stored))).toString('utf8')).toBe(signed[1].bytes);
  });

  it('gives up, storing nothing, when the signer answers another key id on every attempt', async () => {
    const { signer } = rotating(['k2', 'k3', 'k4']);
    const s = setup({ signer });
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)));
    expect(await s.sealer.runPass()).toBe(0);
    expect(s.hot.table('sys_audit_checkpoint')).toEqual([]);
    expect(s.logger.lines.filter((l) => l.level === 'error').map((l) => l.message)).toEqual([expect.stringMatching(/different key id on each of 3 attempts/)]);
  });
});

describe('what the sealer writes, and where (ruling 3d)', () => {
  it('writes each seed sealed under its checkpoint coordinate, as a sys_secret row below the hooks, and never the sealed object', async () => {
    const s = setup();
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)), row('r2', at(8, 20), null));
    await s.sealer.runPass();
    const seeds = s.crypto.encrypts.filter((c) => c.namespace === 'ledger_probe');
    expect(seeds).toEqual([
      { scope: 'audit_seal', namespace: 'ledger_probe', key: '[null,0]' },
      { scope: 'audit_seal', namespace: 'ledger_probe', key: '["org_a",0]' },
    ]);
    expect(s.hot.creates.filter((c) => c.object === 'sys_secret')).toHaveLength(3);
    expect(s.inserts.map((i) => i.object).filter((o) => o === 'sys_secret' || o === 'ledger_probe')).toEqual([]);
    expect(s.checkpoints().map((c) => c.seed_handle).sort()).toEqual(s.hot.table('sys_secret').filter((r) => r.namespace === 'ledger_probe').map((r) => r.id).sort());
  });

  it('keeps the seed of a checkpoint whose insert stored its row and then rejected, and the checkpoint stands (M1)', async () => {
    const s = setup();
    const insert = s.engine.insert.bind(s.engine);
    s.engine.insert = async (object, r, o) => {
      const stored = await insert(object, r, o);
      if (object === 'sys_audit_checkpoint') throw new Error('afterInsert hook failed');
      return stored;
    };
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)));
    expect(await s.sealer.runPass()).toBe(1);
    expect(s.hot.table('sys_secret').filter((r) => r.namespace === 'ledger_probe').map((r) => r.id)).toEqual([s.checkpoints()[0].seed_handle]);
    expect(s.logger.lines.filter((l) => l.level !== 'info').map((l) => [l.level, l.message])).toEqual([['warn', expect.stringMatching(/afterInsert hook failed.*after its row was stored; it stands/)]]);
    expect(await s.sealer.runPass()).toBe(0);
  });

  it('refuses an organization id too long for the seed coordinate before anything is sealed (Q6 (a))', async () => {
    const s = setup();
    s.hot.table('ledger_probe').push(row('r1', at(8, 10), 'o'.repeat(130)));
    expect(await s.sealer.runPass()).toBe(0);
    expect(s.crypto.encrypts.filter((c) => c.namespace === 'ledger_probe')).toEqual([]);
    expect(s.hot.table('sys_secret').filter((r) => r.namespace === 'ledger_probe')).toEqual([]);
    expect(s.logger.lines.find((l) => l.level === 'error')?.message).toMatch(/longer than sys_secret.key holds/);
  });

  it('hands each checkpoint to a sink, and a failing sink costs only a warning', async () => {
    const s = setup();
    const delivered: unknown[] = [];
    const sealer = new AuditSealer({
      engine: s.engine, crypto: s.crypto, signer: () => s.signer, logger: s.logger, now: () => s.clock.now,
      sink: () => ({ deliver: async (entry) => { delivered.push(entry.kind); throw new Error('siem down'); } }),
    });
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)));
    expect(await sealer.runPass()).toBe(1);
    expect(delivered).toEqual(['checkpoint']);
    expect(s.logger.lines.map((l) => l.level)).toEqual(['info', 'warn']);
  });
});

describe('when it cannot seal it says so at error, again each hour while it lasts (D3, Q5 (a), S4)', () => {
  it('with no crypto provider: one line naming the consequence and the fix, and nothing written', async () => {
    const s = setup({ crypto: false });
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)));
    await s.sealer.runPass();
    await s.sealer.runPass();
    const errors = s.logger.lines.filter((l) => l.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/'ledger_probe'.*no crypto provider.*NOT being sealed.*Fix: wire a crypto provider/);
    expect(s.hot.table('sys_audit_checkpoint')).toEqual([]);
  });

  it('with a column of no rule: one line naming the column and its type, and the object is not sealed', async () => {
    const formula = { ...LEDGER, fields: { ...LEDGER.fields, total: { type: 'formula' } } };
    const s = setup({ objects: [formula] });
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)));
    await s.sealer.runPass();
    await s.sealer.runPass();
    const errors = s.logger.lines.filter((l) => l.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/'ledger_probe'.*'total' \(type 'formula'\).*NOT being sealed/);
    expect(s.hot.table('sys_audit_checkpoint')).toEqual([]);
  });

  it('with no tenant_id field: one line naming it, and the object is not folded into the deployment chain (S3)', async () => {
    const fields = Object.fromEntries(Object.entries(LEDGER.fields).filter(([name]) => name !== 'tenant_id'));
    const s = setup({ objects: [{ ...LEDGER, fields }] });
    s.hot.table('ledger_probe').push(row('r1', at(8, 10), null));
    await s.sealer.runPass();
    expect(s.logger.lines.filter((l) => l.level === 'error').map((l) => l.message)).toEqual([expect.stringMatching(/'ledger_probe'.*no 'tenant_id' field.*NOT being sealed/)]);
    expect(s.hot.table('sys_audit_checkpoint')).toEqual([]);
  });

  it('reports a stalled object again after an hour, and not on every pass before it (S4)', async () => {
    const s = setup();
    s.hot.create = async () => { throw new Error('disk full'); };
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)));
    const errorsAfterPass = async () => (await s.sealer.runPass(), s.logger.lines.filter((l) => l.level === 'error').length);
    expect([await errorsAfterPass(), await errorsAfterPass()]).toEqual([1, 1]);
    s.clock.now += H;
    expect(await errorsAfterPass()).toBe(2);
  });

  it("quotes a driver's reason, never its statement, whose values can hold a sealed secret's ciphertext", async () => {
    const s = setup();
    s.hot.create = async () => {
      throw Object.assign(new Error("insert into `sys_secret` (`ciphertext`) values ('Q2lwaGVydGV4dA==') - no such table: sys_secret"), { code: 'SQLITE_ERROR' });
    };
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)));
    await s.sealer.runPass();
    const [error] = s.logger.lines.filter((l) => l.level === 'error');
    expect(error.message).toContain('SQLITE_ERROR: no such table: sys_secret');
    expect(error.message).not.toContain('Q2lwaGVydGV4dA==');
  });

  it('seals nothing and reports nothing when no object declares lifecycle.seal', async () => {
    const s = setup({ objects: [{ ...LEDGER, lifecycle: { class: 'audit', retention: { maxAge: '90d' } } }], crypto: false });
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)));
    expect(await s.sealer.runPass()).toBe(0);
    expect(s.logger.lines).toEqual([]);
  });
});
