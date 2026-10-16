// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #23134 — `record:related_list` declares its PARENT record with a binding key
// of its own, `parentDataSource`, beside the child-row `dataSource` (ruling B
// on objectstack-ai/objectui#12296, ruling comment 6137226306).
//
// What is pinned, and why each half is a separate fact:
//
//   A — the key parses with the data-source shape: a full `safeParse` success
//       is the assertion (a key-only check would stay green over a
//       declaration that refused every value), and the shape is the SAME def
//       `PageComponentSchema.dataSource` takes for its object arm — one
//       declaration, two carriers, no copy to drift.
//   B — the values that shape refuses are refused here too, at the key's own
//       path, with the shape's own issue codes (codes and paths, never prose).
//   C — every other `ComponentPropsMap` row refuses the key: the per-type
//       door, which is why the key lives on the props row and not on the node.
//   D — CONTROL: the node-level `dataSource` on this block is untouched. It is
//       still the child-row binding (#6953) and parses exactly as it did,
//       with or without a parent binding beside it.
//   E — the describe opens with the `[PLANNED — not yet rendered]` marker,
//       the one part of the prose a consumer parses (`check-liveness.mts`
//       `MARKER_RE.planned` reads it as the key's liveness status).

import { describe, expect, it } from 'vitest';
import { ComponentPropsMap, RecordRelatedListProps } from './component.zod';
import { ElementDataSourceSchema, PageComponentSchema } from './page.zod';

type Issue = { code: string; path: PropertyKey[]; keys?: string[] };
type Parsed = { success: boolean; data?: unknown; error?: { issues: Issue[] } };
type Door = { safeParse: (v: unknown) => Parsed };

/** A related list that is legal on its own — the base every case adds to. */
const BASE = { objectName: 'task', relationshipField: 'account_id' } as const;

/** A full object binding: every member the data-source shape declares. */
const FULL_BINDING = {
  object: 'account',
  view: 'all_accounts',
  filter: [{ field: 'environment_type', operator: 'equals', value: 'production' }],
  sort: [{ field: 'created_at', order: 'desc' }],
  limit: 1,
};

const parse = (extra: Record<string, unknown>): Parsed =>
  (RecordRelatedListProps as unknown as Door).safeParse({ ...BASE, ...extra });

const zodDef = (schema: unknown): unknown => (schema as { _zod: { def: unknown } })._zod.def;

describe('A — the parent binding parses with the data-source shape', () => {
  it('the base document parses on its own: the positive control every case rests on', () => {
    expect(parse({}).success).toBe(true);
  });

  it('a full object binding parses GREEN, the whole document, and keeps what the shape keeps', () => {
    const r = parse({ parentDataSource: FULL_BINDING });
    expect(r.success).toBe(true);
    const parent = (r.data as Record<string, unknown>).parentDataSource;
    expect(parent).toEqual((ElementDataSourceSchema as unknown as Door).safeParse(FULL_BINDING).data);
  });

  it('a bare `{ object }` binding parses: every other member is optional, as on `dataSource`', () => {
    const r = parse({ parentDataSource: { object: 'account' } });
    expect(r.success).toBe(true);
    expect((r.data as Record<string, unknown>).parentDataSource).toEqual({ object: 'account' });
  });

  it('the key carries no schema default: absent stays absent, so the record context remains the parent', () => {
    const r = parse({});
    expect(r.success).toBe(true);
    expect(r.data as Record<string, unknown>).not.toHaveProperty('parentDataSource');
  });

  it('the key is the SAME def the node-level `dataSource` takes for its object arm, not a copy', () => {
    const key = (RecordRelatedListProps as unknown as { shape: Record<string, { unwrap: () => unknown }> })
      .shape.parentDataSource;
    expect(key).toBeDefined();
    expect(zodDef(key.unwrap())).toBe(zodDef(ElementDataSourceSchema));

    // The node side of the identity, read off the published node schema rather
    // than assumed: `PageComponentSchema` is a closed object (its `visibility`
    // fold, a `.transform` pipe, retired at 18, #23543 F4), and `dataSource` is
    // an optional union whose object arm is that same def.
    const node = PageComponentSchema as unknown as { shape?: Record<string, unknown> };
    const dataSource = node.shape?.dataSource as { unwrap: () => { _zod: { def: { options: unknown[] } } } };
    expect(dataSource).toBeDefined();
    const arms = dataSource.unwrap()._zod.def.options;
    expect(zodDef(arms[0])).toBe(zodDef(ElementDataSourceSchema));
  });
});

describe('B — what the data-source shape refuses, the parent binding refuses at its own path', () => {
  const issuesOf = (binding: unknown): Issue[] => {
    const r = parse({ parentDataSource: binding });
    expect(r.success).toBe(false);
    return r.error!.issues;
  };
  const has = (issues: Issue[], code: string, path: PropertyKey[]) =>
    issues.some((i) => i.code === code && JSON.stringify(i.path) === JSON.stringify(path));

  it('a binding with no `object` is refused at `parentDataSource.object`', () => {
    expect(has(issuesOf({ limit: 1 }), 'invalid_type', ['parentDataSource', 'object'])).toBe(true);
  });

  it('a near-miss spelling (`objectName`) is refused as an unknown key of the binding, not dropped', () => {
    const issues = issuesOf({ object: 'account', objectName: 'account' });
    const unknown = issues.find((i) => i.code === 'unrecognized_keys');
    expect(unknown?.path).toEqual(['parentDataSource']);
    expect(unknown?.keys).toEqual(['objectName']);
  });

  it('the record-form `filter` is refused at `parentDataSource.filter`, as on every filter door', () => {
    expect(has(issuesOf({ object: 'account', filter: { status: 'active' } }), 'invalid_type', ['parentDataSource', 'filter'])).toBe(true);
  });

  it('the API arm of `dataSource` is not admitted: its keys are unknown to the object binding', () => {
    const issues = issuesOf({ provider: 'api', read: { url: '/api/v1/cloud/home' } });
    const unknown = issues.find((i) => i.code === 'unrecognized_keys');
    expect(unknown?.path).toEqual(['parentDataSource']);
    expect([...(unknown?.keys ?? [])].sort()).toEqual(['provider', 'read']);
  });

  it('a non-object value is a TYPE error at the key, never an unknown key: the key IS declared', () => {
    const issues = issuesOf('account');
    expect(issues.some((i) => i.code === 'unrecognized_keys')).toBe(false);
    expect(has(issues, 'invalid_type', ['parentDataSource'])).toBe(true);
  });
});

describe('C — every other component row refuses the key: the per-type door', () => {
  /**
   * The rows whose door refuses the WHOLE props bag, `{}` included, because
   * the type itself is retired at the node. Derived, not listed: a row is in
   * this set exactly when it refuses an empty bag.
   */
  const refusesEveryBag = (door: Door) => !door.safeParse({}).success
    && !door.safeParse({}).error!.issues.some((i) => i.code === 'unrecognized_keys');

  const rows = Object.entries(ComponentPropsMap) as Array<[string, Door]>;

  it('the population is the real map, not an empty loop', () => {
    expect(rows.length).toBeGreaterThan(50);
    expect(rows.some(([type]) => type === 'record:related_list')).toBe(true);
  });

  it('no row but `record:related_list` declares the key', () => {
    const declaring = rows
      .filter(([, door]) => Object.prototype.hasOwnProperty.call((door as { shape?: object }).shape ?? {}, 'parentDataSource'))
      .map(([type]) => type);
    expect(declaring).toEqual(['record:related_list']);
  });

  it('every other row refuses it BY NAME, or refuses the whole bag of a retired type', () => {
    const notRefused: string[] = [];
    const wholeBag: string[] = [];
    for (const [type, door] of rows) {
      if (type === 'record:related_list') continue;
      const r = door.safeParse({ parentDataSource: { object: 'account' } });
      const byName = !r.success && r.error!.issues.some(
        (i) => i.code === 'unrecognized_keys' && (i.keys ?? []).includes('parentDataSource'),
      );
      if (byName) continue;
      if (!r.success && refusesEveryBag(door)) { wholeBag.push(type); continue; }
      notRefused.push(type);
    }
    expect(notRefused).toEqual([]);
    // The whole-bag set is the retired types only — a live row landing here
    // would be refusing for a reason this test does not mean to accept.
    expect(wholeBag.sort()).toEqual(['ai:chat_window', 'user:profile']);
  });

  it('CONTROL: the related list itself does not report the key as unknown', () => {
    const r = (ComponentPropsMap['record:related_list'] as unknown as Door)
      .safeParse({ parentDataSource: { object: 'account' } });
    // It fails for its own required keys, which is the point of the control:
    // the door is judging the bag, and the parent binding is not what it names.
    expect(r.success).toBe(false);
    expect(r.error!.issues.some((i) => i.code === 'unrecognized_keys')).toBe(false);
  });
});

describe('D — CONTROL: the node-level `dataSource` on this block is the child-row binding, unchanged', () => {
  const CHILD_BINDING = { object: 'task', view: 'open_tasks', limit: 10 };
  const node = (properties: Record<string, unknown>) =>
    (PageComponentSchema as unknown as Door).safeParse({ type: 'record:related_list', dataSource: CHILD_BINDING, properties });

  it('a node with a child `dataSource` parses, and keeps the binding as authored', () => {
    const r = node({ ...BASE });
    expect(r.success).toBe(true);
    expect((r.data as Record<string, unknown>).dataSource).toEqual(CHILD_BINDING);
  });

  it('a parent binding beside it changes nothing about the child binding, and survives in `properties`', () => {
    const without = node({ ...BASE });
    const withParent = node({ ...BASE, parentDataSource: { object: 'account', limit: 1 } });
    expect(withParent.success).toBe(true);
    expect((withParent.data as Record<string, unknown>).dataSource)
      .toEqual((without.data as Record<string, unknown>).dataSource);
    const props = (withParent.data as { properties: Record<string, unknown> }).properties;
    expect(props.parentDataSource).toEqual({ object: 'account', limit: 1 });
    expect((ComponentPropsMap['record:related_list'] as unknown as Door).safeParse(props).success).toBe(true);
  });
});

describe('E — the describe carries the liveness marker the ledger reads', () => {
  it('opens with the planned marker, which `check-liveness` reads as the key status', () => {
    const key = (RecordRelatedListProps as unknown as { shape: Record<string, { description?: string }> })
      .shape.parentDataSource;
    expect(key.description?.startsWith('[PLANNED — not yet rendered]')).toBe(true);
  });
});
