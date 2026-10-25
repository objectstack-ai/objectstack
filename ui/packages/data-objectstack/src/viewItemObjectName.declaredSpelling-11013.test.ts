/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11013 — a stored `view` row's bound object is read under the
 * spelling the spec declares, `object` (ruling 甲 on objectstack#20051, stage
 * ii: "objectui aligns its reads to the declared spellings").
 *
 * `viewItemObjectName` read `data.object ?? object ?? objectName`. The third leg
 * is gone. Three facts make that safe, and each is measured here rather than
 * recalled:
 *
 *   1. THE DOOR. The spec declares `object` on every `view` member and
 *      `objectName` on none, so the metadata write door
 *      (`ViewMetadataSchema`, which `saveMetaItem` validates every `view` body
 *      against) refuses a row bound by `objectName` alone — on the flattened
 *      overlay and on the ViewItem record. The same body bound by `object`
 *      parses: the firing control that the refusal is about the spelling.
 *   2. THE WRITERS. Every write path in this adapter stamps `object`, so a row
 *      the console wrote carries it whatever else it carries.
 *   3. THE ANSWER. A row carrying both spellings answers exactly as before (the
 *      `object` leg was already read first); only a row carrying the undeclared
 *      spelling alone stops matching — in `listViews` and `listViewOverrides`
 *      alike, since both narrow through this one accessor.
 */

import { describe, it, expect, vi } from 'vitest';
import { ViewMetadataSchema } from '@objectstack/spec/ui';
import { ObjectStackAdapter, viewItemObjectName } from './index';

const OBJECT = 'crm_task';

/** A stub metadata store keyed the way `sys_metadata` is: `type` + `name`. */
function makeDS(seed: any[] = []) {
  const rows = new Map<string, any>(seed.map((r) => [`view::${r.name}`, r]));
  const meta = {
    getItems: vi.fn(async (type: string) => ({
      type,
      items: [...rows.entries()].filter(([k]) => k.startsWith(`${type}::`)).map(([, v]) => v),
    })),
    getItem: vi.fn(async (type: string, name: string) => ({ type, name, item: rows.get(`${type}::${name}`) })),
    saveItem: vi.fn(async (type: string, name: string, item: any) => {
      rows.set(`${type}::${name}`, { ...item });
      return { success: true, item: rows.get(`${type}::${name}`) };
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
  return { ds, meta, rows };
}

describe('objectui#11013 — the door: `objectName` alone does not bind a stored view row', () => {
  const overlay = { name: `${OBJECT}.mine`, viewKind: 'list', type: 'grid', columns: ['name'] };
  const record = { name: `${OBJECT}.mine`, viewKind: 'list', config: { type: 'grid', columns: ['name'] } };

  it('the flattened overlay: refused bound by `objectName`, parsed bound by `object`', () => {
    expect(ViewMetadataSchema.safeParse({ ...overlay, objectName: OBJECT }).success).toBe(false);
    expect(ViewMetadataSchema.safeParse({ ...overlay, object: OBJECT }).success).toBe(true);
  });

  it('the ViewItem record: refused bound by `objectName`, parsed bound by `object`', () => {
    expect(ViewMetadataSchema.safeParse({ ...record, objectName: OBJECT }).success).toBe(false);
    expect(ViewMetadataSchema.safeParse({ ...record, object: OBJECT }).success).toBe(true);
  });
});

describe('objectui#11013 — the writers: every console write path stamps `object`', () => {
  it('createView and updateView each leave `object` on the row', async () => {
    // The `updateView` target is a row at rest with no binding at all: the
    // merge stamps one on the way back out. (`updateViewConfig` was the third
    // writer here until objectui#12504 retired it.)
    const { ds, rows } = makeDS([{ name: `${OBJECT}.at_rest`, label: 'At rest', type: 'grid' }]);
    await ds.createView(OBJECT, { name: `${OBJECT}.created`, label: 'Created', type: 'grid' });
    await ds.updateView(OBJECT, `${OBJECT}.at_rest`, { isPinned: true });
    for (const name of [`${OBJECT}.created`, `${OBJECT}.at_rest`]) {
      expect(rows.get(`view::${name}`)?.object, name).toBe(OBJECT);
      expect(rows.get(`view::${name}`), name).not.toHaveProperty('objectName');
    }
  });
});

describe('objectui#11013 — the answer: `object` and `data.object` bind, `objectName` does not', () => {
  it('reads `data.object`, then `object`', () => {
    expect(viewItemObjectName({ object: OBJECT })).toBe(OBJECT);
    expect(viewItemObjectName({ data: { provider: 'object', object: OBJECT } })).toBe(OBJECT);
    expect(viewItemObjectName({ list: { data: { provider: 'object', object: OBJECT } } })).toBe(OBJECT);
  });

  it('a row carrying both spellings answers as before — by `object`', () => {
    expect(viewItemObjectName({ object: OBJECT, objectName: OBJECT })).toBe(OBJECT);
    expect(viewItemObjectName({ object: OBJECT, objectName: 'other' })).toBe(OBJECT);
  });

  it('a row carrying only `objectName` is bound to no object', () => {
    expect(viewItemObjectName({ objectName: OBJECT })).toBeUndefined();
    expect(viewItemObjectName({ list: { objectName: OBJECT } })).toBeUndefined();
  });

  it('listViews and listViewOverrides narrow by the same answer', async () => {
    const declared = { name: `${OBJECT}.declared`, object: OBJECT, label: 'Declared', type: 'grid' };
    const undeclared = { name: `${OBJECT}.undeclared`, objectName: OBJECT, label: 'Undeclared', type: 'grid' };
    const { ds } = makeDS([declared, undeclared]);

    const listed = (await ds.listViews(OBJECT)).map((v: any) => v.name);
    expect(listed).toEqual([`${OBJECT}.declared`]);

    const overrides = await ds.listViewOverrides(OBJECT);
    expect(Object.keys(overrides)).toEqual([`${OBJECT}.declared`]);
  });
});
