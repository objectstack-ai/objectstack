/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35933 — `listViews()` carries the package the server served each
 * row under (the item's `_packageId`) on both of its arms.
 *
 * A dotted view name does not say whether a view is read-only: the console's
 * own saved shared views are named `object.key` too, stored in the custom
 * package. The served package does, and the console reads it to offer a view's
 * own saves (the footer's calculation menu, Rename) only where the server would
 * take them. The `config`-flattening arm used to rebuild the row from `config`
 * and drop it.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';
import { answerObjectViewRead } from './objectViewRoute.test-support';

const OBJECT = 'showcase_task';

/** A view a code package ships, in the canonical ViewItem shape (body under `config`). */
const SHIPPED = {
  name: `${OBJECT}.in_progress`,
  object: OBJECT,
  viewKind: 'list',
  label: 'In progress',
  config: { type: 'grid', columns: ['name'], data: { provider: 'object', object: OBJECT } },
  _packageId: 'com.example.showcase',
};

/** A shared view the console saved into the customization package. */
const CUSTOM = {
  name: `${OBJECT}.team_tasks`,
  object: OBJECT,
  viewKind: 'list',
  label: 'Team tasks',
  config: { type: 'grid', columns: ['name'], data: { provider: 'object', object: OBJECT } },
  _packageId: 'com.example.showcase.custom',
};

/** A bare spec row (no `config`), the legacy shape the second arm keeps as it is. */
const BARE = {
  name: `${OBJECT}.legacy`,
  object: OBJECT,
  viewKind: 'list',
  label: 'Legacy',
  type: 'grid',
  columns: ['name'],
  data: { provider: 'object', object: OBJECT },
  _packageId: 'com.example.showcase',
};

/** A row bound to no package: served with no `_packageId`. */
const UNBOUND = {
  name: `${OBJECT}.unbound`,
  object: OBJECT,
  viewKind: 'list',
  label: 'Unbound',
  config: { type: 'grid', columns: ['name'], data: { provider: 'object', object: OBJECT } },
};

function makeDS(seed: any[]) {
  const meta = {
    getItems: vi.fn(async (type: string) => ({ type, items: seed.map((r) => structuredClone(r)) })),
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const ds: any = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async (input: RequestInfo | URL) =>
      (await answerObjectViewRead(input, () => ds.client.meta.getItems('view')))
        ?? json({ success: true, data: { capabilities: {}, routes: {} } })),
  });
  ds.connected = true;
  ds.connectionState = 'connected';
  ds.client = { meta, getLocale: () => undefined };
  return ds;
}

describe('listViews carries the served package on every row (objectstack#35933)', () => {
  it('a flattened ViewItem row keeps its `_packageId`, shipped or custom', async () => {
    const rows = await makeDS([SHIPPED, CUSTOM]).listViews(OBJECT);
    const byName = new Map(rows.map((r: any) => [r.name, r]));
    expect(byName.get(SHIPPED.name)?._packageId).toBe('com.example.showcase');
    expect(byName.get(CUSTOM.name)?._packageId).toBe('com.example.showcase.custom');
    // Still the flattened shape the switcher reads.
    expect(byName.get(SHIPPED.name)?.type).toBe('grid');
    expect(byName.get(SHIPPED.name)?.config).toBeUndefined();
  });

  it('a bare spec row keeps its `_packageId`', async () => {
    const [row] = await makeDS([BARE]).listViews(OBJECT);
    expect(row?.name).toBe(BARE.name);
    expect(row?._packageId).toBe('com.example.showcase');
  });

  it('a row served with no package gains none', async () => {
    const [row] = await makeDS([UNBOUND]).listViews(OBJECT);
    expect(row?.name).toBe(UNBOUND.name);
    expect('_packageId' in (row ?? {})).toBe(false);
  });
});
