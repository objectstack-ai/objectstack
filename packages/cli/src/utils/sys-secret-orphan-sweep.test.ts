// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8103 — pins for the `sys_secret` orphan SWEEP planner.
 *
 * Everything that can run against real code does: a real `ObjectQL`, the real
 * `LocalCryptoProvider` (test mode, ephemeral key, no disk), the real
 * datasource credential binder, the real shipped settings classifier and the
 * real reference union, over a minimal in-memory driver double. The three
 * `sys_secret` rows are not hand-written — each is minted by the producer that
 * actually writes it, so the handle spellings under test come from the
 * producers rather than from this file.
 *
 * ## The measurement the card turns on, reproduced here against the planner
 *
 * A LIVE, engine-owned credential is classified `orphaned` by the SHIPPED
 * settings-scoped classifier — the OLD predicate — and is therefore in that
 * predicate's deletable bucket. The same row under the COMPLETE union is
 * `referenced` and never reaches the deletable list. Both halves are asserted
 * in one test so neither can drift away from the other.
 *
 * ## Zero assertions carry positive controls
 *
 * Every "this is empty" assertion below is accompanied by a control that is
 * NOT a substring of the term under test, because a query that matches nothing
 * and a query that is broken read identically. Where the assertion is
 * `deletable === []`, the control is a run of the SAME planner over the SAME
 * fixture that yields a NON-empty deletable list — so an empty answer can only
 * come from the guard under test.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { createDatasourceSecretBinder } from '@objectstack/service-datasource';
import {
  classifySysSecretRows,
  collectEncryptedSpecifierRefs,
  isSecretHandle,
  LocalCryptoProvider,
} from '@objectstack/service-settings';
import type { SettingsManifest } from '@objectstack/spec/system';
import {
  buildSecretReferenceUnion,
  collectSecretReferenceUnion,
  type FamilyResult,
  type SecretReferenceEngineLike,
  type SecretReferenceUnion,
} from './secret-reference-union.js';
import {
  buildPreDeleteExport,
  planSysSecretOrphanSweep,
  useHandlePredicate,
  SWEEP_EXPOSURE_NOTES,
  WITHHELD_LEGACY_INLINE_SIBLING,
  WITHHELD_UNATTRIBUTABLE,
  WITHHELD_UNION_INCOMPLETE,
  WITHHOLD_CLASSES,
} from './sys-secret-orphan-sweep.js';

// The command installs the producer's own predicate; the tests run through the
// same seam so nothing here is measured against the module's stand-in.
useHandlePredicate(isSecretHandle);

type Row = Record<string, unknown>;

function makeDriver() {
  const stores = new Map<string, Map<string, Row>>();
  const storeFor = (object: string) => {
    let s = stores.get(object);
    if (!s) { s = new Map(); stores.set(object, s); }
    return s;
  };
  const matches = (row: Row, where: unknown): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where as Row)) {
      if (k.startsWith('$')) continue;
      if ((row[k] ?? null) !== (v ?? null)) return false;
    }
    return true;
  };
  // Rows leave as COPIES, like a real driver's: handing out the live object
  // lets the engine's read-path mask stamp over the stored `secret:` ref.
  const copy = (r: Row): Row => ({ ...r });
  let n = 0;
  let throwOnFind: { object: string; error: Error } | undefined;
  const deleted: Array<{ object: string; id: string }> = [];

  const driver = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {},
    async disconnect() {},
    async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast?: Row) {
      if (throwOnFind?.object === object) throw throwOnFind.error;
      const matched = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      const page = typeof ast?.limit === 'number' ? matched.slice(0, ast.limit) : matched;
      return page.map(copy);
    },
    async create(object: string, data: Row) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return copy(row);
    },
    async delete(object: string, id: string) {
      deleted.push({ object, id });
      return storeFor(object).delete(id);
    },
    async count(object: string, ast?: Row) {
      return (await this.find(object, ast)).length;
    },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {},
    async rollback() {},
  };

  return {
    driver,
    seed(object: string, row: Row) { storeFor(object).set(String(row.id), { ...row }); },
    rowsOf(object: string) { return Array.from(storeFor(object).values()).map(copy); },
    failReadsOf(object: string, error: Error) { throwOnFind = { object, error }; },
    deleted,
  };
}

const TEST_PACKAGE_ID = 'com.objectstack.test.8103';
const textField = (name: string) => ({ name, label: name, type: 'text' as const });

const sysSecretObject = {
  name: 'sys_secret',
  label: 'Secret',
  fields: {
    ...Object.fromEntries(
      ['id', 'namespace', 'key', 'kms_key_id', 'alg', 'ciphertext', 'created_at', 'rotated_at']
        .map((f) => [f, textField(f)]),
    ),
    version: { name: 'version', label: 'version', type: 'number' as const },
  },
};

const sysSettingObject = {
  name: 'sys_setting',
  label: 'Setting',
  fields: Object.fromEntries(
    ['id', 'namespace', 'key', 'scope', 'user_id', 'value', 'value_enc'].map((f) => [f, textField(f)]),
  ),
};

const sysMetadataObject = {
  name: 'sys_metadata',
  label: 'Metadata',
  fields: Object.fromEntries(
    ['id', 'name', 'type', 'scope', 'metadata', 'state'].map((f) => [f, textField(f)]),
  ),
};

/**
 * The business object family 2 holds its handle on. `smtp` / `password` makes
 * `(namespace, key)` COLLIDE with a declared encrypted settings specifier —
 * the collision is not contrived: the engine records (object name, field name)
 * while settings records (namespace, specifier key), and nothing keeps the two
 * vocabularies apart.
 */
const smtpObject = {
  name: 'smtp',
  label: 'SMTP account',
  fields: {
    id: textField('id'),
    host: textField('host'),
    password: { name: 'password', label: 'password', type: 'secret' as const },
  },
};

const settingsManifests = [
  {
    namespace: 'smtp',
    specifiers: [
      { key: 'password', type: 'string', encrypted: true },
      { key: 'retired_token', type: 'string', encrypted: true },
      { key: 'inline_legacy', type: 'string', encrypted: true },
      { key: 'host', type: 'string' },
    ],
  },
] as unknown as SettingsManifest[];

const attributableTo = collectEncryptedSpecifierRefs(settingsManifests);

async function buildRuntime() {
  const store = makeDriver();
  const engine = new ObjectQL();
  engine.registerDriver(store.driver as never, true);
  await engine.init();
  for (const object of [sysSecretObject, sysSettingObject, sysMetadataObject, smtpObject]) {
    engine.registry.registerObject(object as never, TEST_PACKAGE_ID);
  }

  const crypto = new LocalCryptoProvider({ mode: 'test' });
  engine.setCryptoProvider(crypto as never);

  const seedSecret = (handle: { id: string; kmsKeyId: string; alg: string; version: number; ciphertext: string },
    namespace: string, key: string, extra: Row = {}) => {
    store.seed('sys_secret', {
      id: handle.id,
      namespace,
      key,
      kms_key_id: handle.kmsKeyId,
      alg: handle.alg,
      version: handle.version,
      ciphertext: handle.ciphertext,
      created_at: '2026-01-01T00:00:00.000Z',
      ...extra,
    });
  };

  // --- family 1: a settings handle, minted by the real provider, IN FORCE ---
  const settingsHandle = await crypto.encrypt('smtp-app-password', { namespace: 'smtp', key: 'password' });
  seedSecret(settingsHandle, 'smtp', 'password');
  store.seed('sys_setting', {
    id: 'set_1', namespace: 'smtp', key: 'password', scope: 'tenant', user_id: null,
    value_enc: settingsHandle.id,
  });

  // --- a GENUINE settings orphan: attributable, named by nothing -----------
  // Minted by the same real provider under a declared encrypted specifier, and
  // deliberately not referenced by any sys_setting row. This is the one class
  // the ruling permits deleting, and it is what keeps every "deletable is
  // empty" assertion below falsifiable.
  const orphanHandle = await crypto.encrypt('rotated-away-token', { namespace: 'smtp', key: 'retired_token' });
  seedSecret(orphanHandle, 'smtp', 'retired_token');

  // --- family 2: the engine's own secret-field channel, LIVE ---------------
  await engine.insert('smtp', { id: 'rec_1', host: 'mail.example.com', password: 'hunter2' });
  const objectFieldHandleId = String(store.rowsOf('smtp')[0].password).slice('secret:'.length);

  // --- family 3: the REAL datasource credential binder, LIVE ---------------
  const binder = createDatasourceSecretBinder({ engine: engine as never, cryptoProvider: crypto as never });
  const credentialsRef = await binder.bind({ value: 'pg-password' }, { name: 'main' });
  store.seed('sys_metadata', {
    id: 'meta_1', name: 'main', type: 'datasource', scope: 'platform', state: 'active',
    metadata: JSON.stringify({ name: 'main', driver: 'postgres', external: { credentialsRef } }),
  });

  return {
    engine: engine as unknown as SecretReferenceEngineLike,
    realEngine: engine,
    store,
    crypto,
    settingsHandleId: settingsHandle.id,
    orphanHandleId: orphanHandle.id,
    objectFieldHandleId,
    datasourceHandleId: credentialsRef.slice('sys_secret:'.length),
  };
}

type Runtime = Awaited<ReturnType<typeof buildRuntime>>;

const secretsOf = (rt: Runtime) => rt.store.rowsOf('sys_secret') as never[];
const settingRowsOf = (rt: Runtime) => rt.store.rowsOf('sys_setting') as never[];

/**
 * ⛔ `declared` is REQUIRED and has no default. A default here would swallow an
 * explicitly passed `undefined` — which is precisely the value under test, and
 * the first version of this file did exactly that and reported a complete union
 * for the run that was meant to gap.
 */
const planOver = async (rt: Runtime, declared: readonly { name?: string }[] | undefined) => {
  const union = await collectSecretReferenceUnion({ engine: rt.engine, declaredDatasources: declared });
  return {
    union,
    plan: planSysSecretOrphanSweep({
      secrets: secretsOf(rt),
      union,
      attributableTo,
      settingRows: settingRowsOf(rt),
    }),
  };
};

describe('#8103 reproduction — the old predicate vs the COMPLETE union, on real code', () => {
  let rt: Runtime;
  beforeEach(async () => { rt = await buildRuntime(); });

  it('a LIVE engine-owned row is deletable under the OLD predicate and REFERENCED under the union', async () => {
    // ── OLD predicate: the shipped settings-scoped classifier ──────────────
    const shipped = classifySysSecretRows({
      secrets: secretsOf(rt),
      settingRows: settingRowsOf(rt),
      attributableTo,
    });
    const oldVerdict = shipped.rows.find((r) => r.id === rt.objectFieldHandleId);
    expect(oldVerdict?.verdict).toBe('orphaned');

    // …and the row is LIVE: a business row's own column still names it.
    expect(rt.store.rowsOf('smtp')[0].password).toBe(`secret:${rt.objectFieldHandleId}`);

    // ── The ruled predicate: unreferenced by the COMPLETE union ────────────
    const { union, plan } = await planOver(rt, []);
    expect(union.complete).toBe(true);
    expect(plan.refusal).toBeNull();

    const swept = plan.rows.find((r) => r.id === rt.objectFieldHandleId);
    expect(swept?.decision).toBe('referenced');
    expect(swept?.holders).toEqual(['object-field: smtp.password#rec_1']);
    expect(plan.deletable).not.toContain(rt.objectFieldHandleId);

    // Positive control for that exclusion — the SAME planner over the SAME
    // fixture DOES produce a deletable row, so "not in the list" is a decision
    // about this handle and not an empty list.
    expect(plan.deletable).toEqual([rt.orphanHandleId]);
  });

  it('the datasource handle escapes the old predicate only by NOT colliding, and the union names it', async () => {
    const shipped = classifySysSecretRows({
      secrets: secretsOf(rt), settingRows: settingRowsOf(rt), attributableTo,
    });
    // `unattributable` under the old predicate — a name match, not ownership.
    expect(shipped.rows.find((r) => r.id === rt.datasourceHandleId)?.verdict).toBe('unattributable');

    const { plan } = await planOver(rt, []);
    const swept = plan.rows.find((r) => r.id === rt.datasourceHandleId);
    expect(swept?.decision).toBe('referenced');
    expect(swept?.holders).toEqual(['datasource: datasource(main).external.credentialsRef']);
  });
});

describe('the falsifiable criterion — an incomplete union refuses, and NAMES the family', () => {
  let rt: Runtime;
  beforeEach(async () => { rt = await buildRuntime(); });

  it('the host not declaring its datasources gaps family 3 and empties the deletable set', async () => {
    // Control first: with the host answering `[]`, the sweep DOES delete.
    const answered = await planOver(rt, []);
    expect(answered.plan.deletable).toEqual([rt.orphanHandleId]);

    // `undefined` is "nobody answered", NOT "there are none".
    const { plan } = await planOver(rt, undefined);
    expect(plan.refusal?.code).toBe('PRECONDITION_REQUIRED');
    expect(plan.refusal?.status).toBe(428);
    expect(plan.refusal?.gaps.map((g) => g.family)).toEqual(['datasource']);
    expect(plan.refusal?.message).toContain('datasource');
    expect(plan.deletable).toEqual([]);

    // …and the genuine orphan is withheld under its OWN class, not silently dropped.
    const orphan = plan.rows.find((r) => r.id === rt.orphanHandleId);
    expect(orphan?.decision).toBe('withheld');
    expect(orphan?.withheld).toBe(WITHHELD_UNION_INCOMPLETE);
  });

  it('an unreadable sys_setting gaps family 1, and the refusal says so', async () => {
    rt.store.failReadsOf('sys_setting', new Error('connection reset'));
    const { plan } = await planOver(rt, []);
    expect(plan.refusal?.gaps.map((g) => g.family)).toEqual(['settings']);
    expect(plan.refusal?.gaps[0]?.reason).toContain('connection reset');
    expect(plan.deletable).toEqual([]);
    expect(plan.families.settings.status).toBe('gap');
    // ⛔ Not flattened: the families that DID enumerate still say so, with counts.
    expect(plan.families['object-field'].status).toBe('enumerated');
    expect(plan.families['object-field'].referenceCount).toBe(1);
    expect(plan.families.datasource.status).toBe('enumerated');
  });

  it('an engine with no listDatasourceDefs() gaps family 3 even when the host answered', async () => {
    const narrowed: SecretReferenceEngineLike = {
      getConfigs: () => rt.engine.getConfigs(),
      getDriverForObject: (o) => rt.engine.getDriverForObject(o),
    };
    const union = await collectSecretReferenceUnion({ engine: narrowed, declaredDatasources: [] });
    const plan = planSysSecretOrphanSweep({
      secrets: secretsOf(rt), union, attributableTo, settingRows: settingRowsOf(rt),
    });
    expect(plan.refusal?.gaps.map((g) => g.family)).toEqual(['datasource']);
    expect(plan.families.datasource.reason).toContain('listDatasourceDefs');
    expect(plan.deletable).toEqual([]);
  });

  it('a partially-gapped family still proves its gathered handles LIVE', () => {
    // A gap does not discard the references collected before it opened: those
    // handles are named, so they are referenced, not merely un-enumerated.
    const partial: FamilyResult = {
      family: 'object-field',
      status: 'gap',
      reason: 'reading secret field(s) of `other` threw — Error: table is locked',
      references: [{ handleId: 'sec_partial', family: 'object-field', holder: 'smtp.password#rec_1' }],
    };
    const union: SecretReferenceUnion = buildSecretReferenceUnion({
      settings: { family: 'settings', status: 'enumerated', references: [] },
      'object-field': partial,
      datasource: { family: 'datasource', status: 'enumerated', references: [] },
    });
    const plan = planSysSecretOrphanSweep({
      secrets: [{ id: 'sec_partial', namespace: 'smtp', key: 'password' }],
      union,
      attributableTo,
      settingRows: [],
    });
    expect(plan.rows[0]?.decision).toBe('referenced');
    expect(plan.counts.referenced).toBe(1);
  });
});

describe('the classes the ruling puts out of reach', () => {
  let rt: Runtime;
  beforeEach(async () => { rt = await buildRuntime(); });

  it('`unattributable` is NEVER deletable, even with a complete union', async () => {
    // Unreference the datasource handle so nothing names it at all: it is now
    // unreferenced AND unattributable — the exact shape a settings-only sweep
    // would have deleted.
    rt.store.seed('sys_metadata', {
      id: 'meta_1', name: 'main', type: 'datasource', scope: 'platform', state: 'active',
      metadata: JSON.stringify({ name: 'main', driver: 'postgres', external: {} }),
    });
    const { union, plan } = await planOver(rt, []);
    expect(union.complete).toBe(true);
    expect(union.handleIds.has(rt.datasourceHandleId)).toBe(false);

    const row = plan.rows.find((r) => r.id === rt.datasourceHandleId);
    expect(row?.decision).toBe('withheld');
    expect(row?.withheld).toBe(WITHHELD_UNATTRIBUTABLE);
    expect(row?.attributable).toBe(false);
    expect(plan.deletable).not.toContain(rt.datasourceHandleId);
    // Positive control: the run is live and does delete something.
    expect(plan.deletable).toEqual([rt.orphanHandleId]);
  });

  it('a LEGACY INLINE sibling is withheld — the #8063 guard in the opposite direction', async () => {
    const inlineHandle = await rt.crypto.encrypt('older-inline', { namespace: 'smtp', key: 'inline_legacy' });
    rt.store.seed('sys_secret', {
      id: inlineHandle.id, namespace: 'smtp', key: 'inline_legacy',
      kms_key_id: inlineHandle.kmsKeyId, alg: inlineHandle.alg,
      version: inlineHandle.version, ciphertext: inlineHandle.ciphertext,
    });
    // The pair now resolves through INLINE ciphertext, which names no handle.
    rt.store.seed('sys_setting', {
      id: 'set_legacy', namespace: 'smtp', key: 'inline_legacy', scope: 'tenant', user_id: null,
      value_enc: 'AQIDBAUGBwgJCg==',
    });

    const { plan } = await planOver(rt, []);
    const row = plan.rows.find((r) => r.id === inlineHandle.id);
    expect(row?.decision).toBe('withheld');
    expect(row?.withheld).toBe(WITHHELD_LEGACY_INLINE_SIBLING);
    expect(row?.legacyInlineSibling).toBe(true);
    expect(row?.attributable).toBe(true); // attributable, and STILL not deleted
    expect(plan.deletable).not.toContain(inlineHandle.id);
    expect(plan.legacyInlineRows).toEqual([
      { namespace: 'smtp', key: 'inline_legacy', scope: 'tenant', user_id: null },
    ]);
    // Positive control: the same run still deletes the genuine orphan.
    expect(plan.deletable).toEqual([rt.orphanHandleId]);
  });

  it('a re-wrapped row is never read as a retirement — version/rotated_at are not verdict inputs', async () => {
    // Re-wrap the IN-FORCE settings row the way `rotateKey` does: same id, a
    // bumped version and a rotation timestamp.
    const before = rt.store.rowsOf('sys_secret').find((r) => r.id === rt.settingsHandleId)!;
    rt.store.seed('sys_secret', { ...before, version: 4, rotated_at: '2026-08-01T00:00:00.000Z' });

    const { plan } = await planOver(rt, []);
    const row = plan.rows.find((r) => r.id === rt.settingsHandleId);
    expect(row?.decision).toBe('referenced');
    expect(row?.rewrapped).toBe(true);
    expect(row?.reason).toContain('re-wrap is not a retirement');
    expect(plan.deletable).not.toContain(rt.settingsHandleId);

    // The inverse, which is the dangerous half: stamp the SAME re-wrap
    // evidence onto the genuine orphan. Re-wrap evidence must move nothing —
    // the orphan is deletable because nothing names it, and it stays deletable
    // for that reason alone.
    const orphanRow = rt.store.rowsOf('sys_secret').find((r) => r.id === rt.orphanHandleId)!;
    rt.store.seed('sys_secret', { ...orphanRow, version: 4, rotated_at: '2026-08-01T00:00:00.000Z' });
    const after = await planOver(rt, []);
    expect(after.plan.deletable).toEqual([rt.orphanHandleId]);
    expect(after.plan.rows.find((r) => r.id === rt.orphanHandleId)?.rewrapped).toBe(true);
  });
});

describe('the operator-facing text says what was measured', () => {
  let rt: Runtime;
  beforeEach(async () => { rt = await buildRuntime(); });

  it('never claims the sweep cleans up leaked or exposed old credentials', async () => {
    const { plan } = await planOver(rt, []);
    const prose = plan.notes.join(' ').toLowerCase();

    // Positive control on the search itself: a phrase that IS present.
    expect(prose).toContain('still in force');

    // The inverted framing, stated rather than implied.
    expect(prose).toContain('not "old credentials that were replaced"');
    expect(prose).toContain('retires nothing that is exposed');
    expect(prose).toContain('currently valid');
    // …and the false claim is absent.
    expect(prose).not.toContain('cleans up');
    expect(prose).not.toContain('leaked');
  });

  it('the exposure notes are always present, whatever the plan found', async () => {
    const { plan } = await planOver(rt, []);
    for (const note of SWEEP_EXPOSURE_NOTES) expect(plan.notes).toContain(note);
  });

  it('the withhold classes are a closed, countable set', async () => {
    const { plan } = await planOver(rt, undefined);
    expect(Object.keys(plan.withheldByClass).sort()).toEqual([...WITHHOLD_CLASSES].sort());
    const summed = Object.values(plan.withheldByClass).reduce((a, b) => a + b, 0);
    expect(summed).toBe(plan.counts.withheld);
    expect(plan.counts.total).toBe(plan.counts.referenced + plan.counts.deletable + plan.counts.withheld);
  });
});

describe('the mandatory pre-delete export', () => {
  let rt: Runtime;
  beforeEach(async () => { rt = await buildRuntime(); });

  it('carries the cipher material and the holder evidence for every deletable row', async () => {
    const { plan } = await planOver(rt, []);
    const rawById = new Map(rt.store.rowsOf('sys_secret').map((r) => [String(r.id), r]));
    const doc = buildPreDeleteExport({ plan, rawById, producedBy: 'os secret orphans --delete' });

    expect(doc.format).toBe('objectstack.sys_secret.pre-delete-export.v1');
    expect(doc.rows.map((r) => r.id)).toEqual([rt.orphanHandleId]);
    // Restorable: the ciphertext is the row's own, not a placeholder.
    expect(doc.rows[0]?.ciphertext).toBe(rawById.get(rt.orphanHandleId)?.ciphertext);
    expect(typeof doc.rows[0]?.ciphertext).toBe('string');
    expect(doc.rows[0]?.kms_key_id).toBe('local:v1');
    expect(doc.decisions[0]?.id).toBe(rt.orphanHandleId);
    expect(doc.decisions[0]?.reason).toContain('COMPLETE reference union');
    expect(doc.families.datasource.status).toBe('enumerated');
    expect(doc.warning).toContain('CIPHER MATERIAL');
  });

  it('refuses to build when a deletable row was not read — never a shorter export', async () => {
    const { plan } = await planOver(rt, []);
    expect(plan.deletable).toEqual([rt.orphanHandleId]); // control: there IS a row to miss
    expect(() => buildPreDeleteExport({
      plan, rawById: new Map(), producedBy: 'test',
    })).toThrow(/no raw sys_secret row was read/);
  });

  it('an incomplete union produces an empty export because nothing is deletable', async () => {
    const { plan } = await planOver(rt, undefined);
    const rawById = new Map(rt.store.rowsOf('sys_secret').map((r) => [String(r.id), r]));
    const doc = buildPreDeleteExport({ plan, rawById, producedBy: 'test' });
    expect(doc.rows).toEqual([]);
    // Control: the same rawById over a COMPLETE plan is non-empty.
    const complete = await planOver(rt, []);
    expect(buildPreDeleteExport({ plan: complete.plan, rawById, producedBy: 'test' }).rows)
      .toHaveLength(1);
  });
});

describe('the handle predicate comes from the producer', () => {
  it('agrees with a handle minted by the real LocalCryptoProvider', async () => {
    const crypto = new LocalCryptoProvider({ mode: 'test' });
    const handle = await crypto.encrypt('x', { namespace: 'smtp', key: 'password' });
    expect(isSecretHandle(handle.id)).toBe(true);
    // A legacy inline value is not a handle — the discriminator the guard rests on.
    expect(isSecretHandle('AQIDBAUGBwgJCg==')).toBe(false);
  });
});
