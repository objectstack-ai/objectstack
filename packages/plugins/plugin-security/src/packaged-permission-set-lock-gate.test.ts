// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11843 — the packaged-permission-set lock answers at the METADATA door.
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
 * every persistence path). The refusal cases assert the lock's ERROR CLASS
 * IDENTITY (`instanceof PackagedPermissionSetLockedError`), not only the
 * `code`/`status` envelope: `NOT_OVERRIDABLE`/403 is shared with the ADR-0005
 * tier gate by design, so the class is the only fingerprint that proves WHICH
 * layer answered. And every refusal case asserts the ROW COUNT — the defect
 * this card measured was a write that landed, so "threw" alone is half a pin.
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
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import {
  ObjectStackProtocolImplementation,
  resetEnvWritableMetadataTypes,
} from '@objectstack/metadata-protocol';
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
    `${table}|${String(w.type)}|${String(w.name)}|${String(w.organization_id ?? 'null')}|${String(w.state ?? 'active')}`;
  const findRow = (where: Record<string, unknown>) => {
    if (where.id !== undefined) {
      for (const [k, r] of rows) if (r.id === where.id) return { key: k, row: r };
      return null;
    }
    const k = keyOf(where);
    const r = rows.get(k);
    return r ? { key: k, row: r } : null;
  };
  const declaredItems = [
    { name: PACKAGED_SET, label: 'Support Agent', _packageId: PKG, objects: {} },
    { name: SHADOW_SET, label: 'Drafted', _packageId: 'sys_metadata', objects: {} },
  ];
  return {
    rows,
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
    async find(table: string, _opts: { where: Record<string, unknown> }) {
      if (table === 'sys_metadata_history') return historyRows;
      return Array.from(rows.values());
    },
    async findOne(table: string, opts2: { where: Record<string, unknown> }) {
      if (table === 'sys_metadata_history') return null;
      return findRow(opts2.where)?.row ?? null;
    },
    async insert(table: string, data: Record<string, unknown>) {
      if (table === 'sys_metadata_history') {
        const h: Row = { ...data };
        if (!h.id) h.id = `h_${historyRows.length + 1}`;
        historyRows.push(h);
        return { id: h.id as string };
      }
      const k = keyOf(data, table);
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

  it('hatch OPEN: a package-less save targeting a package-declared set is refused by the LOCK, and no row lands', async () => {
    const { engine, protocol, wired } = boot();
    expect(wired).toBe(true);
    openHatch();

    const err = await save(protocol, { type: 'permission', name: PACKAGED_SET, item: body(PACKAGED_SET) });

    // Class identity is the layer fingerprint — the ADR-0005 tier gate shares
    // this code and status, but only the lock constructs this class.
    expect(err).toBeInstanceOf(PackagedPermissionSetLockedError);
    expect(err).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    expect((err as Error).message).toContain(PKG);
    // The defect was a write that LANDED — the throw alone is half the pin.
    expect(metaRowsOf(engine)).toEqual([]);
  }, 30_000);

  it('hatch CLOSED: the identical save is refused by the same lock — the refusal does not depend on the hatch', async () => {
    const { engine, protocol } = boot();

    const err = await save(protocol, { type: 'permission', name: PACKAGED_SET, item: body(PACKAGED_SET) });

    expect(err).toBeInstanceOf(PackagedPermissionSetLockedError);
    expect(err).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    expect(metaRowsOf(engine)).toEqual([]);
  }, 30_000);

  it('hatch OPEN: a DRAFT save of the packaged name is refused too — the seam gates both minting paths', async () => {
    const { engine, protocol } = boot();
    openHatch();

    const err = await save(protocol, {
      type: 'permission', name: PACKAGED_SET, item: body(PACKAGED_SET), mode: 'draft',
    });

    expect(err).toBeInstanceOf(PackagedPermissionSetLockedError);
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
    expect(rows[0]).toMatchObject({ package_id: null, organization_id: null });
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
