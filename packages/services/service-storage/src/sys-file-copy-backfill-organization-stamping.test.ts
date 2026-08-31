// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #13547 — the FIFTH and SIXTH `sys_file` insert doors.
//
// Four doors on this object have been given the acting organization one card
// at a time — `createFile` (#12745), `createSession` (#12928), and the
// `update`/`delete` halves (#13178) — and all four run through
// `StorageMetadataStore`, which threads a `StorageWriteContext` into
// `context.tenantId` so the platform's insert-side chokepoint can stamp the
// column. These two bypass that store entirely:
//
//   file-reference-lifecycle.ts  copyOwnedFile     an engine lifecycle hook
//   backfill-file-references.ts  materializeDataUri  an operator pass
//
// Both passed `{ isSystem: true, [RAW_FILE_VALUES_CONTEXT_KEY]: true }` and no
// tenant, so `buildDriverOptions` emitted no `DriverOptions.tenantId`,
// `injectTenantOnInsert` stamped nothing, and each row landed
// `organization_id = NULL` — reachable from every organization through the
// driver's `(organization_id = :tenantId OR organization_id IS NULL)` term.
//
// ⚠️ These assert the CONTEXT the engine is handed, not a column on the
// payload. Whether `sys_file` has a tenant column at all, and whether an
// explicit value wins, are `resolveTenantField` / `injectTenantOnInsert`'s
// answers; re-deciding them here would be the second convention this card is
// about.

import { describe, it, expect, vi } from 'vitest';
import { RAW_FILE_VALUES_CONTEXT_KEY } from '@objectstack/spec/data';
import { assertEngineFindOnePredicate } from '@objectstack/objectql';
import { installFileReferenceHooks } from './file-reference-lifecycle.js';
import { backfillFileReferences } from './backfill-file-references.js';

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });

const fakeStorage = () =>
  ({
    upload: vi.fn(async () => {}),
    download: vi.fn(async () => Buffer.from('the-bytes')),
    delete: vi.fn(async () => {}),
    exists: vi.fn(async () => true),
    getInfo: vi.fn(async () => ({ key: 'k', size: 9, contentType: 'image/png', lastModified: new Date() })),
  }) as any;

/** The `sys_file` insert this card is about, with the options bag intact. */
type Insert = { object: string; data: Record<string, unknown>; options: any };

const sysFileInsertOf = (inserts: Insert[]): Insert => {
  const hit = inserts.filter((i) => i.object === 'sys_file');
  expect(hit).toHaveLength(1);
  return hit[0];
};

// ---------------------------------------------------------------------------
// Door 5 — `copyOwnedFile`, reached through the copy-on-claim before-hook
// ---------------------------------------------------------------------------

const LIFECYCLE_REGISTRY: Record<string, any> = {
  sys_file: {
    name: 'sys_file',
    fields: { id: { type: 'text' }, key: { type: 'text' }, organization_id: { type: 'text' } },
  },
  product: {
    name: 'product',
    fields: { id: { type: 'text' }, name: { type: 'text' }, image: { type: 'image' } },
  },
};

function lifecycleEngine(files: Array<Record<string, unknown>>) {
  const inserts: Insert[] = [];
  const updates: Array<{ data: Record<string, unknown>; options: any }> = [];
  const tables: Record<string, Array<Record<string, unknown>>> = { sys_file: [...files], product: [] };
  const hooks = new Map<string, Array<(ctx: any) => Promise<void> | void>>();

  const engine: any = {
    registerHook(event: string, handler: any) {
      const list = hooks.get(event) ?? [];
      list.push(handler);
      hooks.set(event, list);
    },
    getObject: (name: string) => LIFECYCLE_REGISTRY[name],
    async find(object: string, options: any) {
      return (tables[object] ?? []).filter((r) =>
        Object.entries(options?.where ?? {}).every(([k, v]) =>
          v && typeof v === 'object' && Array.isArray((v as any).$in)
            ? (v as any).$in.some((x: unknown) => String(x) === String(r[k]))
            : r[k] === v,
        ),
      );
    },
    async findOne(object: string, options: any) {
      assertEngineFindOnePredicate(object, options);
      return (tables[object] ?? []).find((r) => String(r.id) === String(options?.where?.id)) ?? null;
    },
    async insert(object: string, data: any, options?: any) {
      inserts.push({ object, data: { ...data }, options });
      (tables[object] ??= []).push({ ...data });
      return data;
    },
    async update(object: string, data: any, options?: any) {
      if (object === 'sys_file') updates.push({ data: { ...data }, options });
      const row = (tables[object] ?? []).find((r) => String(r.id) === String(data.id));
      if (row) Object.assign(row, data);
      return row;
    },
    inserts,
    updates,
    tables,
    async trigger(event: string, ctx: any) {
      for (const h of hooks.get(event) ?? []) await h(ctx);
    },
  };
  return engine;
}

/**
 * Drive an insert of `product` whose `image` already names a file owned by a
 * DIFFERENT slot — the one condition that reaches `copyOwnedFile` — with the
 * session the engine's `buildSession()` would have built for the caller.
 */
async function driveCopyingInsert(engine: any, session: unknown) {
  const data: Record<string, unknown> = { image: 'file_owned' };
  const ctx: any = {
    object: 'product',
    event: 'beforeInsert',
    input: { data },
    session,
    dispatch: { mode: 'record', index: 0, scope: {} },
  };
  await engine.trigger('beforeInsert', ctx);
  const row = { ...(ctx.input.data as Record<string, unknown>), id: 'p1' };
  engine.tables.product.push(row);
  ctx.event = 'afterInsert';
  ctx.result = row;
  await engine.trigger('afterInsert', ctx);
  return row;
}

const ownedFile = () => ({
  id: 'file_owned',
  key: 'user/file_owned.png',
  name: 'owned.png',
  status: 'committed',
  ref_object: 'other',
  ref_id: 'r9',
  ref_field: 'image',
});

describe('#13547 door 5 — copyOwnedFile threads the triggering write’s organization', () => {
  it('hands the engine `context.tenantId` for the organization the write acts in', async () => {
    const engine = lifecycleEngine([ownedFile()]);
    installFileReferenceHooks(engine, () => fakeStorage(), silentLogger());

    await driveCopyingInsert(engine, { userId: 'u1', organizationId: 'org_A' });

    const insert = sysFileInsertOf(engine.inserts);
    expect(insert.options?.context?.tenantId).toBe('org_A');
    // The bookkeeping markers the copy has always carried are untouched.
    expect(insert.options?.context?.isSystem).toBe(true);
    expect(insert.options?.context?.[RAW_FILE_VALUES_CONTEXT_KEY]).toBe(true);
  });

  it('⛔ never puts the organization on the PAYLOAD — the driver decides the column', async () => {
    const engine = lifecycleEngine([ownedFile()]);
    installFileReferenceHooks(engine, () => fakeStorage(), silentLogger());

    await driveCopyingInsert(engine, { organizationId: 'org_A' });

    expect(sysFileInsertOf(engine.inserts).data).not.toHaveProperty('organization_id');
  });

  it('omits `tenantId` ENTIRELY when the caller has no active organization', async () => {
    const engine = lifecycleEngine([ownedFile()]);
    installFileReferenceHooks(engine, () => fakeStorage(), silentLogger());

    await driveCopyingInsert(engine, { userId: 'u1' });

    const context = sysFileInsertOf(engine.inserts).options?.context ?? {};
    // Presence, not value: `buildDriverOptions` reads `tenantId !== undefined`,
    // so `tenantId: undefined` is NOT the same as an absent key.
    expect(Object.prototype.hasOwnProperty.call(context, 'tenantId')).toBe(false);
    expect(context.isSystem).toBe(true);
  });

  it('omits it for a caller with no session at all (the pre-repair call shape)', async () => {
    const engine = lifecycleEngine([ownedFile()]);
    installFileReferenceHooks(engine, () => fakeStorage(), silentLogger());

    await driveCopyingInsert(engine, undefined);

    const context = sysFileInsertOf(engine.inserts).options?.context ?? {};
    expect(Object.prototype.hasOwnProperty.call(context, 'tenantId')).toBe(false);
  });

  it('⛔ never derives the organization from the SOURCE file it is copying', async () => {
    // The source row is stamped for another organization. The copy belongs to
    // the slot that triggered it, not to whoever owned the bytes — deriving
    // from the source would wall the copy into a tenant that is not writing.
    const engine = lifecycleEngine([{ ...ownedFile(), organization_id: 'org_SOURCE' }]);
    installFileReferenceHooks(engine, () => fakeStorage(), silentLogger());

    await driveCopyingInsert(engine, { organizationId: 'org_A' });

    expect(sysFileInsertOf(engine.inserts).options?.context?.tenantId).toBe('org_A');
  });

  it('pins the measurement the repair rests on: the after-hook claims ownership, NEVER the tenant', async () => {
    // `copyOwnedFile` documents that it leaves ownership columns NULL because
    // "the after-hook claims the copy for the slot that triggered it". That is
    // true of `ref_*` and ONLY of `ref_*` — so the insert is the last point
    // that can stamp the tenant, which is why the repair belongs there.
    const engine = lifecycleEngine([ownedFile()]);
    installFileReferenceHooks(engine, () => fakeStorage(), silentLogger());

    await driveCopyingInsert(engine, { organizationId: 'org_A' });

    expect(engine.updates.length).toBeGreaterThan(0);
    for (const { data } of engine.updates) {
      expect(data).not.toHaveProperty('organization_id');
    }
    // …and it does claim the ownership columns, so the double is really
    // exercising the claim path rather than passing because nothing ran.
    expect(engine.updates.some((u: any) => u.data.ref_object === 'product')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Door 6 — the backfill pass materialising inline `data:` bytes
// ---------------------------------------------------------------------------

const DATA_URI = 'data:image/png;base64,aGVsbG8=';

/** `product` is walled; `memo` carries no organization column at all. */
const BACKFILL_REGISTRY: Record<string, any> = {
  sys_file: { fields: { id: { type: 'text' }, organization_id: { type: 'text' } } },
  product: {
    fields: {
      id: { type: 'text' },
      image: { type: 'image' },
      organization_id: { type: 'text' },
    },
  },
  memo: { fields: { id: { type: 'text' }, image: { type: 'image' } } },
};

function backfillEngine(tables: Record<string, Array<Record<string, unknown>>>) {
  const inserts: Insert[] = [];
  const projections: Array<{ object: string; fields: unknown }> = [];
  const engine: any = {
    getObject: (name: string) => BACKFILL_REGISTRY[name],
    getConfigs: () => BACKFILL_REGISTRY,
    async find(object: string, options: any) {
      projections.push({ object, fields: options?.fields });
      const key = options?.orderBy?.[0]?.field;
      const seek = (options?.where as any)?.[key]?.$gt;
      let rows = tables[object] ?? [];
      if (seek !== undefined) rows = rows.filter((r) => String(r[key]) > String(seek));
      const ordered = key ? [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key]))) : rows;
      return typeof options?.limit === 'number' ? ordered.slice(0, options.limit) : ordered;
    },
    async insert(object: string, data: any, options?: any) {
      inserts.push({ object, data: { ...data }, options });
      (tables[object] ??= []).push({ ...data });
      return data;
    },
    async update(object: string, data: any) {
      const row = (tables[object] ?? []).find((r) => String(r.id) === String(data.id));
      if (row) Object.assign(row, data);
      return row;
    },
    inserts,
    projections,
    tables,
  };
  return engine;
}

const runBackfill = (engine: any) =>
  backfillFileReferences(engine, () => fakeStorage(), silentLogger(), { apply: true });

describe('#13547 door 6 — the backfill stamps from the record that HELD the bytes', () => {
  it('threads the subject record’s organization onto the materialised sys_file', async () => {
    const engine = backfillEngine({
      product: [{ id: 'p1', image: DATA_URI, organization_id: 'org_B' }],
      sys_file: [],
    });

    await runBackfill(engine);

    const insert = sysFileInsertOf(engine.inserts);
    expect(insert.options?.context?.tenantId).toBe('org_B');
    expect(insert.options?.context?.isSystem).toBe(true);
    expect(insert.data).not.toHaveProperty('organization_id');
  });

  it('projects the organization column so the value is actually in reach', async () => {
    const engine = backfillEngine({
      product: [{ id: 'p1', image: DATA_URI, organization_id: 'org_B' }],
      sys_file: [],
    });

    await runBackfill(engine);

    const scan = engine.projections.find((p: any) => p.object === 'product');
    expect(scan?.fields).toContain('organization_id');
    expect(scan?.fields).toContain('image');
  });

  it('stamps NOTHING when the subject row carries no organization — ⛔ never invents one', async () => {
    const engine = backfillEngine({
      product: [{ id: 'p1', image: DATA_URI, organization_id: null }],
      sys_file: [],
    });

    await runBackfill(engine);

    const context = sysFileInsertOf(engine.inserts).options?.context ?? {};
    expect(Object.prototype.hasOwnProperty.call(context, 'tenantId')).toBe(false);
  });

  it('leaves an object with no organization column unprojected and unstamped', async () => {
    const engine = backfillEngine({ memo: [{ id: 'm1', image: DATA_URI }], sys_file: [] });

    await runBackfill(engine);

    const scan = engine.projections.find((p: any) => p.object === 'memo');
    // Naming a column the object does not have would fail the whole scan.
    expect(scan?.fields).not.toContain('organization_id');
    const context = sysFileInsertOf(engine.inserts).options?.context ?? {};
    expect(Object.prototype.hasOwnProperty.call(context, 'tenantId')).toBe(false);
  });

  it('keeps each row on its OWN organization across a multi-tenant scan', async () => {
    // The reason an operator-supplied single organization would be wrong: one
    // run spans every tenant in the deployment.
    const engine = backfillEngine({
      product: [
        { id: 'p1', image: DATA_URI, organization_id: 'org_B' },
        { id: 'p2', image: DATA_URI, organization_id: 'org_C' },
      ],
      sys_file: [],
    });

    await runBackfill(engine);

    const stamped = engine.inserts
      .filter((i: Insert) => i.object === 'sys_file')
      .map((i: Insert) => i.options?.context?.tenantId);
    expect(stamped).toEqual(['org_B', 'org_C']);
  });

  it('⛔ writes no organization onto any EXISTING sys_file row — forward-stamping only', async () => {
    const legacy = { id: 'file_legacy', key: 'user/legacy.png', organization_id: null };
    const engine = backfillEngine({
      product: [{ id: 'p1', image: DATA_URI, organization_id: 'org_B' }],
      sys_file: [legacy],
    });

    await runBackfill(engine);

    expect(engine.tables.sys_file.find((r: any) => r.id === 'file_legacy')).toEqual(legacy);
  });
});
