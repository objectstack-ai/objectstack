/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * What objectui's page schemas accept for a view-data component's retired
 * `api` binding, now that the spec's page-parse judge of it is gone
 * (objectui#12666).
 *
 * objectstack#23784 removed that judge from `@objectstack/spec/ui`: "the
 * component-props rule is the one judge of a page component's retired api data
 * binding". That rule is `validateComponentProps` in `@objectstack/lint`, run at
 * the save door, `os validate` and `os build`; it is not a spec export and not a
 * Zod refinement, so objectui has nothing to attach in its place. The spec's own
 * `PageSchema` on objectstack `main` accepts the binding (the PR's door table:
 * "`PageSchema.safeParse` / `definePage` / `defineStack` … accepted: these doors
 * run no lint rule").
 *
 * This file pins what objectui's doors answer after the attachment left
 * `PageNodeSchema` and `PageKindNodeSchema`:
 *  - under `slots`, whose children no component arm judges, the binding is
 *    ACCEPTED at any depth (the removed judge walked the whole slot subtree,
 *    so a block nested in a `page:tabs` item widened too): this is the
 *    widening, the same one the spec took;
 *  - under `regions`, each component is judged by its arm in the component
 *    union. The `object-grid`, `object-map` and `object-gantt` arms read the
 *    `properties` bag and refuse the binding by themselves, at
 *    `properties.data.provider`. The `object-tree` arm does not read the bag
 *    (it refuses a bag-only tree for having no record source, with or without
 *    the binding), so it has no region leg here; that answer is the arm's own
 *    and did not move with this change, because the spec's object-level check
 *    never ran once a region child had failed.
 * ⛔ No spec-side leg. None could be written while 18.0.0-next.2 refused the
 * slotted binding and objectstack `main` accepted it. The installed
 * 18.0.0-next.3 accepts it too (objectstack `a35f7a6`), so a spec leg is
 * writable now; it would be a new assertion, not the bump that made it so.
 */
import { describe, it, expect } from 'vitest';
import { PageNodeSchema, safeValidateSchema } from '../zod/index.zod';

const API = { provider: 'api', read: { url: '/api/rows' } };
const OBJ = { provider: 'object', object: 'task' };
const VIEW_DATA_TYPES = ['object-grid', 'object-map', 'object-gantt', 'object-tree'] as const;
/** The arms that read a region component's `properties` bag. */
const BAG_ARMS = ['object-grid', 'object-map', 'object-gantt'] as const;

/** Every nested issue path, joined, under an issue tree (union branches included). */
const nestedPaths = (issues: readonly unknown[]): string[] =>
  issues.flatMap((issue) => {
    const i = issue as { path?: PropertyKey[]; errors?: unknown[][] };
    return [(i.path ?? []).map(String).join('.'), ...(i.errors ?? []).flatMap((branch) => nestedPaths(branch))];
  });

const block = (type: string, data: unknown) => ({ type, properties: { objectName: 'task', data } });
const slotted = (type: string, data: unknown) => ({ kind: 'slotted', slots: { details: [block(type, data)] } });
const inRegion = (type: string, data: unknown) => ({ regions: [{ name: 'main', components: [block(type, data)] }] });
/** A `page:tabs` whose first item holds the block as a child: the nested position. */
const tabs = (child: unknown) => ({ type: 'page:tabs', properties: { items: [{ label: 'One', children: [child] }] } });

/** The `page` node through its own schema and the published door, and the `home` kind node. */
const doors = (extra: Record<string, unknown>) => [
  ['PageNodeSchema', PageNodeSchema.safeParse({ type: 'page', ...extra })],
  ['safeValidateSchema(page)', safeValidateSchema({ type: 'page', ...extra })],
  ['safeValidateSchema(home)', safeValidateSchema({ type: 'home', ...extra })],
] as const;

describe('objectui#12666 — a slotted view-data block naming the retired `api` provider is accepted', () => {
  it.each(VIEW_DATA_TYPES)('%s under `slots.details`: every page door accepts it', (type) => {
    for (const [door, r] of doors(slotted(type, API))) {
      expect({ door, success: r.success }).toEqual({ door, success: true });
    }
  });
});

describe('objectui#12666 — a NESTED slotted view-data block naming the retired `api` provider is accepted', () => {
  it('`object-grid` in `slots.details` › `page:tabs` › `items[0].children[0]`: every page door accepts it', () => {
    for (const [door, r] of doors({ kind: 'slotted', slots: { details: [tabs(block('object-grid', API))] } })) {
      expect({ door, success: r.success }).toEqual({ door, success: true });
    }
  });
});

describe('objectui#12666 — a region view-data block naming the retired `api` provider is still refused, by its own arm', () => {
  it('`object-grid` in `regions` › `page:tabs` › `items[0].children[0]`: every page door refuses it at the nested `properties.data.provider` (unchanged)', () => {
    for (const [door, r] of doors({ regions: [{ name: 'main', components: [tabs(block('object-grid', API))] }] })) {
      expect({ door, success: r.success }).toEqual({ door, success: false });
      expect(nestedPaths(r.error!.issues)).toContain('regions.0.components.0.properties.items.0.children.0.properties.data.provider');
    }
  });


  it.each(BAG_ARMS)('%s under `regions`: every page door refuses it at that component, on `properties.data.provider`', (type) => {
    for (const [door, r] of doors(inRegion(type, API))) {
      expect({ door, success: r.success }).toEqual({ door, success: false });
      const issues = r.error!.issues;
      expect(issues.map((i) => i.path.join('.'))).toContain('regions.0.components.0');
      expect(nestedPaths(issues)).toContain('properties.data.provider');
    }
  });
});

describe('objectui#12666 — controls', () => {
  it.each(VIEW_DATA_TYPES)('%s with an `object` binding passes in a slot on every page door', (type) => {
    for (const [door, r] of doors(slotted(type, OBJ))) {
      expect({ door, success: r.success }).toEqual({ door, success: true });
    }
  });

  it.each(BAG_ARMS)('%s with an `object` binding passes in a region on every page door', (type) => {
    for (const [door, r] of doors(inRegion(type, OBJ))) {
      expect({ door, success: r.success }).toEqual({ door, success: true });
    }
  });
});
