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
 *     own operator bucket (`selectLikeTypes`, `custom/filter-builder.tsx:935`,
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
 * The fix is that the population is now TAKEN from the doc (`documentedTypes()`)
 * instead of copied beside it, so `the accept set is EXACTLY the published doc`
 * compares the enum against the authority rather than against a copy of it and
 * fails in both directions. A doc-seeded pin has its own failure mode — a reader
 * that silently matches nothing turns the pin vacuous in the same stroke — so
 * every reader THROWS on absence and `the doc reader has a floor` drives that,
 * with the doc's own two-member `logic` union as the positive control.
 *
 * ⛔ If this pin reddens because the DOC widened: the mirror follows, as its own
 * reviewable change. ⛔ Never narrow the doc to match the mirror — under
 * decision batch #88 a contract does not retract what it published to authors.
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
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { FilterBuilderSchema, FilterFieldSchema, FilterGroupSchema } from '../zod/complex.zod';
import { safeValidateSchema } from '../zod/index.zod';
import type { FilterField as TsFilterField, FilterGroup as TsFilterGroup } from '../complex';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const CATALOG = join(REPO_ROOT, 'examples/schema-catalog/src/schemas/components-complex-filter-builder');
const READER = 'packages/components/src/custom/filter-builder.tsx';
/**
 * The published doc — a THIRD declaration of this authoring surface, and since
 * decision batch #88 (objectui#7562) the AUTHORITY for it: *"a contract does
 * not retract what it published to authors."* Both faces repaired in this file
 * follow it; they do not define it.
 */
const DOC = 'content/docs/components/complex/filter-builder.mdx';

function publishedDoc(): string {
  return readFileSync(join(REPO_ROOT, DOC), 'utf8');
}

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
// drifts back, which is the half a runtime assertion cannot cover.
expectType<Equal<TsFilterField['value'], string>>();
expectType<Equal<TsFilterField['type'],
  | 'text' | 'number' | 'currency' | 'percent' | 'rating'
  | 'date' | 'datetime' | 'time'
  | 'boolean'
  | 'select' | 'status'
  | 'lookup' | 'master_detail' | 'user'
  | undefined>>();
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
    // A plain `z.object` STRIPS unknown keys, so an undeclared `name` would be
    // accepted-and-discarded rather than refused. What makes the refusal real
    // is that `value` is REQUIRED, so the old shape has no identity at all.
    const parsed = FilterFieldSchema.safeParse({ value: 'a', label: 'A', type: 'text', name: 'a' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && 'name' in parsed.data).toBe(false);
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
 * The seven the published doc declares that this mirror refused until
 * objectui#7562 — each with its own named bucket in
 * `custom/filter-builder.tsx` and its own value control, which is exactly why
 * the ruling let them in rather than cutting them out of the doc.
 *
 * Paired with the bucket that CARRIES each one, so "it draws" is asserted
 * against the renderer source rather than restated as prose. The buckets are
 * literal `const` arrays, so a rename or a deletion in the component turns
 * this red instead of leaving the mirror declaring a key nothing draws.
 */
const DOC_ONLY_TYPES: ReadonlyArray<readonly [string, string]> = [
  ['currency', 'const numberLikeTypes = ["number", "currency", "percent", "rating"]'],
  ['percent', 'const numberLikeTypes = ["number", "currency", "percent", "rating"]'],
  ['rating', 'const numberLikeTypes = ["number", "currency", "percent", "rating"]'],
  ['status', 'const selectLikeTypes = ["select", "status"]'],
  ['lookup', 'const lookupLikeTypes = ["lookup", "master_detail", "user"]'],
  ['master_detail', 'const lookupLikeTypes = ["lookup", "master_detail", "user"]'],
  ['user', 'const lookupLikeTypes = ["lookup", "master_detail", "user"]'],
];

/** The seven spellings above, for the places that only need the names. */
const UNRULED_LIVE_TYPES = DOC_ONLY_TYPES.map(([type]) => type);

/**
 * One `interface <name> { … }` block out of the published doc's schema fence.
 *
 * Throws rather than returning an empty string, and the same goes for every
 * reader below it. A doc-seeded pin has exactly one interesting failure mode —
 * the reader quietly matches nothing, the population comes back empty, and
 * every assertion built on it passes while checking nothing — so absence is
 * LOUD here, and the floor test drives both throws.
 */
function docInterfaceBlock(doc: string, iface: string): string {
  const open = doc.indexOf(`interface ${iface} {`);
  if (open === -1) throw new Error(`${DOC}: no \`interface ${iface} {\` block`);
  const close = doc.indexOf('\n}', open);
  if (close === -1) throw new Error(`${DOC}: \`interface ${iface}\` is never closed`);
  return doc.slice(open, close);
}

/**
 * Every quoted member of the union `<iface>.<key>` declares, in the doc's own
 * order. The union may span LINES — the doc lays `type?:` out over five rows —
 * so the slice runs to the terminating `;`, not to the end of the line. Line
 * comments are stripped first: `// Field type` sits inside that slice, an
 * apostrophe in some future one would otherwise mint a phantom member, and a
 * `;` in one would otherwise be mistaken for the terminator (objectui#9073).
 */
function docUnionMembers(doc: string, iface: string, key: string): string[] {
  // ⛔ Comments come off FIRST, and everything after this line addresses the
  // stripped block only (objectui#9073). Locating the terminating `;` in the
  // raw block and stripping afterwards let a `;` inside a union-row comment
  // end the slice early: the fourteen-member union read as eight, and the
  // mirror/doc pin then announced a widening that had not happened — a
  // confident lie, which is worse than silence.
  //
  // ⚠️ And it is a two-sided fix, not a one-line one: stripping SHORTENS the
  // block, so an index taken before the strip addresses a different place
  // after it. `at` is therefore computed here, on the stripped block, and
  // never carried across from the raw one.
  const block = mask(docInterfaceBlock(doc, iface));
  const at = block.indexOf(`\n  ${key}:`);
  if (at === -1) throw new Error(`${DOC}: \`${iface}\` no longer declares \`${key}\``);
  const end = block.indexOf(';', at);
  if (end === -1) throw new Error(`${DOC}: \`${iface}.${key}\` is unterminated`);
  const body = block.slice(at, end);
  const members = [...body.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  if (members.length === 0) {
    throw new Error(`${DOC}: \`${iface}.${key}\` parsed to ZERO members`);
  }
  return members;
}

/**
 * The accept set, TAKEN from the authority rather than copied from it
 * (objectui#8774).
 *
 * This used to be a hand-kept `DOCUMENTED_FOURTEEN` constant sitting beside the
 * pin. A population maintained here can only ever confirm the mirror it was
 * copied from, which is precisely the blindness objectui#7562 turned out to be:
 * the doc had moved, both code faces agreed with each other, and no instrument
 * said so. Measured before it was changed — the ceiling reviewer's ablation
 * Leg E added a fifteenth member to the DOC alone and every pin in this file
 * stayed green.
 */
function documentedTypes(): string[] {
  return docUnionMembers(publishedDoc(), 'FilterField', 'type?');
}

/**
 * The "the mirror widened past the authority" verdict, as a function and a
 * sentence rather than an expression buried in one assertion (objectui#9073).
 *
 * It is lifted out because a controlled input has to be pushed through THE SAME
 * comparison and THE SAME sentence the pin renders — a copy of either could
 * drift away from the thing it is there to vouch for, and this diagnosis is
 * exactly the one that was observed to fire falsely.
 */
const WIDENED_MESSAGE =
  `this mirror accepts \`type\` members ${DOC} never published — the mirror widened ` +
  `past the authority.`;

function widenedPastTheDoc(documented: string[]): string[] {
  return mirrorTypeMembers().filter((t) => !documented.includes(t));
}

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
    expect(src).toContain('const selectLikeTypes = ["select", "status"]');
  });

  it('REFUSES `string` — the phantom the enum used to carry', () => {
    // Breaking half #2. `string` reached the text control only by the
    // unrecognised-word fallthrough in `valueFamilyForFieldType`, so it was
    // indistinguishable from a nonsense spelling; the render half measures that.
    expect(FilterFieldSchema.safeParse({ value: 'a', label: 'A', type: 'string' }).success).toBe(false);
  });

  it.each(DOC_ONLY_TYPES)(
    'accepts `%s`, and the renderer draws it — the bucket that carries it is `%s`',
    (type, bucket) => {
      // objectui#7562, items 1+2. This assertion is the INVERSE of the one it
      // replaced (`still refuses the live-but-unruled spelling …`): the ruling
      // made the published doc the authority, so a member the doc offers and
      // the renderer draws is a member this mirror accepts.
      //
      // The two halves are asserted together on purpose. Accepting a spelling
      // is only correct while the renderer still has a branch for it, and the
      // ruling's precondition is exactly that pairing — "⛔ never a key
      // declared that nothing draws". So the accept and the branch that earns
      // it redden as one.
      expect(FilterFieldSchema.safeParse({ value: 'a', label: 'A', type }).success).toBe(true);
      expect(readFileSync(join(REPO_ROOT, READER), 'utf8')).toContain(bucket);
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

  it('the accept set is EXACTLY the published doc, member for member', () => {
    // The set equality, not fourteen individual accepts: an enum that had
    // gained a fifteenth member the doc never published would pass every
    // per-member assertion above and fail only here.
    //
    // objectui#8774 — the expectation is now READ FROM the doc rather than
    // copied into a constant beside it, which is what makes this fail in BOTH
    // directions instead of one:
    //
    //   - the MIRROR grows a member the doc never published → the mirror
    //     widened past the authority;
    //   - the DOC grows a fifteenth member the mirror does not implement →
    //     the divergence objectui#7562 WAS, in the direction that recreates it.
    //
    // The second one is the whole card: while this compared against a
    // hard-coded list, a member added to the mdx reddened nothing here.
    const declared = mirrorTypeMembers();
    const documented = documentedTypes();
    expect(
      documented.filter((t) => !declared.includes(t)),
      // ⚠️ This message used to say "a LATER ruling", which is wrong about the
      // example it cites and was corrected in objectui#9073: objectui#4814
      // retired `owner` on 2026-08-16/17, and batch #88 is 2026-09-02 — so the
      // retirement PREDATES the batch it was offered as an exception to. The
      // exception does not depend on the order anyway: a spelling ANY ruling
      // has retired does not come back through the doc.
      `the published doc offers \`type\` members this mirror refuses. Under decision ` +
        `batch #88 the DOC is the authority and the MIRROR follows — widen ` +
        `FilterFieldSchema.type and FilterField['type'] to match, as its own reviewable ` +
        `change. ⛔ Do NOT narrow ${DOC} to match the mirror. The one exception to ` +
        `"the mirror follows": a spelling ANY ruling RETIRED from this doc — the ` +
        `way objectui#4814 retired \`owner\` — reappearing in it is a doc REGRESSION, ` +
        `not a widening, and the doc edit is what gets reverted.`,
    ).toEqual([]);
    expect(widenedPastTheDoc(documented), WIDENED_MESSAGE).toEqual([]);
    expect([...declared].sort()).toEqual([...documented].sort());
  });

  it('every member the published doc offers, the mirror ACCEPTS', () => {
    // The behavioural half of the equality above: `.options` is introspection
    // of the enum, this is a parse. Seeded from the doc, so a member added to
    // the mdx is asserted on the day it is added rather than on the day
    // somebody remembers to copy it into a list in this file.
    for (const type of documentedTypes()) {
      expect(
        FilterFieldSchema.safeParse({ value: 'a', label: 'A', type }).success,
        `${DOC} offers \`type: '${type}'\`, which this mirror refuses`,
      ).toBe(true);
    }
  });

  it('the doc reader has a floor — its positive control is the doc\'s own `logic` union', () => {
    // ⚠️ A doc-seeded pin fails the way this repository has failed before: the
    // reader silently matches nothing, the population is empty, and every
    // assertion built on it passes while checking nothing — turning the two
    // tests above vacuous in the same stroke that made them doc-driven. Three
    // legs, so an empty read cannot be mistaken for agreement.
    const doc = publishedDoc();
    // (1) CONTROL — the same reader, the same file, a DIFFERENT block whose
    //     answer is fixed by the ruling at exactly two members. It can fire in
    //     the region under test: a reader that matched nothing, or matched the
    //     wrong interface, returns something that is not `['and','or']`, and
    //     this reddens. And it is independent of the `type?:` block it vouches
    //     for, so the thing being measured cannot be what satisfies it.
    //     ⛔ One mode this control does NOT cover, corrected in objectui#9073
    //     after it was claimed here: a reader that stops at the FIRST LINE of a
    //     multi-line union. `logic` is itself single-line, so such a reader
    //     reads it correctly and this leg stays green.
    //     That mode IS covered — measured, by mutating this reader into a
    //     line-bounded one: `type?:` then parses to zero members, the
    //     zero-members throw fires out of `documentedTypes()`, and six tests in
    //     this file redden, this one among them at leg (2) rather than here.
    //     So the guard exists; it is the THROW below plus the equality pin, not
    //     this control. ⚠️ A control that names a mode it cannot catch is the
    //     same class of defect as the reader objectui#9073 repaired: a
    //     confident claim that sends the next reader to the wrong place.
    expect(docUnionMembers(doc, 'FilterGroup', 'logic')).toEqual(['and', 'or']);
    // (2) The population itself is non-empty and duplicate-free — a duplicated
    //     member would make the sorted-equality above pass on unequal sets.
    const documented = documentedTypes();
    expect(documented.length).toBeGreaterThan(0);
    expect([...new Set(documented)]).toEqual(documented);
    // (3) A renamed block or a renamed key is a THROW, not an empty set. This
    //     is the leg that keeps (2) from being all that stands between a doc
    //     edit and a pin that has quietly stopped reading anything.
    expect(() => docUnionMembers(doc, 'FilterField', 'nosuchkey?')).toThrow('no longer declares `nosuchkey?`');
    expect(() => docUnionMembers(doc, 'NoSuchInterface', 'type?')).toThrow('no `interface NoSuchInterface {` block');
  });

  it('the gap is measured against the PUBLISHED doc, not against a private opinion', () => {
    // `content/docs/components/complex/filter-builder.mdx` is a THIRD
    // declaration of this component's authoring surface, independent of both
    // faces repaired here, and it already agrees with the renderer: `value` as
    // the field key, `{ id, logic, conditions }` as the group, and a FOURTEEN
    // member `type?` union. This assertion is what makes "the mirror is the odd
    // one out" a reading rather than a claim — and it turns red if someone
    // narrows the DOC to match the mirror, which is the wrong direction.
    const doc = publishedDoc();
    expect(doc).toContain("logic: 'and' | 'or';");
    expect(doc).toMatch(/value: string;\s+\/\/ Field identifier/);
    for (const type of [...RULED, 'select', ...UNRULED_LIVE_TYPES]) {
      expect(doc, `the published doc no longer offers \`${type}\``).toContain(`'${type}'`);
    }
    // …and the doc declares `type` OPTIONAL, which this mirror now does too.
    // Read from the doc rather than restated, so narrowing the DOC to a
    // required `type` reddens here as well — the wrong direction, both ways.
    expect(doc).toContain('type?:');
    expect(FilterFieldSchema.safeParse({ value: 'a', label: 'A' }).success).toBe(true);
  });
});

/* ── objectui#9073 — the reader's comment/terminator ORDER ────────────────── */

/**
 * The fixtures below are CONTROLLED INPUTS, not declarations found in this
 * tree, and that is the shape of the card: objectui#9073 is a defect in a
 * test-embedded READER, so nothing in the shipped surface is wrong and there is
 * nothing to find. No comment anywhere in the published doc carries a `;`
 * today — a fixture claiming to have found one would be describing a tree that
 * does not exist.
 *
 * So each one is the REAL doc with exactly one comment rewritten, anchored to a
 * literal row rather than hand-written, so that the fixture cannot quietly
 * become a straw man when the doc moves: a vanished anchor THROWS.
 */
const UNION_ROW = "    | 'date' | 'datetime' | 'time'\n";
const EARLIER_ROW = "  value: string;                         // Field identifier\n";

function docWith(anchor: string, replacement: string): string {
  const doc = publishedDoc();
  if (!doc.includes(anchor)) {
    throw new Error(
      `${DOC}: objectui#9073 fixture anchor ${JSON.stringify(anchor)} is gone — ` +
        `the fixture no longer perturbs the doc it claims to perturb`,
    );
  }
  // Function replacement: a literal `$&`/`$1` in the text would otherwise be a
  // substitution pattern rather than the bytes written here.
  return doc.replace(anchor, () => replacement);
}

describe('objectui#9073 — the doc reader strips comments BEFORE it locates the terminator', () => {
  it('a `;` inside a union-row comment no longer truncates the union — nor reports a widening that never happened', () => {
    // ⭐ What this card is about is the FALSE POSITIVE, not the under-count.
    // The reader used to locate the terminating `;` in the RAW block and strip
    // comments only afterwards, so the `;` in the comment injected below ended
    // the slice EIGHT members in. The mirror's fourteen then read as six
    // members the doc "never published", and the pin above rendered
    // WIDENED_MESSAGE — announcing a widening nobody had made and sending
    // whoever read it to look for a change that does not exist. A reader that
    // under-counts a mirror does not stay quiet; it lies confidently.
    const poisoned = docWith(
      UNION_ROW,
      "    | 'date' | 'datetime' | 'time'   // dates; and date-times\n",
    );
    const documented = docUnionMembers(poisoned, 'FilterField', 'type?');
    // The DIAGNOSIS first, deliberately: through the same function and the
    // same sentence the pin renders rather than a copy of either, so the red
    // run prints the false verdict itself and not a symptom of it.
    expect(widenedPastTheDoc(documented), WIDENED_MESSAGE).toEqual([]);
    // …and the read underneath it, seeded from the authority rather than from
    // a count kept here — the reason objectui#8774 deleted this file's
    // hand-kept `DOCUMENTED_FOURTEEN`.
    expect(documented).toEqual(documentedTypes());
  });

  it('a `;` in a comment BEFORE the key keeps the anchor in ONE coordinate system', () => {
    // ⚠️ The trap in the one-line reading of this repair. Stripping comments
    // SHORTENS the block, so an index computed on the raw block addresses a
    // different place in the stripped one. An implementation that strips the
    // comments but carries the old `at` across starts its slice INSIDE the
    // union and silently drops the LEADING members — a second wrong answer
    // reached from the same fix, and one the test above cannot see.
    //
    // The comment rewritten here sits BEFORE `type?:`, so it never enters the
    // slice at all and cannot affect the terminator search either. It can only
    // be caught by that coordinate shift, which is why it is a separate leg.
    const shifted = docWith(
      EARLIER_ROW,
      "  value: string;                         // Field identifier; never the label\n",
    );
    expect(docUnionMembers(shifted, 'FilterField', 'type?')).toEqual(documentedTypes());
  });

  it('CONTROL — a doc with no `;` in any comment reads identically in both worlds', () => {
    // ⚠️ Named a control because it CANNOT tell the two worlds apart: the
    // published doc carries no `;` inside a comment, so this is green before
    // the repair and green after it. It is here so the two legs above are
    // readable as perturbations of a known-good answer — ⛔ it is not evidence
    // that the repair works, and it must not be counted as any.
    expect(docUnionMembers(publishedDoc(), 'FilterGroup', 'logic')).toEqual(['and', 'or']);
    expect(widenedPastTheDoc(documentedTypes()), WIDENED_MESSAGE).toEqual([]);
  });

  it('a union whose only `;` is inside a comment is UNTERMINATED — loudly, not truncated silently', () => {
    // The ONE existing branch this repair moves, recorded here rather than
    // discovered by somebody later. Before: the comment's `;` was accepted as
    // the terminator and the reader returned a truncated set in silence.
    // After: the comment is gone before the search runs, the block genuinely
    // has no terminator past the key, and `is unterminated` fires — the throw
    // that was already here, wording untouched. Silent-and-wrong → loud is the
    // direction this file already declares for its readers ("absence is LOUD
    // here"); the two throws pinned in the floor test are not moved at all.
    //
    // Hand-written rather than doc-anchored, and it has to be: the real block
    // carries further `;` after the union (`options?: Array<{ … }>;`), so no
    // edit to a COMMENT can leave the real block unterminated.
    const handWritten = [
      'interface FilterField {',
      '  type?:',
      "    | 'text'",
      "    | 'number'   // no terminator past here; only this comment has one",
      '}',
      '',
    ].join('\n');
    expect(() => docUnionMembers(handWritten, 'FilterField', 'type?')).toThrow(
      '`FilterField.type?` is unterminated',
    );
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
