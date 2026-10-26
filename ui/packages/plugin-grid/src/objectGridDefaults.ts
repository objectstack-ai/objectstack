/**
 * The display defaults of `ObjectGrid` (`./ObjectGrid.tsx`): the row-height
 * resolver, the page sizes, the selection default and the no-refusal
 * grouping signature, moved out of that file verbatim (objectstack#25994,
 * slice 1).
 */

import { PaginationConfigSchema } from '@objectstack/spec/ui';
import { ROW_HEIGHT_TO_DENSITY_MODE } from '@object-ui/core';

/** The row heights this grid styles — the five `RowHeight` values the spec admits. */
export type RowHeightMode = 'compact' | 'short' | 'medium' | 'tall' | 'extra_tall';

/**
 * The ONE answer this component gives for a `rowHeight` it does not recognize
 * (objectui#4443).
 *
 * The seed used to be `schema.rowHeight ?? 'compact'`, which made the component
 * answer the same question two ways: an ABSENT `rowHeight` landed on `compact`,
 * an OFF-SPEC one fell through the density ternaries below to their terminal
 * `else` — the `medium` styling. That is the absent-vs-off-spec split #4440
 * removed from `ListView`, and a third answer to a question `@object-ui/core`
 * (`rowHeightToDensityMode`, which abstains) and the `@object-ui/react` spec
 * bridge (#4352, which abstains) had already settled. One metadata-driven
 * system, one answer: off-spec renders exactly like absent.
 *
 * The ternary chains are deliberately NOT touched — `medium` is a real value
 * with its own arm, and a leaf renderer's terminal `else` is legitimate styling.
 * Narrowing happens here, at the boundary, so nothing off-spec ever reaches it.
 *
 * Membership is tested against `ROW_HEIGHT_TO_DENSITY_MODE` rather than a local
 * list so the admitted values have one definition in the repo; that table is
 * typed `Record<RowHeight, DensityMode>`, so the build fails if the spec grows a
 * sixth row height and this resolver is not taught about it.
 *
 * `hasOwnProperty`, not `in`: `in` walks the prototype chain, so `'toString'`
 * would come back admitted. That is not hypothetical here — the toolbar's icon
 * map is looked up by the same key, and a prototype member reached
 * `Object.prototype.toString` and rendered it as a React component, while a
 * plain off-spec value produced `undefined` and threw outright.
 */
export function resolveRowHeightMode(rowHeight: unknown): RowHeightMode {
  if (typeof rowHeight !== 'string') return 'compact';
  if (!Object.prototype.hasOwnProperty.call(ROW_HEIGHT_TO_DENSITY_MODE, rowHeight)) return 'compact';
  return rowHeight as RowHeightMode;
}

/**
 * The page size every display surface of this component falls back to when the
 * author declared none (objectui#9853, rulings 5749197629 and 5824040487): the
 * flat table, the server-paged table, the grouped view's page of groups, and a
 * server-grouped leaf's page of rows. Wherever there is a pager, this is its
 * page.
 *
 * READ from `@objectstack/spec`, not restated. The protocol's pagination config
 * declares `pageSize` with a default, and that declaration is the one answer an
 * author can look up; a literal here would be a second answer free to drift
 * from it. Parsing an empty object is the spec's own way of saying what an
 * undeclared member means, so this is the value the schema would fill in.
 *
 * ⚠️ There is deliberately no local fallback number behind this read. If a
 * future `@objectstack/spec` stops declaring the default (the same principle
 * `packages/types` applies at its own import boundary is that a validator does
 * not write values), this throws at module load instead of quietly
 * substituting a number nobody declared. The spec version is locked, so that
 * can only surface on a spec upgrade, where the pin
 * `ObjectGrid.displayPageSizeDefault-9853.test.tsx` reddens first.
 */
function readSpecDisplayPageSize(): number {
  const declared: unknown = PaginationConfigSchema.parse({}).pageSize;
  if (typeof declared !== 'number' || !Number.isInteger(declared) || declared <= 0) {
    throw new Error(
      '[ObjectUI] ObjectGrid: @objectstack/spec no longer declares a positive default '
      + `for pagination.pageSize (read ${String(declared)}); the grid has no display `
      + 'page size to fall back to.',
    );
  }
  return declared;
}
export const DEFAULT_DISPLAY_PAGE_SIZE = readSpecDisplayPageSize();

/**
 * How many rows this grid FETCHES when it buckets a window into groups in the
 * browser and the author declared no page size (`bucketsFetchedWindow`). A
 * fetch batch, ⛔ not a page size: no display path reads it, and it does not
 * follow the display default (objectui#9853, ruling 5824040487, structure B).
 * Before ruling 5749197629 this number was named as a "server window" and also
 * sized the server-paged table's visible page, so one constant meant two
 * quantities.
 *
 * It stays a constant of this component rather than the protocol's value
 * because the protocol declares no fetch batch: it is how much of the result
 * set a client-grouped view holds, which is an implementation choice.
 */
export const DEFAULT_FETCH_BATCH_SIZE = 50;

/**
 * The mode a `selection` object with no `type` member asks for (objectui#9837,
 * ruling A-prime: presence enables, an explicit off wins).
 *
 * ⚠️ Derived, not chosen freely. The ruling's first clause is that writing the
 * object turns selection ON, so the only values that satisfy it are the two
 * enabling ones — and `'multiple'` is already this renderer's own answer to
 * "selection is on, nothing said which kind": it is what the bulk-action
 * auto-enable arm resolves to, and what the legacy `selectable: true` means
 * (`packages/types/src/data-display.ts`, "boolean: Enable/disable selection
 * (true = multiple selection)"). `'single'` would be a third, unstated opinion.
 *
 * ⚠️ `@objectstack/spec`'s own `SelectionConfigSchema` declares `type` with
 * `.default('none')`, which this constant deliberately does NOT follow: honouring
 * it would make a written object mean OFF and contradict the ruling's first
 * clause outright. It is reachable only through a PARSE, and this repo's mirror
 * strips imported defaults at the import boundary
 * (`packages/types/src/zod/imported-defaults.ts`), so an omitted `type` stays
 * omitted on the way to this read — but metadata parsed by the spec bundle
 * itself arrives carrying `type: 'none'` and is then an EXPLICIT off here.
 * Handed back as a question on objectui#9837 rather than decided here.
 */
export const DEFAULT_SELECTION_TYPE = 'multiple' as const;

/**
 * The ONE resolver for an authored page size, for the reason the `rowHeight`
 * resolver just above exists: one resolver at every entry is what keeps the
 * answer single (objectui#4443).
 *
 * Before objectui#9853 this value was spelled out separately at each of its
 * three read points, and the spellings disagreed about a non-positive number:
 * the flat site used `||`, so `0` was falsy and fell through to a default,
 * while both seeds used `??`, so `0` was not nullish and survived as a real
 * page size. It then divided the grouped pager and reached the wire as
 * `$top: 0`, so the grid asked the server for nothing and drew an empty table
 * — with no error, no warning and no empty state naming the cause.
 *
 * ## Why refusing `0` is not this renderer inventing a meaning
 *
 * `@objectstack/spec` has already answered what a `pageSize` of `0` means.
 * Its pagination config declares the member as a POSITIVE integer with a
 * default, and the spec's own suite pins that refusal under the names
 * `should reject zero pageSize` and `should reject negative pageSize`. The
 * `limit` that this block's `ElementDataSourceMapping` lowers
 * `pagination.pageSize` into is declared positive as well. So `0` is not a
 * spelling whose meaning a consumer may choose; it is a value the contract
 * refuses, and a renderer that quietly divides by it is the only party not
 * saying so.
 *
 * ⚠️ The refusal is FAIL-SOFT on purpose. Throwing would take out the whole
 * subtree for a declaration the flat path already tolerated, which is a worse
 * outcome than the defect. The value is dropped, the site's own default is
 * used, and `describeNonPositivePageSize` states it once through the channel
 * this component already uses for "you declared it, the renderer dropped it".
 *
 * Reads the canonical key first and the deprecated flat shorthand second, in
 * that precedence, with `??` so an explicit `0` is SEEN by the guard instead
 * of skipped by falsiness — that skipping is the defect, not the fix.
 */
function readAuthoredPageSize(schema: {
  pagination?: unknown;
  pageSize?: unknown;
}): unknown {
  const fromObject = (schema.pagination as { pageSize?: unknown } | undefined)?.pageSize;
  return fromObject ?? schema.pageSize;
}

function isUsablePageSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function resolvePageSize(
  schema: { pagination?: unknown; pageSize?: unknown },
  fallback: number,
): number {
  const authored = readAuthoredPageSize(schema);
  return isUsablePageSize(authored) ? authored : fallback;
}

/**
 * The diagnostic half. `null` means "nothing to say" — an absent key is not a
 * mistake, and a usable page size is not either, so the message is CONDITIONAL
 * and a control asserting its silence is what keeps it from being an
 * always-on marker that states nothing.
 */
export function describeNonPositivePageSize(
  schema: { pagination?: unknown; pageSize?: unknown },
  context: { blockType?: unknown; objectName?: unknown },
): string | null {
  const authored = readAuthoredPageSize(schema);
  if (authored === undefined || authored === null) return null;
  if (isUsablePageSize(authored)) return null;
  const where = [
    typeof context.blockType === 'string' ? context.blockType : 'object-grid',
    typeof context.objectName === 'string' ? context.objectName : undefined,
  ]
    .filter(Boolean)
    .join(' on ');
  return (
    `[ObjectUI] ObjectGrid pagination: ${where} declared pageSize: ${String(authored)}, `
    + 'which is not a positive integer. A page size must be a positive integer '
    + '(the spec refuses zero and negative values), so it was ignored and this '
    + 'grid fell back to its default page size.'
  );
}

/**
 * The grouping-refusal signature when no entry is refused (objectui#10583,
 * objectui#10657): the authored grouping config is then handed on as it is.
 */
export const NO_GROUPING_REFUSAL = JSON.stringify({ refused: [], warned: [] });
