/**
 * The column helpers and column emit types of `ObjectGrid` (`./ObjectGrid.tsx`):
 * the chip field types, the header-label resolver, the column-list
 * normaliser and the types `generateColumns()` emits into, moved out of that
 * file verbatim (objectstack#25994, slice 1). `ObjectGrid.tsx` re-exports
 * every name it exported before.
 */

import type { ListColumn, TableColumn } from '@object-ui/types';
import type { I18nLabel } from '@objectstack/spec/ui';
import { pickLocalized } from '@object-ui/i18n';

/**
 * The field types whose grid cell draws chips: the ones `@object-ui/fields`
 * maps to `SelectCellRenderer` (a badge per selected option). Their column
 * carries `chips`, so `data-table` floors it at its widest drawn chip and a
 * single-word value is never ellipsized (objectui#12708).
 */
const CHIP_FIELD_TYPES: ReadonlySet<string> = new Set(['select', 'status', 'multiselect', 'radio', 'checkboxes', 'tags']);

export function isChipFieldType(type: unknown): boolean {
  return typeof type === 'string' && CHIP_FIELD_TYPES.has(type);
}

/**
 * Resolve a column header `label` (`ListColumnSchema.label`, the spec's
 * `I18nLabel`) to the string the header prints, in the viewer's `language`.
 *
 * A plain string passes through unchanged. An inline locale map
 * (`{ en: 'Amount', 'zh-CN': '金额' }`) is picked by `pickLocalized` — the one
 * locale pick the console uses for `I18nLabel`, with its own floor when the
 * viewer's locale is absent — rather than a second implementation here.
 * objectui#12358: this used to keep only a plain string and answer `undefined`
 * for a map, so an authored map header silently fell back to the field label.
 * A map with no usable entry still answers `undefined`, so the field-label
 * fallback at the call site applies exactly as for an absent label.
 */
export function resolveColumnLabel(label: string | I18nLabel | undefined, language: string | undefined): string | undefined {
  if (label == null) return undefined;
  if (typeof label === 'string') return label;
  return pickLocalized(label, language) || undefined;
}

/**
 * Helper to normalize columns configuration
 * Handles both string[] and ListColumn[] formats
 */
export function normalizeColumns(
  columns: string[] | ListColumn[] | undefined
): ListColumn[] | string[] | undefined {
  if (!columns || columns.length === 0) return undefined;
  
  // Already in ListColumn format - check for object type with optional chaining
  if (typeof columns[0] === 'object' && columns[0] !== null) {
    return columns as ListColumn[];
  }
  
  // String array format
  return columns as string[];
}

/**
 * ⭐ WHAT THIS GRID'S COLUMN PRODUCER IS ALLOWED TO EMIT (objectui#6004).
 *
 * `generateColumns()` below builds the column array this component hands to
 * `data-table`, whose slot is `DataTableSchema.columns: TableColumn[]`. It had
 * no return annotation, so its four emit paths were inferred structurally and
 * nothing ever compared them to the slot's declaration — and all four call
 * sites re-widened to `any` on the way out, so even an annotation would have
 * been discarded one hop later.
 *
 * ## ⭐ Why this is not just `: TableColumn[]`
 *
 * objectui#6373 measured, at the sibling producer in `plugin-dashboard`, that a
 * bare `TableColumn` annotation raises no error on a `{ ...spread }` emit,
 * because TypeScript's excess-property check is a FRESHNESS check on the
 * properties an object literal WRITES OUT and spread properties are exempt.
 *
 * Measured again HERE before choosing this shape, because this seam is worse
 * than that one and the difference matters:
 *
 *   1. `generateColumns = useCallback((): TableColumn[] => {`, everything else
 *      unchanged  →  `tsc --noEmit` exit 0, ZERO diagnostics.
 *   2. Same, PLUS an undeclared key `wrapControl: true` WRITTEN OUT in the path-A
 *      column literal (not arriving through a spread)  →  exit 0, ZERO diagnostics.
 *
 * Run 2 is the one that fixes the mechanism. At objectui#6373's seam the object
 * literal sits in `enrich()`'s return position, so freshness still caught keys
 * written out longhand and only the spread escaped. Here every literal is the
 * return value of a `.map()` callback, so it is inferred into the callback's
 * return type FIRST and reaches the annotation as a non-fresh `X[]`. Freshness
 * is gone entirely: written-out keys escape too. A bare annotation at this seam
 * is not a weak instrument, it is an inert one — a green gate and no guard.
 *
 * The `?: never` members are what make the annotation able to fail. They are
 * ADR-0049 retirement tombstones — this repo's convention for a key that is
 * REFUSED rather than merely absent (`StaticTableColumn` in `@object-ui/types`)
 * — and they bite by ASSIGNABILITY, which survives `.map()` because it never
 * depended on freshness. Re-adding `...(col.summary && { summary: col.summary })`
 * to a column literal is a compile error naming `summary`.
 *
 * ## The rule (objectui#6373's, applied to this producer's key set)
 *
 * A producer may write into a `TableColumn[]` slot only keys the CONSUMER of
 * that slot reads, and the read set is MEASURED from the consumer's source,
 * never assumed. A key the consumer reads and `TableColumn` declares is
 * written; a key the consumer reads that `TableColumn` does not declare is HELD
 * where a ruling already holds it; a key nothing reads is RETIRED — never
 * declared, because declaring a key nothing reads is the same
 * `declared != enforced` defect facing the other way. Before retiring, prove
 * the value has a second road to its consumer.
 *
 * Consumers measured for THIS producer — two of them, because the array is read
 * twice before it reaches the slot:
 *
 *   - `data-table.tsx`, comments stripped, every `col.<key>` read — FOURTEEN:
 *     `accessorKey`, `width`, `align`, `header`, `className`, `cellClassName`,
 *     `sortable`, `resizable`, `editable`, `type`, `cell`, `headerIcon`,
 *     `fitContent`, `wrap`. ⚠️ It was THIRTEEN between objectui#7196 and
 *     objectui#6650, which added the `wrap` read this producer now feeds; it
 *     said fourteen before #7196 re-derived it:
 *     `name` was the fourteenth and was correct when written, but objectui#6963
 *     (2026-08-31) retired the `col.name` alias — the last undeclared spelling
 *     the adapter accepted — so the key left the consumer's read set that day.
 *   - THIS FILE's own downstream passes, which read the array before handing it
 *     on — TEN: `pinned` (the left/right reorder + the frozen-column verdict),
 *     `accessorKey`, `header`, `width`, `type`, `fitContent`, plus the four the
 *     chrome passes read in order to RE-EXPRESS them: `className` and
 *     `cellClassName` (`applyDensity`, and again in the right-pinned literal),
 *     `sortable` (`withSortability`), `cell` (the mobile card renderer).
 *     ⚠️ Those four were missing from this list from the day it was written —
 *     all three passes already existed at that commit — so this is an
 *     incompleteness, not drift. They change no verdict: each is declared on
 *     `TableColumn` and read by `data-table.tsx` as well. Recorded because a
 *     list presented as MEASURED has to be one.
 *     ⚠️ `col.wrap` is read ONE MORE TIME here since objectui#6650, at the
 *     `LinkCell` call sites, and that read is not a re-expression of the
 *     forward — it is a SECOND consumer of the same authored key. The record
 *     link wears its own `truncate`, so honouring `wrap` only downstream would
 *     have left column one of almost every grid wrapping its cell body around
 *     text still clamped to one line.
 *
 * Verdicts, each with the read-count behind it:
 *
 *   - `headerIcon` — DECLARED by `TableColumn`, so NOT held. Live:
 *     `data-table.tsx` renders it into the header cell (1 render site, 2
 *     syntactic reads), forwarded verbatim and never re-expressed. It WAS held
 *     here, on the "undeclared by `TableColumn`" premise; objectui#6615
 *     declared it and that premise expired with nothing going red at the moment
 *     of loss. objectui#6424 then removed the hold, MEASURED rather than
 *     derived: with the member deleted both emit types below are byte-identical
 *     (27 members, every member's resolved type unchanged), against a positive
 *     control that deleting `pinned` instead moves them to 26. Pinned in
 *     `columnHoldsExpiry-6424.test.ts` — which now also carries the claim the
 *     hold used to carry implicitly, that `TableColumn` DECLARES the key.
 *   - `pinned` — HELD. Live, and consumed BEFORE the slot: the reorder pass
 *     below reads it (5 reads in this file) and re-expresses it as the sticky
 *     `className` that `data-table` actually reads. `data-table` never reads
 *     `pinned` itself, and does not need to.
 *   - `wrap` — DECLARED by `TableColumn`, forwarded, and READ. This entry was
 *     "RETIRED (objectui#5453, 2026-08-28)" and the retirement was correct on
 *     its own measurement: `data-table.tsx` was then a two-way switch,
 *     `isFit ? 'w-full whitespace-nowrap' : 'truncate w-full'`, with a `title`
 *     tooltip as the only concession to overflow, so nothing read the key and
 *     the emit rule retired it. ⭐ What #5453 could not settle is what
 *     objectui#6650 escalated one level up: `@objectstack/spec` never stopped
 *     DECLARING `ListColumn.wrap`, and describes it to authors as "Allow text
 *     wrapping" — so retiring the forward left a promise made at authoring
 *     time and silently broken at render time. The maintainer ruled that
 *     promise is kept rather than withdrawn (2026-09-02, Option B): the
 *     consumer was BUILT, `TableColumn` now declares the key, and the forward
 *     returns WITH a reader. ⚠️ Note what moved and what did not — the emit
 *     rule is unchanged and still decided this: the key is written because the
 *     consumer reads it, which is the same test that retired it when the
 *     consumer did not exist.
 *   - `options` — RETIRED (see the enrichment pass below).
 *   - `type` — not adjudicated here; its VALUE set was settled by `fc62bb490`,
 *     whose fold still stands. It is the one member whose vocabulary differs between
 *     the two types below.
 *   - `name` — not emitted by this producer at all, so objectui#5120's alias
 *     never needed a hold here. Tombstoned only in the sense that nothing writes
 *     it — and since objectui#6963 (2026-08-31) nothing READS it either: the
 *     consumer-side alias is retired, so the key is absent from BOTH ends of
 *     this seam and the verdict now rests on two measurements, not one.
 *
 * `essential` is absent from both types on purpose: objectui#6004's suggested
 * key list named it, but it was READ off the authored column and turned into a
 * `className` — never emitted, and not a `ListColumn` member either. That read
 * is now RETIRED too (objectui#6458), so mobile visibility is decided purely
 * positionally (`colIndex === 0`) and nothing on either side of this producer
 * carries the key.
 */

/**
 * The tombstoned keys — DERIVED from the authored input type, never hand-listed,
 * so a future `ListColumn` member is refused by default and has to be
 * adjudicated to escape.
 *
 * `ListColumn` is the right derivation source because it is where this
 * producer's drift comes from: every key the emit could wrongly grow is a key
 * the author wrote on the input and someone forwarded. `pinned` is the one that
 * escaped and stayed — adjudicated HELD above. `wrap` escaped too, was RETIRED
 * by objectui#5453, and has since been DECLARED on `TableColumn` by
 * objectui#6650, so the band lets it through again — ⭐ and it does so with no
 * edit to this line, which is the property that makes the derivation worth
 * having. The tombstone was never a carve-out to remember to remove; it was a
 * consequence of `TableColumn` not declaring the key, and it lifted the moment
 * that stopped being true. A key that never earns a declaration stays refused
 * by default, and re-adding its forward stays a compile error naming it.
 */
export type RetiredListColumnKey = Exclude<keyof ListColumn, keyof TableColumn | 'pinned'>;

/**
 * The undeclared-but-live keys this producer holds. See the docblock above.
 *
 * ⚠️ "Undeclared by `TableColumn`" is this interface's ENTRY CONDITION, and it
 * is a claim about ANOTHER package that can stop being true with nothing going
 * red here. So it is re-checked per key when the card owning that key closes,
 * never inherited: `headerIcon` sat here on exactly that premise until
 * objectui#6615 declared it on `TableColumn`, at which point the hold was
 * redundant rather than load-bearing, and objectui#6424 removed it.
 *
 * ⛔ A key whose ONLY declaration on the emit types is this interface is not in
 * that position — deleting it deletes the key from the emit. `pinned` is that
 * key today, which is why the two verdicts differ.
 */
export interface ObjectGridColumnHolds {
  /**
   * HELD, load-bearing on BOTH counts — the pair that has to hold for a hold to
   * be real, and the contrast that made `headerIcon`'s removal safe:
   *
   *   1. `TableColumn` does NOT declare it, and `RetiredListColumnKey` carves it
   *      out of the derived tombstone band, so this member is its ONLY
   *      declaration on both emit types. Deleting it drops the key from them
   *      (measured: 27 members → 26).
   *   2. It has a live consumer BEFORE the slot — this file's own reorder pass
   *      reads it and re-expresses it as the sticky `className` that
   *      `data-table` actually reads. That is the "second road" the emit rule
   *      demands before a key may be retired. `wrap` failed it in 2026-08 and
   *      was retired; objectui#6650 then BUILT its consumer rather than
   *      reinstating a hold, which is why `wrap` is a plain declared key today
   *      and `pinned` is still the only member here.
   */
  pinned?: 'left' | 'right';
}

/**
 * What `generateColumns()` returns: everything final EXCEPT `type`, which is
 * still the producer's raw inference vocabulary (`@objectstack/spec`'s
 * `FieldType`, 49 values) rather than the EIGHT-literal union `TableColumn`
 * declares (`TABLE_COLUMN_TYPES`: `text`, `number`, `date`, `datetime`,
 * `currency`, `percent`, `boolean`, `action`). `fc62bb490` folds it
 * downstream, in a pass that is deliberately separate from the enrichment map —
 * so the pre-fold shape needs a name, and this is it.
 *
 * ⚠️ This said "7-literal" until objectui#7196 re-derived it. `action` joined
 * the union at objectui#6370 on 2026-08-25 — a day BEFORE this docblock was
 * written, and that commit's own subject line reads "make the 8-literal union
 * the one canonical TableColumn.type" — so the count was never right here; it
 * was mis-copied, not drifted. Both numbers are now measured rather than
 * recited: `TABLE_COLUMN_TYPES` in `@object-ui/types` has 8 members and
 * `@objectstack/spec`'s `FieldType` enum has 49.
 */
/**
 * ⭐ `options` — RETIRED at this emit (objectui#6004), and this explicit
 * tombstone is now the ONLY enforcement of that verdict. ⛔ Do not "tidy" it
 * away as redundant.
 *
 * Until objectui#6425 the key needed no tombstone: it was a member of NO part
 * of the emit types below, so TypeScript's excess-property check refused a
 * fresh literal writing it — refusal by non-membership. #6425's maintainer
 * ruling (2026-08-27) then declared `options` on `TableColumn` itself (the
 * `object-data-table` cell pipeline reads it off the AUTHORED column), which
 * made the key a member here through `Omit<TableColumn, …>` / `TableColumn`
 * and silently ended that enforcement. Nothing went red at the moment of
 * loss — the emit-boundary suite's directive merely turned TS2578-unused,
 * which is luck, not design. The general rule, recorded so the next seam can
 * check itself: **a pin enforced by a key's non-membership silently stops
 * enforcing the moment the key becomes a member.**
 *
 * objectui#6004's verdict itself is unchanged — nothing on either side of
 * THIS seam reads a column-level `options` (`data-table.tsx` has no such
 * read; `renderCellEditor` rebuilds the field from the object schema) — only
 * the refusal's mechanism moves, from freshness to assignability. It is
 * intersected into BOTH the pre-fold draft and the post-fold column, because
 * the retirement belongs to the seam, not to one of its two types; the key
 * cannot land in the DERIVED band (`RetiredListColumnKey`) because `options`
 * is not a `ListColumn` member, which is why this one is hand-written.
 */
type ObjectGridRetiredOptionsTombstone = { options?: never };

export type ObjectGridColumnDraft =
  Omit<TableColumn, 'type'>
  & { type?: string }
  & ObjectGridColumnHolds
  & ObjectGridRetiredOptionsTombstone
  & { [K in RetiredListColumnKey]?: never };

/** Post-fold: what actually reaches `DataTableSchema.columns: TableColumn[]`. */
export type ObjectGridColumn =
  TableColumn
  & ObjectGridColumnHolds
  & ObjectGridRetiredOptionsTombstone
  & { [K in RetiredListColumnKey]?: never };
