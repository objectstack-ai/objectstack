// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13913 — `MetadataManager.getViewsByObject()` answered EMPTY for an
 * aggregated view container living in this manager's own backing store.
 *
 * ---------------------------------------------------------------------------
 * The defect, and why it survived #13407
 * ---------------------------------------------------------------------------
 * There are two independent object-bound readers. The REST route
 * (`GET /meta/view?object=`) reads through `ObjectStackProtocolImplementation.
 * getMetaItems` over `sys_metadata` rows; #13407 taught THAT reader to expand a
 * runtime-authored container inline. `getViewsByObject()` reads
 * `this.list('view')` — `MetadataManager`'s OWN registry + loader store, a
 * completely separate store — never calls `getMetaItems`, and had no equivalent
 * step. So the very container #13407 made visible on the wire still answered
 * empty through this entry point.
 *
 * The filter here was never the bug: it reads the top-level `object`, exactly
 * as `ViewSchema.object` declares. Two conditions have to hold at once, and the
 * second is the one that decides the shape of the fix — the filter ALSO
 * requires `viewKind`, and a container has none. Getting the container into the
 * store is therefore not enough; the container's EXPANSION has to be what the
 * read sees. Relaxing the `viewKind` requirement instead would answer with the
 * container itself as a view — the behaviour #7163 ruled wrong — which is why
 * `answers with EXPANDED items and never the container itself` below is a pin
 * against that regression and not a restatement of the fix.
 *
 * ---------------------------------------------------------------------------
 * What is driven, and why it is NOT the REST route
 * ---------------------------------------------------------------------------
 * Every assertion goes through `manager.getViewsByObject(...)` itself. A pin
 * written against `GET /meta/view?object=` would have gone green on `main`
 * without touching this bug at all — #13929 already repaired that exit.
 *
 * The container fixture is the card's own shape: a top-level `object` and NO
 * `list.data.object`. That combination is what #13407's corrected derivation
 * chain exists for, and it is why `container.object` has to be consulted first.
 *
 * ---------------------------------------------------------------------------
 * The control
 * ---------------------------------------------------------------------------
 * `a non-container ViewItem still resolves unchanged` and `already-registered
 * expanded items are NOT duplicated` are green in BOTH directions on purpose:
 * this change must not move what the exit already answered. A case going red
 * there would report a regression, not this fix.
 *
 * Reverse verification (direction predicted before running, and recorded in the
 * PR body as measured): reverting `getViewsByObject` to its pre-#13913 body
 * turns the two container cases RED and leaves both controls GREEN.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { MetadataManager } from './metadata-manager.js';
import { DatabaseLoader } from './loaders/database-loader.js';

// The manager logs on some paths; keep the run quiet and stable.
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
 * The card's container shape: the binding lives ONLY in the top-level `object`
 * field. `list.data` deliberately carries no `object`, so the pre-#13407
 * two-deep derivation chain (`list.data.object` -> `form.data.object`) cannot
 * find it and the fallback to the row's own name is not available either.
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
    default: { type: 'simple', sections: [{ label: 'Info', fields: [{ field: 'name' }] }] },
  },
};

/** An already-independent ViewItem — the shape a source registrar produces. */
const independentViewItem = {
  name: 'crm_lead.legacy',
  object: 'crm_lead',
  viewKind: 'list',
  config: { type: 'grid', columns: [{ field: 'name' }] },
  order: 0,
  scope: 'package',
};

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

function managerWithRegistryContainer(): MetadataManager {
  const manager = new MetadataManager({ formats: ['json'], loaders: [] });
  // How a container is keyed everywhere in this repo: under the bare object
  // name, with no top-level `name` of its own.
  manager.registerInMemory('view', 'crm_lead', runtimeContainer);
  return manager;
}

describe('#13913 getViewsByObject() expands aggregated view containers', () => {
  it('answers with the container EXPANSION, not empty', async () => {
    const manager = managerWithRegistryContainer();

    const views = await manager.getViewsByObject('crm_lead');

    // Pre-fix this was `[]`: the container carries no `viewKind`, so the filter
    // rejected the only row in the store.
    expect(views.length).toBeGreaterThan(0);
    expect(names(views)).toEqual(['crm_lead.default', 'crm_lead.pipeline']);
  });

  it('answers with EXPANDED items and never the container itself (#7163)', async () => {
    const manager = managerWithRegistryContainer();

    const views = (await manager.getViewsByObject('crm_lead')) as Record<string, unknown>[];

    // Every answer is an independent ViewItem bound to the requested object.
    for (const v of views) {
      expect(v.viewKind === 'list' || v.viewKind === 'form').toBe(true);
      expect(v.object).toBe('crm_lead');
    }
    // The container is keyed `crm_lead` and has neither `viewKind` nor a
    // top-level `name`; loosening the filter to admit it is the regression this
    // pins against.
    expect(names(views)).not.toContain('crm_lead');
    expect(views.some((v) => v.list !== undefined || v.listViews !== undefined)).toBe(false);
  });

  it('derives the binding from the top-level `object` when `list.data.object` is absent', async () => {
    const manager = managerWithRegistryContainer();

    // Nothing binds to the container's registry KEY by accident: ask for an
    // object the container does not name and the answer stays empty.
    expect(await manager.getViewsByObject('crm_account')).toEqual([]);
    expect((await manager.getViewsByObject('crm_lead')).length).toBe(2);
  });

  it('reaches a container that arrived through a LOADER, not only the registry', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerLoader(
      new DatabaseLoader({
        driver: storeServing([
          {
            id: 'r1',
            name: 'crm_lead',
            type: 'view',
            // A runtime-authored row: the stored body is the container itself.
            metadata: JSON.stringify({ name: 'crm_lead', ...runtimeContainer }),
          },
        ]),
        cache: { enabled: false },
      }),
    );

    expect(names(await manager.getViewsByObject('crm_lead'))).toEqual([
      'crm_lead.default',
      'crm_lead.pipeline',
    ]);
  });

  // ------------------------------------------------------------------
  // Controls — green in BOTH directions.
  // ------------------------------------------------------------------

  it('CONTROL: a non-container ViewItem still resolves unchanged', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerInMemory('view', 'crm_lead.legacy', independentViewItem);

    const views = await manager.getViewsByObject('crm_lead');

    expect(views).toEqual([independentViewItem]);
  });

  it('CONTROL: already-registered expanded items are NOT duplicated by the expansion', async () => {
    const manager = managerWithRegistryContainer();
    // What every source registrar does: the container under the bare object
    // key, PLUS each expanded item under `<object>.<viewKey>`. The registered
    // copy is the fully-enriched one and must win.
    const registeredPipeline = {
      name: 'crm_lead.pipeline',
      object: 'crm_lead',
      viewKind: 'list',
      config: { type: 'kanban' },
      order: 0,
      scope: 'package',
      _packageId: 'crm',
    };
    manager.registerInMemory('view', 'crm_lead.pipeline', registeredPipeline);

    const views = (await manager.getViewsByObject('crm_lead')) as Record<string, unknown>[];

    expect(names(views)).toEqual(['crm_lead.default', 'crm_lead.pipeline']);
    expect(views.find((v) => v.name === 'crm_lead.pipeline')).toBe(registeredPipeline);
  });
});
