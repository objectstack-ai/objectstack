/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * URL filter (de)serialization shared by the drill "escape hatch"
 * (`useOpenRecordList`, the WRITE side) and the ADR-0055 bare data surface
 * (`ObjectDataPage`, the READ side). Keeping both sides in ONE module keeps the
 * `filter[<field>][<op>]` operator contract (objectstack-ai/objectstack#1752) from drifting between the
 * code that emits a URL and the code that parses it back.
 *
 * Contract:
 *   - equality      `filter[field]=value`              → `[field, '=', value]`
 *   - range / cmp   `filter[field][gte|lte|gt|lt]=v`   → `[field, '>=' | … , v]`
 *   - is null       `filter[field][null]=true|false`   → `[field, 'is_null', true]`
 *                                                     / `[field, 'is_not_null', true]`
 *   - is empty      `filter[field][empty]=true|false`  → `[field, 'is_empty', true]`
 *                                                     / `[field, 'is_not_empty', true]`
 * A date-bucket drill emits `gte` + `lt` to scope a list to a time bucket; an
 * EMPTY-bucket drill emits `[null]=true` (objectui#9159), a widget filter
 * asking for "this field is set" emits `[null]=false` (objectui#9508), and a
 * widget filter saying "is empty" / "is not empty" emits `[empty]=true|false`
 * (objectui#11547).
 */

/** Filter triple shape shared with view metadata: [field, operator, value]. */
export type FilterTriple = [string, string, unknown];

/**
 * URL range/comparison operator suffix → ObjectQL operator (READ side).
 *
 * ## No prototype, because the URL chooses the key (objectui#9507)
 *
 * `parseUrlFilterTriples` decides "is this suffix an operator" by looking the
 * suffix up here and testing the result for truthiness — and the suffix comes
 * from the address bar. While this was a plain object literal that question was
 * also answered by `Object.prototype`: `filter[amount][constructor]` resolved to
 * `Object.prototype.constructor`, passed the guard, and emitted a triple whose
 * OPERATOR WAS A JS FUNCTION — neither ignored nor downgraded, the two outcomes
 * `parseUrlFilterTriples` promises are the only ones. `__proto__` was the same
 * defect in a second shape: its inherited accessor yielded `Object.prototype`
 * itself, so that suffix produced an operator that was an OBJECT.
 *
 * ⛔ The repair is deliberately NOT a list of member names to refuse. A denylist
 * is a spelling-level patch that the next member of `Object.prototype` walks
 * straight past, and it would have to be kept in step with a prototype this
 * module does not own. Removing the prototype removes the construction that
 * permitted the answer at all, so an own entry is the only thing a lookup here
 * can ever find. The sweep in `drillUrlFilters.test.ts` enumerates
 * `Object.prototype` at run time rather than naming members, for the same
 * reason.
 *
 * ⚠️ The exported face is unchanged and must stay unchanged: same name, same
 * four entries, same `Record<string, string>` type, same behaviour under
 * spread, `Object.entries` and `Object.keys` — `ObjectDataPage` inverts this
 * map to bridge a triple's operator to the spec's alias spelling, and
 * `drillEmptyBucketNavHost-9085.test.ts` pins its key list. ⛔ Do not "simplify"
 * it back to an object literal.
 */
export const URL_FILTER_OPS: Record<string, string> = Object.assign(Object.create(null), {
  gte: '>=',
  lte: '<=',
  gt: '>',
  lt: '<',
});

/** ObjectQL range operator key → URL param suffix (WRITE side). Inverse of the
 *  relevant `URL_FILTER_OPS` entries. */
export const RANGE_OP_PARAM: Record<string, string> = { $gte: 'gte', $lte: 'lte', $gt: 'gt', $lt: 'lt' };

/**
 * The EMPTINESS operator pair (objectui#9159, completed by objectui#9508), in
 * the ONE place both sides read it from, so the write and read halves cannot
 * drift apart on its spelling.
 *
 * ## One param, whose VALUE is the direction — not a comparand
 *
 * Every range and equality member of this vocabulary carries a value the user
 * is filtering BY. This one carries none: the condition is "this dimension is
 * empty" or "this dimension is set", and the param's boolean says WHICH. Three
 * consequences, all deliberate and all pinned:
 *
 *   - `filter[field][null]=false` IS the is-not-null operator (objectui#9508).
 *     objectui#9159 ruled it deliberately not an operator, on a premise it
 *     stated outright — this dialect could not WRITE "is not null", so a
 *     read-side-only operator would have been a second contract with no
 *     producer. objectui#9508 supplies that producer in the write arm below, in
 *     the same commit, so the premise is DISCHARGED rather than overridden and
 *     the read side is never alone with an operator nothing emits.
 *   - anything else in that slot is still dropped like an unknown suffix —
 *     never downgraded to `is_null false`, never to an equality against the
 *     string the param happens to hold.
 *   - equality-to-empty-string is not a substitute: `parseUrlFilterTriples`
 *     skips a param whose value is `''`, so `filter[owner]=` round-trips to no
 *     condition at all. Both spellings are non-empty literals for that reason.
 *
 * ## Why TWO producer keys are read, not one
 *
 * `convertFiltersToAST` lowers four producer spellings onto these two
 * operators: `$null` carries the direction verbatim and `$exists` carries its
 * inverse. Both are read here, because the two drill routes deliver different
 * ones — measured, not assumed:
 *
 *   - a COMPOSED drill filter's is-null condition only ever arrives spelled
 *     `$null`.
 *     `composeDrillFilter` lowers through the spec's `parseFilterAST`, which
 *     canonicalises `is_not_null` back to `{ $null: false }`, so an authored
 *     `$exists` is already gone by the time it reaches this function.
 *     ⚠️ Its is-EMPTY condition does not arrive as `$null` any more: from
 *     `@objectstack/spec` 17.6.0 that lowering spells `is_empty` /
 *     `is_not_empty` as `$empty`, a different question on a text or
 *     multi-value field, carried by its own pair, {@link EMPTY_FILTER}
 *     (objectui#11547). Before 17.6.0 all four empty spellings lowered to
 *     `$null` and reached this pair.
 *   - an UNCOMPOSED one arrives spelled however the author wrote it. A widget
 *     that hands its own resolved filter straight to the escape hatch
 *     (`ObjectMetricWidget`, whose drawer renders `OpenInListButton`) passes
 *     through no canonicaliser at all, so `$exists` reaches this function
 *     verbatim. The dataset filter inspector's "is not empty" row wrote
 *     exactly that pair until objectui#10813, so a filter stored before then
 *     still carries it; that row now writes `{ $empty: false }`, which is not
 *     one of these two keys: it reaches this function verbatim too, and the
 *     `[empty]` arm, {@link EMPTY_FILTER}, carries it (objectui#11547).
 *
 * ⚠️ A NON-boolean under either key says nothing about emptiness and writes
 * nothing, which is what it did before this pair existed.
 *
 * ⚠️ When both keys are present and DISAGREE, one param key cannot carry two
 * directions. `$null` wins, deterministically and pinned, and the drill
 * degrades to a superset — the same posture this module already takes for two
 * conditions on one field and operator. It is a superset whichever way it goes:
 * such an object asks for `is_null` AND `is_not_null`, which selects no rows at
 * all, and no single param is narrower than that.
 *
 * ⚠️ `param` is deliberately NOT an entry in {@link URL_FILTER_OPS}. That map is
 * the RANGE vocabulary, and `ObjectDataPage` inverts it to bridge a triple's
 * operator to the spec's own alias spelling. Both `op` and `notOp` here are
 * already canonical `ViewFilterRule` operator words, so bridging them would map
 * them to the aliases `'null'` / `'not_null'`, which `normalizeFilterOperator`
 * passes through verbatim and the rule schema then rejects — a saved view that
 * silently loses this condition. Keeping this pair out of the range map is what
 * keeps "Save as view" correct.
 */
export const NULL_FILTER = {
  /** URL param suffix, shared by both directions: `filter[<field>][null]`. */
  param: 'null',
  /** The ONLY param value that spells IS NULL. */
  flag: 'true',
  /** The ONLY param value that spells IS NOT NULL (objectui#9508). */
  notFlag: 'false',
  /** ObjectQL operator `flag` reads back as — what `convertFiltersToAST` emits for `{ $null: true }`. */
  op: 'is_null',
  /** ObjectQL operator `notFlag` reads back as — what it emits for `{ $null: false }` (objectui#9508). */
  notOp: 'is_not_null',
  /** ObjectQL operator-object key whose BOOLEAN is the direction verbatim. */
  key: '$null',
  /** The synonym key the WRITE side also recognizes, whose boolean is the INVERSE direction. */
  existsKey: '$exists',
  /**
   * i18n key for this operator's user-visible label, reused from the filter
   * builder's operator family rather than forked: all ten packs already define
   * and translate it, and that family already has a locale-parity pin. The chip
   * arm below hands this OUT; resolving it is the render site's job.
   */
  labelKey: 'filterBuilder.operators.is_null',
  /**
   * Same family, same pin, for the inverse direction (objectui#9508) — the
   * builder offers `is_not_null` as its own row, so this key is already in that
   * parity pin's denominator and no eleventh translation is introduced here.
   *
   * Both keys follow the builder's operator ids, which are the protocol's own
   * spellings since objectui#9306 (the family was keyed `isNull` /
   * `isNotNull` before). A key left on the old spelling resolves to NOTHING and
   * the chip renders the key itself — `ObjectDataPage.filterChipI18n-9159`
   * renders the chip through the real packs, which is what catches that.
   */
  notLabelKey: 'filterBuilder.operators.is_not_null',
} as const;

/**
 * The "is empty" operator pair (objectui#11547): {@link NULL_FILTER}'s shape,
 * for the spec's `$empty` predicate rather than `$null`.
 *
 * ## Why it is a pair of its own and not another spelling of is-null
 *
 * `$empty` judges a field by its DECLARED type — on a text field it also finds
 * `''`, on a multi-value field also `[]` — so it is not `$null` under another
 * name, and folding it onto `[null]` would answer a narrower question than the
 * widget asked. From `@objectstack/spec` 17.6.0, `parseFilterAST` lowers the
 * view operators `is_empty` / `is_not_empty` to it, so a COMPOSED drill of a
 * widget filter saying "is empty" arrives here as `{ $empty: true | false }`.
 * Without this pair that object hit no arm below and wrote NO param: the list
 * opened unscoped by the condition, a superset of what the widget counted.
 *
 * Everything {@link NULL_FILTER} documents about the VALUE holds here
 * unchanged: one param whose value is the direction, only its two exact
 * spellings are conditions, the comparand is the literal `true` in both
 * triples, and a non-boolean under the producer key writes nothing.
 *
 * ⚠️ When `$empty` and `$null` sit on ONE field they are two params, not one
 * param asked for two directions, so nothing has to win: both are written, both
 * read back, and the list ANDs them exactly as `convertFiltersToAST` does for
 * the same object. That conjunction is the narrowest answer, not a superset.
 *
 * ⚠️ Kept OUT of {@link URL_FILTER_OPS} for the reason {@link NULL_FILTER}
 * gives: `is_empty` / `is_not_empty` are already canonical `ViewFilterRule`
 * words, and bridging them through that range map is what would lose the
 * condition from "Save as view".
 */
export const EMPTY_FILTER = {
  /** URL param suffix, shared by both directions: `filter[<field>][empty]`. */
  param: 'empty',
  /** The ONLY param value that spells IS EMPTY. */
  flag: 'true',
  /** The ONLY param value that spells IS NOT EMPTY. */
  notFlag: 'false',
  /** ObjectQL operator `flag` reads back as — what `convertFiltersToAST` emits for `{ $empty: true }`. */
  op: 'is_empty',
  /** ObjectQL operator `notFlag` reads back as — what it emits for `{ $empty: false }`. */
  notOp: 'is_not_empty',
  /** ObjectQL operator-object key whose BOOLEAN is the direction verbatim. */
  key: '$empty',
  /**
   * The filter builder's existing operator labels, reused rather than forked,
   * exactly as {@link NULL_FILTER} reuses its pair: present and translated in
   * all ten packs and already inside that family's locale-parity pin.
   */
  labelKey: 'filterBuilder.operators.is_empty',
  notLabelKey: 'filterBuilder.operators.is_not_empty',
} as const;

/**
 * The ONE grammar for a key in this family, so the two arms below cannot drift
 * apart on what a field name is: `filter[<field>]`, with an OPTIONAL
 * `[<suffix>]`. The field slot excludes both brackets, so a suffix can never be
 * swallowed into the field name — the drift objectui#9196 measured, where a
 * greedy field capture turned `filter[amount][gte]` into a condition against a
 * field literally named `amount][gte` that no object declares.
 */
const FILTER_KEY = /^filter\[([^[\]]+)\](?:\[([^[\]]+)\])?$/;

/**
 * Parse `filter[<field>]=<value>` (equality), `filter[<field>][<op>]=<value>`
 * (range/comparison), `filter[<field>][null]=true|false` ({@link NULL_FILTER},
 * the is-null pair) and `filter[<field>][empty]=true|false` ({@link
 * EMPTY_FILTER}, the is-empty pair) search params into ObjectQL triples. An
 * unknown operator suffix is ignored (never silently downgraded to equality),
 * and so is an unknown value in either flag slot.
 */
export function parseUrlFilterTriples(searchParams: URLSearchParams): FilterTriple[] {
  const out: FilterTriple[] = [];
  searchParams.forEach((value, key) => {
    if (value === '') return;
    const m = FILTER_KEY.exec(key);
    if (!m) return;
    const [, field, suffix] = m;
    if (suffix === undefined) {
      out.push([field, '=', value]);
      return;
    }
    if (suffix === NULL_FILTER.param) {
      // The param's VALUE is the direction, and only its two exact spellings
      // are conditions (objectui#9508). Anything else here is dropped like an
      // unknown suffix rather than answered at an operator nobody asked for.
      // The comparand stays the literal `true` in BOTH triples: these operators
      // take no comparand, and their direction is in the operator WORD.
      if (value === NULL_FILTER.flag) out.push([field, NULL_FILTER.op, true]);
      else if (value === NULL_FILTER.notFlag) out.push([field, NULL_FILTER.notOp, true]);
      return;
    }
    if (suffix === EMPTY_FILTER.param) {
      // Same two-spelling rule as the is-null slot above (objectui#11547).
      if (value === EMPTY_FILTER.flag) out.push([field, EMPTY_FILTER.op, true]);
      else if (value === EMPTY_FILTER.notFlag) out.push([field, EMPTY_FILTER.notOp, true]);
      return;
    }
    const op = URL_FILTER_OPS[suffix];
    if (op) out.push([field, op, value]);
  });
  return out;
}

/**
 * The EQUALITY-ONLY arm of the same grammar, for a surface that implements
 * `filter[<field>]=<value>` and nothing else — today the plain object route
 * (`/apps/:app/:object`, `ObjectView`), whose related-list "View All" buttons
 * scope a destination list to one parent record.
 *
 * An operator suffix is DROPPED, exactly as `parseUrlFilterTriples` drops an
 * operator it does not know: ignored, and in particular never silently
 * downgraded to equality. Those are two different outcomes and only one is
 * correct — answering the narrower `amount = 100` when the URL asked for
 * `amount >= 100` is a wrong answer wearing a right answer's shape.
 *
 * The is-null flag ({@link NULL_FILTER}) is a suffixed form, so this arm drops
 * it too — the boundary below applies to it unchanged (objectui#9159).
 *
 * ⚠️ This arm deliberately does NOT execute the operator suffix (objectui#9196).
 * Teaching this route range operators would widen the accepted set of an
 * addressable public surface — a behaviour addition, not a repair, and one that
 * belongs to the maintainer rather than to a bug fix. The operator arm stays
 * where it already is: `parseUrlFilterTriples`, on the ADR-0055 `/data` surface.
 */
export function parseUrlEqualityFilterTriples(searchParams: URLSearchParams): FilterTriple[] {
  const out: FilterTriple[] = [];
  searchParams.forEach((value, key) => {
    if (value === '') return;
    const m = FILTER_KEY.exec(key);
    // `m[2] !== undefined` is the suffixed form — not executable here, so the
    // whole condition is dropped rather than answered at the wrong operator.
    if (!m || m[2] !== undefined) return;
    out.push([m[1], '=', value]);
  });
  return out;
}

/**
 * Serialize a drill filter object into `filter[...]` search params. An ObjectQL
 * range operator object (`{ $gte, $lt }`) becomes `filter[field][gte|lt]`; the
 * emptiness pair ({@link NULL_FILTER}) — `{ $null: true }`, what an EMPTY-bucket
 * drill carries, and its three synonyms `{ $exists: false }`, `{ $null: false }`
 * and `{ $exists: true }` (objectui#9508) — becomes `filter[field][null]` with
 * the direction as its value; `{ $empty: true | false }` ({@link EMPTY_FILTER},
 * objectui#11547) becomes `filter[field][empty]` the same way; a plain value
 * becomes `filter[field]`.
 * `null`/`undefined` values and objects with no recognized operator are skipped
 * (drill degrades to a superset) rather than stringified to
 * `"[object Object]"`.
 *
 * ⚠️ A JS `null` VALUE stays "no condition", and is not the is-null spelling: it
 * is what a producer writes when it has nothing to say about the field. The
 * empty bucket says something, and says it as `{ $null: true }` (objectui#9085).
 *
 * ## `$and` is flattened, because this dialect's conjunction is implicit
 *
 * A drill filter composed from more than one source arrives as
 * `{ $and: [<widget filter>, <click context>] }` — what `composeDrillFilter`
 * (`@object-ui/core`) lowers `widget.filter ∧ drill.filter` to (objectui#8944).
 * The READ side already returns a FLAT list of triples that the query layer ANDs
 * together, so a top-level `$and` is expressible here: emit each child's params
 * into the same set and `parseUrlFilterTriples` reads the conjunction straight
 * back. Nesting is walked too, since composing three sources nests.
 *
 * ⚠️ Without this branch a composed filter took the `String(value)` path below —
 * `$and` holds an ARRAY, so it was neither `null` nor a non-array object — and
 * the URL grew a bogus `filter[$and]=[object Object],[object Object]` while BOTH
 * real conditions vanished. That is the very outcome this function's contract
 * says it never produces, and it is wrong in the widening direction: the list
 * lands unscoped by anything the user actually clicked.
 *
 * ⚠️ Two conditions on the SAME field and operator are NOT expressible here (one
 * param key, one value). The later source wins, so a click context still
 * overrides the widget's condition on that field exactly as it did when this
 * value was built by spreading — the drill degrades to a superset there, the
 * same posture this function already takes for operators it cannot spell.
 */
export function serializeDrillFilterParams(
  filter: Record<string, unknown> | undefined,
): URLSearchParams {
  const params = new URLSearchParams();
  if (!filter) return params;
  collectFilterParams(filter, params);
  return params;
}

/**
 * Which way an operator object asks about emptiness: `true` = is-null, `false` =
 * is-not-null, `undefined` = it says nothing about emptiness at all.
 *
 * The two keys are read in the order {@link NULL_FILTER} documents — `$null`
 * carries the direction verbatim, `$exists` carries its inverse, and `$null`
 * wins when both are present and disagree. `typeof` gates both reads because a
 * non-boolean under either key is not a direction; it wrote nothing before this
 * pair existed and it writes nothing now.
 */
function nullDirection(ops: Record<string, unknown>): boolean | undefined {
  const asNull = ops[NULL_FILTER.key];
  if (typeof asNull === 'boolean') return asNull;
  const asExists = ops[NULL_FILTER.existsKey];
  if (typeof asExists === 'boolean') return !asExists;
  return undefined;
}

/** One source's conditions, written into the shared param set. Recurses on `$and`. */
function collectFilterParams(filter: Record<string, unknown>, params: URLSearchParams): void {
  for (const [field, value] of Object.entries(filter)) {
    if (value == null) continue;
    if (field === '$and' && Array.isArray(value)) {
      // Implicit-AND dialect: each child contributes its own params, in order,
      // so a later source overrides an earlier one on a field they share.
      for (const child of value) {
        if (child && typeof child === 'object' && !Array.isArray(child)) {
          collectFilterParams(child as Record<string, unknown>, params);
        }
      }
      continue;
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      const ops = value as Record<string, unknown>;
      // The emptiness pair (objectui#9159, both directions since objectui#9508).
      // Emitted BESIDE any range bound on the same object rather than instead of
      // it, because `convertFiltersToAST` emits both conditions for that input
      // and the two drill sinks agreeing is the point.
      const direction = nullDirection(ops);
      if (direction !== undefined) {
        params.set(
          `filter[${field}][${NULL_FILTER.param}]`,
          direction ? NULL_FILTER.flag : NULL_FILTER.notFlag,
        );
      }
      // The "is empty" pair (objectui#11547) — what a composed drill carries
      // for an `is_empty` / `is_not_empty` widget filter from spec 17.6.0. Its
      // own param, so it is written beside the is-null param and any range
      // bound, never instead of them; `typeof` gates it as `nullDirection` gates
      // its keys, so a non-boolean writes nothing.
      const empty = ops[EMPTY_FILTER.key];
      if (typeof empty === 'boolean') {
        params.set(
          `filter[${field}][${EMPTY_FILTER.param}]`,
          empty ? EMPTY_FILTER.flag : EMPTY_FILTER.notFlag,
        );
      }
      for (const [op, suffix] of Object.entries(RANGE_OP_PARAM)) {
        const bound = ops[op];
        if (bound != null) params.set(`filter[${field}][${suffix}]`, String(bound));
      }
      continue; // handled (flag / range ops) or skipped — never String(object)
    }
    // Arrays reach here as `$in`-style comparands this dialect cannot spell;
    // skipping keeps the promise above (never `String(array)`).
    if (Array.isArray(value)) continue;
    params.set(`filter[${field}]`, String(value));
  }
}

/**
 * Delete the equality param AND every operator param (both range bounds, and the
 * emptiness param in either direction) for a field, so removing a date-range
 * chip drops the whole range together (objectstack-ai/objectstack#1752) and removing an emptiness chip
 * drops its param (objectui#9159, objectui#9508). Prefix-based, so it covers a suffix by construction rather
 * than by listing one — a new operator is removable the day it is writable.
 * Mutates and returns `params`.
 */
export function deleteFieldFilterParams(params: URLSearchParams, field: string): URLSearchParams {
  const prefix = `filter[${field}]`;
  for (const key of Array.from(params.keys())) {
    if (key === prefix || key.startsWith(`${prefix}[`)) params.delete(key);
  }
  return params;
}

/**
 * One display chip: a field, plus the ONE of two carriers its operator needs.
 *
 * The split is not stylistic — it is the line between text this module may
 * finish and text it may not (objectui#9159, applying objectui#8441). A range
 * or equality chip's content is the USER'S OWN comparand, which no catalogue
 * can translate and which reads the same in every locale, so it is finished
 * here as `text`. An is-null chip's content is PROSE this module would
 * otherwise hard-code in English for every reader on every locale; it therefore
 * travels as `textKey` and is resolved at the render site, which already
 * translates the field half of the same chip.
 */
export interface FilterChip {
  field: string;
  /** Finished, language-neutral text (a comparand, a pair of range bounds). */
  text?: string;
  /** i18n key whose translation IS this chip's text. Mutually exclusive with `text`. */
  textKey?: string;
}

/**
 * Group filter triples into ONE display chip per field, preserving first-seen
 * order. A date-bucket drill contributes two triples for the same field
 * (`>= start`, `< end`); they collapse into a single `start → end` range chip.
 *
 * The emptiness pair gets its own arms (objectui#9159, both directions since
 * objectui#9508). Without them the param fell to the `= <value>` default and the
 * chip read `= true` — a condition the user never wrote, against a value the
 * object does not hold, on the one drill whose whole point is that the field is
 * EMPTY. They are checked first so a field carrying the param can never render
 * as that bare `true`.
 *
 * `is_null` is tested before `is_not_null` so a caller that hands in both keeps
 * the answer objectui#9159 shipped; the URL cannot produce that pair (one param
 * key, one direction), so this only fixes the order for a hand-built list.
 *
 * The "is empty" pair ({@link EMPTY_FILTER}, objectui#11547) gets the same two
 * arms, checked after these.
 *
 * These arms are the only ones that yield `textKey` rather than `text`, for the
 * reason on {@link FilterChip}. The keys are the filter builder's existing
 * operator keys, already present and already translated in all ten packs, and
 * already policed by that family's locale-parity pin — ⛔ not strings forked for
 * these chips, which would put two spellings of one operator label at rest in
 * one product.
 */
export function groupFilterChips(triples: FilterTriple[]): FilterChip[] {
  const order: string[] = [];
  const byField = new Map<string, FilterTriple[]>();
  for (const tr of triples) {
    if (!byField.has(tr[0])) {
      byField.set(tr[0], []);
      order.push(tr[0]);
    }
    byField.get(tr[0])!.push(tr);
  }
  return order.map((field) => {
    const list = byField.get(field)!;
    if (list.some(([, op]) => op === NULL_FILTER.op)) {
      return { field, textKey: NULL_FILTER.labelKey };
    }
    if (list.some(([, op]) => op === NULL_FILTER.notOp)) {
      return { field, textKey: NULL_FILTER.notLabelKey };
    }
    // objectui#11547 — the "is empty" pair, same posture and same carrier.
    // After the is-null arms, so every list those arms already answered keeps
    // its answer; a field carrying both params shows the is-null label while
    // the list still applies both (one chip per field, as for a range bound).
    if (list.some(([, op]) => op === EMPTY_FILTER.op)) {
      return { field, textKey: EMPTY_FILTER.labelKey };
    }
    if (list.some(([, op]) => op === EMPTY_FILTER.notOp)) {
      return { field, textKey: EMPTY_FILTER.notLabelKey };
    }
    const gte = list.find(([, op]) => op === '>=' || op === '>');
    const lt = list.find(([, op]) => op === '<' || op === '<=');
    const text =
      gte || lt
        ? `${gte ? String(gte[2]) : '…'} → ${lt ? String(lt[2]) : '…'}`
        : `= ${String(list[0][2])}`;
    return { field, text };
  });
}
