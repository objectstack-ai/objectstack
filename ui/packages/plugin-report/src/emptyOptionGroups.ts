// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ReportChartSchema.showEmptyGroups` (objectstack#36722) — the chart's
 * "show the groups that hold no records" switch.
 *
 * A grouped dataset query answers one row per value that HOLDS rows, so a
 * select option no record carries is absent from the answer: a "deals by
 * stage" bar chart has no bar for an empty stage, and the stage reads as not
 * existing rather than as zero. With the switch on, the report chart adds the
 * x-axis field's DECLARED options the answer left out.
 *
 * **Values come from the executor's own table.** An added row's measure cell
 * is `emptyGroupValueFor(aggregate)` from `@objectstack/spec/data` — the one
 * kind→identity mapping the analytics executor fills its own empty groups
 * with — so a count or sum reads `0` and an avg/min/max stays empty (there is
 * nothing to average). ⛔ No second empty-value table, and no `?? 0`: a column
 * whose aggregate the answer does not state gets no value either.
 *
 * **Rows, not cells.** The added rows carry the option's STORED value, as an
 * unresolved server row would, so the chart's relabelling, declared order and
 * option colours treat them exactly like a real group. With a `seriesBy`
 * split, an added option gets one row per series value the answer holds, so
 * every series reads the empty value at that category.
 *
 * **Presence** is judged by the STORED value wherever the answer carries it:
 * `drillRawRows[i]` is index-aligned with the rows and holds each field-backed
 * dimension's stored value before the server relabels it, so a row whose raw
 * twin holds the x-axis value is matched by that value alone. Only a row with
 * no raw twin falls back to spellings: the option's stored value, its authored
 * label (the server resolves dimension labels, ADR-0021) and its localized
 * label. A spelling match is a guess (the server's label comes from its own
 * translation at the request locale, the client's from another read), and a
 * missed match would draw a false zero beside the real group.
 *
 * Added rows are APPENDED after the answer's own rows, so every index below
 * `rows.length` still addresses the answer (the drill reads those by index).
 * Returns the input array itself when nothing is missing.
 */
import { emptyGroupValueFor } from '@objectstack/spec/data';

type Row = Record<string, unknown>;

export interface EmptyOptionGroupFill {
  /** The chart's category dimension. */
  xAxis: string;
  /** The `seriesBy` split dimension, when one is authored. */
  seriesBy?: string;
  /** The measure columns the added rows carry: the plotted one, and its `__compare` twin when compared. */
  measures: string[];
  /** The aggregate the plotted measure's answer column states (`fields[].aggregate`). */
  aggregate: unknown;
  /** The x-axis field's declared options, as authored. */
  options: unknown;
  /** The same options with translated labels (`localizeFieldOptions`), when a translator ran. */
  localizedOptions?: unknown;
  /** The answer's `drillRawRows`: stored dimension values, index-aligned with `rows`. */
  rawRows?: readonly Row[];
}

/** An option's stored value plus every label it can arrive under. */
function optionSpellings(opt: unknown): { value: unknown; keys: string[] } | null {
  if (typeof opt === 'string' || typeof opt === 'number' || typeof opt === 'boolean') {
    return { value: opt, keys: [String(opt)] };
  }
  if (opt && typeof opt === 'object') {
    const o = opt as { value?: unknown; label?: unknown };
    if (o.value == null) return null;
    const keys = [String(o.value)];
    if (typeof o.label === 'string') keys.push(o.label);
    return { value: o.value, keys };
  }
  return null;
}

/**
 * The answer's rows plus one row (one per series value with a split) for each
 * declared option no row carries. See the module header for the rules.
 */
export function fillEmptyOptionGroups(rows: readonly Row[], fill: EmptyOptionGroupFill): Row[] {
  const input = rows as Row[];
  if (!Array.isArray(fill.options) || fill.options.length === 0) return input;
  const localized = Array.isArray(fill.localizedOptions) ? fill.localizedOptions : [];

  // Stored values the raw twins state, and the display spellings of the rows
  // that have no raw twin to state one.
  const presentStored = new Set<string>();
  const presentSpelled = new Set<string>();
  rows.forEach((row, i) => {
    const raw = fill.rawRows?.[i];
    if (raw && fill.xAxis in raw) {
      const v = raw[fill.xAxis];
      if (v != null) presentStored.add(String(v));
      return;
    }
    const v = row[fill.xAxis];
    if (v != null) presentSpelled.add(String(v));
  });

  // Series values the answer holds, in arrival order — the null group included,
  // since it is a series the chart draws.
  const seriesValues: unknown[] = [];
  if (fill.seriesBy) {
    const seen = new Set<string>();
    for (const row of rows) {
      if (!(fill.seriesBy in row)) continue;
      const v = row[fill.seriesBy];
      const key = v == null ? 'n' : `s:${String(v)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      seriesValues.push(v ?? null);
    }
  }

  const empty = emptyGroupValueFor(typeof fill.aggregate === 'string' ? fill.aggregate : undefined);
  const added: Row[] = [];
  fill.options.forEach((opt, i) => {
    const spelled = optionSpellings(opt);
    if (!spelled) return;
    const translated = optionSpellings(localized[i]);
    const keys = translated ? [...spelled.keys, ...translated.keys] : spelled.keys;
    const stored = String(spelled.value);
    if (presentStored.has(stored) || keys.some((k) => presentSpelled.has(k))) return;
    // A duplicate declaration of the same value adds it once.
    presentStored.add(stored);
    const base: Row = { [fill.xAxis]: spelled.value };
    if (empty !== undefined) for (const m of fill.measures) base[m] = empty;
    if (fill.seriesBy && seriesValues.length > 0) {
      for (const s of seriesValues) added.push({ ...base, [fill.seriesBy]: s });
    } else {
      added.push(base);
    }
  });
  return added.length > 0 ? [...rows, ...added] : input;
}
