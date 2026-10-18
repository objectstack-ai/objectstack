// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { MetadataTypeSchema } from '@objectstack/spec/kernel';
import { SchemaRegistry } from './registry.js';
// [#4550 / #5480] The producer's OWN write-verb dispatch decisions, so the
// engine double cannot accept a call `ObjectQL.delete` / `ObjectQL.update`
// refuses — a double looser than the implementation is no test at all.
import { assertEngineDeleteDispatch } from './engine-delete-dispatch.js';
import { assertEngineUpdateDispatch } from './engine-update-dispatch.js';
import { assertEngineFindOnePredicate } from './engine-findone-predicate.js';

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
 *
 * ---------------------------------------------------------------------------
 * [#24210] Every other type: absence, by name as in the listing
 * ---------------------------------------------------------------------------
 * A type with no data plane has no refusal to share, so the by-name read
 * (`getMetaItem`) answers a disabled package's item as ABSENT, as the listing
 * omits it: no `item` (the transports' `404 RESOURCE_NOT_FOUND`), or the
 * missing draft's `404 NO_DRAFT` on the strict draft read. `READERS` carries a
 * listing row and a by-name row for EVERY type `MetadataTypeSchema` declares
 * but `object` (`BY_NAME_TYPES`; the schema does not list `package`), so a
 * type added there gets its two rows here without anyone writing them.
 * `package` is never hidden: the Packages page re-enables from it.
 */

const PKG = 'app.disabled_demo';
const OTHER_PKG = 'app.healthy_demo';

/** [#24210] Every declared metadata type the by-name read answers as absent. */
const BY_NAME_TYPES: readonly string[] = MetadataTypeSchema.options.filter((type) => type !== 'object');
/** The item each package ships of `type`, registered as a code package registers it. */
const shippedName = (type: string, pkg: string) => `${pkg === PKG ? 'demo' : 'healthy'}_${type}_item`;

const objectBody = (name: string) => ({
  name,
  label: 'Demo',
  // [#8310] The runtime object door requires an authored OWD.
  sharingModel: 'private',
  fields: {
    name: { name: 'name', type: 'text', label: 'Name' },
  },
});

const rowKey = (w: Record<string, unknown>) =>
  [w.type, w.name, w.organization_id ?? '', w.package_id ?? '', w.state ?? 'active'].join('|');

/** [#24371] One `where` value as the store reads it: `{ $in: [...] }` (the by-name read's both-spellings `type`) or equality. */
const whereValueMatches = (actual: unknown, want: unknown): boolean =>
    want !== null && typeof want === 'object' && Array.isArray((want as { $in?: unknown }).$in)
        ? (want as { $in: unknown[] }).$in.includes(actual)
        : actual === want;

const matchesWhere = (row: Record<string, unknown>, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
    if (v === null) return row[k] === null || row[k] === undefined;
    return whereValueMatches(row[k], v);
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
        // [#11957] Pinned to ObjectQL.findOne's OWN #4419 predicate: `findOne`
        // applies limit: 1, so a query naming no record returns an ARBITRARY row
        // and the engine REFUSES it. A double that answers it anyway is how
        // #11767 shipped a bootstrap bypass that was inert on every real
        // deployment while a 641-line unit matrix stayed green.
        assertEngineFindOnePredicate(table, o);
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
    registry.installPackage({ id: pkg, name: pkg, version: '1.0.0' } as any, 'code');
    await protocol.saveMetaItem({ type: 'object', name: obj, packageId: pkg, item: objectBody(obj) });
    // [#24097] A pending draft too, so the by-name read's `state: 'draft'` row
    // has a draft to serve before the disable (else it answers NO_DRAFT there).
    await protocol.saveMetaItem({
      type: 'object',
      name: obj,
      packageId: pkg,
      mode: 'draft',
      item: { ...objectBody(obj), label: 'Demo (draft)' },
    });
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
    // [#24210] A pending draft of the stored app, so the by-name read's
    // `state: 'draft'` and `previewDrafts` rows have a draft to serve.
    await protocol.saveMetaItem({
      type: 'app',
      name: app,
      packageId: pkg,
      mode: 'draft',
      item: { name: app, label: 'Demo App (draft)' },
    });
    // [#24210] One item of every declared type, as a code package ships it:
    // the registry layer, stamped with the package that registered it.
    for (const type of BY_NAME_TYPES) {
      registry.registerItem(type, { name: shippedName(type, pkg), label: 'Shipped' } as any, 'name', pkg);
    }
  }
}

const listItemsOf = async (protocol: any, type: string): Promise<any[]> => {
  const res = await protocol.getMetaItems({ type });
  return (Array.isArray(res) ? res : res?.items ?? res?.data ?? []) as any[];
};

const listNames = async (protocol: any, type: string): Promise<string[]> =>
  (await listItemsOf(protocol, type)).map((i) => i?.name).filter(Boolean);

/**
 * [#24097] Whether a by-name read serves `demo_widget`. Only the
 * `OBJECT_PACKAGE_DISABLED` refusal counts as "refuses": any other throw
 * (`NO_DRAFT`, a bare not-found) is rethrown, so a row cannot read an
 * unrelated failure as enforcement.
 */
const servesByName = async (read: () => Promise<any>, pick: (r: any) => unknown): Promise<boolean> => {
  try {
    return (pick(await read()) ?? null) !== null;
  } catch (e: any) {
    if (e?.code === 'OBJECT_PACKAGE_DISABLED') return false;
    throw e;
  }
};

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
 * object or item. `enforces: false` = a resolution reader that must keep
 * serving it.
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
    reader: 'getMetaItem({ type: "object", name }) — GET /meta/object/:name',
    enforces: true,
    why: 'the by-name half of the listing: the console record form, metadata provider and SDK getItem read it',
    serves: async ({ protocol }) =>
      servesByName(() => protocol.getMetaItem({ type: 'object', name: 'demo_widget' }), (r) => r?.item),
  },
  {
    reader: 'getMetaItem({ type: "objects", name }) — the plural spelling of the same route',
    enforces: true,
    why: 'folded to the singular before the refusal; pinned so the fold cannot silently stop folding',
    serves: async ({ protocol }) =>
      servesByName(() => protocol.getMetaItem({ type: 'objects', name: 'demo_widget' }), (r) => r?.item),
  },
  {
    reader: 'getMetaItem({ state: "draft" }) — GET /meta/object/:name?state=draft',
    enforces: true,
    why: 'the designer\'s draft read: the refusal is checked once, before any layer, in every state',
    serves: async ({ protocol }) =>
      servesByName(
        () => protocol.getMetaItem({ type: 'object', name: 'demo_widget', state: 'draft' }),
        (r) => r?.item,
      ),
  },
  {
    reader: 'getMetaItem({ previewDrafts: true }) — GET /meta/object/:name?preview=draft',
    enforces: true,
    why: 'the render path\'s draft-overlay preview, which returns before the active read does',
    serves: async ({ protocol }) =>
      servesByName(
        () => protocol.getMetaItem({ type: 'object', name: 'demo_widget', previewDrafts: true }),
        (r) => r?.item,
      ),
  },
  {
    reader: 'getMetaItemLayered — GET /meta/object/:name?layers=true',
    enforces: true,
    why: 'a by-name API face that reads its layers without getMetaItem, so it carries the refusal itself',
    serves: async ({ protocol }) =>
      servesByName(
        () => protocol.getMetaItemLayered({ type: 'object', name: 'demo_widget' }),
        (r) => r?.effective,
      ),
  },
  {
    reader: 'getMetaItem({ type: "app", name }) — GET /meta/app/:name, a stored row',
    enforces: true,
    why: '[#24210] the by-name half of the app listing: absent, as the listing omits it',
    serves: async ({ protocol }) =>
      servesByName(() => protocol.getMetaItem({ type: 'app', name: 'demo_app' }), (r) => r?.item),
  },
  {
    reader: 'getMetaItem({ type: "apps", name }) — the plural spelling of the same route',
    enforces: true,
    why: '[#24210] folded to the singular before the predicate is asked',
    serves: async ({ protocol }) =>
      servesByName(() => protocol.getMetaItem({ type: 'apps', name: 'demo_app' }), (r) => r?.item),
  },
  {
    reader: 'getMetaItem({ type: "app", state: "draft" }) — GET /meta/app/:name?state=draft',
    enforces: true,
    why: '[#24210] the strict draft read answers the missing draft\'s 404 NO_DRAFT',
    serves: async ({ protocol }) => {
      try {
        return (await protocol.getMetaItem({ type: 'app', name: 'demo_app', state: 'draft' }))?.item != null;
      } catch (e: any) {
        if (e?.code === 'NO_DRAFT') return false;
        throw e;
      }
    },
  },
  {
    reader: 'getMetaItem({ type: "app", previewDrafts: true }) — GET /meta/app/:name?preview=draft',
    enforces: true,
    why: '[#24210] the draft-overlay preview returns before the active read, and is asked the same predicate',
    serves: async ({ protocol }) =>
      servesByName(
        () => protocol.getMetaItem({ type: 'app', name: 'demo_app', previewDrafts: true }),
        (r) => r?.item,
      ),
  },
  // [#24210] Two rows per declared type, generated: a type `MetadataTypeSchema`
  // adds is enumerated here with no row to write.
  ...BY_NAME_TYPES.flatMap((type) => [
    {
      reader: `getMetaItems({ type: "${type}" }) — GET /meta/${type}`,
      enforces: true,
      why: 'the listing omits a disabled package\'s item of every type but package',
      serves: async ({ protocol }: { protocol: any }) =>
        (await listNames(protocol, type)).includes(shippedName(type, PKG)),
    },
    {
      reader: `getMetaItem({ type: "${type}", name }) — GET /meta/${type}/:name`,
      enforces: true,
      why: 'the by-name half of that listing: absent, the answer a name with nothing behind it gets',
      serves: async ({ protocol }: { protocol: any }) =>
        servesByName(() => protocol.getMetaItem({ type, name: shippedName(type, PKG) }), (r) => r?.item),
    },
  ]),
  {
    reader: 'listDrafts() — GET /meta/_drafts',
    enforces: true,
    why: '[#24210] the pending-changes list omits a disabled package\'s drafts, as its by-name draft read answers NO_DRAFT',
    serves: async ({ protocol }) =>
      ((await protocol.listDrafts())?.drafts ?? []).some((d: any) => d?.packageId === PKG),
  },
  {
    reader: 'listDrafts({ packageId }) — GET /meta/_drafts?packageId=',
    enforces: true,
    why: '[#24210] naming the package does not bring its drafts back',
    serves: async ({ protocol }) =>
      ((await protocol.listDrafts({ packageId: PKG }))?.drafts ?? []).length > 0,
  },
  {
    reader: 'the repository\'s listDrafts — the package batch doors (publish-drafts, discard-drafts)',
    enforces: false,
    why: '[#24210] a disabled package\'s drafts still publish and discard: those doors define their batch here',
    serves: async ({ protocol }) => {
      await (protocol as any).ensureOverlayIndex();
      return ((await (protocol as any).getOverlayRepo().listDrafts({ packageId: PKG })) ?? []).length > 0;
    },
  },
  {
    reader: 'getMetaItemLayered({ type: "app", name }) — the producer under GET /meta/app/:name/layers and ?layers=true',
    enforces: false,
    why: '[#24210] the doors answer the absence (the shared layered chain\'s owner step, pinned per transport in @objectstack/rest and @objectstack/runtime); the producer keeps serving its resolution readers',
    serves: async ({ protocol }) =>
      (await protocol.getMetaItemLayered({ type: 'app', name: 'demo_app' }))?.effective != null,
  },
  {
    reader: 'getMetaItemLayered({ type: "permission", name }) — the security catalog echo and the packaged-permission-set lock gate',
    enforces: false,
    why: '[#24210] plugin-security reads the layers directly, not through a door: a disabled package\'s permission set still echoes and stays locked',
    serves: async ({ protocol }) =>
      (await protocol.getMetaItemLayered({ type: 'permission', name: shippedName('permission', PKG) }))?.effective != null,
  },
  {
    reader: 'getMetaItem(…).packageId — the owner the layered doors\' step and readServedPackageBinding read',
    enforces: false,
    why: '[#24210] the by-name read withholds the item but its kept envelope still names the owner, which is how the layered doors and the echo learn it',
    serves: async ({ protocol }) =>
      (await protocol.getMetaItem({ type: 'app', name: 'demo_app' }))?.packageId === PKG,
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

  it('[#24097] the by-name refusal is the data plane\'s: OBJECT_PACKAGE_DISABLED / 404, one envelope', async () => {
    const h = makeHarness();
    await seed(h.protocol, h.registry);
    h.registry.disablePackage(PKG);

    const caught = async (read: () => Promise<unknown>): Promise<any> => {
      try {
        await read();
      } catch (e) {
        return e;
      }
      return undefined;
    };
    let dataPlane: any;
    try {
      (h.protocol as any).assertObjectRegistered('demo_widget');
    } catch (e) {
      dataPlane = e;
    }
    const byName = await caught(() => h.protocol.getMetaItem({ type: 'object', name: 'demo_widget' }));
    const layered = await caught(() => h.protocol.getMetaItemLayered({ type: 'object', name: 'demo_widget' }));

    for (const err of [byName, layered]) {
      expect(err?.code).toBe('OBJECT_PACKAGE_DISABLED');
      expect(err?.status).toBe(404);
      expect(err?.object).toBe('demo_widget');
      // One constructor for both halves of the answer, so they cannot drift.
      expect(err?.message).toBe(dataPlane?.message);
    }
  });

  it('[#24097] the control: another package\'s object is still served by name', async () => {
    const h = makeHarness();
    await seed(h.protocol, h.registry);
    h.registry.disablePackage(PKG);

    const served: any = await h.protocol.getMetaItem({ type: 'object', name: 'healthy_widget' });
    expect(served?.item?.name).toBe('healthy_widget');
    expect(served?.item?._packageId).toBe(OTHER_PKG);
    const layered: any = await h.protocol.getMetaItemLayered({ type: 'object', name: 'healthy_widget' });
    expect((layered?.effective as any)?.name).toBe('healthy_widget');
  });

  it('[#24210] a disabled package\'s item is answered as a missing name is, on every type', async () => {
    const h = makeHarness();
    await seed(h.protocol, h.registry);
    h.registry.disablePackage(PKG);

    for (const type of BY_NAME_TYPES) {
      const missing: any = await h.protocol.getMetaItem({ type, name: `no_such_${type}_item` });
      const hidden: any = await h.protocol.getMetaItem({ type, name: shippedName(type, PKG) });
      // No item, which is what the transports judge absence on (`item == null`).
      expect({ type, item: missing?.item }).toEqual({ type, item: undefined });
      expect({ type, item: hidden?.item, hasItemKey: 'item' in hidden }).toEqual({ type, item: undefined, hasItemKey: true });
      expect(hidden?.registration).toBeUndefined();
    }

    // The strict draft read: the missing draft's own error, code, status and text.
    let draftErr: any;
    try {
      await h.protocol.getMetaItem({ type: 'app', name: 'demo_app', state: 'draft' });
    } catch (e) {
      draftErr = e;
    }
    expect(draftErr?.code).toBe('NO_DRAFT');
    expect(draftErr?.status).toBe(404);
    expect(draftErr?.message).toBe('No pending draft exists for app/demo_app.');
  });

  it('[#24210] the control: another package\'s item of every type is still listed and served by name', async () => {
    const h = makeHarness();
    await seed(h.protocol, h.registry);
    h.registry.disablePackage(PKG);

    const served: Record<string, boolean> = {};
    for (const type of BY_NAME_TYPES) {
      const name = shippedName(type, OTHER_PKG);
      const read: any = await h.protocol.getMetaItem({ type, name });
      served[`${type}: by name`] = read?.item?.name === name;
      served[`${type}: listed`] = (await listNames(h.protocol, type)).includes(name);
    }
    expect(served).toEqual(allTrue(served));
    const app: any = await h.protocol.getMetaItem({ type: 'app', name: 'healthy_app' });
    expect(app?.item?._packageId).toBe(OTHER_PKG);
    // [#24210] …and its pending drafts are still listed, both of them.
    const drafts = (await h.protocol.listDrafts()).drafts;
    expect(drafts.filter((d) => d.packageId === OTHER_PKG).map((d) => `${d.type}/${d.name}`).sort())
      .toEqual(['app/healthy_app', 'object/healthy_widget']);
    expect(drafts.filter((d) => d.packageId === PKG)).toEqual([]);
  });

  it('[#24210] the protection envelope stays: the write doors\' verdict on the address is not the item', async () => {
    // The ownership ceremony gates its own writes on `editable` / `lock` from
    // this read (`packages/cli`, `lock.verdict`), and the save door judges a
    // save to this address the same way whether or not the package is enabled.
    const h = makeHarness();
    await seed(h.protocol, h.registry);
    const before: any = await h.protocol.getMetaItem({ type: 'app', name: 'demo_app' });
    h.registry.disablePackage(PKG);
    const after: any = await h.protocol.getMetaItem({ type: 'app', name: 'demo_app' });

    expect(before?.item?.name).toBe('demo_app');
    expect(after?.item).toBeUndefined();
    const { item: _beforeItem, ...beforeEnvelope } = before;
    const { item: _afterItem, ...afterEnvelope } = after;
    expect(afterEnvelope).toEqual(beforeEnvelope);
  });

  it('[#24097] a field drop on a disabled package\'s object still answers 409 DESTRUCTIVE_CHANGE', async () => {
    // The save's destructive-change check reads the prior schema through the
    // protocol's private shared body, not the refusing API face. Read through
    // the API face, its `catch` took the refusal for "skip the check" and the
    // drop landed with no confirmation.
    const h = makeHarness();
    await seed(h.protocol, h.registry);
    h.registry.disablePackage(PKG);

    let err: any;
    try {
      await h.protocol.saveMetaItem({
        type: 'object',
        name: 'demo_widget',
        packageId: PKG,
        item: { ...objectBody('demo_widget'), fields: { other: { name: 'other', type: 'text', label: 'Other' } } },
      });
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe('DESTRUCTIVE_CHANGE');
    expect(err?.status).toBe(409);
    const stored = [...h.rows.values()].find(
      (r: any) => r.type === 'object' && r.name === 'demo_widget' && (r.state ?? 'active') === 'active',
    );
    const body = typeof stored?.metadata === 'string' ? JSON.parse(stored.metadata) : stored?.metadata;
    expect(Object.keys(body?.fields ?? {})).toContain('name');
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
