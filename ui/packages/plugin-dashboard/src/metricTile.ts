// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The metric tile's layout rule — ONE home, read by every metric tile in this
 * package: the plain cards (`MetricCard`, `MetricWidget`, and through it
 * `ObjectMetricWidget` and every `object-metric` page block) and the
 * dataset-bound tile (`DatasetWidget`) (objectui#12623).
 *
 *  - The title owns the first line: 13 px / 500, up to two lines, an ellipsis
 *    on the second. Nothing shares its line but the plain card's icon chip.
 *  - The value never wraps, and it scales before it would clip
 *    (objectui#12942). A short value is one step smaller (20 px) in a tile
 *    narrower than 160 px, 24 px from 160 px up. A longer one — a seven-digit
 *    money figure with cents — takes a size ladder from 14 px to 24 px whose
 *    steps start where that size fits (`metricTileValueClass`).
 *  - The measure label (dataset-bound tile only) is an 11 px muted line under
 *    the value, dropped below 160 px. The title's tooltip carries it, so it is
 *    still there at every width.
 *
 * Width rules key off the TILE's own box (`@container` on the tile, `@[160px]:`
 * variants), never the viewport: a dashboard grid, a page block and the
 * Studio's folded canvas each size the same tile differently.
 *
 * Class strings stay static literals so Tailwind's content scanner sees them
 * (`apps/console/src/index.css` sources this package's `src/**`).
 */

/** Put on the tile's root: the box the width rules below are measured against. */
export const METRIC_TILE_CONTAINER_CLASS = '@container';

/** The title: owns the first line, at most two lines, an ellipsis on the second. */
export const METRIC_TILE_TITLE_CLASS = 'min-w-0 line-clamp-2 break-words text-[13px] font-medium leading-snug text-foreground';

/**
 * The value: never wraps; 20 px below a 160 px tile, 24 px from 160 px up. The
 * short value's face on a plain tile, and the dataset-bound tile's value at
 * every length: that tile has no Card inset, so its value has the container's
 * whole width and the ladder below, measured against a Card, does not apply.
 */
export const METRIC_TILE_VALUE_CLASS = 'max-w-full overflow-hidden text-ellipsis whitespace-nowrap tabular-nums text-xl @[160px]:text-2xl';

/**
 * The value's size ladder, chosen by how wide the value is (objectui#12942).
 *
 * A plain tile (`MetricCard`, `MetricWidget`: a `Card`, 1 px border, the value
 * in `CardContent`'s 24 px side padding) gives its value the container's width
 * less {@link METRIC_TILE_VALUE_INSET} px — the container query reads the
 * Card's content box, inside the border. A value `em` wide fits at a size of
 * `px` from a container `INSET + em * px` wide, so each `@[N px]:` step below
 * starts at `ceil(INSET + maxEm * px)` for its rung's widest value. The
 * `metricTileValueScale-12942` test re-derives every step from that formula.
 *
 * The first rung is the short value's face, {@link METRIC_TILE_VALUE_CLASS}'s
 * sizes unchanged. Every later rung starts at 14 px; past the last one, 14 px
 * at every width. A value still wider than its tile at 14 px keeps the
 * ellipsis, and the value node carries the full figure as its tooltip.
 *
 * Literals only: Tailwind's content scanner must see every class.
 */
export const METRIC_TILE_VALUE_INSET = 48;

export const METRIC_TILE_VALUE_LADDER: ReadonlyArray<{ readonly maxEm: number; readonly sizes: string }> = [
  { maxEm: 4.5, sizes: 'text-xl @[160px]:text-2xl' },
  { maxEm: 5.5, sizes: 'text-sm @[136px]:text-base @[147px]:text-lg @[158px]:text-xl @[180px]:text-2xl' },
  { maxEm: 6.75, sizes: 'text-sm @[156px]:text-base @[170px]:text-lg @[183px]:text-xl @[210px]:text-2xl' },
  { maxEm: 8, sizes: 'text-sm @[176px]:text-base @[192px]:text-lg @[208px]:text-xl @[240px]:text-2xl' },
  { maxEm: 10, sizes: 'text-sm @[208px]:text-base @[228px]:text-lg @[248px]:text-xl @[288px]:text-2xl' },
  { maxEm: 12.5, sizes: 'text-sm @[248px]:text-base @[273px]:text-lg @[298px]:text-xl @[348px]:text-2xl' },
];

/** Past the ladder's last rung: 14 px at every width. */
export const METRIC_TILE_VALUE_FINAL_SIZES = 'text-sm';

const METRIC_TILE_VALUE_BASE = 'max-w-full overflow-hidden text-ellipsis whitespace-nowrap tabular-nums';

/**
 * How wide `text` draws, in em, at the tile's bold tabular figures — an upper
 * bound read off Inter, the console's face: a digit is 0.65 em, a digit
 * separator (`,` `.` `'` or a space) 0.27 em, a sign or currency symbol 0.7 em,
 * and any other character a full em (letters, CJK).
 */
export function metricTileValueEm(text: string): number {
  let em = 0;
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') em += 0.65;
    else if (/[.,'\s]/u.test(ch)) em += 0.27;
    else if (/[\p{Sc}%+\-\u2212]/u.test(ch)) em += 0.7;
    else em += 1;
  }
  return em;
}

/**
 * The value node's class for `value`: the rung of {@link METRIC_TILE_VALUE_LADDER}
 * its width falls in, or the 14 px final face past the last rung.
 */
export function metricTileValueClass(value: string | number): string {
  const em = metricTileValueEm(String(value));
  const rung = METRIC_TILE_VALUE_LADDER.find((r) => em <= r.maxEm);
  return `${METRIC_TILE_VALUE_BASE} ${rung ? rung.sizes : METRIC_TILE_VALUE_FINAL_SIZES}`;
}

/** The measure label: an 11 px muted line under the value, dropped below 160 px. */
export const METRIC_TILE_MEASURE_LABEL_CLASS = 'hidden max-w-full truncate text-[11px] text-muted-foreground @[160px]:block';

/**
 * The title's tooltip: the description when one is authored, else the title,
 * then the measure label on its own line — the one place the label survives in
 * a tile too narrow to draw it.
 */
export function metricTileTooltip(title: string | undefined, description?: string, measureLabel?: string): string | undefined {
  const text = [description || title, measureLabel].filter(Boolean).join('\n');
  return text || undefined;
}

/**
 * The value node's tooltip: the full figure, for a value past the short rung —
 * the one place it survives in a tile too narrow even for 14 px. A short value
 * draws none, as before.
 */
export function metricTileValueTitle(value: string | number): string | undefined {
  const text = String(value);
  return metricTileValueEm(text) > METRIC_TILE_VALUE_LADDER[0].maxEm ? text : undefined;
}
