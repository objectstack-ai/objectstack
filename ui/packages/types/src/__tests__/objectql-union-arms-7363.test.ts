/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-gallery` / `object-data-table` nodes reach a validation arm
 * (objectui#7363).
 *
 * PR #7355 (objectui#6576) minted `ObjectGallerySchema` and
 * `ObjectDataTableSchema` on both faces and deliberately left
 * `ObjectQLComponentSchema` alone, so `AnyComponentSchema` — and with it
 * `validateSchema` / `safeValidateSchema` / `objectui validate` — had no arm for
 * either node type. A document carrying one was refused as matching NO arm,
 * exactly as before the schemas existed, and a wrong-typed key on such a node
 * could never be diagnosed by name.
 *
 * Two legs per node type, because a pass alone proves nothing — the shape
 * `safe-validate-corpus-6318.test.ts` uses for `code-editor` / `bar-chart`:
 *
 *  1. a minimal document validates through the published entry point;
 *  2. the arm is a real declaration: a wrong-typed DECLARED key on the node is
 *     refused, and the refusal names that key. `BaseSchema` is `.passthrough()`,
 *     so an UNKNOWN key would prove nothing; every probe below is a key the
 *     mirror declares. Before the arms existed the same documents were refused
 *     too — for the wrong reason, with no arm naming the key — which is why the
 *     BY-NAME half is the load-bearing one, not `.success === false`.
 *
 * The TS face is pinned beside it: `ObjectQLComponentSchema` narrows to each
 * declaration by its discriminant, instead of to `never`.
 */
import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { safeValidateSchema, ObjectQLComponentSchema as ObjectQLComponentZod } from '../zod/index.zod.js';
import type { ObjectQLComponentSchema, ObjectGallerySchema, ObjectDataTableSchema } from '../objectql.js';

/* ── Type-level pins: the TS union narrows by discriminant ─────────────────── */

type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/** Was `never` while the union had ten arms. */
export type assertionGalleryIsAnArm =
  Expect< Equal< Extract< ObjectQLComponentSchema, { type: 'object-gallery' } >, ObjectGallerySchema > >;
export type assertionDataTableIsAnArm =
  Expect< Equal< Extract< ObjectQLComponentSchema, { type: 'object-data-table' } >, ObjectDataTableSchema > >;

/* ── Runtime helpers ───────────────────────────────────────────────────────── */

/**
 * Every issue path in the tree, INCLUDING the per-arm `errors` a Zod 4
 * `invalid_union` hangs off its top-level issue (objectui#7004 measured that
 * shape: the root reports one `invalid_union` at `[]` and the arms' real
 * diagnoses live in `errors[i]`). A node with no arm produces paths of `type`
 * only — every arm fails on its literal — so a DECLARED key's path appearing
 * here is proof that an arm accepted the discriminant and read the key.
 */
function issuePaths(result: ReturnType<typeof safeValidateSchema>): string[] {
  if (result.success) return [];
  const out: string[] = [];
  const walk = (issues: readonly z.core.$ZodIssue[]) => {
    for (const issue of issues) {
      out.push(issue.path.map(String).join('.'));
      const nested = (issue as { errors?: readonly (readonly z.core.$ZodIssue[])[] }).errors;
      if (nested) for (const arm of nested) walk(arm);
    }
  };
  walk(result.error.issues);
  return out;
}

describe('objectui#7363 — the two objectui#6576 schemas are arms of the ObjectQL union', () => {
  it('the zod union carries both literals', () => {
    const literals = ObjectQLComponentZod.options.map(
      (arm) => (arm.shape.type as z.ZodLiteral<string>).value,
    );
    expect(literals).toContain('object-gallery');
    expect(literals).toContain('object-data-table');
    // The ten arms PR #7355 left in place are all still there — this is an
    // addition, not a reshuffle — less `object-form` and `object-map`, whose
    // authored arms left this union for `ObjectQLPublicBlockComponentSchema` in
    // objectui#10859 batches 4 and 5 (`object-form-properties-bag-10859-b4.test.ts`,
    // `object-map-properties-bag-10859-b5.test.ts`), and `object-chart`, whose
    // authored arm left the same way in objectui#11276
    // (`object-chart-properties-bag-11276.test.ts`), and `object-gantt`, whose
    // authored arm left in objectui#10859 batch 6
    // (`object-gantt-properties-bag-10859-b6.test.ts`), and `object-grid`, whose
    // authored arm left in objectui#11276's `object-grid` batch
    // (`object-grid-properties-bag-11276.test.ts`), and `list-view`, whose
    // authored page arm left in objectui#12670
    // (`list-view-properties-bag-12670.test.ts`).
    expect(literals).toHaveLength(6);
    expect(literals).not.toContain('list-view');
    expect(literals).not.toContain('object-grid');
    expect(literals).not.toContain('object-form');
    expect(literals).not.toContain('object-map');
    expect(literals).not.toContain('object-chart');
    expect(literals).not.toContain('object-gantt');
  });

  it.each([
    ['object-gallery', { type: 'object-gallery' }],
    ['object-gallery with its keys', { type: 'object-gallery', objectName: 'contact', imageField: 'photo', titleField: 'name' }],
    ['object-data-table', { type: 'object-data-table' }],
    // `dataProvider` left this fixture with the typed declaration it exercised
    // (objectui#7353): the key is now a retirement tombstone, refused by name.
    ['object-data-table with its keys', { type: 'object-data-table', objectName: 'contact', searchable: true, pagination: false }],
  ])('a minimal %s document validates through safeValidateSchema', (_label, doc) => {
    const r = safeValidateSchema(doc);
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues, null, 2)).toBe(true);
  });

  it.each([
    ['object-gallery', 'imageField', { type: 'object-gallery', imageField: 42 }],
    ['object-data-table', 'searchable', { type: 'object-data-table', searchable: 'yes' }],
  ])('a wrong-typed declared key on %s is refused BY NAME at %s', (_type, path, doc) => {
    // A third row probed `dataProvider.provider` on object-data-table. It pinned
    // the typed declaration objectui#7353 retired, so it was removed with it
    // rather than respelled. The key is now a retirement tombstone; its by-name
    // refusal, well-formed and malformed, is pinned in
    // `object-data-table-dataprovider-retired-7353.test.ts`.
    // Probe keys are ones NO OTHER arm declares: measured on the ten-arm tree,
    // `data` and `className` were already named by a sibling arm's issues, so
    // they could not tell "this arm read it" from "some arm read it".
    const r = safeValidateSchema(doc);
    expect(r.success).toBe(false);
    // The load-bearing half: an arm accepted the discriminant and diagnosed
    // the key. With no arm, every path here is `type`.
    expect(issuePaths(r)).toContain(path);
  });

  it('the runtime-slot refusal on object-data-table now reaches the author (objectui#6124 shape)', () => {
    // `onRowClick` is refused BY NAME by the mirror (`handlerKeyRefusal`); until
    // the arm existed that refusal was unreachable — the node never got past
    // `type`.
    const r = safeValidateSchema({ type: 'object-data-table', onRowClick: 'handler' });
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain('onRowClick');
  });
});
