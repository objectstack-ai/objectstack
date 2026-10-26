/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * sort-query — lower a block's authored `sort` to the `$orderby` value a
 * `DataSource.find` query carries.
 *
 * ONE authored spelling reaches every object-bound block: the spec's
 * `SortConfig[]` (`[{ field, order }]`). The legacy OData-ish string clause
 * (`"name desc"`) that this function also honoured until objectui#8221 is
 * RETIRED — director ruling, decision batch #77, 2026-09-07 (objectui#8221,
 * maintainer approved), option B: "The platform has one `sort` spelling, the
 * array, everywhere."
 *
 * Why the string had to go rather than be declared alongside the array: every
 * `sort` input in the registry publishes `type: 'array'` alone, so the html
 * tier already answered `type-mismatch` for the string, and
 * `@objectstack/spec` refuses it outright on `element-record-picker`. A
 * spelling that core implements, the docs teach and the validator rejects is
 * three faces disagreeing, and the ruling settled which one wins. Declaring
 * per-block string arms instead (option A) was rejected by name: it would make
 * one key mean different things on different blocks.
 *
 * This is now the ONLY definition in the repo. It was hoisted here because
 * objectstack#7137 added two more read sites (`object-timeline`,
 * `record:line_items`) next to three sibling blocks that each inlined a
 * byte-identical private copy (`ObjectGantt` / `ObjectMap` / `ObjectCalendar`),
 * and a fifth and sixth copy is how the conversions start disagreeing. Those
 * three copies were deliberately left alone by objectstack-ai/objectstack#7137 and collapsed onto this
 * function by objectui#4022; every block now imports it from here.
 *
 * Two deliberate differences from those retired private copies, both of which
 * make this function more faithful to the declared contract rather than adding
 * tolerance — and both are BEHAVIOUR CHANGES the migration delivered, not pure
 * refactor:
 *
 *  - **A missing `order` is READ as ascending rather than dropped.** ⚠️ This
 *    bullet used to say `order` is "optional in `SortConfig`". It is not:
 *    `SortConfig.order` is required on the interface, on its zod mirror, and on
 *    `@objectstack/spec`'s `SortItemSchema`, which refuses an entry without it
 *    (`invalid_value` at `0.order`, measured on `@objectstack/spec@17.4.0`).
 *    Corrected under objectui#8973, which is where objectui#8767's contract
 *    review routed this sentence and its twin in
 *    `@object-ui/types`' `ObjectGridSchema.sort` docblock. The tolerance is
 *    real but it is a RUNTIME one — types are erased, so an entry missing
 *    `order` still arrives and still has to mean something. The private copies
 *    required BOTH keys and silently dropped such an entry, which lost an
 *    authored sort key instead of ordering by it.
 *  - **Nothing usable yields `undefined`, never `{}`.** An empty object is a
 *    truthy value that means "no ordering" only by accident of the adapter's
 *    serializer; `undefined` says it, so the query simply carries no `$orderby`.
 *
 * Not a lenient alias: an unusable input (a number, an object, an array of
 * strings) yields `undefined` rather than a guess. Only the ONE spelling the
 * schema types declare is honoured.
 *
 * ⚠️ A retired string is REFUSED OUT LOUD, not dropped in silence. Types are
 * erased, so the narrowed signature below cannot stop a string: authored JSON,
 * a stored `sys_metadata` row and an `as any` bag all reach this function
 * unparsed. Returning `undefined` and saying nothing would turn every one of
 * those into a row order that quietly stopped applying — the exact failure this
 * repository has measured over and over. See {@link convertSortToQueryParams}.
 *
 * ⚠️ OUT LOUD is about the SPELLING, not about the container it arrives in
 * (objectui#9955). `sort: ['name asc']` is the same retired clause one level
 * down, and it used to reach the array arm's `continue` and leave through the
 * `undefined` return with nothing printed — the loud scalar refusal sat one arm
 * above it, so the two spellings of one mistake got opposite treatment. Both are
 * loud now. ⛔ Being loud is NOT accepting: the sentence four paragraphs up
 * ("an unusable input … yields `undefined` rather than a guess") still holds
 * byte for byte, and `['name asc']` still contributes no ordering. The ruling
 * quoted at the top of this docblock — one `sort` spelling, the array,
 * everywhere — is the reason making it WORK was never on the table.
 */

/** A field name paired with a direction — the spec's `SortConfig`. */
export interface QuerySortEntry {
  field?: string;
  order?: 'asc' | 'desc';
}

/**
 * The canonical spelling, quoted in the refusal diagnostic so the message
 * carries the fix and not just the complaint.
 *
 * ⚠️ BOTH keys, deliberately. `order` is REQUIRED on `SortConfig`, on its zod
 * counterpart and on `@objectstack/spec`'s `SortItemSchema`, so an example that
 * omitted it would make this diagnostic prescribe metadata a publish refuses —
 * objectui#9031. The pin feeds this very example back through `SortItemSchema`
 * from the installed artifact rather than eyeballing it, because the way this
 * regresses is somebody "simplifying" the example, not somebody editing prose.
 */
const ARRAY_FORM_EXAMPLE = "[{ field: 'name', order: 'desc' }]";

/**
 * Retired string clauses already reported, so one bad `sort` logs its
 * prescription ONCE instead of once per render. The message is a fix
 * instruction for an author, not a per-render event, and this sink runs inside
 * the query memo of every object-bound block — a related-list derivation over
 * an object with N lists would otherwise print N lines per pass.
 *
 * Module state, exactly as {@link resetRetiredSortSpellingReports}'s sibling
 * `resetRetiredFieldTypeReports` keeps it for retired field types: the dedupe
 * is per SPELLING, so two blocks that inherit the same bad view sort still
 * print one line between them.
 *
 * ⚠️ It holds keys, not raw spellings — the two arms that report are ARM-TAGGED
 * (objectui#9955). A retired string arrives either as the whole `sort` or as one
 * entry of the array, and the two get DIFFERENT messages (what a reader must
 * change, and what the query still carries, are not the same in the two cases).
 * On one shared raw key the first arm to fire would silence the other, and the
 * author would read a sentence about the wrong container. {@link retiredKey}
 * builds the keys so the two spaces cannot collide, and the bound each arm keeps
 * is unchanged: ONE line per distinct spelling per arm, however many blocks
 * inherit the same bad view.
 */
const reportedRetiredSpellings = new Set<string>();

/**
 * Key a report by the arm that produced it AND the spelling that produced it.
 *
 * The two spaces are disjoint by construction rather than by luck: `arm` is one
 * of two fixed tokens, neither of which contains a newline, so the text before
 * the first newline identifies the arm no matter what an author wrote. A raw
 * spelling can be anything at all — it comes out of authored JSON — so a bare
 * string prefix would only be disjoint until somebody authored the prefix.
 */
function retiredKey(arm: 'scalar' | 'entry', spelling: string): string {
  return `${arm}\n${spelling}`;
}

/**
 * Test seam — forget which retired spellings have been reported.
 *
 * Needed because the dedupe above is module state: without it the second test
 * to assert the refusal diagnostic would observe silence and pass for the
 * wrong reason.
 */
export function resetRetiredSortSpellingReports(): void {
  reportedRetiredSpellings.clear();
}

/**
 * Name a retired string `sort` clause, once per spelling.
 *
 * `console.error`, not `warn`, and not dev-gated: this call REFUSES an authored
 * row order, so the page renders in a different order than the author asked
 * for. That is the same severity class as `reportRetiredFieldType`, which is
 * also unconditional, and the opposite of `warnOnUnknownActionKeys`, which only
 * reports keys nothing was ever going to read.
 *
 * ⚠️ This text is read at the moment the author is ALREADY being corrected, so
 * it must not prescribe metadata the spec refuses (objectui#9031). It used to
 * end "`order` is optional and means `'asc'`" — a RUNTIME tolerance stated as
 * an AUTHORING permission. Both halves of that are load-bearing and both have to
 * survive any rewording:
 *
 *  - the tolerance is REAL — a missing `order` is read as ascending here rather
 *    than dropped (see {@link normalizeSortEntries}), because types are erased
 *    and an entry that arrives without it still has to mean something;
 *  - and it is NOT permission — `order` is required on `SortConfig`, on its zod
 *    counterpart and on `@objectstack/spec`'s `SortItemSchema`, which refuses an
 *    entry without it.
 *
 * Stating only the first is what made an author who followed this correction
 * verbatim get refused a second time, at publish, by a different door. Deleting
 * the tolerance instead would be the opposite error: it is what this renderer
 * actually does, and a diagnostic that denies it sends the author hunting for a
 * dropped sort key that was never dropped.
 */
function reportRetiredSortSpelling(sort: string): void {
  const key = retiredKey('scalar', sort);
  if (reportedRetiredSpellings.has(key)) return;
  reportedRetiredSpellings.add(key);
  console.error(
    `[object-ui] convertSortToQueryParams: the legacy string \`sort\` clause is retired ` +
      `(objectui#8221) and was REFUSED — received ${JSON.stringify(sort)}, so this query ` +
      `carries no \`$orderby\`. Write the array form instead: ` +
      `sort: ${ARRAY_FORM_EXAMPLE} — both keys, on every entry. \`order\` is required: on ` +
      `\`SortConfig\`, on its zod counterpart, and on \`@objectstack/spec\`'s \`SortItemSchema\`, ` +
      `which refuses an entry without it. (A missing \`order\` is still read as \`'asc'\` ` +
      `here — that is a runtime tolerance, not permission to omit the key: metadata ` +
      `written that way is refused when it is published.) ` +
      `The array is the only spelling every \`sort\` input declares, and the only one ` +
      `\`@objectstack/spec\` accepts.`,
  );
}

/**
 * Name a retired string clause that arrived as an ENTRY of the `sort` array,
 * once per spelling (objectui#9955).
 *
 * A sibling of {@link reportRetiredSortSpelling} rather than a reuse of it, and
 * the difference is the one sentence an author acts on: the scalar refusal can
 * say "this query carries no `$orderby`" because refusing the whole value is
 * refusing the whole ordering, while one bad entry among good ones leaves the
 * other entries lowering normally — `[{ field: 'a', order: 'asc' }, 'b desc']`
 * still orders by `a`. Reusing the scalar text here would tell an author their
 * rows are unordered when they are ordered by everything except the key they
 * are hunting for, which is worse than silence.
 *
 * Everything the scalar text carries, this one carries too, because objectui#9031
 * ruled BOTH halves load-bearing and a reader reaching this message is being
 * corrected in exactly the same moment: the worked array-of-objects example, the
 * fact that `order` is REQUIRED at publish, and the fact that this renderer's
 * ascending default is a RUNTIME tolerance and ⛔ not permission to omit the key.
 *
 * The caller withholds exactly one string from this reporter — `''` — because
 * `sort: ''` does not reach the scalar reporter either (the `!sort` guard reads
 * an empty spelling as "the author wrote nothing", and its pin says reporting it
 * would train readers to ignore the message). Mirroring that is the point of the
 * whole card; inverting it one container deeper would recreate the same
 * inconsistency in the other direction.
 *
 * `console.error`, unconditional and not dev-gated — the same choice, for the
 * same reason, as its scalar sibling: this refuses an authored row order, so the
 * page renders in an order the author did not ask for. ⛔ Not the
 * `warnOnUnknownActionKeys` class, which reports keys nothing was ever going to
 * read; here something WAS going to be read and now is not.
 */
function reportRetiredSortEntrySpelling(entry: string): void {
  const key = retiredKey('entry', entry);
  if (reportedRetiredSpellings.has(key)) return;
  reportedRetiredSpellings.add(key);
  console.error(
    `[object-ui] convertSortToQueryParams: a \`sort\` ARRAY ENTRY is the retired string ` +
      `clause (objectui#8221) and was REFUSED — received ${JSON.stringify(entry)} as an entry ` +
      `of the \`sort\` array, so that entry orders nothing (and if it was the only usable ` +
      `entry, this query carries no \`$orderby\` at all). The retirement is about the ` +
      `SPELLING, not the container: wrapping the clause in an array does not revive it. ` +
      `Write entry OBJECTS instead: sort: ${ARRAY_FORM_EXAMPLE} — both keys, on every entry. ` +
      `\`order\` is required: on \`SortConfig\`, on its zod counterpart, and on ` +
      `\`@objectstack/spec\`'s \`SortItemSchema\`, which refuses an entry without it. ` +
      `(A missing \`order\` is still read as \`'asc'\` here — that is a runtime tolerance, ` +
      `not permission to omit the key: metadata written that way is refused when it is ` +
      `published.) The array OF OBJECTS is the only spelling every \`sort\` input declares, ` +
      `and the only one \`@objectstack/spec\` accepts.`,
  );
}

/**
 * A sort entry after normalization — BOTH keys present, always. That is the
 * difference from {@link QuerySortEntry}, whose two members are optional
 * because it describes what an author may WRITE, not what survives this door.
 */
export interface NormalizedSortEntry {
  field: string;
  order: 'asc' | 'desc';
}

/**
 * Decide WHICH authored entries survive and WHAT a missing direction means —
 * the whole of this module's normalization, with no opinion about the wire.
 *
 * Split out of {@link convertSortToQueryParams} by objectui#8973, which measured
 * `object-grid` re-implementing this decision privately and getting it wrong:
 * its array arm interpolated every key unconditionally, so an entry missing
 * `field` or `order` reached the wire as the literal text `undefined`
 * (`$orderby: 'name undefined'`), which the server answers `400 INVALID_QUERY`.
 *
 * ⚠️ It is SHAPE-AGNOSTIC on purpose, and that is what makes it reusable where
 * the map below is not. `object-grid` sends a `"field order"` join string, not
 * this module's `{field: direction}` map; swapping its wire shape is route B on
 * objectui#8767, which the maintainer DECLINED by name (2026-09-10) pending a
 * card that measures the server contract and both readers. Exporting the
 * decision without the map lets that block share the ONE implementation of the
 * rule while keeping the wire shape the declination protects — so "one
 * operation, one implementation" is satisfied for the operation that actually
 * has two copies, rather than being traded away for a shape change nobody
 * ruled on.
 *
 * The two rules, unchanged from the map builder they were lifted out of:
 *
 *  - an entry with no usable `field` is SKIPPED (it names nothing to order by);
 *  - `order` normalizes to `'asc'` unless it is exactly `'desc'`, so a missing
 *    direction means ascending and a garbage one does not reach the wire.
 *
 * A third rule was added by objectui#9955 and it changes no RETURN value: a
 * STRING entry is the retired clause one container deeper, so it is now REFUSED
 * OUT LOUD before the skip above reaches it — and then skipped, contributing
 * nothing, exactly as before. ⛔ The two rules above are untouched by it; in
 * particular the entry-shaped object with no `field` keeps its DELIBERATE
 * silence, because it names nothing to order by rather than naming it in a
 * retired spelling. The seam is `typeof entry === 'string'` and only that.
 *
 * @returns The surviving entries in authored order, or `undefined` when nothing
 * orderable was authored — never an empty array, so callers can omit the
 * query key entirely rather than asking for an ordering with no content.
 */
export function normalizeSortEntries(
  sort: QuerySortEntry[] | undefined | null,
): NormalizedSortEntry[] | undefined {
  if (!sort) return undefined;

  // Retired spelling — reachable only at runtime, since the signature above no
  // longer admits it. Read through `unknown` on purpose: the check is about the
  // VALUE that actually arrived, not about the type the caller promised.
  if (typeof (sort as unknown) === 'string') {
    reportRetiredSortSpelling(sort as unknown as string);
    return undefined;
  }

  if (Array.isArray(sort)) {
    const out: NormalizedSortEntry[] = [];
    for (const entry of sort) {
      // The retired spelling, one container deeper (objectui#9955). Read through
      // `unknown` for the same reason the scalar arm above does: the check is
      // about the VALUE that arrived, not the type the caller promised. ⛔ This
      // branch does not ACCEPT the string — the entry still contributes nothing,
      // exactly as it did when it fell through the skip below. All it adds is the
      // sentence that says so.
      //
      // The one string it does not name is `''`, and that is SYMMETRY with the
      // scalar arm rather than an exception to the seam: `sort: ''` never reaches
      // the loud arm above either, because the `!sort` guard reads it as "the
      // author wrote nothing" rather than as the retired clause. Whitespace is
      // NOT in that carve-out — `'   '` is truthy, is loud on the scalar arm
      // today, and stays loud here.
      if (typeof (entry as unknown) === 'string') {
        const spelling = entry as unknown as string;
        if (spelling !== '') reportRetiredSortEntrySpelling(spelling);
        continue;
      }
      if (!entry || typeof entry.field !== 'string' || entry.field === '') continue;
      out.push({ field: entry.field, order: entry.order === 'desc' ? 'desc' : 'asc' });
    }
    return out.length > 0 ? out : undefined;
  }

  return undefined;
}

/**
 * Normalize an authored `sort` into the field→direction map used for
 * `QueryParams.$orderby`.
 *
 * The decision about which entries survive lives in
 * {@link normalizeSortEntries}; this function is only the MAP projection of it.
 * Duplicate fields therefore collapse last-wins, keeping the position of the
 * first mention — the same thing the single-pass loop this replaced did, since
 * an object key keeps its insertion position when it is re-assigned.
 *
 * @param sort `SortConfig[]` — the one declared spelling. The legacy string
 * clause (`"name desc"`) is retired (objectui#8221): a string that reaches here
 * at runtime is refused with a diagnostic naming the array form, and this
 * function returns `undefined` so the query carries no `$orderby`.
 * @returns The ordering map, or `undefined` when nothing orderable was authored.
 */
export function convertSortToQueryParams(
  sort: QuerySortEntry[] | undefined | null,
): Record<string, 'asc' | 'desc'> | undefined {
  const entries = normalizeSortEntries(sort);
  if (!entries) return undefined;

  const out: Record<string, 'asc' | 'desc'> = {};
  for (const entry of entries) out[entry.field] = entry.order;
  return out;
}
