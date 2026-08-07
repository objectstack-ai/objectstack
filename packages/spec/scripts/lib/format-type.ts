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

export const refName = (ref: string): string => ref.split('/').pop() || ref;
export const isAnonymousRef = (name: string) => /^__schema\d+$/.test(name);

/** A page-local anchor, matching how fumadocs slugs the `## SchemaName` heading. */
export const anchorFor = (schemaName: string) => `#${schemaName.toLowerCase()}`;

/** How many declared keys an inline object shows before eliding the rest. */
const INLINE_KEY_LIMIT = 4;

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
 * An `enum` node's members, joined — and, inside a shape summary only, cut to
 * `INLINE_ENUM_WIDTH_LIMIT` with an explicit count of what was cut.
 *
 * The elided spelling is `Enum<'text' | 'textarea' | … +42 more>`-shaped:
 * `…` is the same "there is more" token the key elision above already uses, and
 * `+42 more` is the part that makes this SAFE to do at all. A silent prefix
 * would leave the page looking complete while it wasn't — the reader has no way
 * to tell a 7-member vocabulary from the first 7 of 49 — and a docs page that
 * lies by omission is worse than a wide one. With the count, the cell states
 * exactly what it is: a sample of a 49-term vocabulary.
 *
 * Where the rest stays readable, in order of what a reader hits first:
 *   1. The vocabulary's OWN row is never elided — `ctx.inShapeSummary` is only
 *      set below a summary's `{ … }`. For 457 of the 805 in-shape occurrences
 *      the identical list is printed in full elsewhere on the SAME page (the
 *      named schema's own `type` row, or its `### Allowed Values` bullets):
 *      `BulkActionDef.params` is one — `BulkActionParam.type` two sections down
 *      carries all 49 — and so is every `api/*.mdx` `error` shape, whose codes
 *      are spelled out on `ErrorResponse.code`.
 *   2. For the remaining 348 the elided cell is the only place on that page, so
 *      the count is doing the work by itself, and the JSON Schema under
 *      `json-schema/` remains the authority it always was.
 * The marker cannot be an anchor to (1): Zod inlines enums, so the node reaching
 * this function is a bare `{ type: 'string', enum: [...] }` with no `$ref` and
 * no name to link — inventing one would be guessing at which page-local heading
 * happens to carry the same members.
 */
function formatEnum(values: unknown[], inShapeSummary: boolean): string {
  const members = values.map((v: unknown) => formatLiteral(v));
  const full = members.join(' | ');
  if (!inShapeSummary || full.length <= INLINE_ENUM_WIDTH_LIMIT) return `Enum<${full}>`;

  // Fill greedily, never below one member: a sample of zero states nothing, and
  // the member widths are the schema's, not ours to bound.
  const shown: string[] = [];
  let width = 0;
  for (const member of members) {
    const cost = shown.length === 0 ? member.length : member.length + ' | '.length;
    if (shown.length > 0 && width + cost > INLINE_ENUM_WIDTH_LIMIT) break;
    shown.push(member);
    width += cost;
  }

  const hidden = members.length - shown.length;
  // One member wider than the whole budget: it was forced in, nothing is
  // hidden, and `+0 more` would be a marker pointing at nothing.
  if (hidden === 0) return `Enum<${full}>`;

  const marker = `… +${hidden} more`;
  const elided = [...shown, marker].join(' | ');
  // THE MARKER MUST EARN ITS OWN FOOTPRINT. A body only a member or two over
  // the budget gives back less than the marker costs to print, so eliding it
  // trades a real spelling for a count and a rewritten page, and buys nothing.
  // Measured on the corpus: without this guard 29 of 189 elisions save fewer
  // characters than the marker occupies (14 of them hide a single member and
  // save 2-3 characters). With it, every elision that survives saves at least
  // its own cost, and the limit stops being a cliff at exactly 81 characters.
  const markerFootprint = marker.length + ' | '.length;
  const worthIt = full.length - elided.length >= markerFootprint;
  return `Enum<${worthIt ? elided : full}>`;
}

export function formatType(prop: any, ctx?: TypeContext): string {
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
      return formatType({ ...target, $ref: undefined }, { ...ctx!, expanding });
    }

    const href = ctx?.schemaHref?.(name) ?? null;
    return href ? `[${name}](${href})` : name;
  }

  if (prop.type === 'array') {
    const element = formatType(prop.items, ctx);
    // An open object element renders as an intersection and a multi-variant
    // element as a union — `[]` would re-associate either — so parenthesize
    // and the cell keeps meaning "array of that".
    return hasTopLevelUnionOrIntersection(element) ? `(${element})[]` : `${element}[]`;
  }

  if (prop.enum) {
    return formatEnum(prop.enum, ctx?.inShapeSummary === true);
  }

  if (prop.const !== undefined) {
    return formatLiteral(prop.const);
  }

  if (prop.anyOf || prop.oneOf) {
    const variants = prop.anyOf || prop.oneOf;
    return variants.map((v: any) => formatType(v, ctx)).join(' | ');
  }

  if (prop.type === 'object') {
    // Declared keys and openness are INDEPENDENT facts, and JSON Schema states
    // them independently: a `.passthrough()` / `.catchall()` object carries
    // `properties` AND `additionalProperties` at once. Testing the latter first
    // — as this renderer did until #4912 — made them alternatives, so every
    // open object with a declared shape printed as a bare `Record<string, any>`
    // and the author-facing page lost keys the schema *requires*.
    const open = prop.additionalProperties
      ? `Record<string, ${formatType(prop.additionalProperties, ctx)}>`
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
      const shown = keys.slice(0, INLINE_KEY_LIMIT).map(k => {
        const child = prop.properties[k];
        const optional = (prop.required || []).includes(k) ? '' : '?';
        // Depth-limited: nested objects stay opaque so a table cell can't explode.
        // Everything below this point is a SUMMARY of the child, not the
        // child's own row, so a long enum reached from here is elided (#5340).
        // The flag is set once, here, and inherited by every branch underneath
        // — arrays of objects recurse (only a direct object child is forced
        // opaque above), so `errors?: { code: Enum<…> }[]` is reached this way.
        const childType = child?.type === 'object' && child.properties
          ? 'object'
          : formatType(child, ctx && { ...ctx, inShapeSummary: true });
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
