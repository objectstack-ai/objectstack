// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { IAuditCheckpointSigner, IClusterService, LockHandle } from '@objectstack/spec/contracts';
import { describe, expect, it } from 'vitest';
import { checkpointBodyFromRow, checkpointDigest, signedBodyBytes, verifyAuditLedger, type CheckpointSignedBody } from './index.js';
import { bindingCrypto, lockableStore, memoryEngine, recordingLogger, sessionLockDatabase } from './seal-store.testkit.js';
import { AUDIT_SEAL_PG_LOCK_KEY } from './seal-lock.js';
import { AUDIT_SEAL_MAX_IDLE_WINDOWS_PER_PASS, AUDIT_SEAL_MAX_LEAVES, AUDIT_SEALER_LOCK, AuditSealer } from './sealer.js';
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

function setup(options: { objects?: unknown[]; crypto?: boolean; signer?: IAuditCheckpointSigner; cluster?: IClusterService; maxLeaves?: number } = {}) {
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
    ...(options.maxLeaves === undefined ? {} : { maxLeaves: options.maxLeaves }),
  });
  const checkpoints = () => store.hot.table('sys_audit_checkpoint').map((r) => checkpointBodyFromRow(r));
  return { ...store, crypto, logger, signer, clock, sealer, checkpoints };
}

/** A cluster double that grants every acquire its own held lease, and counts renewals. */
function grantingCluster() {
  const cluster = { renews: 0, lock: { acquire: async () => ({ key: AUDIT_SEALER_LOCK, fencingToken: 1n, renew: async () => void (cluster.renews += 1), release: async () => {}, isHeld: () => true }) } };
  return cluster as unknown as IClusterService & { renews: number };
}

/** Runs `change` once, right after the first page read of a window's rows: between the sealer's two reads of it (S7). */
function betweenReads(s: ReturnType<typeof setup>, change: () => void) {
  const find = s.hot.find.bind(s.hot);
  let changed = false;
  s.hot.find = async (object, query) => {
    const page = await find(object, query);
    if (!changed && object === 'ledger_probe' && query.limit === 500) {
      changed = true;
      change();
    }
    return page;
  };
}

/** Deletes a row of the sealed object from the hot store. */
function drop(s: ReturnType<typeof setup>, id: string) {
  const table = s.hot.table('ledger_probe');
  table.splice(table.findIndex((r) => r.id === id), 1);
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

  it('reads each row of a window once when rows of one created_at straddle the page boundary: the keyset tie arm (S2)', async () => {
    const s = setup();
    // 495 rows a second apart, then 15 rows of one instant: the first page of 500 ends inside the tie.
    const tie = at(8, 30);
    const rows = Array.from({ length: 510 }, (_, i) =>
      row(`r${String(i).padStart(3, '0')}`, i < 495 ? new Date(DAY0 + 8 * H + i * 1_000).toISOString() : tie));
    s.hot.table('ledger_probe').push(...rows);
    const reads = new Map<string, number>();
    const find = s.hot.find.bind(s.hot);
    s.hot.find = async (object, query) => {
      const page = await find(object, query);
      if (object === 'ledger_probe' && query.limit === 500) for (const r of page) reads.set(String(r.id), (reads.get(String(r.id)) ?? 0) + 1);
      return page;
    };
    await s.sealer.runPass();
    expect(s.checkpoints().flatMap((c) => c.row_ids)).toEqual(rows.map((r) => r.id));
    expect(reads.size).toBe(510);
    expect([...reads].filter(([, n]) => n !== 1)).toEqual([]);
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

  it("drops from a late checkpoint each row a checkpoint stored since the pass read the window's lists, so no row is sealed twice (N1)", async () => {
    const cluster = grantingCluster();
    const s = setup({ cluster });
    const other = new AuditSealer({ engine: s.engine, crypto: s.crypto, signer: () => s.signer, cluster: () => cluster, logger: s.logger, now: () => s.clock.now });
    s.hot.table('ledger_probe').push(row('r1', at(10, 5)));
    await s.sealer.runPass();
    s.hot.table('ledger_probe').push(row('late', at(10, 30)));
    const find = s.hot.find.bind(s.hot);
    let raced = false;
    s.hot.find = async (object, query) => {
      const page = await find(object, query);
      // The pass's one read of the horizon's checkpoints; another sealer seals the late row right after it.
      if (object === 'sys_audit_checkpoint' && !raced && (query.where as Record<string, unknown>).window_start !== undefined) {
        raced = true;
        await other.runPass();
      }
      return page;
    };
    expect(await s.sealer.runPass()).toBe(0);
    expect(s.checkpoints().filter((c) => c.row_ids.includes('late')).map((c) => [c.kind, c.sequence])).toEqual([['late', 1]]);
    expect(s.hot.table('sys_secret').filter((r) => r.namespace === 'ledger_probe').map((r) => r.id).sort())
      .toEqual(s.checkpoints().map((c) => c.seed_handle).sort()); // nothing was sealed for the rows dropped
  });
});

describe('per-chain isolation: only a chain-local fault skips a chain, and only that chain (S4, seat ruling 6884540128 item 2)', () => {
  /** A row the canonical rule of its `payload` column (text) refuses: a number. */
  const refused = (id: string, created: string, tenant: string | null) => ({ ...row(id, created, tenant), payload: 42 });
  const errors = (s: ReturnType<typeof setup>) => s.logger.lines.filter((l) => l.level === 'error').map((l) => l.message);

  it('skips the chain of a row a canonical rule refuses, seals every other chain, and holds sealed_through at the skipped window', async () => {
    const s = setup();
    s.hot.table('ledger_probe').push(
      row('a1', at(8, 10)), refused('b1', at(8, 20), 'org_b'), row('d1', at(8, 30), null),
      row('a2', at(9, 10)), row('b2', at(9, 20), 'org_b'), row('a3', at(10, 10)),
    );
    expect(await s.sealer.runPass()).toBe(4);
    expect(s.checkpoints().map((c) => [c.window_start, c.tenant_id, c.kind, c.row_ids, c.sealed_through])).toEqual([
      [at(8, 0), null, 'window', ['d1'], at(8, 0)],
      [at(8, 0), 'org_a', 'window', ['a1'], at(8, 0)],
      // org_b is out for the rest of the pass, so the 09:00 window has a skipped chain: no watermark past 08:00.
      [at(9, 0), 'org_a', 'window', ['a2'], at(8, 0)],
      [at(10, 0), 'org_a', 'window', ['a3'], at(8, 0)],
    ]);
    expect(errors(s)).toEqual([expect.stringMatching(/'ledger_probe'.*chain 'org:org_b'.*b1\.payload.*not text.*NOT being sealed/)]);
  });

  it('resumes a skipped chain from its own oldest unsealed window, as window checkpoints and not late ones', async () => {
    const s = setup();
    s.hot.table('ledger_probe').push(row('a1', at(8, 10)), refused('b1', at(8, 20), 'org_b'), row('a2', at(9, 10)), row('b2', at(9, 20), 'org_b'));
    expect(await s.sealer.runPass()).toBe(2);
    s.hot.table('ledger_probe').find((r) => r.id === 'b1')!.payload = '{"v":"b1"}';
    expect(await s.sealer.runPass()).toBe(2);
    expect(s.checkpoints().slice(2).map((c) => [c.window_start, c.tenant_id, c.kind, c.sequence, c.row_ids, c.sealed_through])).toEqual([
      [at(8, 0), 'org_b', 'window', 0, ['b1'], at(8, 0)],
      [at(9, 0), 'org_b', 'window', 1, ['b2'], at(9, 0)],
    ]);
    expect(await s.sealer.runPass()).toBe(0);
  });

  it('skips the chain whose head checkpoint is malformed, and seals the others past it', async () => {
    const s = setup();
    s.hot.table('ledger_probe').push(row('a1', at(8, 10)), row('b1', at(8, 20), 'org_b'));
    expect(await s.sealer.runPass()).toBe(2);
    s.hot.table('sys_audit_checkpoint').find((r) => r.tenant_id === 'org_b')!.root = 'not a digest';
    s.hot.table('ledger_probe').push(row('a2', at(9, 10)), row('b2', at(9, 20), 'org_b'), row('a3', at(10, 10)));
    expect(await s.sealer.runPass()).toBe(2);
    expect(s.hot.table('sys_audit_checkpoint').slice(2).map((r) => checkpointBodyFromRow(r)).map((c) => [c.tenant_id, c.sequence, c.row_ids, c.sealed_through]))
      .toEqual([['org_a', 1, ['a2'], at(9, 0)], ['org_a', 2, ['a3'], at(9, 0)]]);
    expect(errors(s)).toEqual([expect.stringMatching(/'ledger_probe'.*chain 'org:org_b'.*root.*NOT being sealed/)]);
  });

  it('seals window-major: on a healthy backlog past the per-pass budget, every chain ends each pass at the same window, a sparse one included', async () => {
    const s = setup();
    s.clock.now = DAY0 + 40 * H; // windows up to 39:00 are due
    // org_a writes every hour for 30 hours, more windows than one pass seals; org_b only at hours 0, 11, 23 and 29.
    for (let h = 0; h < 30; h++) s.hot.table('ledger_probe').push(row(`a${h}`, at(h, 10)));
    for (const h of [0, 11, 23, 29]) s.hot.table('ledger_probe').push(row(`b${h}`, at(h, 20), 'org_b'));
    const newest = () => {
      const by: Record<string, string> = {};
      for (const c of s.checkpoints()) if (c.kind === 'window' && !(by[String(c.tenant_id)] > c.window_start)) by[String(c.tenant_id)] = c.window_start;
      return by;
    };
    expect(await s.sealer.runPass()).toBe(24 + 3);
    expect(newest()).toEqual({ org_a: at(23, 0), org_b: at(23, 0) });
    expect(await s.sealer.runPass()).toBe(6 + 1);
    expect(newest()).toEqual({ org_a: at(29, 0), org_b: at(29, 0) });
    expect(s.checkpoints().filter((c) => c.kind === 'late')).toEqual([]);
  });

  it("never seals a lagging chain's rows as late: skipped where another chain sealed, it recovers into window checkpoints, while that chain's own late row is sealed late", async () => {
    const s = setup();
    s.hot.table('ledger_probe').push(row('y1', at(8, 10)), refused('x1', at(8, 20), 'org_x'), row('y2', at(9, 10)), row('x2', at(9, 20), 'org_x'));
    expect(await s.sealer.runPass()).toBe(2); // org_a seals 08:00 and 09:00; org_x is skipped at 08:00
    s.hot.table('ledger_probe').find((r) => r.id === 'x1')!.payload = '{"v":"x1"}';
    s.hot.table('ledger_probe').push(row('y-late', at(8, 40))); // so the late pass reads the 08:00 window
    expect(await s.sealer.runPass()).toBe(3);
    expect(s.checkpoints().filter((c) => c.tenant_id === 'org_x').map((c) => [c.kind, c.window_start, c.sequence, c.row_ids]))
      .toEqual([['window', at(8, 0), 0, ['x1']], ['window', at(9, 0), 1, ['x2']]]);
    expect(s.checkpoints().filter((c) => c.kind === 'late').map((c) => [c.tenant_id, c.window_start, c.row_ids])).toEqual([['org_a', at(8, 0), ['y-late']]]);
  });

  it('still aborts the whole pass on a storage fault: no chain is skipped past it', async () => {
    const s = setup();
    s.hot.table('ledger_probe').push(row('a1', at(8, 10)), row('b1', at(8, 20), 'org_b'), row('a2', at(9, 10)));
    const insert = s.engine.insert.bind(s.engine);
    s.engine.insert = async (object, r, o) => {
      if (object === 'sys_audit_checkpoint' && r.tenant_id === 'org_a') throw new Error('connection reset');
      return insert(object, r, o);
    };
    expect(await s.sealer.runPass()).toBe(0);
    expect(s.hot.table('sys_audit_checkpoint')).toEqual([]);
    expect(errors(s)).toEqual([expect.stringMatching(/sealing 'ledger_probe' FAILED \(connection reset\)/)]);
  });

  it("keeps verify loud: the skipped chain's rows read unsealed and the verdict is not ok", async () => {
    const s = setup();
    s.hot.table('ledger_probe').push(row('a1', at(8, 10)), refused('b1', at(8, 20), 'org_b'), row('a2', at(9, 10)), row('b2', at(9, 20), 'org_b'));
    await s.sealer.runPass();
    const report = await verifyAuditLedger({ engine: s.engine, crypto: s.crypto, now: () => s.clock.now });
    expect(report.ok).toBe(false);
    expect(report.totals).toMatchObject({ unmodified: 2, late: 2, unsealed: 2 });
    expect(report.chains.find((c) => c.chain === 'org:org_b')?.counts).toMatchObject({ late: 2, unsealed: 2 });
  });
});

describe('bounded checkpoints: a window seals into consecutive parts of at most N leaves (S7, ADR-0154 D4 amended)', () => {
  const parts = (s: ReturnType<typeof setup>) =>
    s.checkpoints().map((c) => [c.tenant_id, c.kind, c.window_start, c.sequence, c.part_index, c.final_part, c.row_ids]);

  it('fixes N at 10,000 leaves', () => {
    expect(AUDIT_SEAL_MAX_LEAVES).toBe(10_000);
  });

  it('cuts a window into consecutive parts in D1 order (created_at, id), the last one final, each chained after the one before', async () => {
    const s = setup({ maxLeaves: 2 });
    // Pushed out of order, with a created_at tie broken by id.
    s.hot.table('ledger_probe').push(row('r5', at(8, 50)), row('r2', at(8, 20)), row('r3b', at(8, 30)), row('r1', at(8, 10)), row('r3a', at(8, 30)));
    expect(await s.sealer.runPass()).toBe(3);
    expect(parts(s)).toEqual([
      ['org_a', 'window', at(8, 0), 0, 0, false, ['r1', 'r2']],
      ['org_a', 'window', at(8, 0), 1, 1, false, ['r3a', 'r3b']],
      ['org_a', 'window', at(8, 0), 2, 2, true, ['r5']],
    ]);
    const [p0, p1, p2] = s.checkpoints();
    expect([p1.previous_digest, p2.previous_digest]).toEqual([checkpointDigest(p0), checkpointDigest(p1)]);
    expect(new Set(s.checkpoints().map((c) => c.seed_handle)).size).toBe(3); // one seed per checkpoint (D2)
    const report = await verifyAuditLedger({ engine: s.engine, crypto: s.crypto, now: () => s.clock.now });
    expect(report.ok).toBe(true);
    expect(report.totals).toMatchObject({ unmodified: 5, unsealed: 0 });
    expect(await s.sealer.runPass()).toBe(0);
  });

  it('seals a window of at most N rows as one part, index 0 and final: the single-part checkpoint, which still verifies', async () => {
    const s = setup({ maxLeaves: 2 });
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)), row('r2', at(8, 20)), row('r3', at(9, 10)));
    expect(await s.sealer.runPass()).toBe(2);
    expect(parts(s)).toEqual([
      ['org_a', 'window', at(8, 0), 0, 0, true, ['r1', 'r2']],
      ['org_a', 'window', at(9, 0), 1, 0, true, ['r3']],
    ]);
    expect((await verifyAuditLedger({ engine: s.engine, crypto: s.crypto, now: () => s.clock.now })).ok).toBe(true);
  });

  it('reads a checkpoint written before the amendment (no part index, no final flag) as one final part: it verifies, and its chain goes on', async () => {
    const s = setup();
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)));
    await s.sealer.runPass();
    const stored = s.hot.table('sys_audit_checkpoint')[0];
    const { part_index: _part, final_part: _final, ...legacy } = checkpointBodyFromRow(stored);
    const { signature } = await s.signer.sign(signedBodyBytes(legacy as CheckpointSignedBody));
    Object.assign(stored, { part_index: null, final_part: null, signature });
    expect(Object.keys(checkpointBodyFromRow(stored))).not.toContain('part_index');
    s.hot.table('ledger_probe').push(row('r2', at(9, 10)));
    expect(await s.sealer.runPass()).toBe(1);
    expect(parts(s)).toEqual([
      ['org_a', 'window', at(8, 0), 0, undefined, undefined, ['r1']],
      ['org_a', 'window', at(9, 0), 1, 0, true, ['r2']],
    ]);
    const report = await verifyAuditLedger({ engine: s.engine, crypto: s.crypto, now: () => s.clock.now });
    expect(report.ok).toBe(true);
    expect(report.totals).toMatchObject({ unmodified: 2 });
  });

  it('resumes a window a stopped pass left mid-way as further window parts, never late ones', async () => {
    const s = setup({ maxLeaves: 2 });
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)), row('r2', at(8, 20)), row('r3', at(8, 30)), row('r4', at(8, 40)), row('r5', at(8, 50)), row('n1', at(9, 10)));
    const insert = s.engine.insert.bind(s.engine);
    let inserts = 0;
    s.engine.insert = async (object, r, o) => {
      if (object === 'sys_audit_checkpoint' && ++inserts === 2) throw new Error('connection reset');
      return insert(object, r, o);
    };
    expect(await s.sealer.runPass()).toBe(1); // part 0 stored; the pass stops at part 1
    expect(await s.sealer.runPass()).toBe(3);
    expect(parts(s)).toEqual([
      ['org_a', 'window', at(8, 0), 0, 0, false, ['r1', 'r2']],
      ['org_a', 'window', at(8, 0), 1, 1, false, ['r3', 'r4']],
      ['org_a', 'window', at(8, 0), 2, 2, true, ['r5']],
      ['org_a', 'window', at(9, 0), 3, 0, true, ['n1']],
    ]);
    expect((await verifyAuditLedger({ engine: s.engine, crypto: s.crypto, now: () => s.clock.now })).ok).toBe(true);
    expect(await s.sealer.runPass()).toBe(0);
  });

  it('caps late checkpoints the same way: late rows of a window seal into late parts of at most N', async () => {
    const s = setup({ maxLeaves: 2 });
    s.hot.table('ledger_probe').push(row('r1', at(10, 5)));
    expect(await s.sealer.runPass()).toBe(1);
    s.hot.table('ledger_probe').push(row('l3', at(10, 40)), row('l1', at(10, 20)), row('l2', at(10, 30)));
    expect(await s.sealer.runPass()).toBe(2);
    expect(parts(s).slice(1)).toEqual([
      ['org_a', 'late', at(10, 0), 1, 0, false, ['l1', 'l2']],
      ['org_a', 'late', at(10, 0), 2, 1, true, ['l3']],
    ]);
    const report = await verifyAuditLedger({ engine: s.engine, crypto: s.crypto, now: () => s.clock.now });
    expect(report.totals).toMatchObject({ unmodified: 1, late: 3, unsealed: 0 });
  });

  it('refuses a window part the chain, re-read under the lease, already holds at that index or past it (S1, relaxed for parts)', async () => {
    const cluster = grantingCluster();
    const s = setup({ cluster, maxLeaves: 2 });
    const other = new AuditSealer({ engine: s.engine, crypto: s.crypto, signer: () => s.signer, cluster: () => cluster, logger: s.logger, now: () => s.clock.now, maxLeaves: 2 });
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)), row('r2', at(8, 20)), row('r3', at(8, 30)));
    const sign = s.signer.sign.bind(s.signer);
    let raced = false;
    s.signer.sign = async (bytes) => {
      const signed = await sign(bytes);
      if (!raced) {
        raced = true;
        await other.runPass(); // seals both parts of the window while this pass signs its part 0
      }
      return signed;
    };
    await s.sealer.runPass();
    expect(parts(s)).toEqual([
      ['org_a', 'window', at(8, 0), 0, 0, false, ['r1', 'r2']],
      ['org_a', 'window', at(8, 0), 1, 1, true, ['r3']],
    ]);
    expect(s.logger.lines.filter((l) => l.level === 'error').map((l) => l.message)).toEqual([expect.stringMatching(/not sealed twice/)]);
  });

  it('refuses a window part when the chain, re-read under the lease, holds a checkpoint of that window written before the amendment: on SQL a NULL part index is not at or past part 0 (S1, N2)', async () => {
    const cluster = grantingCluster();
    const s = setup({ cluster });
    // A sealer of the release before the amendment, running beside this one in a rolling upgrade.
    const older = new AuditSealer({ engine: s.engine, crypto: s.crypto, signer: () => s.signer, cluster: () => cluster, logger: s.logger, now: () => s.clock.now });
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)));
    const find = s.hot.find.bind(s.hot);
    let raced = false;
    s.hot.find = async (object, query) => {
      const page = await find(object, query);
      if (object === 'ledger_probe' && query.limit === 500 && !raced) {
        raced = true;
        await older.runPass(); // seals the window this pass has just read, before this pass reads the chain head
        const stored = s.hot.table('sys_audit_checkpoint')[0];
        const { part_index: _part, final_part: _final, ...legacy } = checkpointBodyFromRow(stored);
        const { signature } = await s.signer.sign(signedBodyBytes(legacy as CheckpointSignedBody));
        Object.assign(stored, { part_index: null, final_part: null, signature }); // what that release stores
      }
      return page;
    };
    expect(await s.sealer.runPass()).toBe(0);
    expect(parts(s)).toEqual([['org_a', 'window', at(8, 0), 0, undefined, undefined, ['r1']]]);
    expect(s.logger.lines.filter((l) => l.level === 'error').map((l) => l.message)).toEqual([expect.stringMatching(/at or after part 0 .*not sealed twice/)]);
    expect((await verifyAuditLedger({ engine: s.engine, crypto: s.crypto, now: () => s.clock.now })).ok).toBe(true);
  });

  it('cuts the same way whatever order the rows were written in, when a created_at tie straddles a part boundary: the id decides the side', async () => {
    const tie = [row('r1', at(8, 10)), row('t-b', at(8, 20)), row('t-a', at(8, 20)), row('r4', at(8, 30))];
    for (const written of [tie, [...tie].reverse()]) {
      const s = setup({ maxLeaves: 2 });
      s.hot.table('ledger_probe').push(...written.map((r) => ({ ...r })));
      expect(await s.sealer.runPass()).toBe(2);
      expect(parts(s)).toEqual([
        ['org_a', 'window', at(8, 0), 0, 0, false, ['r1', 't-a']],
        ['org_a', 'window', at(8, 0), 1, 1, true, ['t-b', 'r4']],
      ]);
      expect((await verifyAuditLedger({ engine: s.engine, crypto: s.crypto, now: () => s.clock.now })).ok).toBe(true);
    }
  });

  it('leaves out of its part a row deleted, or moved to another window, between the two reads; the moved row seals in its new window', async () => {
    const s = setup({ maxLeaves: 2 });
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)), row('r2', at(8, 20)), row('r3', at(8, 30)), row('r4', at(8, 40)));
    betweenReads(s, () => {
      drop(s, 'r2');
      s.hot.table('ledger_probe').find((r) => r.id === 'r3')!.created_at = at(9, 15);
    });
    expect(await s.sealer.runPass()).toBe(3);
    expect(parts(s)).toEqual([
      ['org_a', 'window', at(8, 0), 0, 0, false, ['r1']],
      ['org_a', 'window', at(8, 0), 1, 1, true, ['r4']],
      ['org_a', 'window', at(9, 0), 2, 0, true, ['r3']],
    ]);
    const report = await verifyAuditLedger({ engine: s.engine, crypto: s.crypto, now: () => s.clock.now });
    expect(report.ok).toBe(true);
    expect(report.totals).toMatchObject({ unmodified: 3, unsealed: 0 });
    expect(await s.sealer.runPass()).toBe(0);
  });

  it('skips a middle part whose rows all went between the two reads without taking its index: part_index may jump, and the window verifies', async () => {
    const s = setup({ maxLeaves: 2 });
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)), row('r2', at(8, 20)), row('r3', at(8, 30)), row('r4', at(8, 40)), row('r5', at(8, 50)));
    betweenReads(s, () => (drop(s, 'r3'), drop(s, 'r4')));
    expect(await s.sealer.runPass()).toBe(2);
    expect(parts(s)).toEqual([
      ['org_a', 'window', at(8, 0), 0, 0, false, ['r1', 'r2']],
      ['org_a', 'window', at(8, 0), 1, 2, true, ['r5']],
    ]);
    expect((await verifyAuditLedger({ engine: s.engine, crypto: s.crypto, now: () => s.clock.now })).ok).toBe(true);
  });

  it('leaves the window with no final part when its last part empties between the two reads; the next pass resumes it, so a row that arrives then is a window part, never a late one', async () => {
    const s = setup({ maxLeaves: 2 });
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)), row('r2', at(8, 20)), row('r3', at(8, 30)));
    betweenReads(s, () => drop(s, 'r3'));
    expect(await s.sealer.runPass()).toBe(1);
    expect(parts(s)).toEqual([['org_a', 'window', at(8, 0), 0, 0, false, ['r1', 'r2']]]);
    expect((await verifyAuditLedger({ engine: s.engine, crypto: s.crypto, now: () => s.clock.now })).ok).toBe(true);
    expect(await s.sealer.runPass()).toBe(0); // the resume finds every row listed
    s.hot.table('ledger_probe').push(row('r6', at(8, 55)));
    expect(await s.sealer.runPass()).toBe(1);
    expect(parts(s).slice(1)).toEqual([['org_a', 'window', at(8, 0), 1, 1, true, ['r6']]]);
    const report = await verifyAuditLedger({ engine: s.engine, crypto: s.crypto, now: () => s.clock.now });
    expect(report.ok).toBe(true);
    expect(report.totals).toMatchObject({ unmodified: 3, late: 0, unsealed: 0 });
  });

  it('shows a removed interior part through the links (a gap); a removed newest part is not seen by the links, and its rows read unsealed (M2)', async () => {
    const without = async (sequence: number) => {
      const s = setup({ maxLeaves: 2 });
      s.hot.table('ledger_probe').push(row('r1', at(8, 10)), row('r2', at(8, 20)), row('r3', at(8, 30)), row('r4', at(8, 40)), row('r5', at(8, 50)));
      expect(await s.sealer.runPass()).toBe(3);
      const table = s.hot.table('sys_audit_checkpoint');
      table.splice(table.findIndex((r) => Number(r.sequence) === sequence), 1);
      return verifyAuditLedger({ engine: s.engine, crypto: s.crypto, now: () => s.clock.now });
    };
    const interior = await without(1);
    expect(interior.ok).toBe(false);
    expect(interior.faults.map((f) => [f.kind, f.sequence])).toEqual([['gap', 1]]);
    expect(interior.rows.map((r) => [r.row, r.verdict, r.sealed])).toEqual([['r3', 'late', false], ['r4', 'late', false]]);
    const newest = await without(2);
    expect(newest.ok).toBe(false);
    expect(newest.faults).toEqual([]);
    expect(newest.rows.map((r) => [r.row, r.verdict, r.sealed])).toEqual([['r5', 'late', false]]);
  });
});

describe('the uncounted re-walk is bounded while a chain stays skipped (review#3 S1)', () => {
  const HOURS = 200;
  /**
   * Each of these tests first drives `stalled()`: some 200 windows sealed and
   * signed over a dozen passes. That costs 2-5 s on a quiet CI shard and more
   * on a loaded one, against vitest's 5 s default, so the budget is stated.
   */
  const STALLED_TIMEOUT_MS = 30_000;
  /**
   * org_s skipped at 00:00 by a row its canonical rule refuses, while org_a
   * writes every hour: org_a catches up 24 windows a pass while org_s holds
   * the floor at 00:00, until the cap stops the walk.
   */
  async function stalled() {
    const s = setup();
    s.clock.now = DAY0 + (HOURS + 1) * H; // windows up to HOURS:00 are due
    s.hot.table('ledger_probe').push({ ...row('stuck', at(0, 20), 'org_s'), payload: 42 });
    for (let h = 0; h <= HOURS - 1; h++) s.hot.table('ledger_probe').push(row(`a${h}`, at(h, 10)));
    for (let pass = 0; pass < 12 && (await s.sealer.runPass()) > 0; pass++);
    return s;
  }
  const catchUp = async (s: ReturnType<typeof setup>) => {
    for (let pass = 0; pass < 6 && (await s.sealer.runPass()) > 0; pass++);
  };
  const sealedOnce = (s: ReturnType<typeof setup>) => {
    const listed = s.checkpoints().flatMap((c) => c.row_ids).sort();
    return { listed, rows: s.hot.table('ledger_probe').map((r) => String(r.id)).sort(), late: s.checkpoints().filter((c) => c.kind === 'late') };
  };

  it('walks at most MAX_IDLE_WINDOWS_PER_PASS windows that seal nothing, and says so at error', async () => {
    const s = await stalled();
    const windowsRead = new Set<string>();
    const find = s.hot.find.bind(s.hot);
    s.hot.find = async (object, query) => {
      if (object === 'ledger_probe' && query.limit === 500) windowsRead.add(JSON.stringify((query.where as Record<string, unknown>).created_at ?? (query.where as { $and: Array<Record<string, unknown>> }).$and[0].created_at));
      return find(object, query);
    };
    expect(await s.sealer.runPass()).toBe(0);
    expect(windowsRead.size).toBe(1 + AUDIT_SEAL_MAX_IDLE_WINDOWS_PER_PASS); // the floor window, then the cap
    expect(s.logger.lines.filter((l) => l.level === 'error').map((l) => l.message))
      .toContainEqual(expect.stringMatching(/'ledger_probe'.*walked .* windows that seal nothing.*chain\(s\) 'org:org_s'/));
  }, STALLED_TIMEOUT_MS);

  it('seals the whole object again once the skipped chain is fixed: its window and the windows past the cap seal as window checkpoints, none late', async () => {
    const s = await stalled();
    expect(sealedOnce(s).listed.length).toBeLessThan(HOURS); // org_a up to the cap; org_s and the rest wait
    s.hot.table('ledger_probe').find((r) => r.id === 'stuck')!.payload = '{"v":"stuck"}';
    await catchUp(s);
    const { listed, rows, late } = sealedOnce(s);
    expect(listed).toEqual(rows);
    expect(late).toEqual([]);
    expect(s.checkpoints().filter((c) => c.tenant_id === 'org_s').map((c) => [c.kind, c.window_start, c.row_ids])).toEqual([['window', at(0, 0), ['stuck']]]);
  }, STALLED_TIMEOUT_MS);

  it('seals the whole object again once the skipped chain has nothing left to seal (its refused row gone): no chain is skipped, so the walk past the cap is not cut', async () => {
    const s = await stalled();
    drop(s, 'stuck');
    await catchUp(s);
    const { listed, rows, late } = sealedOnce(s);
    expect(listed).toEqual(rows);
    expect(late).toEqual([]);
    const report = await verifyAuditLedger({ engine: s.engine, crypto: s.crypto, now: () => s.clock.now });
    expect(report.ok).toBe(true);
    expect(report.totals).toMatchObject({ unmodified: HOURS, unsealed: 0 });
  }, STALLED_TIMEOUT_MS);
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

  it('drops the seed of a checkpoint whose sequence another checkpoint holds: the unique index proves it can never be stored (N2)', async () => {
    const cluster = grantingCluster();
    const s = setup({ cluster });
    const other = new AuditSealer({ engine: s.engine, crypto: s.crypto, signer: () => s.signer, cluster: () => cluster, logger: s.logger, now: () => s.clock.now });
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)));
    const insert = s.engine.insert.bind(s.engine);
    let raced = false;
    s.engine.insert = async (object, r, o) => {
      if (object === 'sys_audit_checkpoint' && !raced) {
        raced = true;
        await other.runPass(); // stores this sequence first, past this pass's head re-read
      }
      return insert(object, r, o);
    };
    expect(await s.sealer.runPass()).toBe(0);
    expect(s.checkpoints().map((c) => c.sequence)).toEqual([0]);
    expect(s.hot.table('sys_secret').filter((r) => r.namespace === 'ledger_probe').map((r) => r.id)).toEqual([s.checkpoints()[0].seed_handle]);
    expect(s.logger.lines.filter((l) => l.level === 'error').map((l) => l.message)).toEqual([expect.stringMatching(/UNIQUE constraint failed/)]);
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

describe('the audit seal lock: each pass try-locks it beside audit.sealer, and skips while it is held (D3 amended, seat ruling 6885005594)', () => {
  /** A setup whose hot store is a datasource of a database that keeps session locks. */
  const lockable = (options: Parameters<typeof setup>[0] = {}) => {
    const s = setup(options);
    const db = sessionLockDatabase();
    lockableStore(s.hot, db);
    return { ...s, db };
  };
  const tries = (db: ReturnType<typeof sessionLockDatabase>) =>
    db.statements.filter((st) => st.sql === 'select pg_try_advisory_lock(?::bigint) as locked');

  it('takes it on the sealed object\'s hot store for the whole pass, under its own name, and lets it go when the pass ends', async () => {
    const s = lockable();
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)), row('r2', at(9, 10)));
    const heldAtWrite: Array<number | undefined> = [];
    const insert = s.engine.insert.bind(s.engine);
    s.engine.insert = async (...args: Parameters<typeof insert>) => {
      if (args[0] === 'sys_audit_checkpoint') heldAtWrite.push(s.db.holder(AUDIT_SEAL_PG_LOCK_KEY));
      return insert(...args);
    };
    expect(await s.sealer.runPass()).toBe(2);
    expect(tries(s.db).map((st) => st.bindings)).toEqual([[AUDIT_SEAL_PG_LOCK_KEY]]);
    const session = tries(s.db)[0].session;
    expect(heldAtWrite).toEqual([session, session]);
    expect(s.db.holder(AUDIT_SEAL_PG_LOCK_KEY)).toBeUndefined();
    expect(s.db.open()).toEqual([]);
  });

  it('takes it on the datasource that holds the audit rows: the hot store, where it differs from the primary', async () => {
    const s = setup();
    const hotDb = sessionLockDatabase();
    const primaryDb = sessionLockDatabase();
    lockableStore(s.hot, hotDb);
    // The checkpoints, the seeds and the signing key are on the primary: one more datasource, of another database.
    const primary = lockableStore({
      find: (object: string, query: Record<string, unknown>) => s.hot.find(object, query),
      count: (object: string, query?: Record<string, unknown>) => s.hot.count(object, query),
      create: (object: string, data: Record<string, unknown>) => s.hot.create(object, data),
      delete: (object: string, id: string) => s.hot.delete(object, id),
    }, primaryDb);
    s.engine.getDriverForObject = (object: string) => (object === 'ledger_probe' ? s.hot : primary);
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)));
    expect(await s.sealer.runPass()).toBe(1);
    expect(tries(hotDb)).toHaveLength(1);
    expect(primaryDb.statements).toEqual([]);
  });

  it('skips the pass while another session holds it — an os migrate audit-* run — says so once, and seals on the first pass after', async () => {
    const s = lockable();
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)));
    const migration = await s.db.hold(AUDIT_SEAL_PG_LOCK_KEY);
    expect(await s.sealer.runPass()).toBe(0);
    expect(await s.sealer.runPass()).toBe(0);
    expect(s.hot.table('sys_audit_checkpoint')).toEqual([]);
    expect(s.hot.table('sys_secret')).toEqual([]);
    expect(s.db.open()).toEqual([migration.session]);
    const skipped = s.logger.lines.filter((l) => /audit seal lock/.test(l.message));
    expect(skipped.map((l) => l.level)).toEqual(['info']);
    expect(skipped[0].message).toMatch(/'ledger_probe'.*held by another session.*skipped/);
    migration.release();
    // The skipped passes let audit.sealer go as well: the next pass takes both.
    expect(await s.sealer.runPass()).toBe(1);
  });

  it('stores nothing once its session ends mid-pass, drops the seed it sealed, and fails the object\'s pass at error (a lock lapse)', async () => {
    const s = lockable();
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)));
    betweenReads(s, () => s.db.kill(s.db.holder(AUDIT_SEAL_PG_LOCK_KEY)!));
    expect(await s.sealer.runPass()).toBe(0);
    expect(s.hot.table('sys_audit_checkpoint')).toEqual([]);
    expect(s.hot.table('sys_secret').filter((r) => r.namespace === 'ledger_probe')).toEqual([]);
    expect(s.logger.lines.filter((l) => l.level === 'error').map((l) => l.message))
      .toEqual([expect.stringMatching(/sealing 'ledger_probe' FAILED \(the audit seal lock .*lapsed/)]);
  });

  it('on a datasource that offers no session lock, takes none and seals as before: B is the migrations\' to enforce', async () => {
    const s = setup();
    lockableStore(s.hot, { ...sessionLockDatabase(), face: { dialectName: 'sqlite', getKnex: () => { throw new Error('never asked'); } } });
    s.hot.table('ledger_probe').push(row('r1', at(8, 10)));
    expect(await s.sealer.runPass()).toBe(1);
    expect(s.logger.lines.filter((l) => /audit seal lock/.test(l.message))).toEqual([]);
  });
});
