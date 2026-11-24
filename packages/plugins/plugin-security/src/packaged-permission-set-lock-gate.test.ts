// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Commit 5619aace3 — the packaged-permission-set lock answers at the METADATA door.
 *
 * The lock (`packaged-permission-set-lock.ts`) used to have exactly one
 * enforcement point: the `sys_permission_set` DATA door. The pre-persistence
 * authoring-gate seam carried an `'object'` registration only, so a
 * metadata-door save targeting a package-declared permission set reached
 * persistence whenever the ADR-0005 tier gate was open for the type
 * (`OS_METADATA_WRITABLE=permission`) — and the resulting overlay won at
 * read. The maintainer ruling of 2026-08-25 (「11843 同意」 — option B) closed
 * that door by REGISTERING the same lock on the seam rather than authoring a
 * second refusal; this file pins the registered behaviour end to end.
 *
 * ## The harness, and what makes each case answer for the layer it names
 *
 * A REAL `ObjectStackProtocolImplementation` (aliased to the producer's
 * source — see `vitest.config.ts`) over a minimal fake engine, on the
 * host-config topology (`environmentId` undefined — the flagship showcase's
 * own assembly, the one whose `saveMetaItem` runs the authoring gate ahead of
 * every persistence path). The refusal cases assert WHICH layer answered by
 * ERROR CLASS IDENTITY, not only by the `code`/`status` envelope:
 * `NOT_OVERRIDABLE`/403 is shared by the lock, the ADR-0005 tier gate and the
 * protocol's package door, so the class is the only fingerprint. Since
 * ADR-0131 D6 (#15206 S2) the protocol's own package door seals an item a
 * managed package ships with the hatch OPEN as well as CLOSED, and it answers
 * ahead of the seam on every topology. So every save of the package-declared
 * name asserts the class is NOT the lock's (`PackagedPermissionSetLockedError`):
 * the lock is still registered on the seam (`wired`), and the preservation
 * cases below still pass through it. And every refusal case asserts the ROW
 * COUNT — the defect this card measured was a write that landed, so "threw"
 * alone is half a pin.
 *
 * ## What is deliberately NOT re-pinned here (Prime Directive #8)
 *
 *  - The data door staying locked is `packaged-permission-set-lock.test.ts`.
 *  - The hatch's documented behaviour for non-packaged names on the UNGATED
 *    protocol is `sys-metadata-repository.package-writability.test.ts` in
 *    `@objectstack/metadata-protocol` (39 pins, authoritative per the ruling);
 *    this file adds only the with-gate half of that preservation.
 *  - The classifier's own verdict table is `packaged-permission-set-lock.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// The producer's OWN write-verb dispatch decisions, so this fake engine cannot
// accept a call ObjectQL refuses (`check:engine-double-contract`; imported
// from `@objectstack/metadata-core` exactly as the sibling pins do).
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import {
  ObjectStackProtocolImplementation,
  resetEnvWritableMetadataTypes,
} from '@objectstack/metadata-protocol';
import { bindSecurityCatalogReader, createSecurityCatalogReader, resolveUserAuthzGrants } from '@objectstack/core';
import { SchemaRegistry } from '@objectstack/objectql';
import { registerPackagedPermissionSetLockGate } from './packaged-permission-set-lock-gate.js';
import {
  PackagedPermissionSetLockedError,
  PackagedPermissionSetProvenanceUnknownError,
} from './packaged-permission-set-lock.js';

interface Row { [k: string]: unknown }

/** The installed code package whose declaration locks its set. */
const PKG = 'com.example.crm';
/** The set the package declares — artifact-shipped, so the lock owns it. */
const PACKAGED_SET = 'crm_support_agent';
/** An ordinary env-authored name no package declares. */
const ORG_SET = 'org_reporting';
/**
 * A set whose definition lives only in `sys_metadata` (ADR-0070 package-door
 * authoring): hydrated into the registry as a runtime shadow, stamped with
 * the `'sys_metadata'` sentinel `_packageId`. NOT package-declared to the
 * lock — ADR-0094 D5-R keeps this tier editable.
 */
const SHADOW_SET = 'workspace_drafted';

/** Spec-valid permission-set body — must pass the Zod gate, which runs BEFORE the seam under test. */
const body = (name: string) => ({ name, label: 'Pinned', objects: {} });

/**
 * Minimal engine fake: enough storage for `saveMetaItem`'s repository path
 * (the accept cases read their row back) and a SchemaRegistry surface for the
 * classifier (`listItems`) and the protocol (`getArtifactItem` — what makes
 * the packaged name artifact-backed, mirroring an installed package).
 */
function makeFakeEngine(opts?: { listItemsThrows?: boolean }) {
  const rows = new Map<string, Row>();
  const historyRows: Row[] = [];
  const keyOf = (w: Record<string, unknown>, table = 'sys_metadata') =>
    `${table}|${String(w.type)}|${String(w.name)}|${String(w.state ?? 'active')}`;
  const findRow = (where: Record<string, unknown>) => {
    if (where.id !== undefined) {
      for (const [k, r] of rows) if (r.id === where.id) return { key: k, row: r };
      return null;
    }
    const k = keyOf(where);
    const r = rows.get(k);
    return r ? { key: k, row: r } : null;
  };
  const meetsScalars = (r: Row, where?: Record<string, unknown>) => Object.entries(where ?? {})
    .every(([k, v]) => (v !== null && typeof v === 'object') || (r[k] ?? null) === v);
  const declaredItems = [
    { name: PACKAGED_SET, label: 'Support Agent', _packageId: PKG, objects: {} },
    { name: SHADOW_SET, label: 'Drafted', _packageId: 'sys_metadata', objects: {} },
  ];
  return {
    rows,
    historyRows,
    manifests: new Map<string, unknown>([[PKG, { id: PKG }]]),
    registry: {
      getPackage: () => undefined,
      registerItem: () => {},
      registerObject: () => {},
      getItem: () => undefined,
      listItems: (type: string) => {
        if (opts?.listItemsThrows) throw new Error('registry unreadable');
        return type === 'permission' ? declaredItems : [];
      },
      getArtifactItem: (type: string, name: string) =>
        type === 'permission' && name === PACKAGED_SET
          ? { name, _packageId: PKG }
          : undefined,
    },
    async find(table: string, opts2?: { where?: Record<string, unknown>; limit?: number }) {
      // The table's own rows, narrowed by the where's scalar equalities (a batch
      // publish lists a package's drafts with one); operator clauses are not read.
      // The caller's bound applies after the filter, as ObjectQL applies it.
      const found = table === 'sys_metadata_history'
        ? historyRows
        : Array.from(rows.values()).filter((r) => (r.__table ?? 'sys_metadata') === table && meetsScalars(r, opts2?.where));
      return typeof opts2?.limit === 'number' ? found.slice(0, opts2.limit) : found;
    },
    async findOne(table: string, opts2: { where: Record<string, unknown> }) {
      assertEngineFindOnePredicate(table, opts2);
      // A version's history row, as a restore reads it back.
      if (table === 'sys_metadata_history') return historyRows.find((h) => meetsScalars(h, opts2.where)) ?? null;
      return findRow(opts2.where)?.row ?? null;
    },
    async insert(table: string, data: Record<string, unknown>) {
      if (table === 'sys_metadata_history') {
        const h: Row = { ...data };
        if (!h.id) h.id = `h_${historyRows.length + 1}`;
        historyRows.push(h);
        return { id: h.id as string };
      }
      // A metadata row is keyed by its address; a row of any other table (a
      // package commit) by its own id, so a second one never replaces the first.
      const k = table === 'sys_metadata' ? keyOf(data, table) : `${table}|${String(data.id ?? rows.size + 1)}`;
      const row: Row = { id: `r_${rows.size + 1}`, __table: table, ...data };
      rows.set(k, row);
      return { id: row.id as string };
    },
    async update(_t: string, data: Record<string, unknown>, opts2: { where: Record<string, unknown> }) {
      assertEngineUpdateDispatch(data, opts2);
      const found = findRow(opts2.where);
      if (!found) throw new Error('not found');
      rows.set(found.key, { ...found.row, ...data });
      return { id: found.row.id as string };
    },
    async delete(_t: string, opts2: { where: Record<string, unknown> }) {
      assertEngineDeleteDispatch(opts2);
      const found = findRow(opts2.where);
      if (!found) return { deleted: 0 };
      rows.delete(found.key);
      return { deleted: 1 };
    },
    async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
      return cb(undefined, { owned: true });
    },
  };
}

function boot(opts?: { listItemsThrows?: boolean }) {
  const engine = makeFakeEngine(opts);
  const protocol = new ObjectStackProtocolImplementation(
    engine as never,
    () => new Map(),
    undefined, // host-config topology — no environmentId
  ) as unknown as {
    saveMetaItem(req: Record<string, unknown>): Promise<unknown>;
    registerAuthoringGate?(type: string, gate: unknown): void;
  };
  const wired = registerPackagedPermissionSetLockGate(protocol, engine);
  return { engine, protocol, wired };
}

const metaRowsOf = (engine: { rows: Map<string, Row> }) =>
  Array.from(engine.rows.values()).filter((r) => r.__table === 'sys_metadata');

const save = (
  protocol: { saveMetaItem(req: Record<string, unknown>): Promise<unknown> },
  req: Record<string, unknown>,
) => protocol.saveMetaItem(req).then(() => null, (e: unknown) => e);

const openHatch = () => {
  process.env.OS_METADATA_WRITABLE = 'permission';
  resetEnvWritableMetadataTypes();
  (ObjectStackProtocolImplementation as unknown as { resetEnvWritableCache(): void }).resetEnvWritableCache();
};

describe('#11843 — the lock answers at the metadata door', () => {
  beforeEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    resetEnvWritableMetadataTypes();
    (ObjectStackProtocolImplementation as unknown as { resetEnvWritableCache(): void }).resetEnvWritableCache();
  });
  afterEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    resetEnvWritableMetadataTypes();
    (ObjectStackProtocolImplementation as unknown as { resetEnvWritableCache(): void }).resetEnvWritableCache();
  });

  // ── the inversion of the measured defect ─────────────────────────────────

  it('hatch OPEN: a package-less save targeting a package-declared set is refused by the protocol package door, and no row lands', async () => {
    const { engine, protocol, wired } = boot();
    expect(wired).toBe(true);
    openHatch();

    const err = await save(protocol, { type: 'permission', name: PACKAGED_SET, item: body(PACKAGED_SET) });

    // [ADR-0131 D6] The hatch no longer opens an item a managed package ships:
    // the protocol's package door answers ahead of the seam, as with the hatch
    // closed, so the lock is not reached. Class identity is the layer
    // fingerprint — only the lock constructs this class.
    expect(err).not.toBeInstanceOf(PackagedPermissionSetLockedError);
    expect(err).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    // The defect was a write that LANDED — the throw alone is half the pin.
    expect(metaRowsOf(engine)).toEqual([]);
  }, 30_000);

  it('hatch CLOSED: the identical save is still refused, with the same envelope — the refusal does not depend on the hatch', async () => {
    const { engine, protocol } = boot();

    const err = await save(protocol, { type: 'permission', name: PACKAGED_SET, item: body(PACKAGED_SET) });

    // With the hatch closed the protocol's own package door answers first, on
    // this topology as on an environment kernel (`saveMetaItem` asks it on
    // every topology, ahead of the authoring-gate seam), so the lock is not
    // reached. Same condition, same envelope: NOT_OVERRIDABLE / 403.
    expect(err).not.toBeInstanceOf(PackagedPermissionSetLockedError);
    expect(err).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    expect(metaRowsOf(engine)).toEqual([]);
  }, 30_000);

  it('hatch OPEN: a DRAFT save of the packaged name is refused by the protocol package door too, and no row lands', async () => {
    const { engine, protocol } = boot();
    openHatch();

    const err = await save(protocol, {
      type: 'permission', name: PACKAGED_SET, item: body(PACKAGED_SET), mode: 'draft',
    });

    expect(err).not.toBeInstanceOf(PackagedPermissionSetLockedError);
    expect(err).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    expect(metaRowsOf(engine)).toEqual([]);
  }, 30_000);

  // ── the preservation half — NARROW is retained, per the ruling ───────────

  it('hatch OPEN: a package-less save to a NON-packaged name still lands, bound to no package', async () => {
    const { engine, protocol } = boot();
    openHatch();

    const err = await save(protocol, { type: 'permission', name: ORG_SET, item: body(ORG_SET) });

    expect(err).toBeNull();
    const rows = metaRowsOf(engine);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ package_id: null });
    // [ADR-0131 D7] The family declares no organization column: the save
    // writes no organization key at all — every row is the environment's.
    expect(rows[0]).not.toHaveProperty('organization_id');
  }, 30_000);

  it('hatch OPEN: a runtime-shadow set (definition living only in sys_metadata) is NOT locked — ADR-0094 D5-R', async () => {
    const { engine, protocol } = boot();
    openHatch();

    const err = await save(protocol, { type: 'permission', name: SHADOW_SET, item: body(SHADOW_SET) });

    expect(err).toBeNull();
    expect(metaRowsOf(engine)).toHaveLength(1);
  }, 30_000);

  // ── fail-closed, one spelling with the data door ─────────────────────────

  it('no provenance source can answer → the save is refused rather than guessed (fail-closed)', async () => {
    // The gate function alone, on a protocol stub with no layered read: the
    // registry read throws and no second source exists, which is the exact
    // `unknown` verdict the lock's header refuses to accept on a write door.
    let gate: ((ctx: { type: string; name: string; body: unknown }) => Promise<void>) | undefined;
    const stub = {
      registerAuthoringGate: (_type: string, g: typeof gate) => { gate = g; },
    };
    const ql = { registry: { listItems: () => { throw new Error('registry unreadable'); } } };
    expect(registerPackagedPermissionSetLockGate(stub, ql)).toBe(true);
    expect(gate).toBeTypeOf('function');

    const err = await gate!({ type: 'permission', name: PACKAGED_SET, body: body(PACKAGED_SET) })
      .then(() => null, (e: unknown) => e);

    expect(err).toBeInstanceOf(PackagedPermissionSetProvenanceUnknownError);
    expect(err).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
  });

  // ── feature detection, mirroring registerObjectPostureGate ───────────────

  it('a protocol without the seam keeps its behaviour and the caller can read the false', () => {
    expect(registerPackagedPermissionSetLockGate({}, {})).toBe(false);
    expect(registerPackagedPermissionSetLockGate(undefined, {})).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [ADR-0150 D2, #34226] The seal and the lock judge a save by (package, name)
// ─────────────────────────────────────────────────────────────────────────────

// The composition both permission-set describes below share: the packages, the set N,
// the real protocol and registry over this file's fake engine, and the grant reader.
const CRM = 'com.qa.crm';
const HR = 'com.qa.hr';
const FIN = 'com.qa.fin';
/** A second package of the `crm` namespace: it shares crm's set of a name. */
const CRM_TWO = 'com.qa.crm_two';
/** crm's customization pair, with a namespace of its own. */
const CRM_PAIR = `${CRM}.custom`;
const NS: Record<string, string> = { [CRM]: 'crm', [HR]: 'hr', [FIN]: 'fin', [CRM_TWO]: 'crm', [CRM_PAIR]: 'crmx' };
const N = 'qa_shared_reader';
const setOf = (cap: string) => ({ name: N, label: cap, objects: {}, systemPermissions: [cap] });

type Order = 'shipped first' | 'shipped last';
const ORDERS: readonly Order[] = ['shipped first', 'shipped last'];

/** The composition: `shippers` ship N, every package of {@link NS} installed, in `order`. */
async function composition(order: Order, shippers: readonly string[] = [CRM]) {
  const registry = new SchemaRegistry();
  registry.logLevel = 'silent';
  const install = (id: string) => registry.installPackage(
    { id, name: id, version: '1.0.0', type: 'app', namespace: NS[id], ...(id === CRM_TWO ? { dependencies: { [CRM]: '^1.0.0' } } : {}) } as never,
    'authored',
  );
  const ship = () => { for (const id of shippers) registry.registerItem('permission', setOf(`cap_${NS[id]}_shipped`) as never, 'name' as never, id); };
  if (order === 'shipped first') {
    for (const id of shippers) install(id);
    ship();
    for (const id of Object.keys(NS)) if (!shippers.includes(id)) install(id);
  } else {
    for (const id of Object.keys(NS)) install(id);
    ship();
  }
  const engine = makeFakeEngine();
  (engine as { registry: unknown }).registry = registry;
  const protocol = new ObjectStackProtocolImplementation(engine as never, () => new Map(), undefined) as unknown as {
    saveMetaItem(req: Record<string, unknown>): Promise<unknown>;
  };
  expect(registerPackagedPermissionSetLockGate(protocol, engine)).toBe(true);
  // The lock gate alone, on the same registry, for the arms the seal answers first.
  let gate: ((ctx: Record<string, unknown>) => Promise<void>) | undefined;
  registerPackagedPermissionSetLockGate({ registerAuthoringGate: (_t: string, g: typeof gate) => { gate = g; } }, engine);
  return { engine, protocol, registry, gate: (packageId?: string) => gate!({ type: 'permission', name: N, body: setOf('cap'), ...(packageId ? { packageId } : {}) }).then(() => null, (e: unknown) => e) };
}

/** What one grant of N with this package column confers, read by the authorization resolver. */
async function confers(registry: unknown, column: string | null): Promise<unknown> {
  const rows: Record<string, unknown[]> = {
    sys_user: [{ id: 'u1', email: 'u1@example.com' }],
    sys_member: [{ user_id: 'u1', organization_id: 'org_a', role: 'member' }],
    sys_user_permission_set: [{ user_id: 'u1', permission_set: N, permission_set_package: column, organization_id: 'org_a' }],
  };
  const ql = {
    registry,
    find: async (object: string) => rows[object] ?? [],
    findOne: async (object: string, query?: unknown) => { assertEngineFindOnePredicate(object, query as never); return rows[object]?.[0]; },
    count: async () => 0,
  };
  bindSecurityCatalogReader(ql, createSecurityCatalogReader({ registry: registry as never, metadata: { get: () => undefined, list: () => [] } as never }));
  return (await resolveUserAuthzGrants(ql, 'u1', { tenantId: 'org_a' })).systemPermissions;
}

/**
 * A permission set is `(package, name)` (ADR-0150 D2), one set per namespace
 * (D9). Package `crm` ships the set N. Package `hr`, of another namespace, then
 * saves its OWN set N through the metadata door.
 *
 * FROM: the save was refused `NOT_OVERRIDABLE` / 403, "provided by a managed
 * package and is sealed". The protocol's seal judged the name alone, and so
 * did the lock behind it. TO: the save lands, and hr's grant confers hr's set.
 *
 * Every save that overrides crm's shipped set stays sealed exactly as before
 * (ADR-0126 / ADR-0131 D6): one naming no package, one addressed to crm, one
 * addressed to crm's customization pair (whose namespace differs from crm's),
 * and one addressed to a co-owner of crm's namespace. Those saves are asserted
 * to be refused by the SEAL, not by the lock. The lock's own arms are asserted
 * at the gate, which the same composition registers on the same registry.
 *
 * The composition is the real protocol and the real `SchemaRegistry`, both read
 * from source (`vitest.config.ts`), over this file's fake engine. Each case
 * runs in both registration orders: crm's set registered before the other
 * packages install, and after.
 */
describe('[#34226] a permission set is (package, name): the seal and the lock judge a save by the package it addresses', () => {
  const sealed = (err: unknown) => {
    expect(err, 'refused by the seal, not by the lock').not.toBeInstanceOf(PackagedPermissionSetLockedError);
    expect(err).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    expect(String((err as Error).message)).toContain('provided by a managed package and is sealed');
  };

  for (const order of ORDERS) {
    it(`${order}: hr saves its own set N beside crm's shipped N; it lands, and hr's grant confers hr's set while crm's confers crm's (FROM sealed)`, async () => {
      const { engine, protocol, registry } = await composition(order);
      const err = await save(protocol, { type: 'permission', name: N, item: setOf('cap_hr'), packageId: HR });
      expect(err).toBeNull();
      expect(metaRowsOf(engine).map((r) => ({ name: r.name, package_id: r.package_id }))).toEqual([{ name: N, package_id: HR }]);
      expect({ crm: await confers(registry, CRM), hr: await confers(registry, HR) }).toEqual({ crm: ['cap_crm_shipped'], hr: ['cap_hr'] });
    }, 30_000);

    it(`${order}: with crm AND fin shipping N, hr's own save still lands: every shipper is judged, not the first found`, async () => {
      const { engine, protocol } = await composition(order, [CRM, FIN]);
      expect(await save(protocol, { type: 'permission', name: N, item: setOf('cap_hr'), packageId: HR })).toBeNull();
      expect(metaRowsOf(engine)).toHaveLength(1);
    }, 30_000);

    it.each([
      ['naming no package', undefined],
      ['addressed to crm', CRM],
      ['addressed to crm\'s customization pair (another namespace)', CRM_PAIR],
      ['addressed to a co-owner of crm\'s namespace', CRM_TWO],
    ] as const)(`${order}: CONTROL — a save of N %s overrides crm's shipped set and is sealed as before, nothing written`, async (_how, packageId) => {
      const { engine, protocol } = await composition(order);
      sealed(await save(protocol, { type: 'permission', name: N, item: setOf('cap_x'), ...(packageId ? { packageId } : {}) }));
      expect(metaRowsOf(engine)).toEqual([]);
    }, 30_000);

    it(`${order}: CONTROL — with fin ALSO shipping N, a save addressed to fin's namespace co-owner is still sealed`, async () => {
      const { engine, protocol } = await composition(order, [FIN, CRM]);
      sealed(await save(protocol, { type: 'permission', name: N, item: setOf('cap_x'), packageId: CRM_TWO }));
      expect(metaRowsOf(engine)).toEqual([]);
    }, 30_000);

    it(`${order}: hr's own set saved as a draft then published: the draft lands, the publish promotes it, and hr's grant confers it (FROM the publish sealed)`, async () => {
      const { engine, protocol, registry } = await composition(order);
      expect(await save(protocol, { type: 'permission', name: N, item: setOf('cap_hr'), packageId: HR, mode: 'draft' })).toBeNull();
      const published = await (protocol as unknown as { publishMetaItem(req: Record<string, unknown>): Promise<unknown> })
        .publishMetaItem({ type: 'permission', name: N, packageId: HR }).then(() => null, (e: unknown) => e);
      expect(published).toBeNull();
      expect(metaRowsOf(engine).map((r) => ({ package_id: r.package_id, state: r.state }))).toEqual([{ package_id: HR, state: 'active' }]);
      expect({ crm: await confers(registry, CRM), hr: await confers(registry, HR) }).toEqual({ crm: ['cap_crm_shipped'], hr: ['cap_hr'] });
    }, 30_000);

    // The refusal each answers: the managed seal at the store for crm and its pair, and the
    // one-name-per-namespace rule, which the publish judges first, for the environment and crm's co-owner.
    it.each([
      ['naming no package', null, ['NAMESPACE_CONFLICT', 422]],
      ['addressed to crm', CRM, ['NOT_OVERRIDABLE', 403]],
      ['addressed to crm\'s customization pair (another namespace)', CRM_PAIR, ['NOT_OVERRIDABLE', 403]],
      ['addressed to a co-owner of crm\'s namespace', CRM_TWO, ['NAMESPACE_CONFLICT', 422]],
    ] as const)(`${order}: CONTROL — the publish door: a stored draft of N %s is not promoted over crm's shipped set`, async (_how, binding, envelope) => {
      const { engine, protocol } = await composition(order);
      // The draft is hr's, then rebound to the address under test, as a draft stored before this change would be.
      expect(await save(protocol, { type: 'permission', name: N, item: setOf('cap_x'), packageId: HR, mode: 'draft' })).toBeNull();
      for (const [key, row] of engine.rows) if (row.__table === 'sys_metadata') engine.rows.set(key, { ...row, package_id: binding });
      const err = await (protocol as unknown as { publishMetaItem(req: Record<string, unknown>): Promise<unknown> })
        .publishMetaItem({ type: 'permission', name: N, ...(binding ? { packageId: binding } : {}) }).then(() => null, (e: unknown) => e);
      expect([(err as { code?: unknown } | null)?.code, (err as { status?: unknown } | null)?.status]).toEqual(envelope);
      expect(metaRowsOf(engine).map((r) => r.state)).toEqual(['draft']);
    }, 30_000);

    // [#32396] On a runtime that cannot roll back, a refused package publish undoes
    // each promotion it made by hand. The undo addresses the same package the
    // promotion did, so it judges hr's own set N as the promotion did.
    // Created: the undo removes the active row. Edited (hr's N live at v1): the undo
    // restores v1, a write the store judges by its intent.
    it.each(['created', 'edited'] as const)(`${order}: a refused batch publish on a runtime that cannot roll back undoes hr's own set N (%s) and puts its draft back (FROM left live)`, async (shape) => {
      const { engine, protocol } = await composition(order);
      Object.assign(engine, {
        getDefaultDriverName: () => 'remote',
        getDriverByName: () => ({ supports: { transactionsUnsupported: true } }),
      });
      const LATER = 'qa_zz_refused_later';
      const publishOne = (protocol as unknown as { publishMetaItem(req: Record<string, unknown>): Promise<unknown> }).publishMetaItem;
      if (shape === 'edited') {
        expect(await save(protocol, { type: 'permission', name: N, item: setOf('cap_hr_v1'), packageId: HR, mode: 'draft' })).toBeNull();
        expect(await publishOne.call(protocol, { type: 'permission', name: N, packageId: HR }).then(() => null, (e: unknown) => e)).toBeNull();
      }
      const activeBefore = metaRowsOf(engine).filter((r) => r.state === 'active').map((r) => r.metadata);
      expect(await save(protocol, { type: 'permission', name: N, item: setOf('cap_hr'), packageId: HR, mode: 'draft' })).toBeNull();
      expect(await save(protocol, { type: 'permission', name: LATER, item: { ...setOf('cap_later'), name: LATER }, packageId: HR, mode: 'draft' })).toBeNull();
      const draftOf = (name: string) => metaRowsOf(engine).find((r) => r.name === name && r.state === 'draft');
      const draftBefore = { metadata: draftOf(N)?.metadata, checksum: draftOf(N)?.checksum };
      expect(draftBefore.metadata).toBeDefined();

      // The later promotion's write is refused after hr's N was promoted.
      const host = protocol as unknown as {
        promoteDraftForPublish(req: { name: string; judgeOnly?: boolean }): Promise<unknown>;
        publishPackageDrafts(req: { packageId: string }): Promise<{ outcome: string; failed: Array<{ name: string; code?: string }> }>;
      };
      const real = host.promoteDraftForPublish.bind(host);
      const promoted: string[] = [];
      host.promoteDraftForPublish = async (req) => {
        if (!req.judgeOnly) {
          if (req.name === LATER) throw Object.assign(new Error('conflict'), { code: 'METADATA_CONFLICT', status: 409 });
          promoted.push(req.name);
        }
        return real(req);
      };

      const res = await host.publishPackageDrafts({ packageId: HR });

      expect(promoted, 'hr\'s N is promoted before the refused write').toEqual([N]);
      expect(res.outcome).toBe('refused');
      expect(res.failed.find((f) => f.name === N)?.code, 'undone, not reported live').toBe('BATCH_ABORTED');
      expect(metaRowsOf(engine).filter((r) => r.state === 'active').map((r) => r.metadata), 'the active row is as before the publish').toEqual(activeBefore);
      expect(metaRowsOf(engine).filter((r) => r.state === 'draft').map((r) => String(r.name)).sort()).toEqual([N, LATER]);
      expect({ metadata: draftOf(N)?.metadata, checksum: draftOf(N)?.checksum }).toEqual(draftBefore);
    }, 30_000);

    it(`${order}: the lock gate judges the same relations: hr's own set passes, every override of crm's set is locked`, async () => {
      const { gate } = await composition(order);
      expect(await gate(HR)).toBeNull();
      for (const packageId of [undefined, CRM, CRM_PAIR, CRM_TWO]) {
        const err = await gate(packageId);
        expect(err, `the lock for ${packageId ?? 'no package'}`).toBeInstanceOf(PackagedPermissionSetLockedError);
        expect(err).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
      }
    }, 30_000);
  }
});

// [#34401] A rollback, a commit revert and a package rollback of hr's own set N
// write the row bound to hr, so they judge it as hr's save does: a runtime item
// to hr, never an override of crm's shipped N. A delete of it says what it did.
describe('[#34401] restoring or deleting a package\'s own set N beside another namespace\'s shipped N', () => {
  type Proto = {
    saveMetaItem(req: Record<string, unknown>): Promise<unknown>;
    rollbackMetaItem(req: Record<string, unknown>): Promise<unknown>;
    publishPackageDrafts(req: Record<string, unknown>): Promise<{ commitId?: string; failed?: unknown[] }>;
    revertCommit(req: Record<string, unknown>): Promise<{ success: boolean; failed: Array<{ name: string; code?: string }> }>;
    rollbackToPackageCommit(req: Record<string, unknown>): Promise<{ success: boolean; failed: unknown[] }>;
    deleteMetaItem(req: Record<string, unknown>): Promise<{ success: boolean; reset?: boolean; message?: string }>;
  };
  type Engine = Awaited<ReturnType<typeof composition>>['engine'];
  const settle = <T>(p: Promise<T>) => p.then((v) => ({ ok: v, err: null as unknown }), (e: unknown) => ({ ok: undefined as T | undefined, err: e }));
  const envelope = (err: unknown) => [(err as { code?: unknown } | null)?.code, (err as { status?: unknown } | null)?.status];
  const activeCaps = (engine: Engine) => metaRowsOf(engine)
    .filter((r) => r.state === 'active')
    .map((r) => ({ package_id: r.package_id, caps: (JSON.parse(String(r.metadata)) as { systemPermissions?: string[] }).systemPermissions }));
  /** Every stored row and history entry of N moved to `binding`, as a row stored before the seal would be bound. */
  const rebind = (engine: Engine, binding: string | null) => {
    for (const [key, row] of engine.rows) if (row.__table === 'sys_metadata') engine.rows.set(key, { ...row, package_id: binding });
    for (const h of engine.historyRows) h.package_id = binding;
  };

  /** hr's own N saved at v1, then edited to v2, each a save addressed to hr. */
  async function savedTwice(order: Order, shippers?: readonly string[]) {
    const c = await composition(order, shippers);
    const p = c.protocol as unknown as Proto;
    expect(await save(p, { type: 'permission', name: N, item: setOf('cap_hr_v1'), packageId: HR })).toBeNull();
    expect(await save(p, { type: 'permission', name: N, item: setOf('cap_hr_v2'), packageId: HR })).toBeNull();
    expect(activeCaps(c.engine)).toEqual([{ package_id: HR, caps: ['cap_hr_v2'] }]);
    return { ...c, p };
  }

  /** hr's own N published at v1 (commit one), then edited and published at v2 (commit two). */
  async function publishedTwice(order: Order, shippers?: readonly string[]) {
    const c = await composition(order, shippers);
    const p = c.protocol as unknown as Proto;
    const commits: string[] = [];
    for (const cap of ['cap_hr_v1', 'cap_hr_v2']) {
      expect(await save(p, { type: 'permission', name: N, item: setOf(cap), packageId: HR, mode: 'draft' })).toBeNull();
      const res = await p.publishPackageDrafts({ packageId: HR });
      expect(res.commitId, JSON.stringify(res)).toEqual(expect.any(String));
      commits.push(res.commitId!);
    }
    expect(activeCaps(c.engine)).toEqual([{ package_id: HR, caps: ['cap_hr_v2'] }]);
    return { ...c, p, commits };
  }

  for (const order of ORDERS) {
    it(`${order}: rolling back hr's own N to v1 restores v1, and hr's grant confers it (FROM 403 NOT_OVERRIDABLE)`, async () => {
      const { engine, registry, p } = await savedTwice(order);
      const { err } = await settle(p.rollbackMetaItem({ type: 'permission', name: N, toVersion: 1, packageId: HR }));
      expect(err).toBeNull();
      expect(activeCaps(engine)).toEqual([{ package_id: HR, caps: ['cap_hr_v1'] }]);
      expect({ crm: await confers(registry, CRM), hr: await confers(registry, HR) }).toEqual({ crm: ['cap_crm_shipped'], hr: ['cap_hr_v1'] });
    }, 30_000);

    it(`${order}: reverting hr's commit that edited N restores v1 (FROM N in failed[] with NOT_OVERRIDABLE)`, async () => {
      const { engine, registry, p, commits } = await publishedTwice(order);
      const res = await p.revertCommit({ commitId: commits[1], packageId: HR });
      expect(res.failed).toEqual([]);
      expect(res.success).toBe(true);
      expect(activeCaps(engine)).toEqual([{ package_id: HR, caps: ['cap_hr_v1'] }]);
      expect(await confers(registry, HR)).toEqual(['cap_hr_v1']);
    }, 30_000);

    it(`${order}: rolling hr back to its earlier commit restores v1 (FROM the revert failed)`, async () => {
      const { engine, p, commits } = await publishedTwice(order);
      const res = await p.rollbackToPackageCommit({ commitId: commits[0], packageId: HR });
      expect(res.failed).toEqual([]);
      expect(res.success).toBe(true);
      expect(activeCaps(engine)).toEqual([{ package_id: HR, caps: ['cap_hr_v1'] }]);
    }, 30_000);

    it(`${order}: with crm AND fin shipping N, the rollback and the commit revert still restore: every shipper is judged`, async () => {
      const saved = await savedTwice(order, [CRM, FIN]);
      expect((await settle(saved.p.rollbackMetaItem({ type: 'permission', name: N, toVersion: 1, packageId: HR }))).err).toBeNull();
      expect(activeCaps(saved.engine)).toEqual([{ package_id: HR, caps: ['cap_hr_v1'] }]);
      const published = await publishedTwice(order, [FIN, CRM]);
      expect((await published.p.revertCommit({ commitId: published.commits[1], packageId: HR })).failed).toEqual([]);
      expect(activeCaps(published.engine)).toEqual([{ package_id: HR, caps: ['cap_hr_v1'] }]);
    }, 30_000);

    // Rows of N bound to an address that overrides crm's shipped set cannot be saved
    // there; each case stores hr's rows, then rebinds them, as a row stored before
    // the seal would be. The restore into each is refused as it was, nothing written.
    // Each envelope is the one main answered, measured before this change: the
    // restore's seal for crm and its pair, and a refusal judged ahead of it for
    // the rest (the one-name-per-namespace rule, and a package-less address).
    it.each([
      ['bound to no package', null, [CRM], ['RESOURCE_CONFLICT', 409]],
      ['bound to crm', CRM, [CRM], ['NOT_OVERRIDABLE', 403]],
      ['bound to crm\'s customization pair (another namespace)', CRM_PAIR, [CRM], ['NOT_OVERRIDABLE', 403]],
      ['bound to a co-owner of crm\'s namespace', CRM_TWO, [CRM], ['NAMESPACE_CONFLICT', 422]],
      ['bound to a co-owner of fin\'s namespace, fin also shipping', CRM_TWO, [FIN, CRM], ['NAMESPACE_CONFLICT', 422]],
    ] as const)(`${order}: CONTROL — a rollback of N %s is refused as before`, async (_how, binding, shippers, expected) => {
      const { engine, p } = await savedTwice(order, shippers);
      rebind(engine, binding);
      const { err } = await settle(p.rollbackMetaItem({ type: 'permission', name: N, toVersion: 1, ...(binding ? { packageId: binding } : {}) }));
      expect(envelope(err)).toEqual(expected);
      expect(activeCaps(engine)).toEqual([{ package_id: binding, caps: ['cap_hr_v2'] }]);
    }, 30_000);

    it.each([
      ['bound to no package', null, [CRM], 'NAMESPACE_CONFLICT'],
      ['bound to crm', CRM, [CRM], 'NOT_OVERRIDABLE'],
      ['bound to crm\'s customization pair (another namespace)', CRM_PAIR, [CRM], 'NOT_OVERRIDABLE'],
      ['bound to a co-owner of crm\'s namespace', CRM_TWO, [CRM], 'NAMESPACE_CONFLICT'],
      ['bound to a co-owner of fin\'s namespace, fin also shipping', CRM_TWO, [FIN, CRM], 'NAMESPACE_CONFLICT'],
    ] as const)(`${order}: CONTROL — a revert of a commit of N %s fails N as before`, async (_how, binding, shippers, code) => {
      const { engine, p, commits } = await publishedTwice(order, shippers);
      rebind(engine, binding);
      for (const row of engine.rows.values()) if (row.__table === 'sys_metadata_commit') row.package_id = binding;
      const res = await p.revertCommit({ commitId: commits[1] });
      expect(res.failed.map((f) => [f.name, f.code])).toEqual([[N, code]]);
      expect(activeCaps(engine)).toEqual([{ package_id: binding, caps: ['cap_hr_v2'] }]);
    }, 30_000);

    it(`${order}: deleting hr's own N removes hr's set and says so, never "reset to artifact default" (FROM the reset receipt)`, async () => {
      const { engine, registry, p } = await savedTwice(order);
      const res = await p.deleteMetaItem({ type: 'permission', name: N, packageId: HR });
      expect(res.success).toBe(true);
      // `reset` is "a row was deleted" (DeleteMetaItemResponseSchema): one was.
      expect(res.reset).toBe(true);
      expect(res.message).toMatch(new RegExp(`^Deleted permission '${N}' \\(package=${HR.replace(/\./g, '\\.')}\\) — it no longer exists\\.`));
      expect(metaRowsOf(engine)).toEqual([]);
      expect(await confers(registry, CRM)).toEqual(['cap_crm_shipped']);
    }, 30_000);

    it(`${order}: a delete naming hr when hr holds no N answers that nothing was found, never "already at artifact default" (FROM the reset receipt)`, async () => {
      const { protocol } = await composition(order);
      const res = await (protocol as unknown as Proto).deleteMetaItem({ type: 'permission', name: N, packageId: HR });
      expect([res.success, res.reset, res.message]).toEqual([true, false, `No permission '${N}' found — nothing to delete.`]);
    }, 30_000);

    it(`${order}: CONTROL — deleting the customization of crm's N stored for crm's pair still reads as a reset to the artifact default`, async () => {
      const { engine, p } = await savedTwice(order);
      rebind(engine, CRM_PAIR);
      const res = await p.deleteMetaItem({ type: 'permission', name: N, packageId: CRM_PAIR });
      expect(res.success).toBe(true);
      expect(res.reset).toBe(true);
      expect(res.message).toContain('reset to artifact default');
    }, 30_000);
  }
});
