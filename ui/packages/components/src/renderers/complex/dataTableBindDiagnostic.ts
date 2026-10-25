/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The diagnostics that say out loud what `data-table` has always done silently
 * with a key the AUTHOR wrote.
 *
 * TWO questions, one channel. The file is named for the first because it came
 * first (objectui#6575); it was never limited to it.
 *
 *   1. `bind` was authored — and `data-table` does not read `bind` at all
 *      (objectui#6575, maintainer ruling 2026-08-27, option A: 「同意」).
 *   2. `data` was authored and is NOT an array — so the renderer dropped it to
 *      zero rows at `data-table.tsx`'s
 *      `Array.isArray(rawData) ? rawData : EMPTY_ROWS` (objectui#6665).
 *
 * They are deliberately two predicates asking two questions, not one widened
 * predicate. The nodes that trip #2 carry no `bind` AT ALL, so #6575 staying
 * silent on them is correct behaviour rather than a gap — the triage ruling on
 * objectui#6665 is explicit about that, and widening #6575's question would
 * have made its silence look like the defect. See {@link describeNonArrayData}.
 *
 * ## The first defect this names
 *
 * `bind` is the data-scope binding vocabulary: a path string resolved by
 * `useDataScope()`. `list`, `tree-view` and the `object-*` plugin widgets read
 * it. `DataTableRenderer` does NOT — it takes its rows from `data: rawData =
 * EMPTY_ROWS` off the node, and the file calls no such hook.
 *
 * A `bind` on a `data-table` is nevertheless accepted by every gate: the TS
 * side because `BaseSchema` declares `bind` for every node (objectui#6357), the
 * zod side by `BaseSchema` being `.passthrough()` (which `DataTableSchema.extend(…)` inherits). So the
 * author gets a table drawing a correct-looking header over the "No results
 * found" empty state, with no error, no warning and no diagnostic — the
 * hardest failure shape for a human OR an AI author to self-check, because a
 * rendered header reads as a success receipt.
 *
 * The platform was already paying a teaching cost for it rather than a
 * diagnostic cost: `skills/objectui/rules/protocol.md` documents the pothole
 * verbatim, and `skill-guide-data-table-binding.test.tsx` pins the behaviour.
 * This module moves the warning from the docs to the console, where the author
 * who did not read the docs is standing.
 *
 * ## What it deliberately does NOT do
 *
 * It changes NO behaviour. `data-table` still does not read `bind`, and the
 * ruling is explicit that it must not start: making it a `useDataScope` reader
 * (option B) is a separate published-surface question needing its own ruling.
 * Refusing the key at parse (option C) stays blocked on the `.passthrough()`
 * ceiling (objectui#5155 / objectui#6269). So the trap stops being silent; it
 * does not stop being a trap.
 *
 * ⭐ The `data`-vs-`bind` PRECEDENCE half of that open question DISSOLVED at
 * objectui#9308 rather than being answered. While `useDataScope` walked the
 * injected adapter, `bind` and the node's own `data` were two spellings of one
 * idea — "where this table's rows come from" — and a reader of both would have
 * needed a rule. Since that ruling `bind` resolves a path in the ambient
 * predicate scope and `data` is an inline array on the node: different
 * channels, different questions, no precedence to decide. objectui#6575's
 * ruling that `data-table` must not read `bind` is untouched by that, and this
 * diagnostic's job is unchanged.
 *
 * ## Why a console warning, and only a console warning
 *
 * The same channel `plugin-grid`'s `columnSpellingDiagnostics.ts` uses for the
 * identical shape of failure ("you declared something and the renderer dropped
 * it"): a pure `describe…` function returning `string | null`, called from a
 * `useEffect` keyed on the schema slice, one `console.warn`, no NODE_ENV
 * branch. Deliberately the SAME shape rather than a second, differently-shaped
 * one next to it. Rendering an in-table message instead would be user-facing
 * copy needing all ten locale packs in `@object-ui/i18n`; a throw would take
 * the surrounding page down for a defect that costs one table.
 *
 * The rate limit is the `useEffect` key, and that is enough HERE for a reason
 * `visibilityDiagnostic.ts` does not have available: a node gate is evaluated
 * once per row, so it needs a module-level dedupe `Set` to keep one authoring
 * bug from printing N lines. A `data-table` is one node rendered once — the
 * effect key is one line per mount per distinct `bind`, which is already the
 * "one line per distinct authoring bug" ceiling that `Set` exists to buy.
 *
 * ## The message never asserts something it did not check
 *
 * A node can carry BOTH an inline `data` array and a `bind`. That table is not
 * empty, so the "header over an empty body" consequence would be false there —
 * and a diagnostic that overstates its own consequence teaches authors to
 * distrust it. The two cases get two different consequence clauses, decided by
 * looking at the rows the renderer actually resolved.
 */

/** Prefix for every `bind` line — the handle tests and greps hold. */
export const DATA_TABLE_BIND_DIAGNOSTIC_PREFIX = '[ObjectUI] DataTable bind:';

/** The key `data-table` really reads its rows from. */
export const DECLARED_ROWS_KEY = 'data';

/** Where the offending node lives, for the first line of either message. */
export interface DataTableNodeAddress {
  /** The schema node's `type` — `data-table`, or an alias that routes here. */
  blockType?: unknown;
  /** The node's `id`, when it has one. */
  id?: unknown;
  /** The table's authored caption — often the only human-readable name. */
  caption?: unknown;
}

function quote(value: unknown): string {
  return typeof value === 'string' ? `'${value}'` : String(value);
}

function describeAddress({ blockType, id, caption }: DataTableNodeAddress): string {
  const block = typeof blockType === 'string' && blockType.length > 0 ? blockType : 'data-table';
  const parts: string[] = [];
  if (typeof id === 'string' && id.length > 0) parts.push(`id: '${id}'`);
  if (typeof caption === 'string' && caption.length > 0) parts.push(`caption: '${caption}'`);
  return parts.length > 0 ? `${block} (${parts.join(', ')})` : block;
}

/**
 * Was a `bind` authored on this node?
 *
 * `undefined` is absence — a destructuring default or an omitted key. Every
 * other value, including `null` and the empty string, is something the author
 * WROTE, and writing it bought nothing. Exported so the renderer's effect key
 * and this judgement cannot drift apart: one predicate, two readers.
 */
export function hasAuthoredBind(bind: unknown): boolean {
  return bind !== undefined;
}

/**
 * The message for a `data-table` node carrying a `bind`, or `null` when there
 * is nothing to say.
 *
 * `rows` is what the renderer resolved for the body — passed in rather than
 * re-derived, so the consequence sentence is measured against the same array
 * the reader is looking at.
 *
 * Naming the ADDRESS is the point: which node, which path it spells, what the
 * renderer did instead, and what to write to get the rows on screen. A message
 * that only said something went wrong would leave the author where the silence
 * did.
 */
export function describeIgnoredBind(
  bind: unknown,
  rows: unknown,
  address: DataTableNodeAddress,
): string | null {
  if (!hasAuthoredBind(bind)) return null;

  const rowCount = Array.isArray(rows) ? rows.length : 0;
  const consequence =
    rowCount === 0
      ? 'This node has no inline rows, so the table renders its header over an empty body'
      : `The ${rowCount} ${rowCount === 1 ? 'row' : 'rows'} on screen `
        + `${rowCount === 1 ? 'comes' : 'come'} from \`${DECLARED_ROWS_KEY}\`; `
        + 'the `bind` contributes nothing';

  return `${DATA_TABLE_BIND_DIAGNOSTIC_PREFIX} ${describeAddress(address)} — `
    + `\`bind: ${quote(bind)}\` is ignored: data-table does not read \`bind\`; it reads its rows `
    + `from the inline \`${DECLARED_ROWS_KEY}\` array on the node. ${consequence}.\n`
    + `  Put the rows in \`${DECLARED_ROWS_KEY}\`, or author a component that does read \`bind\` `
    + '(`list`, `tree-view`, or an `object-*` widget — they call `useDataScope`). (objectui#6575)';
}

/* ------------------------------------------------------------------------- *
 * objectui#6665 — `data` was authored, and it is not an array.
 * ------------------------------------------------------------------------- */

/** Prefix for every non-array `data` line — the handle tests and greps hold. */
export const DATA_TABLE_DATA_DIAGNOSTIC_PREFIX = '[ObjectUI] DataTable data:';

/**
 * Does this string carry a `${...}` template?
 *
 * Used ONLY to sharpen the wording. {@link describeNonArrayData} fires on ANY
 * non-array `data`; this test decides which sentence it gets, never whether it
 * speaks. That is why a local spelling is tolerable where an imported one would
 * normally be required: a miss here costs a less specific message, never a
 * missed warning, so the failure direction is the safe one. The shape is the
 * one `ExpressionEvaluator` itself looks for before taking its template path
 * (`@object-ui/core`), tightened with a closing brace so a lone `${` in prose
 * does not get to claim it was an expression.
 */
const TEMPLATE_SHAPE = /\$\{[\s\S]*?\}/;

/** Keep one bad value from turning a console line into a wall of text. */
function truncate(value: string, max = 80): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/** Name the thing the author actually wrote, without dumping it. */
function describeAuthoredValue(value: unknown): string {
  if (value === null) return '`null`';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return `the string ${quote(truncate(value))}`;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `the ${typeof value} \`${String(value)}\``;
  }
  if (typeof value === 'object') return 'an object';
  return `a ${typeof value}`;
}

/**
 * Was `data` authored as something that is not an array?
 *
 * `undefined` is absence — an omitted key, or the renderer's destructuring
 * default. Everything else the author WROTE, and `data-table.tsx` reduces every
 * non-array value of it to `EMPTY_ROWS` without a word.
 *
 * ## Why this is not {@link hasAuthoredBind}'s question
 *
 * That one asks "was a `bind` authored?" — a key `data-table` does not read at
 * all. This asks about `data`, the key it genuinely does read, and asks a
 * SHAPE question about it rather than a presence one. The nodes that trip this
 * carry no `bind`, so #6575's predicate is correctly silent on them; that
 * silence is precisely why a second question had to be asked here instead of
 * the first one being widened.
 *
 * ## Why the predicate is not keyed on the `${...}` shape
 *
 * The expression string is the spelling that was REPORTED, but it is not the
 * defect. `Array.isArray(rawData) ? rawData : EMPTY_ROWS` swallows a number, an
 * object, a `null` and a plain string exactly as silently, so a predicate that
 * only caught `${...}` would leave the next non-array spelling to arrive as a
 * fresh card. The shape only chooses the wording (see {@link TEMPLATE_SHAPE}).
 *
 * Exported so the renderer and this judgement cannot drift apart: one
 * predicate, two readers.
 */
export function hasNonArrayAuthoredData(rawData: unknown): boolean {
  return rawData !== undefined && !Array.isArray(rawData);
}

/**
 * The message for a `data-table` node whose `data` is not an array, or `null`
 * when there is nothing to say.
 *
 * ## Why no measured-consequence clause, unlike {@link describeIgnoredBind}
 *
 * That one has to look at the rows the renderer resolved, because a node can
 * carry BOTH a `bind` and a real inline `data` array — "header over an empty
 * body" would be false there. Here it cannot be: `data` is the ONLY row source
 * `data-table` has, and this function is called exactly when that source is not
 * an array, so the body is `EMPTY_ROWS` by construction. The consequence is
 * stated because the predicate already established it, not asserted on faith.
 *
 * ## What it deliberately does NOT say
 *
 * It does not tell the author to move the expression under `properties`. The
 * same expression IS evaluated there — that contrast is what makes this a
 * defect rather than a design — but whether `properties` is an authoring
 * channel for the `ui:*` / `page:*` namespaces is an open contract question,
 * recorded in `skills/objectui/rules/protocol.md` rather than recommended by
 * it. A console line is the wrong place to settle that, so the message teaches
 * the one route the guides do teach: the host resolves the rows.
 *
 * It also changes NO behaviour. Making node-level `data` evaluate expressions
 * is a behaviour change on a published component; the objectui#6665 triage
 * ruling put that arm on the maintainer floor and dispatched only this one.
 * The trap stops being silent; it does not stop being a trap.
 */
export function describeNonArrayData(
  rawData: unknown,
  address: DataTableNodeAddress,
): string | null {
  if (!hasNonArrayAuthoredData(rawData)) return null;

  const where = describeAddress(address);
  const wayOut =
    '  Resolve the rows in the host and put the array on the node as '
    + `\`${DECLARED_ROWS_KEY}\`. (objectui#6665)`;

  if (typeof rawData === 'string' && TEMPLATE_SHAPE.test(rawData)) {
    return `${DATA_TABLE_DATA_DIAGNOSTIC_PREFIX} ${where} — `
      + `\`${DECLARED_ROWS_KEY}: ${quote(truncate(rawData))}\` was never evaluated: a `
      + `\`\${...}\` expression written into \`${DECLARED_ROWS_KEY}\` at node level is read as `
      + `a literal string, so \`${DECLARED_ROWS_KEY}\` is a string rather than an array and the `
      + `table renders its header over an empty body.\n${wayOut}`;
  }

  return `${DATA_TABLE_DATA_DIAGNOSTIC_PREFIX} ${where} — `
    + `\`${DECLARED_ROWS_KEY}\` was authored as ${describeAuthoredValue(rawData)}, and data-table `
    + 'takes its rows only from an array: every non-array value is dropped to zero rows, so the '
    + `table renders its header over an empty body.\n${wayOut}`;
}
