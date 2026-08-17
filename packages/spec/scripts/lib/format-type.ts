// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * JSON Schema node → the type string a reference page prints in its table cell.
 *
 * Extracted from `build-docs.ts` so the rendering can be pinned directly
 * (#4912). The generator is a top-level script with side effects, so the only
 * way to assert on its type strings used to be to run the whole thing and grep
 * the emitted `.mdx` — which is why the passthrough collapse below survived
 * unnoticed through the whole #4001 campaign.
 */

/**
 * Context a page needs to turn a `$ref` into a link that actually resolves.
 *
 * Pages are named after the *zod file* (`data/object.mdx`) while refs name a
 * *schema* (`Field`), so a ref can only be linked by looking the schema name up
 * in the generator's category maps — injected here as `schemaHref` rather than
 * imported, so this module stays free of the generator's module-level state.
 * Anonymous refs (`__schemaN`, emitted when Zod hoists a reused inline schema
 * into `$defs`) have no page at all and are rendered structurally instead.
 */
export interface TypeContext {
  /** `$defs` of the document being rendered — for resolving local refs. */
  defs: Record<string, any>;
  /** The schema whose section is being rendered — target of a self `$ref` (`"#"`). */
  currentSchema: string;
  /**
   * Anonymous refs already being expanded on this branch. Schemas are cyclic
   * (a node contains nodes), so inlining without this recurses forever.
   */
  expanding?: Set<string>;
  /**
   * Recursion state, like `expanding`: set while rendering anything BELOW an
   * inline object summary's `{ … }`, and never cleared on the way down.
   *
   * It is what separates a vocabulary's OWN row — where the full member list is
   * the point of the cell — from a second copy of that list smuggled into a
   * summary, which is the only position `INLINE_ENUM_WIDTH_LIMIT` elides.
   * A caller that passes no `ctx` at all gets no elision, the same way it gets
   * no `$ref` links: this file already degrades that way, and every real caller
   * (`build-docs.ts`) passes one.
   */
  inShapeSummary?: boolean;
  /**
   * Resolve a schema name to its page href, or `null` when the schema isn't one
   * the generator produces a page for — the type is then rendered without a
   * link rather than emitting a 404.
   */
  schemaHref?: (name: string) => string | null;
}

/**
 * A property whose type is a vocabulary too wide to spell inside its table
 * cell: the cell prints a sample plus a count, and these members are printed in
 * full under the table (#6225).
 */
export interface RenderedProperty {
  /** The type string for the table cell. */
  cell: string;
  /**
   * The members the cell no longer spells, for the caller to print in full —
   * or `null` when the cell is complete and nothing needs relocating.
   */
  allowedValues: string[] | null;
}

export const refName = (ref: string): string => ref.split('/').pop() || ref;
export const isAnonymousRef = (name: string) => /^__schema\d+$/.test(name);

/** A page-local anchor, matching how fumadocs slugs the `## SchemaName` heading. */
export const anchorFor = (schemaName: string) => `#${schemaName.toLowerCase()}`;

/** How many declared keys an inline object shows before eliding the rest. */
const INLINE_KEY_LIMIT = 4;

/**
 * How many `{ … }` shape levels one cell expands before printing `object`
 * (#6374).
 *
 * `INLINE_KEY_LIMIT` caps a summary's KEYS at its own level; the two enum
 * budgets cap one key's VOCABULARY; `VARIANT_LIMIT` caps a union's ARITY.
 * Nothing capped how many times a cell could re-enter the object branch, and
 * cell width is the product of all four axes. `ui/page.mdx`'s `Page.slots` was
 * the corpus maximum at 1538 characters with the enum elision already firing
 * eight times inside it: 4 keys × a 2-variant union × a 176-character shape.
 *
 * WHY 1 — the number is RECOVERED, not chosen. This renderer has always had a
 * depth budget of exactly one shape level, written as the ternary in the key
 * loop below: a child that is itself an object printed `object` rather than its
 * shape. That budget was applied on ONE of the four ways down. An array element
 * (`{ … }[]`), a `Record` value (`Record<string, { … }>`) and a union variant
 * (`{ … } | { … }[]`) each re-entered the object branch through `renderType`
 * with the budget nowhere in scope, so the same shape at the same reader-facing
 * depth printed opaquely or in full depending on whether its author had wrapped
 * it in an array. That is a fact about the Zod spelling, not about how a reader
 * needs to read it — the same asymmetry #6225 removed for vocabularies. This
 * constant makes the existing rule apply to all four descents; the ternary it
 * replaces is its depth-1 case.
 *
 * The corpus confirms 1 is the only admissible value. Regenerating all 215
 * pages (8499 type cells) at each candidate, counting emitted cell widths:
 *
 *   depth limit | (none, before) |    1 |    2 |    3 |    4
 *   cells >200  |            121 |   42 |  173 |  191 |  191
 *   cells >400  |              9 |    1 |   19 |   35 |   35
 *   cells >600  |              3 |    1 |    2 |   14 |   22
 *   cells >900  |              1 |    0 |    1 |    1 |    1
 *   p95 / p99   |      145 / 229 | 124/180 | 154/260 | 154/280 | 154/287
 *   max         |           1538 |  656 | 1538 | 1538 | 1538
 *
 * Every limit above 1 is worse than shipping nothing: raising it necessarily
 * LOOSENS the direct-object-child path, which was already at 1, so cells over
 * 200 rise from 121 to 173+ and the flagship never moves. There is no sweep to
 * balance here and no threshold to tune — 1 is the status quo made uniform,
 * and 2 and up are a regression dressed as a budget.
 *
 * At 1, every cell still over 400 characters is `ui/page.mdx`'s
 * `PageComponent.type` (656), a top-level vocabulary in a union variant that
 * #6225 deliberately leaves alone and that carries no nested shape at all.
 * Shape-driven width is gone from the corpus.
 *
 * WHAT A READER LOSES, and why `object` is the honest rendering. Nothing is
 * silently truncated: `object` claims nothing about keys, so unlike a prefix it
 * cannot be mistaken for a complete list — which is the #5340 principle applied
 * to shapes rather than to enum members. It is also not a new elision style in
 * these tables: `object` is what a nested shape has always printed, and the
 * complete shape stays where it always was — its own `## Schema` section when
 * the generator emits one, and `json-schema/` in every case.
 */
const SHAPE_DEPTH_LIMIT = 1;

/**
 * Character budget for one `Enum<…>` BODY rendered INSIDE an inline shape
 * summary. Over it, members are dropped until the body fits and the count of
 * what was dropped is printed in their place (#5340).
 *
 * `INLINE_KEY_LIMIT` above caps how many KEYS a summary shows; nothing capped
 * how wide a single key's TYPE could be, so one long enum blew the cell past
 * anything a table can render. The issue was filed on `BulkActionDef.params`
 * (~900 characters); measuring the whole corpus found that instance is not even
 * close to the worst — `content/docs/references/api/*.mdx` inline the
 * 261-member error-code vocabulary into their `error` shapes, at **6242
 * characters in one cell**, on 80 rows across 13 pages.
 *
 * WHY 80, measured rather than chosen. Across the 216 generated pages there are
 * 8541 type cells carrying 1768 `Enum<…>` occurrences, 805 of them in a shape
 * summary. Their body widths are strongly bimodal, and the population density
 * per character collapses right here:
 *
 *   body width  | (48,56] | (56,64] | (64,80] | (80,100] | (100,200] | >200
 *   occurrences |      57 |      51 |      57 |       31 |        51 |  109
 *   per char    |    7.1  |     6.4 |     3.6 |      1.6 |       0.5 |   —
 *
 * Below 80 sit the ordinary short vocabularies a reader wants spelled out
 * (`'asc' | 'desc'`, the 4-member widget modes); above it sit listings. 80
 * selects 189 of the 805, of which 160 survive the pay-for-your-marker guard in
 * `formatEnum` and 645 are printed exactly as before. Measured on the emitted
 * pages: cells over 200 characters 246 → 145 (-41%), over 900 characters
 * 76 → 4, p99 cell width 643 → 247 (-62%) — while p95 stays at 145, i.e. the
 * ordinary cells do not move, which is the point.
 *
 * Tightening further buys almost nothing and costs real information: budget 24
 * elides 635 of 805 (79%) to save only 4% more characters than budget 80 does,
 * because ~all of the width lives in the ~91 giant listings either budget
 * catches. A fixed MEMBER cap was measured too and is strictly worse at every
 * setting — a cap of 4 elides `Enum<'a' | 'b' | 'c' | 'd' | 'e'>` (31
 * characters, perfectly readable) while still leaving 134 cells over 200.
 */
const INLINE_ENUM_WIDTH_LIMIT = 80;

/**
 * Character budget for a vocabulary printed in ITS OWN table cell — the one
 * position `INLINE_ENUM_WIDTH_LIMIT` deliberately never touches (#6225).
 *
 * Over it the cell prints a sample plus a count AND `formatPropertyType` hands
 * the members back so `build-docs.ts` can print them in full underneath. The
 * two are one decision: this budget may only be spent where the relocation
 * happens, which is why it is read from `formatPropertyType` and never from
 * `formatType` itself.
 *
 * WHY 160, and why it is NOT the 80 that governs the in-shape copy. The two
 * positions have opposite costs. Eliding a copy inside a summary is nearly
 * free — the full list is elsewhere, or the JSON Schema is the authority — so
 * #5340 could put that budget right at the population's density collapse.
 * Relocating a vocabulary out of its OWN row costs a whole `### Allowed Values`
 * section on the page, so the budget wants to be as LOOSE as the width goal
 * allows, not as tight as the population suggests.
 *
 * Measured across the 216 generated pages (8541 type cells, 893 of them a
 * top-level `Enum<…>`), regenerating at each candidate and re-measuring the
 * emitted `.mdx`:
 *
 *   budget   |  40 |  80 | 120 | 160 | 176 | 184 | 200 | 240 | 320
 *   relocated| 227 |  72 |  41 |  25 |  24 |  24 |  17 |  14 |   9
 *   cells>200| 121 | 121 | 121 | 121 | 121 | 125 | 144 | 145 | 145
 *   cells>400|  18 |  18 |  18 |  18 |  18 |  18 |  18 |  18 |  18
 *   p99      | 227 | 227 | 227 | 227 | 227 | 227 | 227 | 247 | 247
 *
 * Every budget from 40 to 176 produces the IDENTICAL width profile — cells over
 * 200 at 121, over 400 at 18, over 900 at 1, p99 227, max 1538. Inside that
 * band the choice is therefore not about width at all; it is only about how
 * many vocabularies get moved, and that falls from 227 sections to 24. Above
 * 176 the profile degrades (184 gives back 4 cells over 200, 200 gives back 23).
 *
 * 160 sits near the top of the flat band: it buys the best achievable width at
 * 25 relocations instead of 227, and keeps a member or two of margin below the
 * 184 cliff rather than overfitting to today's exact knee. That it lands at
 * exactly twice `INLINE_ENUM_WIDTH_LIMIT` is the asymmetry stated plainly — a
 * vocabulary's own row is worth twice the width of a sampled second copy.
 */
const TOP_LEVEL_ENUM_WIDTH_LIMIT = 160;

/**
 * How many `anyOf` variants one cell spells before printing the count of the
 * rest (#6226).
 *
 * A union's width is variant COUNT times variant WIDTH, so neither enum budget
 * above can reach it: `ui/app.mdx`'s `App.navigation` prints
 * `{ id: string; label: string; icon?: string; order?: number; … }` nine times,
 * eight of the nine being one character-identical spelling (the ninth is
 * `{ type: 'separator'; … }`), for 582 characters of correct-but-repeated
 * type. (The repetition itself is #6569's subject, ruled after this cap landed
 * and handled by the dedupe at the call site; this constant governs only how
 * many DISTINCT spellings are worth reading.) The ruling on #6226 chose a cap
 * on the count that prints
 * how many variants it hid, over a whole-cell character budget degrading to
 * `object` and over restoring `$ref` links: those lose more information, and a
 * SECOND elision style in the same table is worse than the width it would fix.
 *
 * WHY 4. The corpus renders 353 unions, and their arity is as lopsided as the
 * enum widths were:
 *
 *   variants | 2   | 3  | 4  | 5  | 6 | 7 | 9
 *   unions   | 256 | 53 | 18 | 12 | 8 | 2 | 4
 *   cumulative 72.5% 87.5% 92.6% 96.0% 98.3% 98.9% 100%
 *
 * A cap of 4 leaves 92.6% of every union in the corpus spelled out in full and
 * touches only the 26 in the tail. Measured on the emitted pages at each
 * candidate (enum budget held at 160): cap 2 → 8 cells over 400, cap 3 → 8,
 * cap 4 → 9, cap 5 → 11, cap 6 → 18, i.e. no better than no cap at all. So 4 is
 * the loosest cap that still does essentially all of the available work: going
 * to 3 recovers ONE more wide cell while eliding 44 unions instead of 26.
 *
 * It is also the cap the reader already meets one line up. `INLINE_KEY_LIMIT`
 * is 4, so a cell shows at most four declared KEYS of an object; showing at
 * most four VARIANTS of a union is the same reading budget on the other axis,
 * and #6226's own issue body proposed the cap that way. Two different "how many
 * before `…`" numbers inside one cell would reintroduce, between the two
 * elisions, exactly the inconsistency the ruling picked this option to avoid.
 */
const VARIANT_LIMIT = 4;

/**
 * Does this rendered type carry a top-level `&` or `|`, i.e. would suffixing
 * `[]` re-associate it?
 *
 * `[]` binds tighter than both operators: `A & B[]` is `A & (B[])` and
 * `A | B[]` is `A | (B[])`, never `(A & B)[]` / `(A | B)[]`. So an array whose
 * element renders as a top-level intersection OR union MUST be parenthesized,
 * or the cell states a different type than the schema — `string | number[]`
 * reads as "a string, or an array of numbers", while the schema said "an array
 * whose elements are string or number". Depth is tracked across `{}`, `<>`,
 * `[]` and `()` so operators nested inside a shape, a `Record<…>` type
 * argument, an `Enum<'a' | 'b'>` or a markdown link target are correctly
 * ignored.
 *
 * The `&` half arrived with #4912, which had *introduced* intersection
 * elements (`{ declared keys } & Record<string, any>`) and so fixed only what
 * it caused. The `|` half is the older defect, filed separately as #5338 and
 * fixed here: it predated that renderer change and its regeneration diff would
 * have buried the passthrough fix. Both halves are one rule — `[]` is not
 * distributive over either operator — so they share one scan.
 */
function hasTopLevelUnionOrIntersection(rendered: string): boolean {
  let depth = 0;
  for (const ch of rendered) {
    if (ch === '{' || ch === '<' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === '>' || ch === ']' || ch === ')') depth--;
    else if (depth === 0 && (ch === '&' || ch === '|')) return true;
  }
  return false;
}

/**
 * Is this node the JSON Schema encoding of `z.never()` — i.e. a `retiredKey()`
 * tombstone (`packages/spec/src/shared/retired-key.ts`)?
 *
 * `z.toJSONSchema` renders `z.never()` as `{ "not": {} }` — the negation of the
 * always-true empty schema, so nothing validates against it. That node carries
 * no `type`, no `$ref` and no `enum`, so before #5606 it fell all the way
 * through `formatType` to the `prop.type || 'any'` tail and printed as **`any`**
 * — the one rendering that reads as "free-form slot, nothing validates it",
 * which is the exact inverse of what a tombstone means. A key retired from
 * `heading?: string` to a tombstone came out of the generator as
 * `heading?: any`, i.e. *more* inviting to write than before it was removed.
 *
 * A **non-empty** `not` (`{ not: { type: 'string' } }`) is an ordinary negation
 * constraint, not `never`, and is deliberately not matched here.
 */
function isNeverNode(prop: any): boolean {
  return (
    !!prop &&
    typeof prop.not === 'object' &&
    prop.not !== null &&
    Object.keys(prop.not).length === 0
  );
}

/**
 * One JSON Schema literal value — a `const`, or a single member of an `enum` —
 * rendered as the TypeScript literal an author would have to type.
 *
 * Quoting is decided by `typeof`, not applied unconditionally (#5729). Both
 * literal branches below used to wrap every value in `'…'`, which turns a
 * NUMERIC literal union into a STRING one on the page: `FormSection.columns`
 * (`z.union([z.enum(['1','2','3','4']), z.literal(1) … z.literal(4)])`) printed
 * as `Enum<'1' | '2' | '3' | '4'> | '1' | '2' | '3' | '4'`, so the four
 * `z.literal(<number>)` variants were indistinguishable from the four string
 * ones and the cell read as "this key only takes strings" — while the schema
 * takes both `2` and `'2'`.
 *
 * That is not cosmetic for the audience these pages are written for. The
 * reference pages are the authoritative input for AI authors (ADR-0033), and a
 * literal union is a copy-the-spelling surface: quotes copied off the page onto
 * a number-only union are a hard parse error. #5611 hit exactly that — its
 * `RecordDetailsProps.sections[].columns` was meant to be a numeric literal
 * union, the generated reference said strings, and the PR retreated to
 * `z.number().int().min(1).max(4)` to sidestep the contradiction. The
 * generator was defining the contract backwards.
 *
 * The mapping is the JSON→TypeScript one, and it is per VALUE rather than per
 * node because JSON Schema states the two independently: `enum` may mix types
 * in one array (`z.nativeEnum({A: 1})` emits `{ type: 'number', enum: [1] }`,
 * a numeric `enum`), so a node-level `type` test would mis-render the mixed
 * case that a per-value test gets right for free.
 */
function formatLiteral(value: unknown): string {
  // The only kind that IS quoted — and it keeps its quotes exactly as before.
  if (typeof value === 'string') return `'${value}'`;
  // `z.literal(null)` → `{ type: 'null', const: null }`. `null` is a keyword,
  // and `String(null)` already spells it; the explicit branch is here so the
  // `typeof value === 'object'` tail below cannot claim it first.
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  // A composite `const` (object/array literal). No schema emits one today, so
  // this is a guard rather than a rendering decision: `String({})` would print
  // `[object Object]` and the old code printed `'[object Object]'`, either of
  // which states a type no author can write. JSON is at least the literal's
  // real spelling. `undefined` cannot reach the `const` branch (guarded by
  // `!== undefined`) but can sit inside a hand-written `enum` array.
  return JSON.stringify(value) ?? 'any';
}

/**
 * An `enum` node's members, joined — and, when a budget is given, cut to it with
 * an explicit count of what was cut.
 *
 * The elided spelling is `Enum<'text' | 'textarea' | …>`-shaped below a summary
 * and `Enum<'text' | 'textarea' | … +42 more>`-shaped on a vocabulary's own row.
 * `…` is the same "there is more" token the key elision above already uses, and
 * it is what makes eliding SAFE to do at all: a SILENT prefix would leave the
 * page looking complete while it wasn't — the reader has no way to tell a
 * 7-member vocabulary from the first 7 of 49 — and a docs page that lies by
 * omission is worse than a wide one. Whether the marker also QUANTIFIES what it
 * cut is the `quantify` parameter, and it is decided per position by whether the
 * page carries the members to check the number against (#9182, on `formatEnum`).
 *
 * TWO budgets reach this function, and which one applies decides where the rest
 * of the vocabulary stays readable:
 *   1. `INLINE_ENUM_WIDTH_LIMIT`, below an inline summary's `{ … }` (#5340).
 *      That cell holds a SECOND copy. For 457 of the 805 in-shape occurrences
 *      the identical list is printed in full elsewhere on the same page
 *      (`BulkActionDef.params` is one — `BulkActionParam.type` two sections down
 *      carries all 49). For the remaining 348 the JSON Schema under
 *      `json-schema/` is the authority, as it always was. Unquantified: a count
 *      no copy on the page can substantiate is what made every page carrying one
 *      a rewrite whenever the vocabulary grew.
 *   2. `TOP_LEVEL_ENUM_WIDTH_LIMIT`, on a property whose own type IS the
 *      vocabulary (#6225), reached only through `formatPropertyType`. That cell
 *      is often the page's ONLY copy, so nothing is cut unless the caller prints
 *      the members underneath the table — which is why that budget is spent in
 *      the one place that hands them back, and never from `formatType`. Keeps
 *      its count: the list is right below it.
 * The marker is a count and not an anchor in case 2: Zod inlines enums, so
 * the node reaching this function is a bare `{ type: 'string', enum: [...] }`
 * with no `$ref` and no name to link — inventing one would be guessing at which
 * page-local heading happens to carry the same members. Case 2 does not need one:
 * its list is immediately below, under a heading naming that exact property.
 */
function elideEnum(
  values: unknown[],
  budget: number | null,
  quantify = true,
): { body: string; hidden: number } {
  const members = values.map((v: unknown) => formatLiteral(v));
  const full = members.join(' | ');
  if (budget === null || full.length <= budget) return { body: full, hidden: 0 };

  // Fill greedily, never below one member: a sample of zero states nothing, and
  // the member widths are the schema's, not ours to bound.
  const shown: string[] = [];
  let width = 0;
  for (const member of members) {
    const cost = shown.length === 0 ? member.length : member.length + ' | '.length;
    if (shown.length > 0 && width + cost > budget) break;
    shown.push(member);
    width += cost;
  }

  const hidden = members.length - shown.length;
  // One member wider than the whole budget: it was forced in, nothing is
  // hidden, and `+0 more` would be a marker pointing at nothing.
  if (hidden === 0) return { body: full, hidden: 0 };

  const elided = elideWithMarker(shown, hidden, full.length, quantify);
  return elided === null ? { body: full, hidden: 0 } : { body: elided, hidden };
}

/**
 * Join a sample with the `… +N more` marker — or refuse, returning `null`.
 *
 * THE MARKER MUST EARN ITS OWN FOOTPRINT. A body only a member or two over its
 * budget gives back less than the marker costs to print, so eliding it trades a
 * real spelling for a count and a rewritten page, and buys nothing. Measured on
 * the corpus when #5340 introduced the guard: without it, 29 of 189 enum
 * elisions saved fewer characters than the marker occupied (14 of them hid a
 * single member and saved 2-3 characters). With it, every elision that survives
 * saves at least its own cost, and a limit stops being a cliff at exactly one
 * character over.
 *
 * Shared by all three elisions (#6225/#6226 reuse what #5340 measured): the
 * enum-body budget, the top-level vocabulary relocation, and the `anyOf`
 * variant cap — which since #6569 also counts variants withheld for spelling a
 * string the cell already prints. They differ in what they count, never in
 * whether a marker is worth printing.
 *
 * Re-measured on the corpus with both new limits in place, by regenerating with
 * this guard forced to return `elided` unconditionally: it refuses **54** of the
 * 248 candidate elisions, and those 54 would together have saved **328
 * characters** — about 6 each, against a marker that costs 12-15 to print. 7 of
 * the refusals are `TOP_LEVEL_ENUM_WIDTH_LIMIT` candidates, i.e. seven whole
 * `### Allowed Values` sections that would have been added to a page to shave
 * single digits off one cell. The guard matters MORE for the relocation than it
 * did for #5340's in-shape elision, because a refusal there saved only a marker
 * while a refusal here saves a page section too.
 */
function elideWithMarker(
  shown: string[],
  hidden: number,
  fullLength: number,
  quantify = true,
): string | null {
  if (hidden <= 0) return null;
  const quantified = `… +${hidden} more`;
  const marker = quantify ? quantified : '…';
  const elided = [...shown, marker].join(' | ');
  // THE THRESHOLD IS ALWAYS MEASURED AGAINST THE QUANTIFIED MARKER, so dropping
  // the count changes the NOTATION and never the elision SET. Judged against the
  // bare `…` instead, the guard gets cheaper to satisfy and fires on bodies it
  // used to refuse: measured here, three `AppearanceConfig.allowedVisualizations`
  // cells (a 9-member, 92-character vocabulary printed in full since #5340)
  // started truncating — an information loss on an enum that has nothing to do
  // with why the count is coming out. #5340 calibrated this refusal on a corpus
  // sweep; re-deriving it from a shorter marker would re-decide that measurement
  // as a side effect of an unrelated change. One change, one effect.
  const quantifiedLength = [...shown, quantified].join(' | ').length;
  return fullLength - quantifiedLength >= quantified.length + ' | '.length ? elided : null;
}

/**
 * `quantify: false` — the in-shape summary's enum elision states THAT it cut,
 * never HOW MUCH (#9182).
 *
 * WHY THE COUNT COMES OUT OF THIS ONE POSITION. `+N more` is a function of the
 * vocabulary's cardinality, so every page carrying the marker is rewritten when
 * the vocabulary grows by one — including pages that say nothing else about it.
 * Measured on `ApiError.code` (288 members, `StandardErrorCode` ∪
 * `ERROR_CODE_LEDGER`), by registering one code and regenerating: **11 pages,
 * 69 lines. 66 of those 69 lines are this marker**, and 9 of the 11 pages —
 * `analytics`, `auth`, `automation-api`, `batch`, `export`, `metadata`,
 * `package-api`, `protocol`, `storage` — contain NOTHING ELSE, 100% of their
 * changed lines being `+285 more` → `+286 more`. The ledger is a per-PR append,
 * so any two PRs registering a code are mutually exclusive by construction, and
 * the generated pages carry no conflict markers when one side is dropped — the
 * silent-drop signature the merge driver already warns about.
 *
 * WHY THIS POSITION AND NOT THE OTHER TWO. The count is kept wherever it is
 * VERIFIABLE against members the page actually prints:
 *   - `TOP_LEVEL_ENUM_WIDTH_LIMIT` (`formatPropertyType`) keeps it — its
 *     `### Allowed Values` list is printed directly below, so the count is a
 *     cross-check the reader can perform, and that page must be rewritten by a
 *     vocabulary change anyway because it spells the vocabulary.
 *   - `VARIANT_LIMIT` keeps it — a union's arity is the only fact that cell
 *     still carries once `SHAPE_DEPTH_LIMIT` has collapsed its variants, and
 *     arity does not grow with a ledger.
 *   - The in-shape copy loses it. This file already records why that position
 *     is the cheap one: "Eliding a copy inside a summary is nearly free — the
 *     full list is elsewhere, or the JSON Schema is the authority." A count the
 *     page cannot substantiate is exactly the part that is free to drop, and on
 *     348 of the 805 in-shape occurrences no copy of the list is on the page at
 *     all.
 *
 * WHY THIS IS NOT A SECOND OMISSION STYLE. #6226 ruled that one table must not
 * carry two omission notations, and that ruling is intact: the bare `…` is not
 * new here, it is the token this renderer ALREADY uses for the unquantified
 * elision in this very cell. `INLINE_KEY_LIMIT` prints
 * `{ code: …; message: string; category?: string; httpStatus?: integer; … }` —
 * four keys and a countless `…` — so the summary containing this enum states
 * "there are more keys" without saying how many. Moving the enum inside it to
 * the same token makes one cell internally consistent instead of adding a
 * notation to the table: quantified where the members are printed, bare `…`
 * inside a summary that is already a sample. What a reader loses is the
 * MAGNITUDE of a list the page does not carry; what they keep is the fact that
 * it is a sample, which is what #5340 required against a SILENT prefix.
 */
function formatEnum(values: unknown[], budget: number | null): string {
  return `Enum<${elideEnum(values, budget, false).body}>`;
}

/**
 * One property's table cell — and, when its type IS a vocabulary too wide to
 * spell there, the members to print in full underneath it (#6225).
 *
 * `build-docs.ts` has always had a rendering built for a long vocabulary — a
 * `### Allowed Values` heading and one bullet per member — but it fired only
 * when the WHOLE SCHEMA was `type: 'string'` + `enum`. A schema Zod hoisted into
 * its own name (`data/FieldType`) got the bullets; the identical 49 members
 * inlined onto a PROPERTY (`Field.type`) got a 561-character table cell, and the
 * 261-member error vocabulary on `ApiError.code` got 6092. Which rendering a
 * vocabulary received depended on whether it had been hoisted — a fact about
 * Zod, not about how a reader needs to read it.
 *
 * This is the mirror of that branch, matched to it CONDITION FOR CONDITION
 * (`type === 'string'` and an `enum` array): the property's own type node is
 * itself the vocabulary. That exactness is what makes the relocation safe. The
 * elision is applied to the SAME node whose members are handed back, so the
 * cell can never be cut without the full list being printed — the two verdicts
 * come from one `elideEnum` call and cannot drift apart.
 *
 * Deliberately NOT matched, though each renders an `Enum<…>` somewhere in its
 * cell: `Enum<…>[]`, `Record<string, Enum<…>>`, and a union variant
 * (`Enum<…> | string`, `ui/page.mdx`'s `PageComponent.type`). For those, "the
 * allowed values of this property" is not the whole truth — the members are the
 * element/value/one-variant vocabulary — so a bullet list under the table would
 * state something the schema does not. They keep their full spelling, exactly
 * as #5340 left them.
 */
export function formatPropertyType(prop: any, ctx?: TypeContext): RenderedProperty {
  if (prop && prop.type === 'string' && Array.isArray(prop.enum)) {
    const { body, hidden } = elideEnum(prop.enum, TOP_LEVEL_ENUM_WIDTH_LIMIT);
    if (hidden > 0) {
      return { cell: `Enum<${body}>`, allowedValues: prop.enum.map((v: unknown) => String(v)) };
    }
  }
  return { cell: formatType(prop, ctx), allowedValues: null };
}

/**
 * `depth` is the count of `{ … }` shape levels already OPEN above this node,
 * and it is a parameter rather than a `TypeContext` field on purpose: a caller
 * that passes no `ctx` (every unit test that only wants a type string) must
 * still get the width budget, the way it always got the ternary this replaces.
 * `ctx` carries facts about the PAGE; depth is a fact about the RECURSION.
 */
export function formatType(prop: any, ctx?: TypeContext): string {
  return renderType(prop, ctx, 0);
}

function renderType(prop: any, ctx: TypeContext | undefined, depth: number): string {
  if (!prop) return 'any';

  // A `retiredKey()` tombstone. `never` is both the accurate TypeScript (the
  // key's `z.input` type IS `never`) and the only rendering that survives the
  // inline shape summary below, where there is no description column to carry
  // the `[REMOVED]` prescription. Checked FIRST: `{ not: {} }` accepts nothing
  // whatever else the node says, so no later branch can be more specific.
  if (isNeverNode(prop)) return 'never';

  if (prop.$ref) {
    // Self-reference: link to the current section rather than a bare `#`.
    if (prop.$ref === '#') {
      return ctx ? `[${ctx.currentSchema}](${anchorFor(ctx.currentSchema)})` : 'object';
    }

    const name = refName(prop.$ref);

    // Zod-hoisted inline schema: no page exists. Render its shape instead.
    if (isAnonymousRef(name)) {
      const target = ctx?.defs?.[name];
      if (!target) return 'object';
      // Cycle guard: these schemas are recursive (a node contains nodes).
      if (ctx!.expanding?.has(name)) return 'object';
      const expanding = new Set(ctx!.expanding ?? []);
      expanding.add(name);
      return renderType({ ...target, $ref: undefined }, { ...ctx!, expanding }, depth);
    }

    const href = ctx?.schemaHref?.(name) ?? null;
    return href ? `[${name}](${href})` : name;
  }

  if (prop.type === 'array') {
    const element = renderType(prop.items, ctx, depth);
    // An open object element renders as an intersection and a multi-variant
    // element as a union — `[]` would re-associate either — so parenthesize
    // and the cell keeps meaning "array of that".
    return hasTopLevelUnionOrIntersection(element) ? `(${element})[]` : `${element}[]`;
  }

  if (prop.enum) {
    return formatEnum(prop.enum, ctx?.inShapeSummary === true ? INLINE_ENUM_WIDTH_LIMIT : null);
  }

  if (prop.const !== undefined) {
    return formatLiteral(prop.const);
  }

  if (prop.anyOf || prop.oneOf) {
    const variants = prop.anyOf || prop.oneOf;
    const rendered: string[] = variants.map((v: any) => renderType(v, ctx, depth));
    const full = rendered.join(' | ');

    // A cell spells each DISTINCT variant rendering once, and counts every
    // variant it did not spell — repeats included (#6569).
    //
    // Two independent facts decide what a union cell shows, and this is one
    // expression of both. `VARIANT_LIMIT` caps how many spellings are worth
    // reading; the dedupe drops spellings that carry nothing because the cell
    // already prints them character for character. They compose into a single
    // marker rather than stacking two elisions, so the invariant a reader can
    // rely on stays one sentence: SPELLINGS SHOWN + THE COUNT = THE UNION'S
    // ARITY, whichever rule withheld a variant.
    //
    // Identical spellings are not new here, but #6374 made them common: with
    // `SHAPE_DEPTH_LIMIT` in force every all-object union below a summary
    // prints `object` per variant, so `object | object | object | object`
    // appeared on 9 cells across 5 shipped reference pages, and
    // `kernel/manifest.mdx`'s `Manifest.navigationContributions` spelled four
    // of them and then counted `… +5 more` identical ones behind them. Those
    // pages are the authoritative input for AI authors (ADR-0033), where a
    // cell that reads as a rendering bug costs more than a wide one.
    //
    // 9 and not the 11 #6569 was filed with, because a SUBSTRING count of
    // `object | object` also matches the two cells that spell
    // `object | object[]` (`ui/page.mdx`'s `slots`,
    // `automation/state-machine.mdx`'s `states`) — two spellings, which the
    // rule below deliberately never collapses. Worth knowing before grepping:
    // re-deriving 11 that way and concluding the dedupe missed two cells is
    // the wrong conclusion from a correct observation. Counting all duplicate
    // spellings rather than only `object` ones, the rule moves 14 cells on 7
    // pages; the extra 5 repeat a SHAPE spelling (`ui/app.mdx`,
    // `data/validation.mdx`).
    //
    // WHY THE COUNT STAYS. Collapsing to a bare `object` would drop the union's
    // ARITY, which after the depth budget is the only fact that cell still
    // carries — "choose one of N shapes" degraded to "some object". #6226 ruled
    // that a union elision must self-report what it hid; a dedupe that reports
    // nothing re-decides that ruling by the back door.
    //
    // WHY NO NEW NOTATION. The count is `… +N more`, the marker the table
    // already uses for elided enum members (#5340), relocated vocabularies
    // (#6225) and capped variants (#6226) — not a multiplicity sigil like
    // `object ×4`. #6226's ruling turned on exactly this: a SECOND omission
    // style in one table is worse than the width it would fix. `N` counts
    // variants-not-spelled in every one of the four positions, so the marker
    // keeps meaning one thing.
    //
    // WHY EQUALITY IS ON THE RENDERED STRING, and why it is not restricted to
    // ADJACENT runs. This renderer judges what a reader sees, so two variants
    // are interchangeable here exactly when their cells are byte-identical —
    // `object | object[]` (`ui/page.mdx`'s `Page.slots`) is two spellings and
    // never collapses, however alike the schemas are. Adjacency was measured
    // and rejected: `App.navigation` — #6226's own filed instance — renders
    // seven identical nav-item shapes, then `{ type: 'separator'; … }`, then an
    // EIGHTH copy of the nav-item shape. A `uniq`-style adjacent rule leaves
    // that eighth copy spelled a second time, i.e. it leaves the defect in the
    // one cell the family was filed on. It is the only corpus site where the
    // two rules differ (3 of 554 union renderings, all three that cell on its
    // three pages).
    //
    // THE PAY-FOR-YOUR-MARKER GUARD APPLIES UNCHANGED — not exempted, and its
    // refusals are correct. Under it a run of identical spellings only
    // collapses once the count is cheaper than the repetition: `object |
    // object` would GROW by 3 characters and `object | object | object` saves
    // 6 against a 12-character marker footprint, so both keep their repeats;
    // four is the first width at which `object` repeats pay (15 saved).
    // Measured on the corpus: 554 union renderings, 14 carry a duplicate
    // spelling, and the guard accepts all 14 — no corpus cell sits in the
    // refusal band today, which is why the refusal is pinned by unit test
    // rather than by a page.
    const spelled = [...new Set(rendered)];
    const shown = spelled.slice(0, VARIANT_LIMIT);
    const hidden = rendered.length - shown.length;
    if (hidden === 0) return full;
    // The variants a reader does not see are counted, never silently dropped —
    // the principle #5340 established for enum members, applied to the other
    // axis a cell grows along (#6226). `elideWithMarker` keeps the count from
    // costing more than the spellings it replaces.
    const elided = elideWithMarker(shown, hidden, full.length);
    return elided ?? full;
  }

  if (prop.type === 'object') {
    // Declared keys and openness are INDEPENDENT facts, and JSON Schema states
    // them independently: a `.passthrough()` / `.catchall()` object carries
    // `properties` AND `additionalProperties` at once. Testing the latter first
    // — as this renderer did until #4912 — made them alternatives, so every
    // open object with a declared shape printed as a bare `Record<string, any>`
    // and the author-facing page lost keys the schema *requires*.
    const open = prop.additionalProperties
      ? `Record<string, ${renderType(prop.additionalProperties, ctx, depth)}>`
      : null;

    // Inline object: show its shape one level deep instead of an opaque `Object`.
    //
    // Tombstoned keys are dropped BEFORE `INLINE_KEY_LIMIT` is applied, not
    // rendered as `never` and counted. They are not authorable surface any
    // more, so spending one of the four slots on one — and pushing a key the
    // author MUST write behind the `…` to afford it — sells a removed key in
    // place of a live one. The elision cannot be worked around by ordering,
    // either: #5248 retired `IndexSchema.type`/`.partial` down to three live
    // keys, so with a limit of four the first tombstone is *mathematically*
    // guaranteed into the summary however low in the shape it sits (#5606).
    // Their own table row still carries the `[REMOVED]` prescription wherever
    // the shape is a named schema; a summary cell has no description column to
    // carry it at all.
    const keys = prop.properties
      ? Object.keys(prop.properties).filter(k => !isNeverNode(prop.properties[k]))
      : [];

    if (keys.length > 0) {
      // The shape budget, spent HERE rather than at each of the four descents
      // that reach this branch (#6374). A cell opens `SHAPE_DEPTH_LIMIT` shape
      // levels; below that a shape prints `object`, whichever way down it was
      // reached — a direct object child, an array element, a `Record` value or
      // a union variant. Wrappers do not spend the budget, only shapes do, so
      // `{ … }[]` and `Record<string, { … }>` are one level, not two.
      if (depth >= SHAPE_DEPTH_LIMIT) return 'object';
      const shown = keys.slice(0, INLINE_KEY_LIMIT).map(k => {
        const child = prop.properties[k];
        const optional = (prop.required || []).includes(k) ? '' : '?';
        // Everything below this point is a SUMMARY of the child, not the
        // child's own row, so a long enum reached from here is elided (#5340).
        // The flag is set once, here, and inherited by every branch underneath
        // — arrays of objects recurse, so `errors?: { code: Enum<…> }[]` is
        // reached this way.
        const childType = renderType(child, ctx && { ...ctx, inShapeSummary: true }, depth + 1);
        return `${k}${optional}: ${childType}`;
      });
      // `…` elides further LIVE declared keys; `& Record<…>` states that
      // UNDECLARED ones are accepted. Different facts — a cell may need both.
      // Tombstones are in neither set: they are declared and rejected, so a
      // summary that ends without `…` now means "these are all the keys you may
      // write", which is a stronger and truer claim than it used to be.
      if (keys.length > shown.length) shown.push('…');
      const shape = `{ ${shown.join('; ')} }`;
      // Declared shape first: the reader needs the keys they MUST write before
      // the note that extra ones are tolerated.
      return open ? `${shape} & ${open}` : shape;
    }

    // No LIVE key declared — either `properties: {}` outright, or a shape whose
    // every declared key is now a tombstone. Both state the same authorable
    // fact, and neither is a shape: intersecting one would print
    // `{  } & Record<…>`, so fall through to the record/opaque renderings
    // exactly as before.
    if (open) return open;
    if (!prop.properties) return 'object';
    return '{  }';
  }

  if (Array.isArray(prop.type)) {
    return prop.type.join(' | ');
  }

  return prop.type || 'any';
}
