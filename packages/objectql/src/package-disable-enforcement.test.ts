// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';
// [#4550 / #5480] The producer's OWN write-verb dispatch decisions, so the
// engine double cannot accept a call `ObjectQL.delete` / `ObjectQL.update`
// refuses — a double looser than the implementation is no test at all.
import { assertEngineDeleteDispatch } from './engine-delete-dispatch.js';
import { assertEngineUpdateDispatch } from './engine-update-dispatch.js';

/**
 * #7557 (A) — disabling a package must reach the metadata listing and the data
 * plane, not just nav and views.
 *
 * Measured on `origin/main` against a real running server (showcase app, a
 * runtime-installed package with three `sys_metadata`-bound objects and three
 * rows), BEFORE the fix:
 *
 *   PATCH /packages/<id>/disable            -> 200, status='disabled'
 *   GET   /api/v1/data/<object>             -> 200, rows=3     ← served anyway
 *   GET   /api/v1/meta/objects              -> object STILL listed
 *   nav / views                             -> correctly gone
 *
 * So `status` was consulted by SOME readers and skipped by others. The skip was
 * deliberate on both sides and both sides gave the same reason: `listItems`
 * returns early for `object`/`objects` before reaching its disable filter
 * (`registry.ts`), and `getMetaItems` exempted the same two types explicitly,
 * "filtering objects would break data queries that depend on their schema".
 *
 * That reason conflated two different readers, which is what this file pins
 * apart. There are two classes of object reader and they must answer
 * DIFFERENTLY:
 *
 *   - RESOLUTION readers — `registry.getObject`, `registry.listItems('object')`
 *     — keep serving a disabled package's objects. Disable is reversible and
 *     destroys no data; migrations, cross-package references and the runtime
 *     authoring gate's object universe all resolve through these, and blanking
 *     them would break authoring that has nothing to do with the disabled
 *     package. This is the honest negative the card asked to preserve.
 *
 *   - API readers — `getMetaItems` (the `/meta/*` listing) and the data plane
 *     (`assertObjectRegistered`, which every `findData`/`getData` entry point
 *     funnels through) — must stop. Absence in the listing and refusal on the
 *     data plane are two halves of ONE answer.
 *
 * ONE test walks EVERY reader (`READERS` below) rather than one test per
 * surface: this bug IS a divergence between readers of a shared predicate, so a
 * new reader that forgets to consult it has to fail here. Adding a reader means
 * adding a row to that table and stating which class it is in.
 *
 * The data-plane refusal is asserted on `code` + `status` (ADR-0112), never on
 * "it threw": a bare `OBJECT_NOT_FOUND` would satisfy "it threw" while sending
 * a caller — an AI agent especially — hunting for a typo or re-creating an
 * object that is merely switched off.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Reverting `getMetaItems`' filter to its `request.type !== 'object' &&
 * request.type !== 'objects'` form turns the `/meta` listing rows red and
 * leaves every resolution row green. Removing the `isObjectPackageDisabled`
 * branch from `assertObjectRegistered` turns the data-plane rows red the same
 * way. Neither touches the other, which is the point of splitting them: the two
 * halves of the enforcement are independently pinned, and the resolution rows
 * are the control that keeps a future "fix" from over-reaching into the
 * registry primitives.
 */

const PKG = 'app.disabled_demo';
const OTHER_PKG = 'app.healthy_demo';

const objectBody = (name: string) => ({
  name,
  label: 'Demo',
  fields: {
    name: { name: 'name', type: 'text', label: 'Name' },
  },
});

const rowKey = (w: Record<string, unknown>) =>
  [w.type, w.name, w.organization_id ?? '', w.package_id ?? '', w.state ?? 'active'].join('|');

const matchesWhere = (row: Record<string, unknown>, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });

/**
 * In-memory `sys_metadata` engine carrying a REAL `SchemaRegistry` — the
 * predicate under test lives on the registry, so a registry double would be
 * measuring the double.
 */
function makeHarness() {
  const registry = new SchemaRegistry({ multiTenant: false });
  (registry as any).logLevel = 'silent';
  const rows = new Map<string, any>();
  const historyRows: any[] = [];
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
      if (table !== 'sys_metadata') return { id: `rec_${++nextId}`, ...(data as any) };
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

  const protocol = new ObjectStackProtocolImplementation(engine, undefined, 'env_test');
  return { protocol, engine, registry, rows };
}

/**
 * A package that owns an object plus one non-object item, and a SECOND, healthy
 * package that owns its own of each. The healthy package is not decoration: it
 * is what separates "disable hid the right things" from "disable emptied the
 * listing", which every assertion below would otherwise pass for the wrong
 * reason.
 */
async function seed(protocol: any, registry: SchemaRegistry) {
  for (const [pkg, obj, app] of [
    [PKG, 'demo_widget', 'demo_app'],
    [OTHER_PKG, 'healthy_widget', 'healthy_app'],
  ] as const) {
    registry.installPackage({ id: pkg, name: pkg, version: '1.0.0' } as any);
    await protocol.saveMetaItem({ type: 'object', name: obj, packageId: pkg, item: objectBody(obj) });
    // `app` rather than `view` as the non-object specimen: a `view` is saved as
    // an ADR-0017 CONTAINER and only becomes independently listable once the
    // registrar expands it into ViewItems, which this metadata-only harness has
    // no registrar to do — so `getMetaItems({type:'view'})` is legitimately
    // empty here and would make the control assertion pass for the wrong
    // reason. `app` is the same disable-filtered listing without that
    // indirection. (Nav/views are covered end-to-end by the live repro recorded
    // in the PR body.)
    await protocol.saveMetaItem({
      type: 'app',
      name: app,
      packageId: pkg,
      item: { name: app, label: 'Demo App' },
    });
  }
}

const listItemsOf = async (protocol: any, type: string): Promise<any[]> => {
  const res = await protocol.getMetaItems({ type });
  return (Array.isArray(res) ? res : res?.items ?? res?.data ?? []) as any[];
};

const listNames = async (protocol: any, type: string): Promise<string[]> =>
  (await listItemsOf(protocol, type)).map((i) => i?.name).filter(Boolean);

/**
 * Items a listing serves for one package. Counted by `_packageId` rather than
 * by name because `view` is enumerated in its EXPANDED form (ADR-0017 splits a
 * container into independent ViewItems), so the name a listing returns is not
 * necessarily the name it was saved under — while ownership is stable either
 * way, and ownership is exactly what disable keys on.
 */
const servedFor = async (protocol: any, type: string, pkg: string): Promise<number> =>
  (await listItemsOf(protocol, type)).filter((i) => i?._packageId === pkg).length;

/**
 * Every reader of the disable predicate, and the class it belongs to.
 * `enforces: true` = an API reader that must stop serving a disabled package's
 * object. `enforces: false` = a resolution reader that must keep serving it.
 */
const READERS: Array<{
  reader: string;
  enforces: boolean;
  why: string;
  serves: (h: { protocol: any; registry: SchemaRegistry }) => Promise<boolean>;
}> = [
  {
    reader: 'getMetaItems({ type: "object" }) — GET /meta/objects',
    enforces: true,
    why: 'the API listing the console and every SDK client reads',
    serves: async ({ protocol }) => (await listNames(protocol, 'object')).includes('demo_widget'),
  },
  {
    reader: 'getMetaItems({ type: "objects" }) — the plural spelling of the same route',
    enforces: true,
    why: 'folded to the singular before the filter; pinned so the fold cannot silently stop folding',
    serves: async ({ protocol }) => (await listNames(protocol, 'objects')).includes('demo_widget'),
  },
  {
    reader: 'getMetaItems({ type: "app" }) — a NON-object listing that ALREADY honoured disable',
    enforces: true,
    why: 'the pre-existing behaviour the objects half was made consistent with; regression guard',
    serves: async ({ protocol }) => (await servedFor(protocol, 'app', PKG)) > 0,
  },
  {
    reader: 'assertObjectRegistered — the data plane (findData / getData funnel here)',
    enforces: true,
    why: 'the symptom itself: 200 with all rows for a disabled package',
    serves: async ({ protocol }) => {
      try {
        (protocol as any).assertObjectRegistered('demo_widget');
        return true;
      } catch {
        return false;
      }
    },
  },
  {
    reader: 'registry.getObject — object RESOLUTION',
    enforces: false,
    why: 'migrations and cross-package references resolve schema through it; disable destroys no data',
    serves: async ({ registry }) => registry.getObject('demo_widget') !== undefined,
  },
  {
    reader: 'registry.listItems("object") — the runtime authoring gate\'s object universe',
    enforces: false,
    why: 'protocol.ts resolves its reference-validation context here; blanking it breaks unrelated authoring',
    serves: async ({ registry }) =>
      (registry.listItems<any>('object')).some((o) => o?.name === 'demo_widget'),
  },
];

/**
 * Walk EVERY reader and report the whole table in one assertion.
 *
 * Deliberately not `expect()` inside the loop: the first failing reader would
 * throw and the remaining rows would never run, so a change that broke three
 * readers would be indistinguishable from one that broke one — in a file whose
 * entire purpose is showing which readers diverged from each other.
 */
const walk = async (
  h: { protocol: any; registry: SchemaRegistry },
  expected: (r: (typeof READERS)[number]) => boolean,
): Promise<Record<string, boolean>> => {
  const out: Record<string, boolean> = {};
  for (const r of READERS) {
    const label = `${r.reader} → ${expected(r) ? 'serves' : 'refuses'}`;
    out[label] = (await r.serves(h)) === expected(r);
  }
  return out;
};

const allTrue = (rows: Record<string, boolean>): Record<string, boolean> =>
  Object.fromEntries(Object.keys(rows).map((k) => [k, true]));

describe('#7557 (A) — a disabled package stops serving, on every API reader at once', () => {
  it('every reader agrees BEFORE the disable — the control', async () => {
    const h = makeHarness();
    await seed(h.protocol, h.registry);

    const rows = await walk(h, () => true);
    expect(rows).toEqual(allTrue(rows));
  });

  it('after disable: API readers stop, resolution readers keep serving', async () => {
    const h = makeHarness();
    await seed(h.protocol, h.registry);
    h.registry.disablePackage(PKG);

    // `enforces` readers must refuse, resolution readers must keep serving —
    // the two classes asserted in ONE table so a divergence names itself.
    const rows = await walk(h, (r) => !r.enforces);
    expect(rows).toEqual(allTrue(rows));
  });

  it('the healthy package is untouched — disable hid the right things, not everything', async () => {
    const h = makeHarness();
    await seed(h.protocol, h.registry);
    h.registry.disablePackage(PKG);

    expect(await listNames(h.protocol, 'object')).toContain('healthy_widget');
    expect(await servedFor(h.protocol, 'app', OTHER_PKG)).toBeGreaterThan(0);
    expect(() => (h.protocol as any).assertObjectRegistered('healthy_widget')).not.toThrow();
  });

  it('the data-plane refusal is loud: OBJECT_PACKAGE_DISABLED / 404, not a bare not-found', async () => {
    const h = makeHarness();
    await seed(h.protocol, h.registry);
    h.registry.disablePackage(PKG);

    let err: any;
    try {
      (h.protocol as any).assertObjectRegistered('demo_widget');
    } catch (e) {
      err = e;
    }

    // ADR-0112: the assertion is `code` + `status`, never "it threw" — a bare
    // OBJECT_NOT_FOUND would pass "it threw" while telling the caller the wrong
    // thing about a package that is merely switched off.
    expect(err).toBeDefined();
    expect(err.code).toBe('OBJECT_PACKAGE_DISABLED');
    expect(err.status).toBe(404);
    expect(err.object).toBe('demo_widget');
    // The code must be DISTINGUISHABLE from the genuinely-absent case, which is
    // the whole reason it is its own code.
    expect(err.code).not.toBe('OBJECT_NOT_FOUND');
    // …and the message must name the remedy, not just the state.
    expect(String(err.message)).toMatch(/re-enable/i);
  });

  it('an object that is genuinely absent still answers OBJECT_NOT_FOUND', async () => {
    const h = makeHarness();
    await seed(h.protocol, h.registry);
    h.registry.disablePackage(PKG);

    let err: any;
    try {
      (h.protocol as any).assertObjectRegistered('never_existed');
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe('OBJECT_NOT_FOUND');
    expect(err?.status).toBe(404);
  });

  it('re-enable restores every reader — disable is reversible and destroys nothing', async () => {
    const h = makeHarness();
    await seed(h.protocol, h.registry);

    const storedBefore = h.rows.size;

    h.registry.disablePackage(PKG);
    h.registry.enablePackage(PKG);

    const rows = await walk(h, () => true);
    expect(rows).toEqual(allTrue(rows));
    // The card's honest negative, pinned: the disable/enable cycle wrote and
    // destroyed no metadata rows.
    expect(h.rows.size).toBe(storedBefore);
  });

  it('the `package` type is never filtered — otherwise disable would be irreversible', async () => {
    const h = makeHarness();
    await seed(h.protocol, h.registry);
    h.registry.disablePackage(PKG);

    // The Packages page must keep listing a disabled package, or there is no
    // surface left to re-enable it from.
    const pkgs = h.registry.getAllPackages().map((p: any) => p?.manifest?.id ?? p?.id);
    expect(pkgs).toContain(PKG);
  });
});

describe('#7557 (A) — isObjectPackageDisabled resolves names the way the READ path does', () => {
  it('answers for a bare short name, the spelling the data plane dispatches on', async () => {
    const h = makeHarness();
    await seed(h.protocol, h.registry);

    expect(h.registry.isObjectPackageDisabled('demo_widget')).toBe(false);
    h.registry.disablePackage(PKG);
    expect(h.registry.isObjectPackageDisabled('demo_widget')).toBe(true);
    expect(h.registry.isObjectPackageDisabled('healthy_widget')).toBe(false);
  });

  it('an unknown name is not "disabled" — that case belongs to OBJECT_NOT_FOUND', async () => {
    const h = makeHarness();
    await seed(h.protocol, h.registry);
    h.registry.disablePackage(PKG);

    expect(h.registry.isObjectPackageDisabled('never_existed')).toBe(false);
  });
});
