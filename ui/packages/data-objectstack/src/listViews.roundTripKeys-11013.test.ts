/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11013 — `listViews()` reads a stored ViewItem record by its declared
 * members (ruling 甲 on objectstack#20051, stage ii; the spec end is
 * objectstack#20474's `VIEW_CONSOLE_ROUND_TRIP_KEYS`).
 *
 * `listViews()` flattens a record's `config` to the row the switcher reads.
 * It used to keep `config` plus `name` / `label` / `isDefault` / `_draft` and
 * nothing else, so the keys the console writes at the record's TOP level —
 * `isPinned` and `sortOrder` through `updateView`, `columnState` and
 * `visibility` carried forward by the view-config save — did not come back on
 * a reload of this read. The switcher sorts saved views by the `sortOrder` it
 * reads off this row, so a reordered record lost its place.
 *
 * Each case below is a real round trip against a stub `sys_metadata` store:
 * the adapter's own write, then a fresh `listViews()`. The carried set is read
 * off the spec's record, so a key the spec adds to the `viewItem` member is
 * pinned here without editing this file.
 */

import { describe, it, expect, vi } from 'vitest';
import { VIEW_CONSOLE_ROUND_TRIP_KEYS } from '@objectstack/spec/ui';
import { ObjectStackAdapter } from './index';

const OBJECT = 'crm_task';
const NAME = `${OBJECT}.my_board`;

/** A stored ViewItem record, the shape the console's create path writes. */
const RECORD = {
  name: NAME,
  object: OBJECT,
  viewKind: 'list',
  label: 'My board',
  config: { type: 'grid', columns: ['name', 'stage'], data: { provider: 'object', object: OBJECT } },
};

/** The spec's round-trip keys declared on the ViewItem record. */
const VIEW_ITEM_KEYS = (Object.keys(VIEW_CONSOLE_ROUND_TRIP_KEYS) as Array<keyof typeof VIEW_CONSOLE_ROUND_TRIP_KEYS>)
  .filter((key) => (VIEW_CONSOLE_ROUND_TRIP_KEYS[key] as readonly string[]).includes('viewItem'));

/** A stub metadata store keyed the way `sys_metadata` is: `type` + `name`. */
function makeDS(seed: any[]) {
  const rows = new Map<string, any>(seed.map((r) => [`view::${r.name}`, structuredClone(r)]));
  const meta = {
    getItems: vi.fn(async (type: string) => ({
      type,
      items: [...rows.entries()].filter(([k]) => k.startsWith(`${type}::`)).map(([, v]) => structuredClone(v)),
    })),
    getItem: vi.fn(async (type: string, name: string) => ({ type, name, item: structuredClone(rows.get(`${type}::${name}`)) })),
    saveItem: vi.fn(async (type: string, name: string, item: any) => {
      rows.set(`${type}::${name}`, structuredClone(item));
      return { success: true, item: structuredClone(item) };
    }),
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const ds: any = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    // `updateView` asks the draft home first; nothing is pending here.
    fetch: vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('state=draft')
        ? json({ error: 'not found' }, 404)
        : json({ success: true, data: { capabilities: {}, routes: {} } })),
  });
  ds.connected = true;
  ds.connectionState = 'connected';
  ds.client = { meta };
  return { ds, rows };
}

async function reloadRow(ds: any): Promise<Record<string, any>> {
  const listed = await ds.listViews(OBJECT);
  const row = listed.find((v: any) => v.name === NAME);
  expect(row, 'the record is no longer listed').toBeDefined();
  return row;
}

describe('objectui#11013 — the carried set is the spec\'s', () => {
  it('the ViewItem round-trip keys are the five the card names, read off the spec', () => {
    expect([...VIEW_ITEM_KEYS].sort()).toEqual(['columnState', 'isDefault', 'isPinned', 'sortOrder', 'visibility']);
    // Control on the same record: a key declared on the list overlay only is not one of them.
    expect(VIEW_ITEM_KEYS).not.toContain('_isOverride');
    expect(Object.keys(VIEW_CONSOLE_ROUND_TRIP_KEYS)).toContain('_isOverride');
  });

  it('every one of them, stored at the record\'s top level, comes back on the flattened row', async () => {
    const stored: Record<string, unknown> = {
      isDefault: true,
      isPinned: true,
      sortOrder: 3,
      visibility: 'team',
      columnState: { order: ['stage', 'name'], widths: { name: 240 } },
    };
    for (const key of VIEW_ITEM_KEYS) expect(stored, `no probe value for \`${key}\``).toHaveProperty(key);
    const { ds } = makeDS([{ ...RECORD, ...stored }]);
    const row = await reloadRow(ds);
    for (const key of VIEW_ITEM_KEYS) expect(row[key], key).toEqual(stored[key]);
  });
});

describe('objectui#11013 — a reload round trip per key', () => {
  it('`isPinned`: the pin toggle\'s write comes back', async () => {
    const { ds } = makeDS([RECORD]);
    expect((await reloadRow(ds)).isPinned).toBeUndefined();
    await ds.updateView(OBJECT, NAME, { isPinned: true });
    expect((await reloadRow(ds)).isPinned).toBe(true);
  });

  it('`sortOrder`: the drag-reorder\'s write comes back', async () => {
    const { ds } = makeDS([RECORD]);
    await ds.updateView(OBJECT, NAME, { sortOrder: 2 });
    expect((await reloadRow(ds)).sortOrder).toBe(2);
  });

  it('`visibility`: a stored group survives another write and comes back', async () => {
    // No console control sets it; the console carries a stored value forward.
    const { ds } = makeDS([{ ...RECORD, visibility: 'organization' }]);
    await ds.updateView(OBJECT, NAME, { isPinned: true });
    const row = await reloadRow(ds);
    expect(row.visibility).toBe('organization');
    expect(row.isPinned).toBe(true);
  });

  it('`columnState`: a record-level column layout comes back', async () => {
    const { ds } = makeDS([RECORD]);
    const columnState = { order: ['stage', 'name'], widths: { stage: 120 } };
    await ds.updateView(OBJECT, NAME, { columnState });
    expect((await reloadRow(ds)).columnState).toEqual(columnState);
  });

  it('`isDefault`: the set-default write comes back, and an absent flag still reads `false`', async () => {
    const { ds } = makeDS([RECORD]);
    expect((await reloadRow(ds)).isDefault).toBe(false);
    await ds.updateView(OBJECT, NAME, { isDefault: true });
    expect((await reloadRow(ds)).isDefault).toBe(true);
  });

  it('`object`: the record\'s declared binding is on the flattened row', async () => {
    const { ds } = makeDS([RECORD]);
    expect((await reloadRow(ds)).object).toBe(OBJECT);
  });
});

describe('objectui#11013 — controls: what the flatten still does', () => {
  it('the record\'s `config` is still flattened to the top level, and the nested `config` is not handed on', async () => {
    const { ds } = makeDS([RECORD]);
    const row = await reloadRow(ds);
    expect(row.type).toBe('grid');
    expect(row.columns).toEqual(['name', 'stage']);
    expect(row.label).toBe('My board');
    expect(row).not.toHaveProperty('config');
    expect(row).not.toHaveProperty('viewKind');
  });

  it('a key the record does not carry is not invented on the row', async () => {
    const { ds } = makeDS([RECORD]);
    const row = await reloadRow(ds);
    for (const key of ['isPinned', 'sortOrder', 'visibility', 'columnState']) {
      expect(row, key).not.toHaveProperty(key);
    }
  });

  it('a flat saved row is returned whole, as before', async () => {
    const flat = { name: `${OBJECT}.flat`, object: OBJECT, label: 'Flat', type: 'grid', isPinned: true, sortOrder: 1 };
    const { ds } = makeDS([flat]);
    const listed = await ds.listViews(OBJECT);
    expect(listed).toEqual([flat]);
  });
});
