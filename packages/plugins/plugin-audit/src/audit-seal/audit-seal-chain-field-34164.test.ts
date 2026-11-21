// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { SysSecret } from '@objectstack/platform-objects/system';
import type { CryptoContext, CryptoHandle, IAuditCheckpointSigner, IClusterService } from '@objectstack/spec/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditPlugin } from '../audit-plugin.js';
import { installDefaultOrganization } from '../default-organization.testkit.js';
import { FieldType, ObjectSchema } from '@objectstack/spec/data';
import { canonicalJsonBytes } from './jcs.js';
import { AUDIT_SEAL_TYPE_RULES, leafInput } from './canonical.js';
import { AUDIT_SEALER_LOCK, AuditSealer } from './sealer.js';
import { checkpointBodyFromRow, signedBodyBytes } from './signed-body.js';
import { columnSaltsOf } from './seed.js';
import { LocalCheckpointSigner } from './signer.js';
import { bindingCrypto, memoryEngine, recordingLogger } from './seal-store.testkit.js';
import { verifyAuditLedger } from './verifier.js';

/**
 * ADR-0154 D10, as its note on `chainField` records: a sealed object names the
 * column its rows are chained by with `lifecycle.seal.chainField`, read by the
 * sealer, the live check and the proof bundle through one reader
 * (`chainValueOf`), and the signed body's `tenant_id` member carries that
 * column's value.
 *
 *  1. On a live engine over SQLite, an object whose organization lives in the
 *     tenant column the registry injects (ADR-0131 `organization_id`) seals
 *     one chain per organization, and the live check scoped to one
 *     organization (`os audit verify --org`) reports that chain's rows.
 *  2. An object that names no chain column chains by `tenant_id`, and its
 *     leaf input, signed body and root are byte for byte what they were
 *     before the key existed: the digests below were taken from the sealer
 *     as it stood before this change, with the seed, the clock, the lock, the
 *     seed handle and the signer held fixed.
 *  3. A definition that reached the registry without the parse and names a
 *     chain column it does not have is not sealed, and the sealer says so at
 *     `error`; the parse refuses it at authoring (spec).
 */

// Leg 2 holds the seed fixed; every other caller of the module is unchanged.
vi.mock('./seed.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./seed.js')>();
  return { ...actual, generateCheckpointSeed: () => Buffer.alloc(actual.AUDIT_SEAL_SEED_BYTES, 7) };
});

const H = 60 * 60 * 1000;
const SYS = { isSystem: true } as const;
type Row = Record<string, unknown>;
const iso = (ms: number) => new Date(ms).toISOString();
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

interface Driver {
  find(o: string, q: Row): Promise<Row[]>;
  create(o: string, r: Row): Promise<unknown>;
  update(o: string, id: string, r: Row): Promise<unknown>;
}

// ── 1. one chain per organization, by the injected tenant column ──────────────

const CHAIN_PROBE = 'chain_probe';
const chainProbe = {
  name: CHAIN_PROBE,
  label: 'Chain Probe',
  // Only the tenant column is injected: no audit family, no ownership anchors.
  ownership: 'none',
  systemFields: { audit: false },
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' },
    created_at: { name: 'created_at', label: 'Created At', type: 'datetime' },
    action: { name: 'action', label: 'Action', type: 'text' },
    payload: { name: 'payload', label: 'Payload', type: 'textarea' },
  },
  lifecycle: { class: 'audit', retention: { maxAge: '90d' }, seal: { valueFields: ['payload'], chainField: 'organization_id' } },
};

describe('a sealed object chained by organization_id, on a live engine (ADR-0154 D5, D10 note)', () => {
  const crypto = bindingCrypto();
  const plugin = new AuditPlugin({ cryptoProvider: crypto });
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  const past = Math.floor(Date.now() / H) * H - 3 * H; // a window three hours ago: settled
  const hot = () => engine.getDriverForObject(CHAIN_PROBE) as unknown as Driver;
  const sealer = () => (plugin as unknown as { sealer: AuditSealer }).sealer;
  const verify = (orgs: string[]) => verifyAuditLedger({ engine: engine as never, crypto, orgs });
  let written = 0;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(plugin);
    await kernel.bootstrap();
    engine = kernel.getService<ObjectQL>('objectql');
    const sqlite = new SqliteWasmDriver({ filename: ':memory:' });
    await sqlite.connect();
    engine.registerDriver(sqlite, true);
    engine.registry.registerObject(chainProbe as never, 'com.objectstack.audit.test.chain-probe');
    engine.registry.registerObject(SysSecret as never, 'com.objectstack.audit.test.chain-probe');
    await engine.syncSchemas();
    await installDefaultOrganization(engine);

    await hot().create(CHAIN_PROBE, { id: 'x1', created_at: iso(past + 60_000), action: 'update', organization_id: 'org_x', payload: '{"from":1}' });
    await hot().create(CHAIN_PROBE, { id: 'x2', created_at: iso(past + 120_000), action: 'delete', organization_id: 'org_x', payload: null });
    await hot().create(CHAIN_PROBE, { id: 'y1', created_at: iso(past + 180_000), action: 'update', organization_id: 'org_y', payload: 'kept' });

    await sealer().stop(); // drive the passes here, not on the loop's clock
    written = await sealer().runPass();
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('has the tenant column only because the registry injected it', () => {
    const fields = (engine.registry.getObject(CHAIN_PROBE) as { fields: Record<string, unknown> }).fields;
    expect(Object.keys(chainProbe.fields)).not.toContain('organization_id');
    expect(fields.organization_id).toBeDefined();
  });

  it('seals one chain per organization, each signed body carrying its organization in tenant_id', async () => {
    expect(written).toBe(2);
    const rows = (await engine.find('sys_audit_checkpoint', { where: { sealed_object: CHAIN_PROBE }, context: SYS })) as Row[];
    const bodies = rows.map((r) => ({ chain_key: r.chain_key, body: checkpointBodyFromRow(r) }));
    expect(bodies.map((b) => [b.chain_key, b.body.tenant_id, b.body.row_ids]).sort()).toEqual([
      ['org:org_x', 'org_x', ['x1', 'x2']],
      ['org:org_y', 'org_y', ['y1']],
    ]);
    // The chain column is a column of the leaf, in clear, like every other declared one.
    expect(bodies[0].body.columns.clear).toContain('organization_id');
  });

  it("reports the rows of the one organization it is scoped to, as `os audit verify --org` asks", async () => {
    const report = await verify(['org_x']);
    expect(report.faults).toEqual([]);
    expect(report.scope.orgs).toEqual(['org_x']);
    expect(report.chains.map((c) => [c.object, c.chain, c.checkpoints, c.counts.unmodified])).toEqual([[CHAIN_PROBE, 'org:org_x', 1, 2]]);
    expect(report.ok).toBe(true);
  });

  it("judges a row of that organization edited below every hook modified, in its organization's chain only", async () => {
    await hot().update(CHAIN_PROBE, 'x1', { payload: '{"from":2}' });
    const scoped = await verify(['org_x']);
    expect(scoped.rows.map((r) => [r.chain, r.row, r.verdict])).toEqual([['org:org_x', 'x1', 'modified']]);
    expect(scoped.ok).toBe(false);
    const other = await verify(['org_y']);
    expect(other.chains.map((c) => [c.chain, c.counts.unmodified])).toEqual([['org:org_y', 1]]);
    expect(other.ok).toBe(true);
  });
});

// ── 2. a tenant_id object: byte for byte what it was ─────────────────────────

const DAY0 = Date.UTC(2026, 10, 10);
const at = (h: number, m: number) => new Date(DAY0 + h * H + m * 60_000).toISOString();

const tenantLedger = (seal: Record<string, unknown>) => ({
  name: 'ledger_probe',
  fields: { id: { type: 'text' }, created_at: { type: 'datetime' }, action: { type: 'text' }, tenant_id: { type: 'lookup' }, payload: { type: 'textarea' } },
  lifecycle: { class: 'audit', retention: { maxAge: '90d' }, seal },
});

/** A signer double whose key id and signature depend on the signed bytes alone. */
const fixedSigner: IAuditCheckpointSigner & { activeKeyId(): Promise<string> } = {
  activeKeyId: async () => 'key_fixed',
  sign: async (bytes: Uint8Array) => ({ keyId: 'key_fixed', signature: sha256(bytes) }),
  publicKey: async () => null,
} as never;

/** A cluster double that grants one lease with a fixed fencing token. */
const fixedCluster = {
  lock: { acquire: async () => ({ key: AUDIT_SEALER_LOCK, fencingToken: 1n, renew: async () => {}, release: async () => {}, isHeld: () => true }) },
} as unknown as IClusterService;

/** Seal three rows of two chains, everything but the rows held fixed; each checkpoint's digests, by chain. */
async function sealFixed(seal: Record<string, unknown>) {
  const object = tenantLedger(seal);
  const store = memoryEngine([object] as never);
  const base = bindingCrypto();
  let handles = 0;
  const crypto = {
    ...base,
    encrypt: async (plain: string, ctx: CryptoContext): Promise<CryptoHandle> => ({ ...(await base.encrypt(plain, ctx)), id: `seed_${handles++}` }),
  };
  const sealer = new AuditSealer({
    engine: store.engine,
    crypto,
    signer: () => fixedSigner,
    cluster: () => fixedCluster,
    logger: recordingLogger(),
    now: () => DAY0 + 12 * H + 30 * 60_000,
  });
  const rows = [
    { id: 'r1', created_at: at(9, 10), action: 'update', tenant_id: 'org_a', payload: '{"v":1}' },
    { id: 'r2', created_at: at(9, 20), action: 'create', tenant_id: 'org_a', payload: 'two' },
    { id: 'r3', created_at: at(9, 30), action: 'config', tenant_id: null, payload: null },
  ];
  store.hot.table('ledger_probe').push(...rows.map((r) => ({ ...r })));
  expect(await sealer.runPass()).toBe(2);
  const out: Record<string, { leaf: string; body: string; root: string }> = {};
  for (const stored of store.hot.table('sys_audit_checkpoint')) {
    const body = checkpointBodyFromRow(stored);
    const saltOf = columnSaltsOf(Buffer.alloc(32, 7), body.sealed_object);
    const first = rows.find((r) => r.id === body.row_ids[0])!;
    out[String(stored.chain_key)] = {
      leaf: sha256(canonicalJsonBytes(leafInput(first, body.columns, object.fields as never, saltOf))),
      body: sha256(signedBodyBytes(body)),
      root: body.root,
    };
  }
  return out;
}

/**
 * Taken from the sealer before `chainField` existed (commit 43dd5656e, this branch's base), by
 * {@link sealFixed} with `{ valueFields: ['payload'] }`: the SHA-256 of the first row's canonical leaf
 * input and of each signed body, and each root.
 */
const BEFORE = {
  'org:org_a': {
    leaf: 'a1be98314b7f10696268e3873e1c5138b13d28b5a42800ad5249261faa529516',
    body: 'caec188d55ea3cf44825d6b237a845d42af163797da6f88e33d8ec21ef3b7c78',
    root: '8d1f06e3959b8a15702ece5bd9de8246a971b6180c8f617145713cca04594cd5',
  },
  deployment: {
    leaf: '4c6df364c7279185ba2c3fc7d01b47ee82ea14c556bfea4492fe522cdfd2e408',
    body: '1652e2fb53a7238f930416c5f4ee3fe28e358ed7b872015c007faf62e489421c',
    root: '4ed41adcb5461893747d0834c78f4a4d1bdb52131af84747ef43639ebeca27c6',
  },
};

describe('an object that names no chain column chains by tenant_id, byte for byte as before (ADR-0154 D1, D4)', () => {
  it('writes the leaf input, signed body and root it wrote before the key existed', async () => {
    expect(await sealFixed({ valueFields: ['payload'] })).toEqual(BEFORE);
  });

  it('writes the same bytes when it names tenant_id itself', async () => {
    expect(await sealFixed({ valueFields: ['payload'], chainField: 'tenant_id' })).toEqual(BEFORE);
  });
});

// ── 3. a chain column the object does not have ──────────────────────────────

describe('a chain column the object does not have, on a definition that skipped the parse', () => {
  it('is not sealed, and the sealer names the column at error', async () => {
    const store = memoryEngine([tenantLedger({ valueFields: ['payload'], chainField: 'org_ref' })] as never);
    const logger = recordingLogger();
    const sealer = new AuditSealer({
      engine: store.engine,
      crypto: bindingCrypto(),
      signer: () => fixedSigner,
      cluster: () => fixedCluster,
      logger,
      now: () => DAY0 + 12 * H + 30 * 60_000,
    });
    store.hot.table('ledger_probe').push({ id: 'r1', created_at: at(9, 10), action: 'update', tenant_id: 'org_a', org_ref: 'org_a', payload: 'x' });
    expect(await sealer.runPass()).toBe(0);
    expect(store.hot.table('sys_audit_checkpoint')).toEqual([]);
    const errors = logger.lines.filter((l) => l.level === 'error').map((l) => l.message);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("'ledger_probe'");
    expect(errors[0]).toContain("'org_ref'");
  });
});

// ── 4. which column types may name the chain: the sealer's own rules decide ──

/**
 * The authoring refusal of a non-text chain column (spec, `nonTextChainColumnType`)
 * is derived from the field-value classes; this holds it to the sealer's own
 * per-type rules (`AUDIT_SEAL_TYPE_RULES`): a type whose canonical rule is `text`
 * is read as text on every store, so `chainValueOf` can read a chain from it, and
 * every other rule (`number`, `boolean`, `date`, `datetime`, `json`) is a type a
 * store hands back as something else. A type with no rule (`null`) is not sealed
 * at all, so its object never reaches `chainValueOf` and the authoring answer is
 * not judged here.
 */
describe('a chain column type is refused at authoring exactly where the sealer reads its value as other than text', () => {
  const refusedAtChainField = (def: Record<string, unknown>): boolean => {
    const parsed = ObjectSchema.safeParse({
      name: 'chain_type_probe',
      fields: { action: { type: 'text', label: 'Action' }, org_ref: { label: 'Org', ...def } },
      lifecycle: { class: 'audit', retention: { maxAge: '90d' }, seal: { valueFields: [], chainField: 'org_ref' } },
    });
    return !parsed.success && parsed.error.issues.some(
      (i) => i.path.join('.') === 'lifecycle.seal.chainField' && /whose value is not one text on every store/.test(i.message),
    );
  };
  const minimalDef = (type: string): Record<string, unknown> => {
    if (type === 'lookup' || type === 'master_detail' || type === 'tree') return { type, reference: 'sys_organization' };
    if (type === 'select' || type === 'radio' || type === 'multiselect' || type === 'checkboxes') return { type, options: [{ label: 'A', value: 'opt_a' }] };
    if (type === 'formula') return { type, expression: 'action' };
    if (type === 'summary') return { type };
    return { type };
  };

  it.each(FieldType.options.filter((t) => AUDIT_SEAL_TYPE_RULES[t] !== null))('%s', (type) => {
    expect(refusedAtChainField(minimalDef(type))).toBe(AUDIT_SEAL_TYPE_RULES[type] !== 'text');
  });

  it.each(['select', 'radio', 'lookup', 'user'] as const)('%s declared multiple: true reads as json, and is refused', (type) => {
    expect(AUDIT_SEAL_TYPE_RULES[type]).toBe('text');
    expect(refusedAtChainField({ ...minimalDef(type), multiple: true })).toBe(true);
  });
});

// ── 5. changing the chain column of an object that already has checkpoints ──

describe('changing chainField on an object that already has checkpoints (ADR-0154 D10 note)', () => {
  it('re-seals the last sealed window under the new chain, and the check fails closed (listed_twice; late under --org)', async () => {
    const object = {
      name: 'ledger_probe',
      fields: { id: { type: 'text' }, created_at: { type: 'datetime' }, action: { type: 'text' }, tenant_id: { type: 'lookup' }, org_ref: { type: 'text' }, payload: { type: 'textarea' } },
      lifecycle: { class: 'audit', retention: { maxAge: '90d' }, seal: { valueFields: ['payload'] } as Record<string, unknown> },
    };
    const store = memoryEngine([object, { name: 'sys_audit_amendment', fields: {} }] as never);
    const crypto = bindingCrypto();
    const signer = new LocalCheckpointSigner({ engine: store.engine, crypto });
    const clock = { now: DAY0 + 12 * H + 30 * 60_000 };
    const run = () => new AuditSealer({ engine: store.engine, crypto, signer: () => signer, logger: recordingLogger(), now: () => clock.now }).runPass();
    const ledger = store.hot.table('ledger_probe');
    ledger.push(
      { id: 'r1', created_at: at(8, 10), action: 'update', tenant_id: 'org_a', org_ref: 'org_b', payload: 'one' },
      { id: 'r2', created_at: at(10, 5), action: 'update', tenant_id: 'org_a', org_ref: 'org_b', payload: 'two' },
    );
    await run();
    const sealed = () => store.hot.table('sys_audit_checkpoint').map((r) => {
      const body = checkpointBodyFromRow(r);
      return [r.chain_key, body.kind, body.row_ids.join(',')].join(' ');
    });
    const before = sealed();

    object.lifecycle.seal = { valueFields: ['payload'], chainField: 'org_ref' };
    ledger.push({ id: 'r3', created_at: at(13, 10), action: 'update', tenant_id: 'org_a', org_ref: 'org_b', payload: 'three' });
    clock.now = DAY0 + 14 * H + 30 * 60_000;
    await run();
    const after = sealed();

    const report = await verifyAuditLedger({ engine: store.engine, crypto, now: () => clock.now });
    const scoped = await verifyAuditLedger({ engine: store.engine, crypto, now: () => clock.now, orgs: ['org_b'] });
    // The rows sealed by tenant_id stay in org_a's chain. The new chain starts from the object's
    // floor, the last sealed window, so that window's r2 is sealed again under org_b.
    expect(before).toEqual(['org:org_a window r1', 'org:org_a window r2']);
    expect(after).toEqual([...before, 'org:org_b window r2', 'org:org_b window r3']);
    // The whole ledger: r2 listed by two checkpoints is a fault, so the check fails closed.
    expect(report.faults.map((f) => `${f.chain}#${f.sequence ?? '-'}:${f.kind}`)).toEqual(['org:org_b#0:listed_twice']);
    expect(report.ok).toBe(false);
    // Scoped to the new chain: r1, held only by org_a's chain, reads late and unsealed; it fails closed too.
    expect(scoped.rows.map((r) => [r.chain, r.row, r.verdict, r.sealed])).toEqual([['org:org_b', 'r1', 'late', false]]);
    expect(scoped.ok).toBe(false);
  });

  it('removing the chain column from valueFields changes no chain: nothing is re-sealed and the check stays ok', async () => {
    // The fix the spec's default-chain-column refusal gives for `tenant_id` listed in `valueFields`. The chain key
    // reads the row's chain value only, never the column set, and each checkpoint is checked against its own
    // signed columns, so the earlier checkpoints stay valid under the set they were signed with.
    const object = {
      name: 'ledger_probe',
      fields: { id: { type: 'text' }, created_at: { type: 'datetime' }, action: { type: 'text' }, tenant_id: { type: 'text' }, payload: { type: 'textarea' } },
      lifecycle: { class: 'audit', retention: { maxAge: '90d' }, seal: { valueFields: ['payload', 'tenant_id'] } as Record<string, unknown> },
    };
    const store = memoryEngine([object, { name: 'sys_audit_amendment', fields: {} }] as never);
    const crypto = bindingCrypto();
    const signer = new LocalCheckpointSigner({ engine: store.engine, crypto });
    const clock = { now: DAY0 + 12 * H + 30 * 60_000 };
    const run = () => new AuditSealer({ engine: store.engine, crypto, signer: () => signer, logger: recordingLogger(), now: () => clock.now }).runPass();
    const ledger = store.hot.table('ledger_probe');
    ledger.push(
      { id: 'r1', created_at: at(8, 10), action: 'update', tenant_id: 'org_a', payload: 'one' },
      { id: 'r2', created_at: at(10, 5), action: 'update', tenant_id: 'org_a', payload: 'two' },
    );
    await run();
    const sealed = () => store.hot.table('sys_audit_checkpoint').map((r) => {
      const body = checkpointBodyFromRow(r);
      return [r.chain_key, body.kind, body.row_ids.join(',')].join(' ');
    });
    const before = sealed();

    object.lifecycle.seal = { valueFields: ['payload'] };
    ledger.push({ id: 'r3', created_at: at(13, 10), action: 'update', tenant_id: 'org_a', payload: 'three' });
    clock.now = DAY0 + 14 * H + 30 * 60_000;
    await run();

    expect(before).toEqual(['org:org_a window r1', 'org:org_a window r2']);
    expect(sealed()).toEqual([...before, 'org:org_a window r3']);
    const report = await verifyAuditLedger({ engine: store.engine, crypto, now: () => clock.now });
    expect(report.faults).toEqual([]);
    expect(report.ok).toBe(true);
    const scoped = await verifyAuditLedger({ engine: store.engine, crypto, now: () => clock.now, orgs: ['org_a'] });
    expect(scoped.ok).toBe(true);
  });
});
