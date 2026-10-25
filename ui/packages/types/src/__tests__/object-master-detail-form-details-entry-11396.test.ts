/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11396 — an `object-master-detail-form` `details` entry is judged by
 * the spec's own closed entry, on both published faces, by reference.
 *
 * `@objectstack/spec` 17.6.0 judges `ComponentPropsMap['object-master-detail-form']
 * .details` as an array of closed entries (objectstack-ai/objectstack#21215):
 * `childObject` required, every other member optional, `columns` the spec's
 * inline grid column, an undeclared key refused by name. This package's
 * `ObjectMasterDetailFormBlockSchema` takes the whole props row through
 * `stripImportedDefaults(SpecObjectMasterDetailFormPropsSchema)` (objectui#10859
 * batch 2), so it needed no edit for the entry to be judged — which is exactly
 * the claim that goes quiet if nobody pins it. This file pins it, so a later
 * hand-mirrored `details` here, or a spec change to the entry, is red.
 *
 * ## What is pinned
 *
 *   - BY REFERENCE, at the type level: the bag's `details` entry IS the spec's
 *     entry (judged by `tsc -p tsconfig.test.json`).
 *   - THE VERDICTS, on the tolerant face (`safeValidateSchema`) and on the
 *     strict authoring face, which `objectui validate` runs, for a node
 *     authored in the spec's `{ type, properties }` form: an undeclared entry
 *     key is refused at the entry with the key named; an entry with no
 *     `childObject` is refused at that member; a bare field-name column is
 *     refused at the column; a column with an undeclared key is refused at the
 *     column with the key named; `{ childObject }` alone is accepted — the lit
 *     control.
 *   - ONE VERDICT ACROSS THE TWO DOORS: each probe gets the verdict the spec's
 *     own props row gives it, read live in the same run, at the same path under
 *     `properties`.
 *
 * ## The fork, closed: `sortField` is refused with the spec's retired-key message
 *
 * Through 17.6.0 the spec entry declared `sortField` while `MasterDetailForm`
 * read no such member (objectui#11070 round 9 retired the authored override, and
 * `plugin-form`'s `masterDetailDetailsMembers-8071.test.tsx` row 2c pins that a
 * written one reaches nothing), so `objectui validate` ACCEPTED an entry carrying
 * it while the renderer ignored it — and this row pinned that acceptance as the
 * forward tripwire. `@objectstack/spec` 17.7.0 carries the retirement
 * (objectstack-ai/objectstack#21589, PR objectstack-ai/objectstack#21632,
 * `6ec54f00`): a `retiredKey()` tombstone on the entry. So the row is flipped at
 * objectui's bump to that release (objectui#11717): both published faces refuse
 * an entry carrying `sortField` at that member, with the spec's own message.
 * `MasterDetailDetailConfig` keeps its `Omit` of the key: the spec entry still
 * LISTS it (as a tombstone), and the TypeScript face leaves it off rather than
 * offer a member whose only legal value is absence.
  */

import { describe, it, expect } from 'vitest';
import {
  ObjectMasterDetailFormPropsSchema as SpecObjectMasterDetailFormPropsSchema,
  type ObjectMasterDetailFormProps as SpecObjectMasterDetailFormProps,
} from '@objectstack/spec/ui';
import type { z } from 'zod';
import { ObjectMasterDetailFormBlockSchema } from '../zod/objectql.zod.js';
import { safeValidateSchema, StrictAnyComponentSchema } from '../zod/index.zod.js';

/* ── Type level ───────────────────────────────────────────────────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/** The spec's `details` entry on its authoring face. */
type SpecDetailEntry = NonNullable<SpecObjectMasterDetailFormProps['details']>[number];
/** The same position on this package's block, read off its `properties` bag. */
type MirrorDetailEntry = NonNullable<
  NonNullable<z.input<typeof ObjectMasterDetailFormBlockSchema>['properties']>['details']
>[number];

export type detailsEntryIsTheSpecs = [
  Expect<Equal<MirrorDetailEntry, SpecDetailEntry>>,
  // Non-vacuity: the comparison can fail.
  Expect<Equal<Equal<MirrorDetailEntry, Omit<SpecDetailEntry, 'childObject'>>, false>>,
];

/* ── Runtime ──────────────────────────────────────────────────────────────── */

type Issue = { code: string; path: readonly PropertyKey[]; keys?: readonly string[]; message?: string };

/** A node authored in the spec's `{ type, properties }` form, with ONE detail entry. */
const nodeWith = (entry: unknown) => ({
  type: 'object-master-detail-form',
  properties: { objectName: 'po', details: [entry] },
});

type Face = { name: string; parse: (doc: unknown) => { success: boolean; error?: { issues: Issue[] } } };
const FACES: Face[] = [
  { name: 'tolerant (`safeValidateSchema`)', parse: (doc) => safeValidateSchema(doc) as never },
  { name: 'strict authoring face', parse: (doc) => StrictAnyComponentSchema.safeParse(doc) as never },
];

/** The issues a refused parse raised AT or UNDER one path, with that prefix stripped. */
function issuesUnder(result: ReturnType<Face['parse']>, prefix: readonly PropertyKey[]): Issue[] {
  if (result.success) return [];
  return (result.error?.issues ?? [])
    .filter((issue) => prefix.every((segment, i) => issue.path[i] === segment))
    .map((issue) => ({ ...issue, path: issue.path.slice(prefix.length) }));
}

const PROBES = [
  { name: '`{ childObject }` alone (the lit control)', entry: { childObject: 'po_line' } },
  { name: 'an undeclared entry key', entry: { childObject: 'po_line', bogusKey: 1 } },
  { name: 'no `childObject`', entry: { title: 'Lines' } },
  { name: 'a bare field-name column', entry: { childObject: 'po_line', columns: ['qty'] } },
  { name: 'a column with an undeclared key', entry: { childObject: 'po_line', columns: [{ name: 'qty', bogusKey: 1 }] } },
  { name: 'the retired `sortField` (a tombstone since 17.7.0)', entry: { childObject: 'po_line', sortField: 'line_no' } },
] as const;

describe('an `object-master-detail-form` `details` entry is judged by the spec\'s closed entry (objectui#11396)', () => {
  describe.each(FACES)('on the $name', ({ parse }) => {
    it('accepts `{ childObject }` alone — the lit control', () => {
      const result = parse(nodeWith({ childObject: 'po_line' }));
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    });

    it('refuses an undeclared entry key at the entry, naming the key', () => {
      const result = parse(nodeWith({ childObject: 'po_line', bogusKey: 1 }));
      expect(result.success).toBe(false);
      const atEntry = issuesUnder(result, ['properties', 'details', 0]);
      expect(atEntry.map((issue) => [issue.code, issue.path, issue.keys])).toEqual([
        ['unrecognized_keys', [], ['bogusKey']],
      ]);
    });

    it('refuses an entry with no `childObject`, at that member', () => {
      const result = parse(nodeWith({ title: 'Lines' }));
      expect(result.success).toBe(false);
      const atEntry = issuesUnder(result, ['properties', 'details', 0]);
      expect(atEntry.map((issue) => [issue.code, issue.path])).toEqual([['invalid_type', ['childObject']]]);
    });

    it('refuses a bare field-name column at the column', () => {
      const result = parse(nodeWith({ childObject: 'po_line', columns: ['qty'] }));
      expect(result.success).toBe(false);
      const atColumn = issuesUnder(result, ['properties', 'details', 0, 'columns', 0]);
      expect(atColumn.map((issue) => issue.code)).toEqual(['invalid_type']);
    });

    it('refuses a column with an undeclared key at the column, naming the key', () => {
      const result = parse(nodeWith({ childObject: 'po_line', columns: [{ name: 'qty', bogusKey: 1 }] }));
      expect(result.success).toBe(false);
      const atColumn = issuesUnder(result, ['properties', 'details', 0, 'columns', 0]);
      expect(atColumn.map((issue) => [issue.code, issue.path, issue.keys])).toEqual([
        ['unrecognized_keys', [], ['bogusKey']],
      ]);
    });

    it('REFUSES `sortField` at that member with the spec\'s retired-key message — objectstack#21589, released in 17.7.0', () => {
      // Flipped at the bump (objectui#11717): this row asserted the 17.6.0
      // acceptance as the forward tripwire for the retirement.
      const entry = { childObject: 'po_line', sortField: 'line_no' };
      const result = parse(nodeWith(entry));
      expect(result.success).toBe(false);
      const spec = SpecObjectMasterDetailFormPropsSchema.safeParse(nodeWith(entry).properties);
      expect(spec.success).toBe(false);
      const specIssue = spec.error!.issues.find((issue) => issue.path.join('.') === 'details.0.sortField')!;
      expect(specIssue.message).toContain('`details[].sortField` was removed');
      const atMember = issuesUnder(result, ['properties', 'details', 0, 'sortField']);
      expect(atMember.map((issue) => [issue.code, issue.path, issue.message])).toEqual([
        [specIssue.code, [], specIssue.message],
      ]);
    });
  });

  it.each(PROBES)('one verdict across the two doors — $name', ({ entry }) => {
    const spec = SpecObjectMasterDetailFormPropsSchema.safeParse(nodeWith(entry).properties);
    const mirror = safeValidateSchema(nodeWith(entry)) as ReturnType<Face['parse']>;
    expect(mirror.success).toBe(spec.success);
    // The same codes at the same paths, the mirror's under `properties`.
    const specIssues = (spec.success ? [] : spec.error.issues).map((issue) => [issue.code, issue.path]);
    const mirrorIssues = issuesUnder(mirror, ['properties']).map((issue) => [issue.code, issue.path]);
    expect(mirrorIssues).toEqual(specIssues);
  });

  it('the probe table is not vacuous — both verdicts occur', () => {
    const verdicts = PROBES.map(({ entry }) => safeValidateSchema(nodeWith(entry)).success);
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });
});
