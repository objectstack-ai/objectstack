/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11117 — a gate-wrapped arm waives `objectName` exactly when the
 * node's `dataSource.object` names the object.
 *
 * Every arm below is registered through `elementDataSourceBlock`, so
 * `ElementDataSourceGate` (`@object-ui/react`) lands a binding's `object` on
 * `objectName` before the renderer reads the node. The tolerant face
 * (`safeValidateSchema`) refused the bindings
 * the docs teach anyway: `object-grid` and `list-view` required `objectName`,
 * and the `object-kanban` / `object-calendar` / `object-gantt` / `object-map`
 * record-source ladders had no rung for the binding.
 *
 * The fix is ONE refinement, `requireRecordSource` in `../zod/objectql.zod.ts`,
 * with the binding counted on `dataSourceSuppliesObject` from
 * `../zod/public-blocks.zod.ts` — the predicate `element:number`'s spec waiver
 * already read. This file pins, per arm:
 *
 *   - the binding parses, with no `objectName` and no other rung;
 *   - a node with neither is still refused, keyed `RECORD_SOURCE_REQUIRED` —
 *     at `objectName` on the two arms whose only rung it is, at the root on
 *     the ladder arms;
 *   - an EMPTY `dataSource.object` supplies nothing — the waiver is "a
 *     non-empty name", as the spec gate's `strName` and the runtime's
 *     `isElementDataSourceConfig` read it, ⛔ not "the key exists";
 *   - a wrong-typed `objectName` beside a binding is still the member's own
 *     refusal, so the waiver covers an OMITTED key only.
 *
 * ⚠️ `object-map` is judged on its AUTHORED arm, `ObjectMapBlockSchema`, the
 * `properties`-bag arm objectui#10859 batch 5 put in `AnyComponentSchema` in
 * place of the flat `ObjectMapSchema`. That arm reads the rungs in the bag, so
 * its `objectName` rows write `properties.objectName`. The flat mirror is no
 * longer an arm of the face; it stays the node as `ObjectMap` reads it after
 * the hoist, and carries the same refinement, pinned by the last case below.
 *
 * And, from disk, that every documented binding in the two pages the card
 * names parses on the tolerant face.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { safeValidateSchema, StrictAnyComponentSchema } from '../zod/index.zod';
import {
  ListViewSchema,
  ObjectCalendarSchema,
  ObjectGanttSchema,
  ObjectGridSchema,
  ObjectKanbanSchema,
  ObjectMapBlockSchema,
  ObjectMapSchema,
  ObjectViewSchema,
} from '../zod/objectql.zod';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

/** The gate-wrapped arms with a record-source requirement, each with the arm `AnyComponentSchema` judges it by. */
const ARMS = [
  ['object-grid', ObjectGridSchema],
  ['list-view', ListViewSchema],
  ['object-kanban', ObjectKanbanSchema],
  ['object-calendar', ObjectCalendarSchema],
  ['object-gantt', ObjectGanttSchema],
  ['object-map', ObjectMapBlockSchema],
] as const;

/** Where an arm takes its `objectName`: on the node, or in the `properties` bag (the authored `object-map`). */
const withObjectName = (type: (typeof ARMS)[number][0], objectName: unknown): Record<string, unknown> =>
  type === 'object-map' ? { type, properties: { objectName } } : { type, objectName };
const OBJECT_NAME_PATH = (type: (typeof ARMS)[number][0]): string =>
  type === 'object-map' ? 'properties.objectName' : 'objectName';

/** Where the refusal sits: the one rung on a one-rung arm, the root on a ladder. */
const REFUSAL_PATH: Record<(typeof ARMS)[number][0], PropertyKey[]> = {
  'object-grid': ['objectName'],
  'list-view': ['objectName'],
  'object-kanban': [],
  'object-calendar': [],
  'object-gantt': [],
  'object-map': [],
};

type Issue = { code: string; path: PropertyKey[]; params?: { code?: string } };
type Parsed = { success: boolean; error?: { issues: Issue[] } };

const issuesOf = (r: Parsed): Issue[] => (r.success ? [] : (r.error?.issues ?? []));
const recordSourceIssues = (r: Parsed): Issue[] =>
  issuesOf(r).filter((i) => i.params?.code === 'RECORD_SOURCE_REQUIRED');
const explain = (r: Parsed): string => JSON.stringify(issuesOf(r).map((i) => [i.code, i.path.join('.')]));

describe('objectui#11117 — the binding is a record source on every gate-wrapped arm', () => {
  it.each(ARMS)('%s: `{ type, dataSource: { object } }` parses on the member and the tolerant face', (type, member) => {
    const node = { type, dataSource: { object: 'account' } };
    const viaMember = member.safeParse(node) as Parsed;
    expect(viaMember.success, explain(viaMember)).toBe(true);
    const viaFace = safeValidateSchema(node) as Parsed;
    expect(viaFace.success, explain(viaFace)).toBe(true);
  });

  it.each(ARMS)('%s: …and on the strict authoring face, which derives the same refinement', (type) => {
    const r = StrictAnyComponentSchema.safeParse({ type, dataSource: { object: 'account' } }) as Parsed;
    expect(r.success, explain(r)).toBe(true);
  });

  it.each(ARMS)('%s: a node with NEITHER is still refused, keyed RECORD_SOURCE_REQUIRED', (type, member) => {
    const r = member.safeParse({ type }) as Parsed;
    expect(r.success).toBe(false);
    const found = recordSourceIssues(r);
    expect(found, explain(r)).toHaveLength(1);
    expect(found[0].code).toBe('custom');
    expect(found[0].path).toEqual(REFUSAL_PATH[type]);
    expect(recordSourceIssues(safeValidateSchema({ type }) as Parsed)).toHaveLength(1);
  });

  it.each(ARMS)('%s: an EMPTY `dataSource.object` supplies nothing — the waiver needs a name', (type, member) => {
    const r = member.safeParse({ type, dataSource: { object: '' } }) as Parsed;
    expect(r.success).toBe(false);
    expect(recordSourceIssues(r), explain(r)).toHaveLength(1);
  });

  it.each(ARMS)('%s: a binding that is not a record supplies nothing either, and is refused at the key too', (type, member) => {
    const r = member.safeParse({ type, dataSource: 'account' }) as Parsed;
    expect(r.success).toBe(false);
    expect(issuesOf(r).some((i) => i.path.join('.') === 'dataSource'), explain(r)).toBe(true);
    expect(recordSourceIssues(r), explain(r)).toHaveLength(1);
  });

  it.each(ARMS)('%s: a wrong-typed `objectName` beside a binding is the member\'s refusal — only an OMITTED key is waived', (type, member) => {
    const r = member.safeParse({ ...withObjectName(type, 7), dataSource: { object: 'account' } }) as Parsed;
    expect(r.success).toBe(false);
    expect(issuesOf(r).map((i) => [i.code, i.path.join('.')]), explain(r)).toEqual([['invalid_type', OBJECT_NAME_PATH(type)]]);
  });

  it.each(ARMS)('%s: `objectName` alone still parses, an empty one included — nothing narrowed', (type, member) => {
    expect((member.safeParse(withObjectName(type, 'account')) as Parsed).success).toBe(true);
    expect((member.safeParse(withObjectName(type, '')) as Parsed).success).toBe(true);
  });

  it('object-grid: the record-source refusal is reported BESIDE another key\'s, as the required member was', () => {
    // `when: () => true` on the shared refinement. Before objectui#11117 the
    // missing `objectName` was the member's `invalid_type`, reported beside
    // every other issue on the node; a refinement zod skipped after the
    // `columns` failure would have dropped it.
    const r = ObjectGridSchema.safeParse({ type: 'object-grid', columns: 5 }) as Parsed;
    expect(issuesOf(r).map((i) => i.path.join('.')), explain(r)).toEqual(['columns', 'objectName']);
    expect(recordSourceIssues(r), explain(r)).toHaveLength(1);
  });

  it('object-map: the flat mirror, no longer an arm of the face, carries the same rule on the node', () => {
    // The node as `ObjectMap` reads it after the hoist (objectui#10859 batch 5's
    // docblock). Same helper, rungs read on the node instead of in the bag.
    const bound = ObjectMapSchema.safeParse({ type: 'object-map', dataSource: { object: 'account' } }) as Parsed;
    expect(bound.success, explain(bound)).toBe(true);
    const neither = ObjectMapSchema.safeParse({ type: 'object-map' }) as Parsed;
    expect(recordSourceIssues(neither).map((i) => i.path), explain(neither)).toEqual([[]]);
    const empty = ObjectMapSchema.safeParse({ type: 'object-map', dataSource: { object: '' } }) as Parsed;
    expect(recordSourceIssues(empty), explain(empty)).toHaveLength(1);
  });

  it('object-view: its `table` slot still takes the grid keys and passes unknown ones through, with no record-source check', () => {
    // The slot is rebuilt from the grid's `.shape`, because zod 4 refuses
    // `.omit()` on the grid now that it carries the refinement.
    const r = ObjectViewSchema.safeParse({ type: 'object-view', objectName: 'account', table: { columns: ['name'], extra: 1 } });
    expect(r.success, explain(r as Parsed)).toBe(true);
    if (r.success) expect((r.data.table as Record<string, unknown>).extra).toBe(1);
    const bad = ObjectViewSchema.safeParse({ type: 'object-view', objectName: 'account', table: { columns: 5 } }) as Parsed;
    expect(issuesOf(bad).map((i) => i.path.join('.'))).toEqual(['table.columns']);
  });
});

/* ── The documented bindings, read off the pages ────────────────────────────── */

const DOCS = ['content/docs/utilities/data-objectstack.mdx', 'content/docs/guide/data-source.md'] as const;

/** Every ```json fence on the page that parses to a node binding an object through `dataSource`. */
function documentedBindings(doc: string): Array<{ type: string; node: Record<string, unknown> }> {
  const text = readFileSync(join(REPO_ROOT, doc), 'utf8');
  const out: Array<{ type: string; node: Record<string, unknown> }> = [];
  for (const match of text.matchAll(/^```json\n([\s\S]*?)^```$/gm)) {
    let node: unknown;
    try {
      node = JSON.parse(match[1]);
    } catch {
      continue;
    }
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    const { type, dataSource } = node as { type?: unknown; dataSource?: unknown };
    if (typeof type !== 'string' || !dataSource || typeof dataSource !== 'object') continue;
    out.push({ type, node: node as Record<string, unknown> });
  }
  return out;
}

describe('objectui#11117 — every documented per-element binding parses on the tolerant face', () => {
  it('the reading is not vacuous: each page yields the bindings the card names', () => {
    // A control on the extraction, not a census: if the fence walk stopped
    // matching, the parse test below would pass over nothing.
    expect(documentedBindings(DOCS[0]).map((b) => b.type)).toEqual(
      expect.arrayContaining(['list-view', 'object-grid', 'object-form', 'object-kanban']),
    );
    expect(documentedBindings(DOCS[1]).map((b) => b.type)).toEqual(
      expect.arrayContaining(['list-view', 'element:number']),
    );
  });

  it.each(DOCS)('%s: each binding fence parses', (doc) => {
    const refused = documentedBindings(doc)
      .map(({ type, node }) => ({ type, result: safeValidateSchema(node) as Parsed }))
      .filter(({ result }) => !result.success)
      .map(({ type, result }) => `${type}: ${explain(result)}`);
    expect(refused).toEqual([]);
  });
});

/**
 * objectui#5250 — a refusal's `path` is minted per issue, never shared.
 *
 * zod 4 copies an added issue SHALLOWLY (`util.issue` spreads it) and then
 * prefixes its `path` IN PLACE (`util.prefixIssues`: `iss.path.unshift(segment)`)
 * as the issue climbs out of an array slot or an object key. So an `addIssue`
 * that hands over an array it keeps — built once, when the arm was defined —
 * has that array rewritten by the first refusal reported from inside a
 * container, and every later refusal of the arm reports the rewritten path, for
 * the life of the module. `objectui check` judges many files in one process,
 * and the `unit` project shares one module graph per worker (`isolate: false`),
 * so both read the drift: measured, after the docs corpus went through the
 * strict face, a bare `object-kanban` member parse reported its ROOT refusal at
 * `0 → 0 → 0 → 0`.
 *
 * The probe refuses each arm from inside a parent's child list, then refuses it
 * bare again: the bare path must not have moved.
 */
describe('objectui#5250 — a refusal reported from inside a container leaves the next one where it was', () => {
  it.each(ARMS)('%s: the bare refusal path is unchanged by a nested refusal', (type, member) => {
    const before = recordSourceIssues(member.safeParse({ type }) as Parsed).map((i) => i.path);
    const nested = safeValidateSchema({ type: 'card', title: 'Records', children: [{ type }] }) as Parsed;
    const nestedPaths = recordSourceIssues(nested).map((i) => i.path);
    expect(nestedPaths.length, `the nested node must be refused for this probe to mean anything: ${explain(nested)}`).toBeGreaterThan(0);
    for (const p of nestedPaths) expect(p.slice(0, 2), explain(nested)).toEqual(['children', 0]);
    const after = recordSourceIssues(member.safeParse({ type }) as Parsed).map((i) => i.path);
    expect(before).toEqual([REFUSAL_PATH[type]]);
    expect(after).toEqual([REFUSAL_PATH[type]]);
  });
});
