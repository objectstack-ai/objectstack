/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#8415 — `FilterBuilderConditionSchema` declares `id`.
 *
 * ## What was wrong
 *
 * The mirror declared a condition as `{ field, operator, value? }`. The
 * component's identity for a row is `id`, and because the mirror is a plain
 * `z.object`, an author who wrote `id` correctly had it STRIPPED in silence.
 * The document then validated and the row rendered — and from then on the row
 * had no individual identity. All four mutation helpers match on `c.id`, every
 * one of them is handed `undefined`, and `undefined === undefined` is TRUE, so
 * each matches EVERY id-less row: `removeCondition` deletes them all in one
 * click (the clicked row included; only uuid-bearing rows survive), and
 * `updateCondition` / `changeOperator` / `changeField` fan one edit out across
 * all of them. `key={condition.id}` becomes `key={undefined}`, which React
 * reads as no key at all rather than as a duplicate one.
 *
 * ⛔ Not "matches none" — the failure is EN BLOC, and it is the more severe of
 * the two readings.
 *
 * Measured on the base commit, through `FilterBuilderConditionSchema.safeParse`:
 * a condition carrying `id` parsed successfully and the parsed OUTPUT did not
 * carry the key. That is the `accepted-and-discarded` class objectui#6150
 * closed for `tree-view.title`, not a refusal.
 *
 * ## Why REQUIRED, and why that is not the answer the GROUP got
 *
 * ⛔ The two `id`s look alike and take OPPOSITE answers — do not unify them.
 *
 *   - `FilterGroupSchema.id` is declared OPTIONAL (objectui#7560): `isValidGroup`
 *     never consults it, nothing reads `filterGroup.id`, and deleting it from an
 *     authored group renders byte-identically. Requiring it would invent a
 *     refusal the renderer does not make.
 *   - A CONDITION's `id` is the opposite reading. `assertion the four match
 *     sites and the React key are live` below re-derives it from the component
 *     source rather than quoting a count.
 *
 * ⭐ The narrowing therefore refuses only what is ALREADY broken: a condition
 * with no `id` renders today but cannot be edited or removed INDIVIDUALLY —
 * every affordance on it acts on all the id-less rows at once. Nothing that
 * works stops working.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { FilterBuilderConditionSchema, FilterGroupSchema } from '../zod/complex.zod';
import { safeValidateSchema } from '../zod/index.zod';
import type { FilterBuilderCondition as TsCondition, FilterGroup as TsGroup } from '../complex';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const READER = 'packages/components/src/custom/filter-builder.tsx';
const readerSource = readFileSync(join(REPO_ROOT, READER), 'utf8');

const FIELDS = [{ value: 'a', label: 'A', type: 'text' }];
const WELL_FORMED = { id: 'c1', field: 'a', operator: 'equals', value: 'x' };
const NO_ID = { field: 'a', operator: 'equals', value: 'x' };
const doc = (value: unknown) => ({ type: 'filter-builder', name: 'f', fields: FIELDS, value });
const group = (conditions: unknown[]) => ({ id: 'root', logic: 'and', conditions });

/* ── Type-level pins: the TS twin moved WITH the mirror ───────────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
function expectType<T extends true>(_: T = true as T): void { /* compile-time only */ }

expectType<Equal<TsCondition['id'], string>>();
// `id` is REQUIRED, not merely typed `string`: an object that OMITS the key must
// be rejected, and only this annotation proves it. The `@ts-expect-error` IS the
// assertion — delete the `id` declaration and this line stops erroring, which
// fails the compile.
// @ts-expect-error `FilterBuilderCondition.id` is required (objectui#8415)
const conditionWithoutId: TsCondition = { field: 'a', operator: 'equals' };
// …and the GROUP's stayed optional, so the two faces cannot be "unified" by a
// future editor without one of these two lines going red.
const groupWithoutId: TsGroup = { logic: 'and', conditions: [] };

describe('objectui#8415 — the condition `id` is DECLARED, so it is no longer stripped', () => {
  it('the repair itself: `id` survives the parse output', () => {
    // The base measurement this moves away from: `success` was already `true`,
    // and the key was GONE from `.data`. Asserting only `success` would have
    // been green before and after.
    const parsed = FilterBuilderConditionSchema.safeParse(WELL_FORMED);
    expect(parsed.success).toBe(true);
    expect(parsed.success && Object.keys(parsed.data as object).sort())
      .toEqual(['field', 'id', 'operator', 'value']);
    expect(parsed.success && (parsed.data as { id?: unknown }).id).toBe('c1');
  });

  it('REFUSES a condition with no `id`, on the direct arm and through a group', () => {
    expect(FilterBuilderConditionSchema.safeParse(NO_ID).success).toBe(false);
    expect(FilterGroupSchema.safeParse(group([NO_ID])).success).toBe(false);
    // The third arm this test used to carry — an id-less row inside a nested
    // sub-group — is gone with the nesting (objectui#9306): a sub-group is now
    // refused BY NAME whatever its rows say, so that fixture would stay red for
    // a reason that is not `id`. The sub-group refusal is pinned in
    // `filter-builder-nested-group-retired-9306.test.ts`.
  });

  it('REFUSES it through the authored document too — a row of the group `value`', () => {
    // This test used to carry three entry paths: `value` and `defaultValue`
    // were each `union([condition, group])`, so a condition reached the mirror
    // bare or inside a group. objectui#10825 left one. A bare condition is now
    // refused as a `value` BY NAME whatever its keys say, and `defaultValue` is
    // retired, so those two fixtures would stay red for a reason that is not
    // `id`; both are pinned in `filter-builder-value-group-only-10825.test.ts`.
    expect(safeValidateSchema(doc(group([NO_ID]))).success).toBe(false);
  });

  it('type-checks `id` now that it is declared — `id: 42` was ACCEPTED before', () => {
    // The second thing declaring a key buys, and the one an author never sees:
    // a `z.object` gives an UNDECLARED key no check at all, so `id: 42` parsed
    // clean at base and was then dropped.
    expect(FilterBuilderConditionSchema.safeParse({ ...WELL_FORMED, id: 42 }).success).toBe(false);
  });
});

describe('objectui#8415 — the negative controls that must NOT have moved', () => {
  it('still ACCEPTS a well-formed condition (anti-vacuity)', () => {
    expect(FilterBuilderConditionSchema.safeParse(WELL_FORMED).success).toBe(true);
    expect(FilterGroupSchema.safeParse(group([WELL_FORMED])).success).toBe(true);
    expect(safeValidateSchema(doc(group([WELL_FORMED]))).success).toBe(true);
    expect(safeValidateSchema(doc(group([]))).success).toBe(true);
  });

  it('still REFUSES a bad operator — and the fixture carries `id` so THIS is what refuses it', () => {
    // Without the `id`, this assertion would stay green with
    // `FilterOperatorSchema` deleted outright: the row would be refused for the
    // missing key instead. Carrying `id` isolates the operator.
    expect(FilterBuilderConditionSchema.safeParse({ ...WELL_FORMED, operator: 'not_a_real_operator' }).success)
      .toBe(false);
    expect(FilterBuilderConditionSchema.safeParse({ id: 'c1', operator: 'equals', value: 'x' }).success)
      .toBe(false);
  });

  it('the GROUP `id` is UNTOUCHED — still optional, still type-checked (objectui#7560)', () => {
    // ⛔ The trap this card was split out to avoid. The group's `id` has zero
    // read sites; requiring it would refuse a document that renders perfectly.
    expect(FilterGroupSchema.safeParse({ logic: 'and', conditions: [WELL_FORMED] }).success).toBe(true);
    expect(FilterGroupSchema.safeParse({ id: 42, logic: 'and', conditions: [] }).success).toBe(false);
    expect(FilterGroupSchema.safeParse({ operator: 'and', conditions: [] }).success).toBe(false);
    expect(groupWithoutId.conditions).toEqual([]);
    expect(conditionWithoutId.field).toBe('a');
  });
});

describe('objectui#8415 — the enforcement the declaration now matches, re-derived from the reader', () => {
  it('the four MATCH sites are live in the component', () => {
    // Re-derived from source rather than quoted as a count: if a refactor moves
    // a row's identity off `id`, this reddens and the REQUIRED declaration has
    // to be re-argued rather than silently outliving its reason.
    const matchSites = [
      // removeCondition
      'conditions: filterGroup.conditions.filter((c) => c.id !== conditionId)',
      // updateCondition
      'c.id === conditionId ? { ...c, ...updates } : c',
      // changeOperator
      'c.id === conditionId',
      // changeField
      'if (c.id !== conditionId) return c',
    ];
    for (const site of matchSites) expect(readerSource).toContain(site);
  });

  it('the React `key` on the row is the condition `id`', () => {
    expect(readerSource).toContain('key={condition.id}');
  });

  it('a new row is BORN with an `id` — the producer agrees with the declaration', () => {
    expect(readerSource).toContain('id: crypto.randomUUID(),');
  });

  it('the component takes `id` from THIS declaration — it derives its condition type, it does not restate it', () => {
    // The renderer half of `declared = enforced`. It used to be pinned as the
    // component's own hand-written `id: string`; objectui#9306 deleted that
    // second declaration, and the component now DERIVES its row from the
    // `FilterBuilderCondition` declared in this package, restating only
    // `operator` and `value` (the two named extensions). So the requiredness
    // pinned at the top of this file — `Equal<…, string>` plus the
    // `@ts-expect-error` on an id-less literal — is the requiredness the
    // component gets, by construction. What is pinned here is that the
    // derivation is still the one in place: `id` is NOT among the members the
    // component omits and restates, and no hand-written interface is back.
    // The derived row is named `FilterBuilderRow` (objectui#6349, batch 12), so
    // `FilterBuilderCondition` names this package's row only, and the
    // component must not declare that name again in either form.
    // The component-side type pins live in
    // `packages/components/src/__tests__/filter-builder-name-authority-9306.test.tsx`.
    expect(readerSource).toContain('FilterBuilderCondition as AuthoredFilterBuilderCondition,\n');
    expect(readerSource).toContain('} from "@object-ui/types"');
    expect(readerSource).toContain(
      'export interface FilterBuilderRow\n  extends Omit<AuthoredFilterBuilderCondition, "operator" | "value"> {\n',
    );
    expect(readerSource).not.toContain('export interface FilterBuilderCondition');
  });

  it('anti-vacuity for the source probes: a spelling that is NOT there reads false', () => {
    // The instrument above is `String.prototype.includes`; a probe that matches
    // nothing would make every assertion in this block unfalsifiable.
    expect(readerSource).not.toContain('c.zzzNotAKey === conditionId');
    expect(readerSource.length).toBeGreaterThan(1000);
  });
});
