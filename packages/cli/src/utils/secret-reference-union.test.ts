// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12663 — pins for the cross-producer `sys_secret` reference union.
 *
 * Everything below runs against a REAL `ObjectQL` engine, the REAL
 * `LocalCryptoProvider` (test mode: ephemeral key, no disk), the REAL
 * datasource secret binder and the REAL shipped settings classifier, over a
 * minimal in-memory driver double. The three `sys_secret` rows the fixtures
 * classify are not hand-written: each is minted by the producer that actually
 * writes it, so the ref spellings under test (`sec_…`, `secret:<id>`,
 * `sys_secret:<id>`) come from the producers rather than from this file.
 *
 * ## The acceptance condition these pins encode
 *
 * An incomplete union is strictly worse than no union, so "the union builds" is
 * not the bar. The bar is that **each producer family is separately covered**:
 * ablate one family's enumeration and a NAMED pin below must go red. The three
 * `family N` describes are exactly those named pins, one per family, and each
 * asserts a handle that ONLY that family holds. A family whose removal left
 * everything green would be a family these tests do not cover.
 *
 * **#12804 — family 3 now has TWO sources, so it needs TWO ablations.** The
 * union asks the engine (`listDatasourceDefs()`) as well as the host, and
 * neither source dominates: the engine indexes only what was REGISTERED on the
 * runtime, while the host's list is the only channel for a datasource declared
 * in code that nothing ever installed. Each half therefore carries a named pin
 * asserting a handle that ONLY that half can reach —
 * `family 3 (engine half)` and `family 3 (host half)`. Ablating one half must
 * red its own pin ALONE; if ablating one leaves everything green, the other is
 * covering for it and the union's two branches were never reached.
 *
 * Family 2 carries an extra pin, because it is the one family that cannot be
 * precomputed: its holders are every `secret`-typed field on every REGISTERED
 * object, tenant-authored ones included. `registers a new secret field at
 * runtime` proves the enumeration is a runtime walk of the metadata registry
 * and not a fixture list — it registers an object AFTER the first union is
 * built and shows the new handle arriving with no code change, with the
 * before-state asserted so the pin cannot pass vacuously.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL, SECRET_MASK } from '@objectstack/objectql';
import { createDatasourceSecretBinder } from '@objectstack/service-datasource';
import {
  classifySysSecretRows,
  collectEncryptedSpecifierRefs,
  LocalCryptoProvider,
} from '@objectstack/service-settings';
import type { SettingsManifest } from '@objectstack/spec/system';
import {
  SECRET_REFERENCE_FAMILIES,
  assertSecretReferenceUnionComplete,
  buildSecretReferenceUnion,
  collectDatasourceSecretReferences,
  collectObjectFieldSecretReferences,
  collectSecretReferenceUnion,
  collectSettingsSecretReferences,
  IncompleteSecretReferenceUnionError,
  readEngineDatasourceDefs,
  type SecretReferenceEngineLike,
} from './secret-reference-union.js';

// ---------------------------------------------------------------------------
// Minimal in-memory driver double. Read verbs only plus `create` — the engine's
// insert path is the only WRITE these fixtures use, and the union itself only
// ever reads. Nothing here declares `delete`, `update` or `findOne`.
// ---------------------------------------------------------------------------

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
  // lets the engine's read-path mask stamp over the stored `secret:` ref, which
  // would read exactly like the union failing to find it.
  const copy = (r: Row): Row => ({ ...r });
  let n = 0;
  /** Set when a read should throw, to drive the gap paths. */
  let throwOnFind: { object: string; error: Error } | undefined;

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
      // Hold the caller's bound by PRESENCE, AFTER the filter and BEFORE the
      // row-touching copy — the shape `check:objectql-double-limit` requires of
      // a `find` double, in that order (a copy applied first reads rows outside
      // the bound). The union itself never passes a bound (see the module
      // header); this arm keeps the double honest rather than serving a call
      // site here.
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
    async count(object: string, ast?: Row) {
      return (await this.find(object, ast)).length;
    },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {},
    async rollback() {},
  };

  return {
    driver,
    /** Seed a row without going through the engine (fixture setup only). */
    seed(object: string, row: Row) { storeFor(object).set(String(row.id), { ...row }); },
    rowsOf(object: string) { return Array.from(storeFor(object).values()).map(copy); },
    failReadsOf(object: string, error: Error) { throwOnFind = { object, error }; },
  };
}

const TEST_PACKAGE_ID = 'com.objectstack.test.12663';

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
    ['id', 'namespace', 'key', 'scope', 'user_id', 'value', 'value_enc']
      .map((f) => [f, textField(f)]),
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
 * The business object family 2 holds its handle on. `smtp` / `password` is
 * chosen so `(namespace, key)` COLLIDES with a declared encrypted settings
 * specifier — that collision is what the premise repro turns on, and it is not
 * contrived: the engine records `namespace = <object name>`, `key = <field
 * name>` (`encryptSecretFields`), while settings records its own namespace and
 * specifier key, and nothing keeps the two vocabularies apart.
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
      { key: 'host', type: 'string' },
    ],
  },
] as unknown as SettingsManifest[];

async function buildRuntime() {
  const store = makeDriver();
  const engine = new ObjectQL();
  engine.registerDriver(store.driver as never, true);
  await engine.init();
  // `packageId` is required by the built declaration this package resolves
  // (`registerObject(schema, packageId, …)`); the engine's own in-package tests
  // reach a source signature that defaults it.
  for (const object of [sysSecretObject, sysSettingObject, sysMetadataObject, smtpObject]) {
    engine.registry.registerObject(object as never, TEST_PACKAGE_ID);
  }

  const crypto = new LocalCryptoProvider({ mode: 'test' });
  engine.setCryptoProvider(crypto as never);

  // --- family 1: a settings handle, minted by the real provider -------------
  const settingsHandle = await crypto.encrypt('smtp-app-password', {
    namespace: 'smtp',
    key: 'password',
  });
  store.seed('sys_secret', {
    id: settingsHandle.id,
    namespace: 'smtp',
    key: 'password',
    kms_key_id: settingsHandle.kmsKeyId,
    alg: settingsHandle.alg,
    version: settingsHandle.version,
    ciphertext: settingsHandle.ciphertext,
  });
  store.seed('sys_setting', {
    id: 'set_1',
    namespace: 'smtp',
    key: 'password',
    scope: 'tenant',
    user_id: null,
    value_enc: settingsHandle.id,
  });

  // --- family 2: the engine's own secret-field channel ----------------------
  // A REAL engine insert: `encryptSecretFields` mints the sys_secret row
  // (namespace='smtp', key='password') and rewrites the column to `secret:<id>`.
  await engine.insert('smtp', { id: 'rec_1', host: 'mail.example.com', password: 'hunter2' });
  const objectFieldHandle = String(store.rowsOf('smtp')[0].password).slice('secret:'.length);

  // --- family 3: the REAL datasource credential binder ----------------------
  const binder = createDatasourceSecretBinder({
    engine: engine as never,
    cryptoProvider: crypto as never,
  });
  const credentialsRef = await binder.bind({ value: 'pg-password' }, { name: 'main' });
  store.seed('sys_metadata', {
    id: 'meta_1',
    name: 'main',
    type: 'datasource',
    scope: 'platform',
    state: 'active',
    metadata: JSON.stringify({
      name: 'main',
      driver: 'postgres',
      external: { credentialsRef },
    }),
  });

  return {
    engine: engine as unknown as SecretReferenceEngineLike,
    realEngine: engine,
    store,
    crypto,
    settingsHandleId: settingsHandle.id,
    objectFieldHandleId: objectFieldHandle,
    datasourceHandleId: credentialsRef.slice('sys_secret:'.length),
  };
}

type Runtime = Awaited<ReturnType<typeof buildRuntime>>;

const collect = (rt: Runtime, declared: Parameters<typeof collectSecretReferenceUnion>[0]['declaredDatasources'] = []) =>
  collectSecretReferenceUnion({ engine: rt.engine, declaredDatasources: declared });

describe('sys_secret reference union — fixtures come from the real producers', () => {
  let rt: Runtime;
  beforeEach(async () => { rt = await buildRuntime(); });

  it('mints three DISTINCT handles, one per producer family', () => {
    const ids = [rt.settingsHandleId, rt.objectFieldHandleId, rt.datasourceHandleId];
    expect(new Set(ids).size).toBe(3);
    // The producers' own spellings, not this file's: a settings handle is bare,
    // the engine wraps it `secret:`, the binder wraps it `sys_secret:`.
    for (const id of ids) expect(id.startsWith('sec_')).toBe(true);
    expect(rt.store.rowsOf('smtp')[0].password).toBe(`secret:${rt.objectFieldHandleId}`);
    expect(rt.store.rowsOf('sys_secret')).toHaveLength(3);
  });
});

/**
 * Ruling 5's reproduction. This is the measurement the whole card rests on: a
 * LIVE, engine-owned credential is classified `orphaned` by the SHIPPED
 * settings-scoped classifier, because attribution by `(namespace, key)` is a
 * name match and not ownership.
 */
describe('the premise: the shipped settings-scoped classifier calls a LIVE credential `orphaned`', () => {
  let rt: Runtime;
  beforeEach(async () => { rt = await buildRuntime(); });

  it('classifies the engine-owned handle `orphaned` while a business row still references it', () => {
    const report = classifySysSecretRows({
      secrets: rt.store.rowsOf('sys_secret') as never,
      settingRows: rt.store.rowsOf('sys_setting') as never,
      attributableTo: collectEncryptedSpecifierRefs(settingsManifests),
    });

    const engineOwned = report.rows.find((r) => r.id === rt.objectFieldHandleId);
    expect(engineOwned?.verdict).toBe('orphaned');

    // …and it is live: the business row's column still names it.
    expect(rt.store.rowsOf('smtp')[0].password).toBe(`secret:${rt.objectFieldHandleId}`);

    // The datasource handle escapes only because `(datasource, main)` happens
    // not to collide with a declared specifier — a name match, not ownership.
    expect(report.rows.find((r) => r.id === rt.datasourceHandleId)?.verdict).toBe('unattributable');
  });

  it('the union names every one of those handles, which is what makes deletion decidable', async () => {
    const union = await collect(rt);
    assertSecretReferenceUnionComplete(union);
    expect(union.handleIds.has(rt.settingsHandleId)).toBe(true);
    expect(union.handleIds.has(rt.objectFieldHandleId)).toBe(true);
    expect(union.handleIds.has(rt.datasourceHandleId)).toBe(true);
  });
});

describe('family 1 — settings (`sys_setting.value_enc`)', () => {
  let rt: Runtime;
  beforeEach(async () => { rt = await buildRuntime(); });

  it('names the handle held ONLY by sys_setting.value_enc, with its holder coordinates', async () => {
    const union = await collect(rt);
    expect(union.handleIds.has(rt.settingsHandleId)).toBe(true);
    const ref = union.references.find((r) => r.handleId === rt.settingsHandleId);
    expect(ref?.family).toBe('settings');
    expect(ref?.holder).toContain('sys_setting(namespace=smtp,key=password');
    // No other family holds it — so removing family 1's enumeration reds this.
    expect(union.references.filter((r) => r.handleId === rt.settingsHandleId)).toHaveLength(1);
  });

  it('a LEGACY INLINE value_enc contributes no handle, and does not gap the family', async () => {
    rt.store.seed('sys_setting', {
      id: 'set_legacy', namespace: 'smtp', key: 'legacy', scope: 'tenant',
      value_enc: 'AQIDBAUGBwgJCg==', // inline ciphertext, not a `sec_` handle
    });
    const result = await collectSettingsSecretReferences(rt.engine);
    expect(result.status).toBe('enumerated');
    expect(result.references.map((r) => r.handleId)).toEqual([rt.settingsHandleId]);
  });

  it('an unreadable sys_setting is a GAP, never an empty answer', async () => {
    rt.store.failReadsOf('sys_setting', new Error('connection reset'));
    const result = await collectSettingsSecretReferences(rt.engine);
    expect(result.status).toBe('gap');
    expect(result.status === 'gap' && result.reason).toContain('connection reset');

    const union = await collect(rt);
    expect(union.complete).toBe(false);
    expect(union.gaps.map((g) => g.family)).toContain('settings');
  });
});

describe('family 2 — the engine secret-field channel (`secret:<id>` on a business row)', () => {
  let rt: Runtime;
  beforeEach(async () => { rt = await buildRuntime(); });

  it('names the handle held ONLY by a business row, with its holder coordinates', async () => {
    const union = await collect(rt);
    expect(union.handleIds.has(rt.objectFieldHandleId)).toBe(true);
    const ref = union.references.find((r) => r.handleId === rt.objectFieldHandleId);
    expect(ref?.family).toBe('object-field');
    expect(ref?.holder).toBe('smtp.password#rec_1');
    expect(union.references.filter((r) => r.handleId === rt.objectFieldHandleId)).toHaveLength(1);
  });

  it('registers a new secret field at runtime: a NEWLY registered object is in the union with no code change', async () => {
    const before = await collect(rt);
    assertSecretReferenceUnionComplete(before);

    // A tenant authors an object this file never mentions, and the engine mints
    // its handle through the same producer path.
    rt.realEngine.registry.registerObject({
      name: 'tenant_api_integration',
      label: 'Tenant integration',
      fields: {
        id: textField('id'),
        label: textField('label'),
        api_token: { name: 'api_token', label: 'api_token', type: 'secret' as const },
      },
    } as never, TEST_PACKAGE_ID);
    await rt.realEngine.insert('tenant_api_integration', {
      id: 'rec_t1', label: 'crm', api_token: 'tok-live-42',
    });
    const newHandleId = String(rt.store.rowsOf('tenant_api_integration')[0].api_token)
      .slice('secret:'.length);

    // Anti-vacuity: the handle did not exist when the first union was built.
    expect(before.handleIds.has(newHandleId)).toBe(false);

    const after = await collect(rt);
    assertSecretReferenceUnionComplete(after);
    expect(after.handleIds.has(newHandleId)).toBe(true);
    expect(after.references.find((r) => r.handleId === newHandleId)?.holder)
      .toBe('tenant_api_integration.api_token#rec_t1');
  });

  it('an unreadable secret-declaring object GAPS the family rather than dropping it', async () => {
    rt.store.failReadsOf('smtp', new Error('table is locked'));
    const result = await collectObjectFieldSecretReferences(rt.engine);
    expect(result.status).toBe('gap');
    expect(result.status === 'gap' && result.reason).toContain('table is locked');
  });

  it('the driver-level read is load-bearing: the generic engine read cannot see the ref at all', async () => {
    // Positive control on the module's central design decision. `maskSecretFields`
    // replaces the stored `secret:<id>` with the mask on every find/findOne,
    // unconditionally — so a union built on `engine.find` would enumerate the
    // family and collect NOTHING, silently, on a real runtime.
    const throughEngine = await rt.realEngine.find('smtp', {}) as Array<Record<string, unknown>>;
    expect(throughEngine[0].password).toBe(SECRET_MASK);
    expect(String(throughEngine[0].password).startsWith('secret:')).toBe(false);

    const union = await collect(rt);
    expect(union.handleIds.has(rt.objectFieldHandleId)).toBe(true);
  });

  it('an object with no secret field is never read at all', async () => {
    // `sys_setting`/`sys_metadata`/`sys_secret` declare no `secret` field, so
    // family 2 must not attribute any handle to them.
    const result = await collectObjectFieldSecretReferences(rt.engine);
    expect(result.status).toBe('enumerated');
    expect(result.references.every((r) => r.holder.startsWith('smtp.'))).toBe(true);
  });
});

describe('family 3 — datasource artefacts (`external.credentialsRef`)', () => {
  let rt: Runtime;
  beforeEach(async () => { rt = await buildRuntime(); });

  it('names the handle held ONLY by a datasource artefact, with its holder coordinates', async () => {
    const union = await collect(rt);
    expect(union.handleIds.has(rt.datasourceHandleId)).toBe(true);
    const ref = union.references.find((r) => r.handleId === rt.datasourceHandleId);
    expect(ref?.family).toBe('datasource');
    expect(ref?.holder).toBe('datasource(main).external.credentialsRef');
    expect(union.references.filter((r) => r.handleId === rt.datasourceHandleId)).toHaveLength(1);
  });

  it('reads a code-defined artefact the host declares, which sys_metadata never sees', async () => {
    const result = collectDatasourceSecretReferences([
      { name: 'analytics', external: { credentialsRef: 'sys_secret:sec_declared_1' } },
    ]);
    expect(result.references).toEqual([
      { handleId: 'sec_declared_1', family: 'datasource', holder: 'datasource(analytics).external.credentialsRef' },
    ]);
  });

  it('an INACTIVE artefact still contributes its handle', async () => {
    rt.store.seed('sys_metadata', {
      id: 'meta_2', name: 'retired', type: 'datasource', state: 'inactive',
      metadata: JSON.stringify({ name: 'retired', external: { credentialsRef: 'sys_secret:sec_retired_1' } }),
    });
    const union = await collect(rt);
    expect(union.handleIds.has('sec_retired_1')).toBe(true);
  });

  it('a ref shape this producer never minted contributes nothing', () => {
    const result = collectDatasourceSecretReferences([
      { name: 'weird', external: { credentialsRef: 'vault://kv/data/pg#password' } },
    ]);
    expect(result.references).toEqual([]);
  });

  it('an undeclared code-defined set is a GAP; an EMPTY one is an answer', async () => {
    // Called directly, not through `collect` — a default parameter would swallow
    // the `undefined` this case is about (measured: it did, first run).
    const undeclared = await collectSecretReferenceUnion({
      engine: rt.engine,
      declaredDatasources: undefined,
    });
    expect(undeclared.complete).toBe(false);
    expect(undeclared.gaps.map((g) => g.family)).toEqual(['datasource']);
    expect(undeclared.gaps[0].reason).toContain('declaredDatasources');
    // The partial references survive — they are real, they just cannot complete.
    expect(undeclared.handleIds.has(rt.datasourceHandleId)).toBe(true);
    // #12804: the engine half answered, so ONLY the host half is missing — one
    // gap reason, not two. (Its wording is pinned separately, in the host-half
    // suite below.)
    expect(undeclared.gaps).toHaveLength(1);

    const declaredEmpty = await collect(rt, []);
    expect(declaredEmpty.complete).toBe(true);
  });

  it('an unparseable sys_metadata artefact is a GAP, never a skipped row', async () => {
    rt.store.seed('sys_metadata', {
      id: 'meta_bad', name: 'corrupt', type: 'datasource', state: 'active', metadata: '{not json',
    });
    const union = await collect(rt);
    expect(union.complete).toBe(false);
    expect(union.gaps[0].reason).toContain('credentialsRef is unknown, not absent');
  });
});

// ---------------------------------------------------------------------------
// #12804 — family 3's SECOND source. Two halves, two ablations.
// ---------------------------------------------------------------------------

/**
 * Mint a credentials handle through the REAL binder, so the ref spelling under
 * test comes from the producer rather than from this file.
 */
async function bindCredential(rt: Runtime, name: string) {
  const binder = createDatasourceSecretBinder({
    engine: rt.realEngine as never,
    cryptoProvider: rt.crypto as never,
  });
  const ref = await binder.bind({ value: `${name}-password` }, { name });
  return { ref, handleId: ref.slice('sys_secret:'.length) };
}

/** An engine slice built by hand, so a port member can be removed or broken. */
const sliceOf = (
  rt: Runtime,
  listDatasourceDefs?: SecretReferenceEngineLike['listDatasourceDefs'],
): SecretReferenceEngineLike => ({
  getConfigs: () => rt.engine.getConfigs(),
  getDriverForObject: (o) => rt.engine.getDriverForObject(o),
  ...(listDatasourceDefs ? { listDatasourceDefs } : {}),
});

describe('family 3 (engine half) — definitions the engine holds', () => {
  let rt: Runtime;
  beforeEach(async () => { rt = await buildRuntime(); });

  it('names a handle held ONLY by an engine-registered datasource definition', async () => {
    const { ref, handleId } = await bindCredential(rt, 'analytics');
    // Registered IN CODE only: never written to sys_metadata, never declared by
    // the host. Before #12804 this handle was invisible to the union.
    rt.realEngine.registerDatasourceDef({
      name: 'analytics', schemaMode: 'external', external: { allowWrites: false, credentialsRef: ref },
    });

    // Anti-vacuity: neither other source can reach it.
    expect(rt.store.rowsOf('sys_metadata').some((r) => String(r.metadata).includes(handleId))).toBe(false);

    const union = await collect(rt, []); // host says it has NONE
    assertSecretReferenceUnionComplete(union);
    expect(union.handleIds.has(handleId)).toBe(true);
    const ref3 = union.references.find((r) => r.handleId === handleId);
    expect(ref3?.family).toBe('datasource');
    expect(ref3?.holder).toBe('datasource(analytics).external.credentialsRef');
    expect(union.references.filter((r) => r.handleId === handleId)).toHaveLength(1);
  });

  it('an engine that cannot list its definitions is a GAP, never an empty answer', async () => {
    const noAccessor = sliceOf(rt);
    const read = readEngineDatasourceDefs(noAccessor);
    expect(read.artefacts).toEqual([]);
    expect(read.gap).toContain('listDatasourceDefs');

    const union = await collectSecretReferenceUnion({ engine: noAccessor, declaredDatasources: [] });
    expect(union.complete).toBe(false);
    expect(union.gaps.map((g) => g.family)).toEqual(['datasource']);
    // The persisted half still enumerated, so its handle survives as a partial.
    expect(union.handleIds.has(rt.datasourceHandleId)).toBe(true);
  });

  it('a throwing listDatasourceDefs is a GAP naming the cause', async () => {
    const throwing = sliceOf(rt, () => { throw new Error('definition index unavailable'); });
    const read = readEngineDatasourceDefs(throwing);
    expect(read.gap).toContain('definition index unavailable');

    const union = await collectSecretReferenceUnion({ engine: throwing, declaredDatasources: [] });
    expect(union.complete).toBe(false);
    expect(union.gaps[0].reason).toContain('definition index unavailable');
  });

  it('an engine answering [] is an ANSWER, exactly as the host\'s [] is', async () => {
    const empty = sliceOf(rt, () => []);
    const union = await collectSecretReferenceUnion({ engine: empty, declaredDatasources: [] });
    expect(union.complete).toBe(true);
  });
});

describe('family 3 (host half) — artefacts the engine never saw', () => {
  let rt: Runtime;
  beforeEach(async () => { rt = await buildRuntime(); });

  it('names a handle held ONLY by the host-declared list', async () => {
    const { ref, handleId } = await bindCredential(rt, 'never_installed');
    // Declared in a config file nothing ever registered: the engine's index
    // cannot see it, and it never reached sys_metadata either.
    expect(rt.realEngine.listDatasourceDefs().some((d) => d.name === 'never_installed')).toBe(false);
    expect(rt.store.rowsOf('sys_metadata').some((r) => String(r.metadata).includes(handleId))).toBe(false);

    const union = await collect(rt, [{ name: 'never_installed', external: { credentialsRef: ref } }]);
    assertSecretReferenceUnionComplete(union);
    expect(union.handleIds.has(handleId)).toBe(true);
    const ref3 = union.references.find((r) => r.handleId === handleId);
    expect(ref3?.family).toBe('datasource');
    expect(ref3?.holder).toBe('datasource(never_installed).external.credentialsRef');
    expect(union.references.filter((r) => r.handleId === handleId)).toHaveLength(1);
  });

  it('the host half still REFUSES when nobody answered — the guarantee #12804 must not remove', async () => {
    // The falsification criterion: an input shape that makes the union refuse
    // rather than return a silent empty answer must still exist after wiring
    // the engine in. `declaredDatasources: undefined` is that shape.
    const undeclared = await collectSecretReferenceUnion({
      engine: rt.engine,
      declaredDatasources: undefined,
    });
    expect(undeclared.complete).toBe(false);
    expect(undeclared.gaps.map((g) => g.family)).toEqual(['datasource']);
    expect(() => assertSecretReferenceUnionComplete(undeclared))
      .toThrow(IncompleteSecretReferenceUnionError);
  });

  it('the gap message states the LIVE mechanism, not the retired one', async () => {
    const undeclared = await collectSecretReferenceUnion({
      engine: rt.engine,
      declaredDatasources: undefined,
    });
    const reason = undeclared.gaps[0].reason;
    // The reason an operator reads mid-incident. The engine DID answer; what is
    // still unreachable is a datasource declared in code and never registered.
    expect(reason).toContain('declaredDatasources');
    expect(reason).toContain('REGISTERED on this runtime');
    expect(reason).toContain('until the host is asked');
    // …and it must not carry the mechanism #12758 retired. A true sentence
    // resting on a dead mechanism is the defect class this pin exists for.
    expect(reason).not.toContain('engine drops');
    expect(reason).not.toContain('could not be seen at all');
  });
});

describe('family 3 — the two sources are a UNION, not a replacement', () => {
  let rt: Runtime;
  beforeEach(async () => { rt = await buildRuntime(); });

  it('one datasource named by BOTH sources contributes ONE reference, not two', async () => {
    const { ref, handleId } = await bindCredential(rt, 'shared');
    rt.realEngine.registerDatasourceDef({ name: 'shared', external: { credentialsRef: ref } });

    const union = await collect(rt, [{ name: 'shared', external: { credentialsRef: ref } }]);
    assertSecretReferenceUnionComplete(union);
    expect(union.references.filter((r) => r.handleId === handleId)).toHaveLength(1);
  });

  it('two sources DISAGREEING keeps both handles — dropping either would under-report', async () => {
    const fromEngine = await bindCredential(rt, 'drifted');
    const fromHost = await bindCredential(rt, 'drifted');
    expect(fromEngine.handleId).not.toBe(fromHost.handleId);
    rt.realEngine.registerDatasourceDef({ name: 'drifted', external: { credentialsRef: fromEngine.ref } });

    const union = await collect(rt, [{ name: 'drifted', external: { credentialsRef: fromHost.ref } }]);
    assertSecretReferenceUnionComplete(union);
    expect(union.handleIds.has(fromEngine.handleId)).toBe(true);
    expect(union.handleIds.has(fromHost.handleId)).toBe(true);
  });

  it('a handle held ONLY in sys_metadata still arrives — the persisted source is untouched', async () => {
    const union = await collect(rt, []);
    assertSecretReferenceUnionComplete(union);
    expect(union.handleIds.has(rt.datasourceHandleId)).toBe(true);
  });
});

/**
 * Type-level pin, evaluated by `tsc --noEmit`: `packages/cli/tsconfig.json`
 * includes `src` with NO test exclusion (unlike `tsconfig.build.json`), so a
 * type assertion written here IS in the typecheck program — verified with
 * `tsc --listFiles`.
 *
 * What it pins: the REAL engine's answer fits the port's declared return type.
 * Taken off the METHOD so re-narrowing `ObjectQL.listDatasourceDefs` moves the
 * pin even if the named types survive.
 */
type EngineDefsPort = NonNullable<SecretReferenceEngineLike['listDatasourceDefs']>;
export function __pinRealEngineSatisfiesTheDatasourcePort(
  engine: ObjectQL,
): ReturnType<EngineDefsPort> {
  return engine.listDatasourceDefs();
}

describe('completeness is the contract', () => {
  let rt: Runtime;
  beforeEach(async () => { rt = await buildRuntime(); });

  it('reports one result for every member of the closed family set', async () => {
    const union = await collect(rt);
    expect([...SECRET_REFERENCE_FAMILIES]).toEqual(['settings', 'object-field', 'datasource']);
    expect(Object.keys(union.families).sort()).toEqual([...SECRET_REFERENCE_FAMILIES].sort());
    for (const family of SECRET_REFERENCE_FAMILIES) {
      expect(union.families[family].family).toBe(family);
    }
  });

  it('refuses an incomplete union with the ADR-0112 envelope, naming the missing family', () => {
    const union = buildSecretReferenceUnion({
      settings: { family: 'settings', status: 'enumerated', references: [] },
      'object-field': {
        family: 'object-field', status: 'gap', references: [],
        reason: 'no driver resolves for `tenant_thing`',
      },
      datasource: { family: 'datasource', status: 'enumerated', references: [] },
    });
    expect(union.complete).toBe(false);

    let thrown: unknown;
    try { assertSecretReferenceUnionComplete(union); } catch (err) { thrown = err; }
    expect(thrown).toBeInstanceOf(IncompleteSecretReferenceUnionError);
    expect((thrown as IncompleteSecretReferenceUnionError).code).toBe('PRECONDITION_REQUIRED');
    expect((thrown as IncompleteSecretReferenceUnionError).status).toBe(428);
    expect((thrown as Error).message).toContain('object-field');
    expect((thrown as Error).message).toContain('tenant_thing');
  });

  it('accepts a union in which every family enumerated', () => {
    const union = buildSecretReferenceUnion({
      settings: { family: 'settings', status: 'enumerated', references: [] },
      'object-field': { family: 'object-field', status: 'enumerated', references: [] },
      datasource: { family: 'datasource', status: 'enumerated', references: [] },
    });
    expect(union.complete).toBe(true);
    expect(() => assertSecretReferenceUnionComplete(union)).not.toThrow();
  });
});
