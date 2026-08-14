// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';
// [#4550 / #5480] The producer's OWN write-verb dispatch decisions, so the
// engine double below cannot accept a call `ObjectQL.delete` / `ObjectQL.update`
// refuses — a double looser than the implementation is no test at all.
import { assertEngineDeleteDispatch } from './engine-delete-dispatch.js';
import { assertEngineUpdateDispatch } from './engine-update-dispatch.js';

/**
 * #6808 — deleting an `object` must stop BOTH registry exits serving it.
 *
 * `deleteMetaItem` ends its repository delete with `restoreArtifactRegistryView`
 * (the #6687 three-tier heal). That walk operates entirely on `SchemaRegistry`'s
 * generic `metadata` map — `removeRuntimeShadow`, `registerItem` and
 * `removeOverlayEntry` all address `this.metadata.get(type)`. An `object`,
 * though, is written into TWO places by `applyObjectRegistryMutation`:
 *
 *   registry.registerItem('object', item, 'name')            → metadata map
 *   registry.registerObject({ …item, _provenance: 'org' }, …) → objectContributors
 *
 * The heal only undid the first. Measured on `origin/main` with this file's
 * harness (the real `SysMetadataRepository` over an in-memory engine):
 *
 *   BEFORE delete: metadata['object'] -> ["myapp_invoice"] | contributors -> ["myapp_invoice"]
 *   AFTER  delete: metadata['object'] -> []                | contributors -> ["myapp_invoice"]
 *   registry.getObject('myapp_invoice')        -> STILL SERVED
 *   registry.getItem('object','myapp_invoice') -> STILL SERVED  (it special-cases back to getObject)
 *
 * The surviving half is the load-bearing one: `getObject` is what the data
 * plane dispatches on (`assertObjectRegistered`), so the `sys_metadata` row was
 * gone while the object stayed resolvable — and writable — for the life of the
 * process. Reachable on the ordinary Studio delete path.
 *
 * The fix is a name-addressed removal verb on the registry
 * (`SchemaRegistry.unregisterObject`, honouring ADR-0029's single-owner /
 * extender rules) called from the heal's tier-3 branch — the tier that has
 * already established no lower layer serves the name.
 */

const APP_PKG = 'app.myapp';

const invoiceBody = (name: string) => ({
  name,
  label: 'Invoice',
  fields: {
    name: { name: 'name', type: 'text', label: 'Name' },
    amount: { name: 'amount', type: 'number', label: 'Amount' },
  },
});

/** ADR-0048: the overlay key includes `package_id`, so the double keys on it too. */
const rowKey = (w: Record<string, unknown>) =>
  [w.type, w.name, w.organization_id ?? '', w.package_id ?? '', w.state ?? 'active'].join('|');

const matchesWhere = (row: Record<string, unknown>, where: Record<string, unknown>) =>
  Object.entries(where ?? {}).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });

/**
 * In-memory `sys_metadata` + `sys_metadata_history` engine carrying a REAL
 * `SchemaRegistry`, plus a data-plane `insert` so the CRUD-refusal pin below
 * measures a write that genuinely dispatched before the delete.
 */
function makeHarness(opts: { controlPlane?: boolean } = {}) {
  const environmentId: string | undefined = opts.controlPlane === true ? undefined : 'env_test';
  const registry = new SchemaRegistry({ multiTenant: false });
  (registry as any).logLevel = 'silent';
  const rows = new Map<string, any>();
  const historyRows: any[] = [];
  const dataRows: any[] = [];
  let nextId = 0;

  const findRow = (w: Record<string, unknown>) => {
    for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
    return null;
  };

  const engine: any = {
    registry,
    async findOne(table: string, o: { where: Record<string, unknown> }) {
      if (table === 'sys_metadata_history') return historyRows.find((h) => matchesWhere(h, o.where)) ?? null;
      if (table !== 'sys_metadata') return null;
      return findRow(o.where)?.row ?? null;
    },
    async find(table: string, o: { where: Record<string, unknown> }) {
      if (table === 'sys_metadata_history') return historyRows.filter((h) => matchesWhere(h, o.where));
      if (table !== 'sys_metadata') return [];
      return Array.from(rows.values()).filter((r) => matchesWhere(r, o.where));
    },
    async insert(table: string, data: Record<string, unknown>) {
      if (table === 'sys_metadata_history') {
        const h = { id: `h_${++nextId}`, ...(data as any) };
        historyRows.push(h);
        return { id: h.id };
      }
      if (table !== 'sys_metadata') {
        // The data plane: a real write for a real (registered) object. Platform
        // side tables (`sys_metadata_commit`, …) are NOT data-plane rows — counting
        // them here would make the CRUD pin below measure metadata bookkeeping.
        const rec = { id: `rec_${++nextId}`, ...(data as any) };
        if (!table.startsWith('sys_')) dataRows.push({ object: table, ...rec });
        return rec;
      }
      const row = { id: `r_${++nextId}`, ...(data as any) };
      rows.set(rowKey(data), row);
      return { id: row.id };
    },
    async update(table: string, data: Record<string, unknown>, o: { where: Record<string, unknown> }) {
      assertEngineUpdateDispatch(data, o);
      if (table !== 'sys_metadata') return { id: null };
      const found = findRow(o.where);
      if (!found) return { id: null };
      const merged = { ...found.row, ...(data as any) };
      rows.delete(found.key);
      rows.set(rowKey(merged), merged);
      return { id: merged.id };
    },
    async delete(table: string, o?: Record<string, unknown>) {
      assertEngineDeleteDispatch(o);
      if (table !== 'sys_metadata') return { deleted: 0 };
      const found = findRow(((o as any)?.where ?? {}) as Record<string, unknown>);
      if (!found) return { deleted: 0 };
      rows.delete(found.key);
      return { deleted: 1 };
    },
    async syncObjectSchema() { /* no physical storage in this double */ },
  };

  const protocol = new ObjectStackProtocolImplementation(engine, undefined, environmentId);
  return { protocol, engine, registry, rows, dataRows };
}

/** The first-build shape: a runtime-CREATED object, authored once through Studio. */
async function seedCreatedObject(protocol: any, name: string, packageId?: string) {
  await protocol.saveMetaItem({
    type: 'object', name, ...(packageId ? { packageId } : {}), item: invoiceBody(name),
  });
}

/** The generic `metadata` map's plain-key entry — the LISTING half. */
const plainKeyEntry = (registry: SchemaRegistry, name: string) =>
  Array.from(
    ((registry as any).metadata as Map<string, Map<string, unknown>>).get('object')?.keys() ?? [],
  ).includes(name);

const storedRows = (rows: Map<string, any>, name: string) =>
  Array.from(rows.values()).filter((r) => r.name === name);

describe('#6808 — deleteMetaItem stops BOTH registry exits serving a deleted object', () => {
  it('the object is gone from getObject AND getItem, not just from the listing map', async () => {
    const { protocol, registry, rows } = makeHarness();
    await seedCreatedObject(protocol, 'myapp_invoice', APP_PKG);

    // Both halves are live before the delete — otherwise "gone" below could be
    // true for the empty reason.
    expect(plainKeyEntry(registry, 'myapp_invoice')).toBe(true);
    expect(registry.getObject('myapp_invoice')).toBeDefined();
    expect(registry.getItem('object', 'myapp_invoice')).toBeDefined();

    const res = await protocol.deleteMetaItem({ type: 'object', name: 'myapp_invoice' });

    expect(res.success).toBe(true);
    expect(storedRows(rows, 'myapp_invoice')).toHaveLength(0);
    // Already green pre-fix — the half the heal always reached.
    expect(plainKeyEntry(registry, 'myapp_invoice')).toBe(false);
    // THE LINES THAT WERE RED: `objectContributors` kept the object, so the
    // surface data CRUD dispatches on kept serving it.
    expect(registry.getObject('myapp_invoice')).toBeUndefined();
    expect(registry.getItem('object', 'myapp_invoice')).toBeUndefined();
    // …and the listing verb agrees with both.
    expect(registry.getAllObjects().map((o: any) => o.name)).not.toContain('myapp_invoice');
  });

  /**
   * The consequence, stated as the thing an operator would actually hit: the
   * data plane kept accepting writes to a deleted object. `assertObjectRegistered`
   * (#3770) reads `registry.getObject`, so the surviving contributor entry was a
   * live write door. Asserted by REFUSAL IDENTITY (`OBJECT_NOT_FOUND` / 404),
   * never a bare `toThrow` — a throw for any other reason would pass that.
   */
  it('data CRUD dispatched before the delete and is REFUSED after it (OBJECT_NOT_FOUND/404)', async () => {
    const { protocol, dataRows } = makeHarness();
    await seedCreatedObject(protocol, 'myapp_invoice', APP_PKG);

    const created = await protocol.createData({
      object: 'myapp_invoice', data: { name: 'INV-1', amount: 10 },
    });
    expect(created.id).toBeTruthy();
    expect(dataRows).toHaveLength(1);

    await protocol.deleteMetaItem({ type: 'object', name: 'myapp_invoice' });

    const err = await protocol
      .createData({ object: 'myapp_invoice', data: { name: 'INV-2', amount: 20 } })
      .then(() => null, (e: any) => e);
    // Pre-fix this write SUCCEEDED — rows into a table whose metadata is gone.
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('OBJECT_NOT_FOUND');
    expect(err.status).toBe(404);
    expect(err.object).toBe('myapp_invoice');
    expect(dataRows).toHaveLength(1);
  });

  /**
   * The tier discipline the fix must NOT break. The removal fires only in the
   * heal's tier 3 ("no layer serves this name"); tiers 1 and 2 concluded a lower
   * layer still does, and an object that is still served must stay registered —
   * `assertObjectRegistered` fails CLOSED, so retiring it there would turn
   * "reset to artifact default" into a data-plane outage.
   *
   * Seed order is deliberate: the packaged artifact is registered AFTER the
   * overlay save. Registered first, its package provenance would make
   * `isArtifactBacked` true and `saveMetaItem`'s overlay gate would refuse the
   * write outright (`object` is `allowOrgOverride: false`), so there would be no
   * overlay to delete and the pin would measure nothing.
   */
  it('an object whose overlay shadows a packaged artifact STAYS registered (tier 1)', async () => {
    const { protocol, registry, rows } = makeHarness();
    await seedCreatedObject(protocol, 'myapp_invoice', APP_PKG);
    // The code package's own artifact, under its composite key.
    (registry as any).registerItem('object', invoiceBody('myapp_invoice'), 'name', APP_PKG);

    await protocol.deleteMetaItem({ type: 'object', name: 'myapp_invoice' });

    expect(storedRows(rows, 'myapp_invoice')).toHaveLength(0);
    // Tier 1 healed by un-shadowing, so the name is still served — by the
    // artifact. Removing the contributor here would have made the shipped
    // object unreachable for data CRUD.
    expect(registry.getObject('myapp_invoice')).toBeDefined();
  });

  /**
   * The provenance refusal, measured against a REAL registry — and the reason
   * it is not theoretical for objects. `engine.registerApp` registers a code
   * package's objects straight into `objectContributors` and never writes the
   * generic `metadata` map, so `isArtifactBacked` cannot see them (tier 1 has
   * no composite entry to find either) and an overlay row for such a name can
   * still be authored. Without this refusal the heal would reach tier 3 and
   * take a shipped object off the data plane until restart — a strictly worse
   * bug than the one being fixed, which is the same argument
   * `removeOverlayEntry` records for its own artifact refusal.
   *
   * ADR-0010 `_provenance` is the axis: both paths that register a TENANT's
   * object (`applyObjectRegistryMutation` and the boot rehydration) stamp
   * `'org'` server-side; a loader-introduced artifact carries `'package'`.
   */
  it('a CODE-SHIPPED object survives the delete of a same-named row', async () => {
    // The reachable shape, and the reason this is not covered by the gates in
    // front of the heal. `deleteMetaItem`'s two-tier authorization refuses an
    // artifact-backed `object` with `NOT_OVERRIDABLE` (pinned below) but runs
    // only when `environmentId !== undefined`; on a CONTROL-PLANE kernel the
    // repository's own `assertAllowed` refuses it instead — except on the
    // NO-ROW leg, which never reaches the repository's write verb at all. That
    // leg still runs the heal (deliberately: "a stale shadow can outlive the
    // row it came from"), so the walk arrives for a name a code package ships.
    const { protocol, registry, rows } = makeHarness({ controlPlane: true });
    // The package's object, as `registerApp` registers it: contributors only,
    // no composite `metadata` entry — so tier 1 finds no shadow to lift, and
    // with no MetadataService here tier 2 finds no baseline either. The walk
    // reaches tier 3 with the object still shipped.
    registry.registerObject(
      { ...invoiceBody('myapp_invoice'), _packageId: APP_PKG, _provenance: 'package' } as any,
      APP_PKG,
    );
    expect((registry.getObject('myapp_invoice') as any)._provenance).toBe('package');

    const res = await protocol.deleteMetaItem({ type: 'object', name: 'myapp_invoice' });

    expect(res.success).toBe(true);
    expect(res.reset).toBe(false); // nothing to delete — no overlay row exists
    expect(storedRows(rows, 'myapp_invoice')).toHaveLength(0);
    // THE OBJECT SURVIVES — the package still ships it, and unregistering code
    // the overlay delete never touched would be a worse bug than the one fixed.
    expect(registry.getObject('myapp_invoice')).toBeDefined();
    expect((registry.getObject('myapp_invoice') as any)._provenance).toBe('package');
  });

  /**
   * …and on a TENANT kernel the same delete never reaches the heal at all: the
   * two-tier authorization refuses it first. Pinned as the pair of the case
   * above so the tier-3 refusal is not mistaken for the only thing standing
   * between a code package's object and this walk — and so a future change to
   * either gate cannot quietly leave the pair with no protection.
   */
  it('the same delete on a tenant kernel is refused before the heal (NOT_OVERRIDABLE)', async () => {
    const { protocol, registry } = makeHarness();
    await seedCreatedObject(protocol, 'myapp_invoice', APP_PKG);
    registry.registerObject(
      { ...invoiceBody('myapp_invoice'), _packageId: APP_PKG, _provenance: 'package' } as any,
      APP_PKG,
    );

    const err = await protocol
      .deleteMetaItem({ type: 'object', name: 'myapp_invoice' })
      .then(() => null, (e: any) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('NOT_OVERRIDABLE');
    expect(registry.getObject('myapp_invoice')).toBeDefined();
  });

  /**
   * ADR-0029 — the extender guard, at the delete seam. An extension is merged
   * into the owner's definition (`resolveObject`), so tearing the owner out from
   * under a live extender leaves contributions that resolve to nothing: the
   * "has extenders but no owner" violation `assertSingleOwnerPerObject` exists
   * to catch, reached at runtime instead of at bootstrap.
   *
   * The heal is best-effort and runs AFTER the repository delete has committed,
   * so it cannot propagate the refusal — the row is gone either way. What it
   * must not do is swallow it: the refusal is caught and logged by name, so a
   * runtime that disagrees with `sys_metadata` is visible rather than inferred.
   */
  it('refuses to unregister an object another package still extends, naming the extender', async () => {
    const { protocol, registry, rows } = makeHarness();
    await seedCreatedObject(protocol, 'myapp_invoice', APP_PKG);
    registry.registerObject(
      { name: 'myapp_invoice', fields: { note: { name: 'note', type: 'text' } } } as any,
      'app.addon', undefined, 'extend',
    );

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let res: any;
    let warned: string[];
    try {
      res = await protocol.deleteMetaItem({ type: 'object', name: 'myapp_invoice' });
    } finally {
      // Read the calls BEFORE restoring: `mockRestore` also resets the mock's
      // recorded state, so a spy asserted after it always reads empty.
      warned = warn.mock.calls.map((c) => String(c[0]));
      warn.mockRestore();
    }

    // The delete itself still succeeds — the row really is gone.
    expect(res.success).toBe(true);
    expect(storedRows(rows, 'myapp_invoice')).toHaveLength(0);
    // …and the extended object is NOT torn down under its extender.
    expect(registry.getObject('myapp_invoice')).toBeDefined();
    expect(registry.getObjectOwner('myapp_invoice')?.packageId).toBe(APP_PKG);
    // The refusal is loud and names who is depending on it — not swallowed by
    // the heal's silent outer catch.
    const refusals = warned.filter((m) => m.includes('stays registered'));
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('app.addon');
    expect(refusals[0]).toContain('myapp_invoice');
  });

  /**
   * The same delete with the extender gone succeeds — the guard is a guard, not
   * a blanket refusal. Stated as a pair with the case above so a fix that simply
   * never removes anything cannot satisfy both.
   */
  it('the same object with no extenders is unregistered', async () => {
    const { protocol, registry } = makeHarness();
    await seedCreatedObject(protocol, 'myapp_invoice', APP_PKG);
    registry.registerObject(
      { name: 'myapp_invoice', fields: { note: { name: 'note', type: 'text' } } } as any,
      'app.addon', undefined, 'extend',
    );
    // The extender uninstalls first, the way the guard's message tells it to.
    registry.unregisterObjectsByPackage('app.addon');

    await protocol.deleteMetaItem({ type: 'object', name: 'myapp_invoice' });

    expect(registry.getObject('myapp_invoice')).toBeUndefined();
    expect(registry.getItem('object', 'myapp_invoice')).toBeUndefined();
  });

  /**
   * The plural spelling reaches the same limb. `canonicalizeMetaRequestType`
   * folds `objects` → `object` at the top of `deleteMetaItem`, and the heal
   * re-folds through `PLURAL_TO_SINGULAR`; the removal keys off the SINGULAR, so
   * neither spelling can miss it (#4432's "every surface in agreement").
   */
  it('the plural `objects` spelling heals identically', async () => {
    const { protocol, registry } = makeHarness();
    await seedCreatedObject(protocol, 'myapp_invoice', APP_PKG);

    await protocol.deleteMetaItem({ type: 'objects', name: 'myapp_invoice' });

    expect(registry.getObject('myapp_invoice')).toBeUndefined();
    expect(registry.getItem('object', 'myapp_invoice')).toBeUndefined();
  });

  /**
   * A control-plane kernel (`environmentId === undefined`) runs the same walk —
   * the tier-2 MetadataService re-registration is the only control-plane-gated
   * step, and it is not this limb. Pinned because the sibling caller
   * (`revertCommit`'s soft-remove) is only reachable on that kernel in the
   * parity pins of `protocol-commit-history.test.ts`.
   */
  it('a control-plane kernel heals both halves too', async () => {
    const { protocol, registry } = makeHarness({ controlPlane: true });
    await seedCreatedObject(protocol, 'myapp_invoice', APP_PKG);
    expect(registry.getObject('myapp_invoice')).toBeDefined();

    await protocol.deleteMetaItem({ type: 'object', name: 'myapp_invoice' });

    expect(registry.getObject('myapp_invoice')).toBeUndefined();
    expect(plainKeyEntry(registry, 'myapp_invoice')).toBe(false);
  });
});
