// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14205 — a loader-held item's identity is the ROW KEY the loader persisted it
 * under, not `body.name`.
 *
 * ---------------------------------------------------------------------------
 * The defect
 * ---------------------------------------------------------------------------
 * `MetadataManager.readListUncached()` (and its no-catch counterpart
 * `listForIndex()`) merged each loader's answer into the result map keyed by
 * `body.name`, admitting an item ONLY when its stored body carried a string
 * `name`:
 *
 * ```ts
 * if (itemAny && typeof itemAny.name === 'string' && !items.has(itemAny.name)) {
 *   items.set(itemAny.name, item);
 * }
 * ```
 *
 * An aggregated `defineView` container has no own `name` BY DESIGN — its
 * identity is the target object, carried in the row's `name` COLUMN, and
 * `DatabaseLoader.rowToData()` returns the stored body without folding the
 * column into it. So a container written by
 * `register('view', OBJECT, container)` survives in-process (the registry keys
 * it by the register argument) and is written to `sys_metadata`, but on the
 * next process start — cold registry, only the loader answering — `list('view')`
 * drops it outright, and `listDiagnosed()` calls the short answer complete.
 *
 * Not scoped to views: ANY loader-held body with no top-level `name` was
 * invisible, including an `api` row, whose absence from the endpoint index
 * reads as "nothing declares this route".
 *
 * ---------------------------------------------------------------------------
 * The ruling this pins (triage, 2026-09-02)
 * ---------------------------------------------------------------------------
 * "a loader-held item's identity is the row key the loader persisted it under
 * — `register(type, name, data)` stored it by `name`, so `readListUncached()`
 * keys loader items by that name, never by `body.name` alone, and does NOT
 * synthesise a `name` into bodies that deliberately have none".
 *
 * Both halves are pinned here: the nameless body is LISTED (`admits …`), and
 * what comes back is the stored body verbatim, still carrying no own `name`
 * (`never synthesises a name …`). The second is why the register contract's
 * `data.name` check (`assertMetadataRegisterContract`) is untouched by this
 * repair — nothing writes a name into a body that has none.
 *
 * ---------------------------------------------------------------------------
 * Controls, and what they are controls AGAINST
 * ---------------------------------------------------------------------------
 * `CONTROL:` cases are green in BOTH directions and were measured so against
 * the pre-repair tree; a red one there would report a regression rather than
 * this fix. They pin the "nothing consumers see today changes shape" half of
 * the ruling: a body that DOES carry a name is still listed and still keyed by
 * that name, a registry entry still wins over a loader row of the same key, and
 * `loadMany()` — whose `body.name` test is a DEDUPE guard, not an admission
 * gate, and which therefore never had this defect — still answers identically.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { MetadataManager } from './metadata-manager.js';
import { DatabaseLoader } from './loaders/database-loader.js';
import { MemoryLoader } from './loaders/memory-loader.js';

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@objectstack/core', async (orig) => ({
  ...((await orig()) as object),
  createLogger: () => logger,
}));

/**
 * The card's container shape, verbatim from
 * `metadata-manager-views-by-object-container.test.ts` — the aggregated
 * container whose identity is the target object and which carries NO top-level
 * `name`.
 */
const runtimeContainer = {
  object: 'crm_lead',
  list: {
    label: 'All Leads',
    type: 'grid',
    data: { provider: 'object' },
    columns: [{ field: 'name' }, { field: 'company' }],
  },
  listViews: {
    pipeline: {
      label: 'Lead Pipeline',
      type: 'kanban',
      data: { provider: 'object' },
      columns: ['name', 'company'],
      kanban: { groupByField: 'status' },
    },
  },
  formViews: {
    edit: { type: 'simple', sections: [{ label: 'Info', fields: [{ field: 'name' }] }] },
  },
};

/** What `runtimeContainer` expands to, sorted — the oracle consumer's answer. */
const EXPANDED = ['crm_lead.default', 'crm_lead.edit', 'crm_lead.pipeline'];

const names = (items: unknown[]): string[] =>
  (items as { name: string }[]).map((i) => i.name).sort();

/**
 * A `sys_metadata` store serving the rows it is handed. Minimal on purpose:
 * `DatabaseLoader.loadMany()` only reaches `syncSchema` and `find`.
 */
function storeServing(rows: Record<string, unknown>[]): IDataDriver {
  return {
    name: 'mock',
    version: '1.0.0',
    supports: {},
    connect: async (): Promise<void> => {},
    disconnect: async (): Promise<void> => {},
    syncSchema: async (): Promise<void> => {},
    find: async (): Promise<Record<string, unknown>[]> => rows,
  } as unknown as IDataDriver;
}

/**
 * A cold manager — empty registry, one `sys_metadata`-backed loader — serving
 * one `view` row keyed `crm_lead`. `body` is what the row's `metadata` column
 * holds; the ONLY difference between the two cases below is whether it repeats
 * the row key as a top-level `name`.
 */
function coldManagerServingViewRow(body: Record<string, unknown>): MetadataManager {
  const manager = new MetadataManager({ formats: ['json'], loaders: [] });
  manager.registerLoader(
    new DatabaseLoader({
      driver: storeServing([
        { id: 'r1', name: 'crm_lead', type: 'view', metadata: JSON.stringify(body) },
      ]),
      cache: { enabled: false },
    }),
  );
  return manager;
}

/** The stored body WITH the name repeated — the shape that was already listed. */
const namedBody = { name: 'crm_lead', ...runtimeContainer };
/** The stored body WITHOUT it — the container's real on-disk shape. */
const namelessBody = { ...runtimeContainer };

describe('#14205 loader-held items are keyed by the row key, not by body.name', () => {
  it('CONTROL: a stored body that DOES carry a top-level name is listed', async () => {
    const items = await coldManagerServingViewRow(namedBody).list('view');

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'crm_lead', object: 'crm_lead' });
  });

  it('admits a stored body with NO top-level name, keyed by the row key', async () => {
    // Pre-repair this was `[]`: `readListUncached()` required `body.name`.
    const items = await coldManagerServingViewRow(namelessBody).list('view');

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ object: 'crm_lead' });
  });

  it('never synthesises a name into a body that deliberately has none', async () => {
    const items = await coldManagerServingViewRow(namelessBody).list('view');

    // The ruling's second half. The row key is the item's identity; it is NOT
    // written into the body, so `assertMetadataRegisterContract`'s refusal of a
    // disagreeing `data.name` keeps meaning what it means.
    expect(items).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(items[0] as object, 'name')).toBe(false);
    expect(items[0]).toEqual(namelessBody);
  });

  it("reaches the oracle consumer: getViewsByObject() expands the nameless container", async () => {
    // The card's own mutation test: #13913's expansion is correct and complete
    // for whatever `list('view')` holds — it just never saw this row.
    const views = await coldManagerServingViewRow(namelessBody).getViewsByObject('crm_lead');

    expect(names(views)).toEqual(EXPANDED);
  });

  it('listDiagnosed() counts the nameless body and stays complete-and-not-degraded', async () => {
    const result = await coldManagerServingViewRow(namelessBody).listDiagnosed('view');

    // Nothing threw before the repair and nothing throws after: the loader
    // answered successfully both times. What changes is that the short answer
    // is no longer reported as a full one.
    expect(result.degraded).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.items).toHaveLength(1);
  });

  it('CONTROL: a registry entry still wins over a loader row of the same key', async () => {
    const manager = coldManagerServingViewRow(namelessBody);
    const registered = { object: 'crm_lead', registryCopy: true };
    manager.registerInMemory('view', 'crm_lead', registered);

    const items = await manager.list('view');

    // One entry, and it is the registry's own object — not a second copy
    // contributed by the loader under the same identity.
    expect(items).toHaveLength(1);
    expect(items[0]).toBe(registered);
  });

  it('CONTROL: loadMany() answered with the nameless body before the repair too', async () => {
    // `loadMany()`'s `typeof itemAny.name === 'string'` test is a DEDUPE guard
    // — a nameless item falls past it and is pushed unconditionally — so that
    // site is a different door and is deliberately untouched by this repair.
    const items = await coldManagerServingViewRow(namelessBody).loadMany('view');

    expect(items).toEqual([namelessBody]);
  });

  it('the endpoint index (listForIndex) SEES a nameless api row instead of dropping it silently', async () => {
    // `matchEndpoint()` reads through `listForIndex()`, the no-catch sibling of
    // `readListUncached()` that carried the identical admission gate. This case
    // pins that second site — and MEASURES, rather than assumes, how far the
    // repair carries there.
    //
    // It does not make the route answer, and that is not this repair's job:
    // `ApiEndpointSchema` declares `name` REQUIRED, so a nameless `api` body is
    // not a valid endpoint declaration at all and `buildEndpointIndex` skips it
    // at its own, separate, declared door. What changes is that the item now
    // REACHES that door. Before, `listForIndex()` dropped it upstream and the
    // author got silence — the exact failure posture `EndpointMatcher`'s LOUD
    // skip exists to prevent. After, the exclusion is stated at `error` level
    // with its consequence.
    const loader = new MemoryLoader();
    await loader.save('api', 'list_tasks', {
      path: '/api/v1/apps/showcase/tasks',
      method: 'GET',
      type: 'object_operation',
      target: 'showcase_task',
      objectParams: { object: 'showcase_task', operation: 'find' },
    });

    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerLoader(loader);
    logger.error.mockClear();

    const match = await manager.matchEndpoint({
      path: '/api/v1/apps/showcase/tasks',
      method: 'GET',
    });

    expect(match).toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(logger.error.mock.calls[0][0])).toContain(
      'EXCLUDED from endpoint matching',
    );
  });

  it('CONTROL: the endpoint index still admits a NAMED api row', async () => {
    const loader = new MemoryLoader();
    await loader.save('api', 'list_tasks', {
      name: 'list_tasks',
      path: '/api/v1/apps/showcase/tasks',
      method: 'GET',
      type: 'object_operation',
      target: 'showcase_task',
      objectParams: { object: 'showcase_task', operation: 'find' },
    });

    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerLoader(loader);

    const match = await manager.matchEndpoint({
      path: '/api/v1/apps/showcase/tasks',
      method: 'GET',
    });

    expect(match).toBeDefined();
  });
});
