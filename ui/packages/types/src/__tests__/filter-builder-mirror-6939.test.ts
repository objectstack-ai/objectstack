/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#6939, the `filter-builder` group — the VALIDATOR half. The render
 * half is
 * `examples/schema-catalog/test/filter-builder-mirror-6939.test.tsx`.
 *
 * ## The defect
 *
 * Three independent mis-declarations in one member, each a key-name or
 * vocabulary MOVE rather than a missing optional key:
 *
 *   1. `FilterFieldSchema` required `name`. Every read site matches an entry by
 *      `value` — `fields.find((f) => f.value === …)` in `getOperatorsForField`,
 *      `changeField`, `getInputType` and `renderValueInput`, `fields[0]?.value`
 *      in `addCondition`, and `<SelectItem value={field.value}>` in the field
 *      dropdown. `name` had zero.
 *   2. Its `type` enum was `string | number | date | boolean | select`.
 *      `string` is a phantom; `text`, `datetime` and `time` — three of the six
 *      `FilterValueFamily` members the component actually folds a column into —
 *      were all refused.
 *   3. `FilterGroupSchema` was `{ operator, conditions }`. The gate is
 *      `isValidGroup` (`custom/filter-builder.tsx:1060`), which reads
 *      `conditions` and `logic` and nothing else.
 *
 * All five `components-complex-filter-builder/*` catalog entries author
 * `{ value, label, type }` fields and a `{ id, logic, conditions }` group — the
 * registration's own `inputs`/`defaultProps` spelling — so the mirror refused
 * every one of them while the renderer drew them.
 *
 * ## Ruling
 *
 * Maintainer, 2026-09-02, via the director seat (summon #8), verbatim 「同意」,
 * recorded as objectui#6939 comment 5510084784. Its `filter-builder` row:
 * *field key is `value`; type vocabulary `text` / `number` / `boolean` /
 * `date` / `datetime` / `time`; group shape `{ id, logic, conditions }`.*
 *
 * ## Two places this implementation departs from a LITERAL reading, and why
 *
 * Both are measured, both are declared here rather than made quietly, and both
 * are flagged on the PR for contract review.
 *
 *   - **`select` is retained.** The ruling's six-member list inherits the
 *     finding card's description of `select` as "extra". It is not: it has its
 *     own operator bucket (`selectLikeTypes` in `custom/filter-builder.tsx`,
 *     read by `operatorsForFieldType` and `isOptionDrivenValueControl`) and
 *     draws the option-driven Select instead of a text box. Dropping it would
 *     refuse a spelling this mirror accepts TODAY and the renderer draws
 *     distinctly — a fresh instance of the class this card closes.
 *   - **Group `id` is declared OPTIONAL.** `isValidGroup` never consults it and
 *     nothing reads `filterGroup.id`; deleting it from an authored group
 *     renders byte-identically (the render half measures that). Requiring it
 *     would invent a refusal the renderer does not make.
 *
 * ## objectui#7562 — the vocabulary widened to the published doc's FOURTEEN
 *
 * Ruled 2026-09-08 (director seat, decision batch #88): of the three
 * declarations of this authoring surface the published doc is the AUTHORITY,
 * so `type` widens to its fourteen members and becomes OPTIONAL (`text` when
 * absent). The ruling's precondition — every one of the fourteen has a
 * renderer branch, or it comes out of the doc instead — was measured first,
 * one condition row per member through the real `FilterBuilder`, reading both
 * the value control and the operator bucket. All fourteen passed; nothing was
 * withdrawn from the doc. `FilterFieldSchema`'s docblock carries the table.
 *
 * The assertions below therefore MOVED, not merely widened: the seven
 * `still refuses the live-but-unruled spelling …` pins became
 * `accepts …, and the renderer draws it`, and the doc-vs-mirror assertion's
 * closing line — which pinned that the mirror still required `type` — became
 * its opposite. That is the whole delta objectui#7562 lands here.
 *
 * ## objectui#8774 — the doc-WIDENING direction, which nothing here caught
 *
 * objectui#7562 made the doc the authority, but the pins in this file bound the
 * enum to a hard-coded `DOCUMENTED_FOURTEEN` constant, and the doc-reading pin
 * asserted only doc ⊇ fourteen. So of the two ways the authority can move, one
 * was guarded and one was not:
 *
 *   - doc NARROWS (a member removed) → the ⊇ pin reddens.
 *   - doc WIDENS (a fifteenth member added) → nothing reddened. And widening is
 *     the direction objectui#7562 CAME FROM: the doc published fourteen while
 *     the mirror accepted seven, and no instrument said so.
 *
 * Measured, not reasoned. The ceiling reviewer's ablation Leg E added `'email'`
 * to the DOC alone (hash-verified, restored) and every pin in this file stayed
 * green; its control, Leg D — the same member added to BOTH code faces — did
 * redden, so the file was live and the hole was directional.
 *
 * The fix then was that the population was TAKEN from the doc (`documentedTypes()`)
 * instead of copied beside it, so `the accept set is EXACTLY the published doc`
 * compares the enum against the authority rather than against a copy of it and
 * fails in both directions. A doc-seeded pin has its own failure mode — a reader
 * that silently matches nothing turns the pin vacuous in the same stroke — so
 * every reader THROWS on absence and `the doc reader has a floor` drives that,
 * with the doc's own two-member `logic` union as the positive control.
 *
 * (The doc reader and its floor went with the doc; see objectstack#27145 and
 * objectstack#27369 below for where the authority lives now.)
 *
 * ## The FOURTH divergence, and how it was settled
 *
 * This file once recorded a residual: two of the four census entries — plus the
 * `filter-builder` nested inside `search-interface` — still refused afterwards,
 * because they authored `conditions[].operator` as `eq` / `gt` / `lt` while
 * `FilterOperatorSchema` declares the spec's canonical `equals` /
 * `greater_than` / `less_than`. That residual was filed as objectui#7561 and is
 * now CLOSED, in two landings that must not be confused with one another:
 *
 *   1. objectui#7561 (PR #9305) routed the operator trigger's identity
 *      comparison through `normalizeFilterOperator`, so all three spellings of
 *      one operator DRAW the same label. It deliberately changed no catalog
 *      data and widened no accepted set.
 *   2. objectui#6939's own remainder then rewrote the seven authored spellings
 *      in those three files to the declared vocabulary — the contract-first
 *      direction, `@objectstack/spec` being the side that is right. The enum
 *      was NOT widened to meet them by a local alias list.
 *
 * ## objectui#9559 — the two refusal pins that MOVED (ruling B, ratified)
 *
 * This file used to pin two refusals as recorded decisions rather than
 * silences: `the alias dialect is still REFUSED` (`eq` / `gt` / `lt`) and `the
 * dropdown's own dialect is still REFUSED` (`greaterThan` / `lessThan`). The
 * ruling on objectui#9559 settled both: `FilterOperatorSchema` is now the spec
 * rule's own operator member, so it accepts every spelling the PROTOCOL
 * accepts and normalises it on parse — which is what `ViewFilterRuleSchema`
 * has always done. Both pins therefore turned into their opposite, and each
 * now also asserts the NORMALISED output, because the one behaviour change is
 * the shape a parsed authored document comes back in. The contract-first
 * claim still holds, one level up: nothing is accepted that the protocol
 * refuses, and `an operator the protocol refuses is still REFUSED` below is
 * the control that says so. The mirror-side pins of the ruling itself live in
 * `filter-operator-protocol-set-9559.test.ts`.
 *
 * ## objectstack#27145 / objectstack#27369 — the authority is `FILTER_FIELD_TYPES`
 *
 * The authority the pins above read, `content/docs/components/complex/filter-builder.mdx`,
 * left the tree with the ObjectUI docs site, and objectstack#27145 froze its
 * last `type?:` union in this file as a hand-kept copy. objectstack#27369
 * replaced that copy with a SINGLE declaration: `FILTER_FIELD_TYPES` and its
 * four behaviour buckets in `../filter-field-types.ts`. `FilterFieldSchema.type`
 * builds its enum from it, `FilterField['type']` is typed from it, and
 * `custom/filter-builder.tsx` takes its buckets from it — so the three faces
 * share one list and cannot drift apart, which is the class objectui#6939,
 * #7562 and #8774 each repaired by hand. The accepted set did not move: the
 * same fourteen, `type` optional, `text` when absent.
 *
 * What a single source cannot guarantee by itself is pinned instead:
 *
 *   - **every member has a renderer branch** — the ruling's precondition. That
 *     is a render measurement, so it lives in the render half
 *     (`examples/schema-catalog/test/filter-builder-mirror-6939.test.tsx`,
 *     `` `<member>` draws a branch of its own, not the fallthrough ``): a
 *     member added to the list with no bucket reddens there.
 *   - **every member is a spec `FieldType`**, except the members named in
 *     `SPEC_FIELD_TYPE_EXEMPTIONS` below, each with its reason. A member that
 *     is neither reddens here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { FilterBuilderSchema, FilterFieldSchema, FilterGroupSchema } from '../zod/complex.zod';
import { safeValidateSchema } from '../zod/index.zod';
import type { FilterField as TsFilterField, FilterGroup as TsFilterGroup } from '../complex';
import { FieldType as SpecFieldTypeEnum } from '@objectstack/spec/data';
import {
  FILTER_FIELD_TYPES,
  FILTER_LOOKUP_LIKE_TYPES,
  FILTER_NUMBER_LIKE_TYPES,
  FILTER_SELECT_LIKE_TYPES,
  type FilterFieldType,
} from '../filter-field-types';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const CATALOG = join(REPO_ROOT, 'examples/schema-catalog/src/schemas/components-complex-filter-builder');
const READER = 'packages/components/src/custom/filter-builder.tsx';
/**
 * Members of `FILTER_FIELD_TYPES` that are NOT a spec `FieldType`, each with the
 * reason it is accepted anyway. ⛔ Exempting is the only way past the spec
 * check — never drop a member to green it, because the accepted set must not
 * narrow (objectstack#27369).
 */
const SPEC_FIELD_TYPE_EXEMPTIONS: Readonly<Partial<Record<FilterFieldType, string>>> = {
  status: 'accepted since objectui#7562 and drawn by the select-like bucket; the spec models '
    + 'a status column as a `select` field, and dropping it would narrow the accepted set',
};

/** The four entries `node packages/cli/dist/cli.js check` counts for this row. */
const CENSUS = ['empty-filter-builder', 'product-search', 'user-filters', 'with-conditions'] as const;

function entry(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(CATALOG, `${name}.json`), 'utf8')) as Record<string, unknown>;
}

/** The `filter-builder` node nested inside the `stack`-rooted fifth entry. */
function nestedSearchInterface(): Record<string, unknown> {
  const doc = entry('search-interface') as { children: Record<string, unknown>[] };
  const node = doc.children.find((c) => c.type === 'filter-builder');
  if (!node) throw new Error('search-interface no longer carries a filter-builder child');
  return node;
}

/** Report the issues rather than `false`, so a red run says what broke. */
function reasons(schema: unknown): string[] {
  const r = safeValidateSchema(schema);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

/**
 * The three spellings these fixtures authored BEFORE objectui#6939's remainder,
 * keyed by the declared member each was rewritten to — all three are rows of
 * the spec's alias table, so since objectui#9559 they parse and normalise back.
 */
const FORMER_ALIAS: Record<string, string> = { equals: 'eq', greater_than: 'gt', less_than: 'lt' };

/** A spelling no vocabulary carries, in the same three slots: the refusal control. */
const NOT_AN_OPERATOR: Record<string, string> = {
  equals: 'qqzz_absent', greater_than: 'qqzz_absent', less_than: 'qqzz_absent',
};

/** The dropdown's OWN camelCase id for the same three operators — also alias
 * rows of the spec's table, so also normalised on parse since objectui#9559. */
const DROPDOWN_ID: Record<string, string> = {
  equals: 'equals',
  greater_than: 'greaterThan',
  less_than: 'lessThan',
};

/** Rewrite every `conditions[].operator` through `table`, changing nothing else. */
function withOperators(
  doc: Record<string, unknown>,
  table: Record<string, string>,
): Record<string, unknown> {
  const group = doc.value as { conditions: { operator: string }[] };
  return {
    ...doc,
    value: {
      ...group,
      conditions: group.conditions.map((c) => ({ ...c, operator: table[c.operator] ?? c.operator })),
    },
  };
}

/* ── Type-level pins (invariant equality, house form) ─────────────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
function expectType<T extends true>(_: T = true as T): void { /* compile-time only */ }

// The TS twin moved WITH the mirror. These fail to compile if either face
// drifts back, which is the half a runtime assertion cannot cover. `type` is
// the shared list's member type (objectstack#27369), not a restated union.
expectType<Equal<TsFilterField['value'], string>>();
expectType<Equal<TsFilterField['type'], FilterFieldType | undefined>>();
// `type` is OPTIONAL, not merely `… | undefined`: an entry that OMITS the key
// must be assignable, which only this annotation proves — the same distinction
// the group `id` needs three lines down (objectui#7562, item 2).
const fieldWithoutType: TsFilterField = { value: 'a', label: 'A' };
expectType<Equal<TsFilterGroup['logic'], 'and' | 'or'>>();
expectType<Equal<TsFilterGroup['id'], string | undefined>>();
// `id` is OPTIONAL, not merely typed `string | undefined`: an object that omits
// the key must be assignable, which only this annotation proves.
const groupWithoutId: TsFilterGroup = { logic: 'and', conditions: [] };
// `name` is gone from the declaration — `@ts-expect-error` is the assertion.
// @ts-expect-error `FilterField.name` was renamed to `value` (objectui#6939)
const legacyNamedField: TsFilterField = { name: 'a', label: 'A', type: 'text' };

describe('objectui#6939 — the field key is `value`', () => {
  it('accepts the spelling every read site matches on', () => {
    expect(FilterFieldSchema.safeParse({ value: 'a', label: 'A', type: 'text' }).success).toBe(true);
  });

  it('REFUSES the former `name` spelling — this half of the move is breaking', () => {
    // The accept set MOVES here, it does not merely widen: a document authored
    // against the old mirror stops validating. Named in the changeset.
    expect(FilterFieldSchema.safeParse({ name: 'a', label: 'A', type: 'text' }).success).toBe(false);
  });

  it('`name` is not silently tolerated as a passthrough hole either', () => {
    // A non-strict object does not refuse an unknown key, so an undeclared
    // `name` is accepted rather than refused — discarded while the mirror was
    // strip mode, kept since objectstack#25923 (`.passthrough()`). What makes the
    // refusal real is that `value` is REQUIRED, so the old shape has no identity
    // at all.
    const parsed = FilterFieldSchema.safeParse({ value: 'a', label: 'A', type: 'text', name: 'a' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && Object.keys(FilterFieldSchema.shape)).not.toContain('name');
  });

  it('the reader still matches on `value`', () => {
    // Text-anchored, so a rename in the component turns this red instead of
    // leaving the prose above quietly false.
    const src = readFileSync(join(REPO_ROOT, READER), 'utf8');
    expect(src).toContain('fields.find((f) => f.value === fieldValue)');
    expect(src).toContain('fields[0]?.value');
    expect(src).toContain('value: string');
  });
});

/** The ruling's six. */
const RULED = ['text', 'number', 'boolean', 'date', 'datetime', 'time'] as const;

/**
 * The seven the published doc declared that this mirror refused until
 * objectui#7562 — each with its own behaviour bucket and its own value
 * control, which is exactly why the ruling let them in rather than cutting
 * them out of the doc.
 *
 * Paired with the shared bucket that CARRIES each one (objectstack#27369: the
 * buckets live in `filter-field-types.ts` and the renderer takes them from
 * there), so a member moved out of its bucket turns this red instead of
 * leaving the mirror declaring a key nothing draws.
 */
const BUCKETED_TYPES: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ['currency', 'FILTER_NUMBER_LIKE_TYPES', FILTER_NUMBER_LIKE_TYPES],
  ['percent', 'FILTER_NUMBER_LIKE_TYPES', FILTER_NUMBER_LIKE_TYPES],
  ['rating', 'FILTER_NUMBER_LIKE_TYPES', FILTER_NUMBER_LIKE_TYPES],
  ['status', 'FILTER_SELECT_LIKE_TYPES', FILTER_SELECT_LIKE_TYPES],
  ['lookup', 'FILTER_LOOKUP_LIKE_TYPES', FILTER_LOOKUP_LIKE_TYPES],
  ['master_detail', 'FILTER_LOOKUP_LIKE_TYPES', FILTER_LOOKUP_LIKE_TYPES],
  ['user', 'FILTER_LOOKUP_LIKE_TYPES', FILTER_LOOKUP_LIKE_TYPES],
];

/** The enum this mirror actually declares, behind `.optional()`. */
function mirrorTypeMembers(): string[] {
  return (FilterFieldSchema as unknown as {
    shape: { type: { unwrap(): { options: string[] } } };
  }).shape.type.unwrap().options;
}

describe('objectui#6939 — the type vocabulary', () => {

  it.each(RULED)('accepts the ruled member `%s`', (type) => {
    expect(FilterFieldSchema.safeParse({ value: 'a', label: 'A', type }).success).toBe(true);
  });

  it('accepts `select`, which this implementation RETAINS against a literal reading', () => {
    // ⚠️ Declared departure — see the header. `selectLikeTypes` gives `select`
    // its own operator bucket and the option-driven value control, so dropping
    // it would refuse a live spelling. If contract review rules the other way,
    // this is the assertion that flips, together with the enum.
    expect(FilterFieldSchema.safeParse({ value: 'a', label: 'A', type: 'select' }).success).toBe(true);
    const src = readFileSync(join(REPO_ROOT, READER), 'utf8');
    expect(FILTER_SELECT_LIKE_TYPES).toContain('select');
    expect(src).toContain('const selectLikeTypes: readonly string[] = FILTER_SELECT_LIKE_TYPES');
  });

  it('REFUSES `string` — the phantom the enum used to carry', () => {
    // Breaking half #2. `string` reached the text control only by the
    // unrecognised-word fallthrough in `valueFamilyForFieldType`, so it was
    // indistinguishable from a nonsense spelling; the render half measures that.
    expect(FilterFieldSchema.safeParse({ value: 'a', label: 'A', type: 'string' }).success).toBe(false);
  });

  it.each(BUCKETED_TYPES)(
    'accepts `%s`, and the renderer draws it from the shared bucket `%s`',
    (type, bucketName, bucket) => {
      // objectui#7562, items 1+2: a member the authority offers and the
      // renderer draws is a member this mirror accepts. The accept and the
      // branch that earns it are asserted together — "⛔ never a key declared
      // that nothing draws" — so they redden as one.
      expect(FilterFieldSchema.safeParse({ value: 'a', label: 'A', type }).success).toBe(true);
      expect(bucket).toContain(type);
      expect(readFileSync(join(REPO_ROOT, READER), 'utf8')).toContain(`= ${bucketName}`);
    },
  );

  it('`text` earns its place by NAME, not by a distinct control', () => {
    // ⚠️ The one member whose branch a DOM measurement cannot show. `text` is
    // the unrecognised-word fallthrough TARGET, so a `text` column draws what
    // a nonsense spelling draws; measured, they are identical. What separates
    // it from the `string` phantom below is that the renderer NAMES it — line
    // 408 is where an absent `type` acquires the family called `text` — and
    // that naming is also what makes `type` safe to leave optional, which is
    // why these two assertions live in one test.
    const src = readFileSync(join(REPO_ROOT, READER), 'utf8');
    expect(src).toContain('const type = fieldType || "text"');
    // Pinned in FULL, because the claim is about the whole list: these are the
    // six family names, and `string` is not one of them.
    expect(src).toContain(
      'type FilterValueFamily = "text" | "number" | "boolean" | "date" | "datetime" | "time"',
    );
    expect(FilterFieldSchema.safeParse({ value: 'a', label: 'A', type: 'text' }).success).toBe(true);
    // …and `string`, which the renderer names in no bucket (the four are
    // pinned verbatim in the tests above) and in no field-type equality test,
    // is still refused. The pair is the point: one fallthrough, two verdicts,
    // decided by whether the renderer says the word.
    expect(src).not.toContain('type === "string"');
    expect(FilterFieldSchema.safeParse({ value: 'a', label: 'A', type: 'string' }).success).toBe(false);
  });

  it('`type` is OPTIONAL — the renderer reads `fieldType || "text"`', () => {
    // objectui#7562 item 2. `{ value, label }` is what `FilterBuilderProps`
    // declares (`type?: string`) and what a field list stripped of `type`
    // renders as: three text columns, every row still drawn. The mirror
    // refused it until this change, which is the divergence being closed.
    expect(FilterFieldSchema.safeParse({ value: 'a', label: 'A' }).success).toBe(true);
    // Absent is not the same as PRESENT-and-nonsense: the vocabulary is still
    // closed, so this widening cannot be read as "type stopped being checked".
    expect(FilterFieldSchema.safeParse({ value: 'a', label: 'A', type: 'zzz' }).success).toBe(false);
    expect(FilterFieldSchema.safeParse({ value: 'a', label: 'A', type: undefined }).success).toBe(true);
  });

  it('the accept set is EXACTLY `FILTER_FIELD_TYPES`, member for member', () => {
    // objectstack#27369: the enum is built from the shared list, so this is
    // the pin that reddens if the mirror ever goes back to restating it — a
    // fifteenth member written into the enum alone, or one left out.
    expect([...mirrorTypeMembers()].sort()).toEqual([...FILTER_FIELD_TYPES].sort());
    for (const type of FILTER_FIELD_TYPES) {
      expect(
        FilterFieldSchema.safeParse({ value: 'a', label: 'A', type }).success,
        `FILTER_FIELD_TYPES carries \`type: '${type}'\`, which this mirror refuses`,
      ).toBe(true);
    }
  });

  it('every member is a spec `FieldType`, or a named exemption', () => {
    // The authority for what a field type IS lives in `@objectstack/spec`;
    // this list may only use its words, plus the exemptions declared (with
    // their reasons) in `SPEC_FIELD_TYPE_EXEMPTIONS`.
    const spec = new Set<string>(SpecFieldTypeEnum.options);
    expect(spec.size).toBeGreaterThan(40);
    const outside = FILTER_FIELD_TYPES.filter((t) => !spec.has(t) && !(t in SPEC_FIELD_TYPE_EXEMPTIONS));
    expect(
      outside,
      'these filter-builder types are not spec `FieldType` members. Use the spec\'s spelling, or — '
        + 'only when the renderer must keep the word — add it to SPEC_FIELD_TYPE_EXEMPTIONS with its '
        + 'reason. ⛔ Never drop a member to green this: the accepted set must not narrow.',
    ).toEqual([]);
  });

  it('every exemption is live: a list member, and still outside the spec', () => {
    // An exemption the spec has since adopted, or for a member that has left
    // the list, would excuse nothing and hide the next one.
    const spec = new Set<string>(SpecFieldTypeEnum.options);
    for (const [type, reason] of Object.entries(SPEC_FIELD_TYPE_EXEMPTIONS)) {
      expect((FILTER_FIELD_TYPES as readonly string[]).includes(type), `${type} is not in FILTER_FIELD_TYPES`).toBe(true);
      expect(spec.has(type), `${type} is a spec FieldType now — delete its exemption`).toBe(false);
      expect(reason).toBeTruthy();
    }
  });

});

describe('objectui#6939 — the group shape is `{ id, logic, conditions }`', () => {
  it('accepts the shape the catalog authors and `EMPTY_GROUP` emits', () => {
    expect(FilterGroupSchema.safeParse({ id: 'root', logic: 'and', conditions: [] }).success).toBe(true);
  });

  it('`id` is OPTIONAL — the renderer never reads it', () => {
    // ⚠️ Declared departure — see the header. `isValidGroup` gates on
    // `conditions` and `logic` only, so a group without `id` renders
    // identically; requiring it would invent a refusal.
    expect(FilterGroupSchema.safeParse({ logic: 'or', conditions: [] }).success).toBe(true);
    const src = readFileSync(join(REPO_ROOT, READER), 'utf8');
    // The component's group is `FilterBuilderRowGroup` (objectui#6349, batch 12),
    // derived from this package's `FilterGroup`.
    expect(src).toContain('Array.isArray((v as FilterBuilderRowGroup).conditions) &&');
    expect(src).toContain('((v as FilterBuilderRowGroup).logic === "and" || (v as FilterBuilderRowGroup).logic === "or")');
  });

  it('`id` is DECLARED, so it is type-checked rather than admitted unvalidated', () => {
    // The reason for declaring a key with no read site: `z.object` strips
    // unknown keys in silence, so an undeclared `id` would accept `42`.
    expect(FilterGroupSchema.safeParse({ id: 42, logic: 'and', conditions: [] }).success).toBe(false);
  });

  it('REFUSES the former `{ operator, conditions }` shape', () => {
    // Breaking half #3, and the loudest of the three at render time: a group
    // spelled this way fails `isValidGroup`, falls back to `EMPTY_GROUP`, and
    // the board empties.
    expect(FilterGroupSchema.safeParse({ operator: 'and', conditions: [] }).success).toBe(false);
  });

  it('`logic` is still a closed vocabulary', () => {
    expect(FilterGroupSchema.safeParse({ id: 'r', logic: 'xor', conditions: [] }).success).toBe(false);
  });
});

describe('objectui#6939 — the catalog entries the mirror refused', () => {
  it.each(['empty-filter-builder', 'user-filters'])(
    '%s now validates under safeValidateSchema',
    (name) => {
      expect(reasons(entry(name))).toEqual([]);
    },
  );

  it.each(['product-search', 'with-conditions'])(
    '%s now validates too — the operator residual is gone',
    (name) => {
      // objectui#6939's remainder: the authored spelling is the DECLARED one.
      expect(reasons(entry(name))).toEqual([]);
    },
  );

  it('the `stack`-rooted fifth entry: its nested filter-builder validates as well', () => {
    // `search-interface.json` roots at `stack`, so `objectui check` (which runs
    // the strict authoring face on the ROOT only — the `check` command validates the
    // parsed document, not its children) counts four entries for this row, not
    // five. The nested node is measured here so the fifth file is not silently
    // unexamined.
    expect(reasons(nestedSearchInterface())).toEqual([]);
  });

  /** The operators of a parsed (or authored) document, in row order. */
  const ops = (d: Record<string, unknown>) =>
    ((d.value as { conditions: { operator: string }[] }).conditions).map((c) => c.operator);

  /** Parse through the whole-document gate and hand back the PARSED document. */
  function parsed(doc: Record<string, unknown>): Record<string, unknown> {
    const r = safeValidateSchema(doc);
    if (!r.success) throw new Error(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    return r.data as Record<string, unknown>;
  }

  it.each(['product-search', 'with-conditions'])(
    '%s: the alias dialect it used to author is ACCEPTED and normalised back (objectui#9559)',
    (name) => {
      // Moved by objectui#9559 ruling B: `eq` / `gt` / `lt` are rows of the
      // spec's alias table, which the protocol's own rule accepts and folds.
      const aliased = withOperators(entry(name), FORMER_ALIAS);
      // Anti-vacuity: the rewrite really did change the tree it was given.
      expect(ops(aliased)).not.toEqual(ops(entry(name)));
      expect(ops(aliased).length).toBeGreaterThan(0);
      expect(reasons(aliased)).toEqual([]);
      // The round trip: the parsed document carries the canonical spelling the
      // fixture itself authors, not the alias that went in.
      expect(ops(parsed(aliased))).toEqual(ops(entry(name)));
    },
  );

  it.each(['product-search', 'with-conditions'])(
    '%s: the dropdown\'s own camelCase dialect is ACCEPTED and normalised back (objectui#9559)',
    (name) => {
      // `FILTER_BUILDER_OPERATORS` is the vocabulary the UI EMITS; its
      // `greaterThan` / `lessThan` are alias rows too, so the gate that refused
      // a UI-edited filter no longer does.
      const dropdown = withOperators(entry(name), DROPDOWN_ID);
      // `equals` is spelled the same in both vocabularies — the overlap is real
      // and is why this arm needs an anti-vacuity leg of its own.
      expect(ops(dropdown)).not.toEqual(ops(entry(name)));
      expect(reasons(dropdown)).toEqual([]);
      expect(ops(parsed(dropdown))).toEqual(ops(entry(name)));
    },
  );

  it.each(['product-search', 'with-conditions'])(
    '%s: an operator the protocol refuses is still REFUSED — nothing wider than the protocol',
    (name) => {
      // The contract-first control, one level up from where it used to sit: the
      // mirror accepts what the PROTOCOL accepts, and not a spelling more.
      const invented = withOperators(entry(name), NOT_AN_OPERATOR);
      expect(ops(invented)).not.toEqual(ops(entry(name)));
      expect(reasons(invented)).not.toEqual([]);
    },
  );

  it.each(CENSUS)('%s: none of the THREE ruled divergences is left in it', (name) => {
    // The positive statement behind the split above, key by key.
    const doc = entry(name) as {
      fields: Record<string, unknown>[];
      value: Record<string, unknown>;
    };
    for (const f of doc.fields) {
      expect(FilterFieldSchema.safeParse(f).success).toBe(true);
      expect('name' in f).toBe(false);
    }
    expect(doc.value.logic).toMatch(/^(and|or)$/);
    expect('operator' in doc.value).toBe(false);
  });
});

describe('objectui#6939 — the controls are legal in BOTH states of this change', () => {
  // Every assertion above that changes verdict is paired with a carrier that
  // does not, so a red run cannot be read as "the repair broke something
  // unrelated". These documents parse before AND after: they carry both key
  // spellings at once (the extra one is stripped in each state) and a `type`
  // that is a member of both enums.
  const bothWays = {
    type: 'filter-builder',
    name: 'x',
    fields: [{ name: 'a', value: 'a', label: 'A', type: 'select' }],
    value: { id: 'r', operator: 'and', logic: 'and', conditions: [] },
  };

  it('the both-spellings carrier validates', () => {
    expect(reasons(bothWays)).toEqual([]);
  });

  it('and it is genuinely reaching FilterBuilderSchema, not some other union arm', () => {
    expect(FilterBuilderSchema.safeParse(bothWays).success).toBe(true);
  });

  it('a `fields` entry that is not an object still refuses, in either state', () => {
    expect(FilterBuilderSchema.safeParse({ ...bothWays, fields: ['a'] }).success).toBe(false);
  });
});

describe('objectui#6939 — the keys are DECLARED, not passthrough holes', () => {
  it('both mirrors expose the ruled keys and no stale one', () => {
    expect(Object.keys((FilterFieldSchema as unknown as { shape: Record<string, unknown> }).shape))
      .toEqual(['value', 'label', 'type', 'operators', 'options']);
    // `FilterGroupSchema` is a `z.lazy`, so its shape is behind the thunk.
    const group = (FilterGroupSchema as unknown as { _def: { getter: () => { shape: Record<string, unknown> } } })
      ._def.getter();
    expect(Object.keys(group.shape)).toEqual(['id', 'logic', 'conditions']);
  });

  it('the unused type-level bindings above are referenced, so lint keeps them', () => {
    expect(groupWithoutId.conditions).toEqual([]);
    expect(legacyNamedField).toBeDefined();
    expect(fieldWithoutType.value).toBe('a');
  });
});
