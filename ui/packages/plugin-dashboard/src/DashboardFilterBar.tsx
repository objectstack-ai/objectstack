/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Dashboard-level filter bar (framework#2501).
 *
 * Renders one control per dashboard filter definition — a preset/custom date
 * range for the built-in `dateRange`, a Select for `select`/`lookup` filters,
 * and an Input for `text`/`number` — writing each value into the dashboard's
 * filter variables via `onChange`. The host (`DashboardRenderer`) broadcasts
 * those values into every bound widget's inline query.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  cn,
  Button,
  Calendar,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';
import { CalendarIcon, RotateCcw } from 'lucide-react';
import { useSafeTranslate, useObjectTranslation, useSafeFieldLabel, pickLocalized } from '@object-ui/i18n';
import { useDataInvalidation } from '@object-ui/react';
import {
  DATE_RANGE_PRESETS,
  toDisplayDate,
  type DashboardFilterDef,
  type DateRangeValue,
} from '@object-ui/core';

/**
 * The filter's display name for the active UI language (objectui#4032, merged
 * scope from the #4163 part-1 audit).
 *
 * `GlobalFilterSchema.label` is the spec's `I18nLabel`, so an author may write
 * an inline per-locale map. Every read site below used to be `def.label ||
 * def.name`, which is wrong TWICE over:
 *
 *  1. a map reached a text node / `aria-label` / `placeholder` and stringified
 *     to `[object Object]` — in the Select's case inside a template literal,
 *     rendering `[object Object]: All`;
 *  2. an object is ALWAYS TRUTHY, so `||` never fell through to `def.name` —
 *     not even for `{}`, or a map with no entry for any locale. The same
 *     truthiness fact #4163 pinned on `DashboardGridLayout`'s header gate.
 *
 * Resolving FIRST and testing the resolved string fixes both at once: there is
 * one call, it yields a string, and the `||` fallback below is reached exactly
 * when that string is empty.
 *
 * Returns `''` rather than applying a fallback itself, because the three
 * controls do not share one: the built-in `dateRange` falls back to a
 * TRANSLATED "Date range", the others to the raw `def.name`. Folding those
 * together here would have made an unlabelled date filter read `dateRange`.
 *
 * ## The translation-bundle rung (`061f5e829`)
 *
 * `GlobalFilterSchema.object` names the object whose bundle entry keys this
 * filter's labels — the spec's describe text for it reads "Object whose
 * `fields.<object>.<field>` translation-bundle entry resolves this filter's
 * field label and option labels". Nothing here read it, so a filter declaring
 * it rendered the raw field name on a translated console.
 *
 * `useSafeFieldLabel().fieldLabel` IS that convention's resolver — the one
 * every list and form already calls, walking the app namespaces for
 * `fields.<object>.<field>`. ⛔ No second resolver was written: the spec's own
 * wording for this key is "zero new i18n vocabulary, one resolver path", and a
 * private lookup here would have been the second path it forbids.
 *
 * Precedence follows that resolver's own signature — `fieldLabel(object,
 * field, fallback)` returns the bundle entry when there is one and the
 * fallback otherwise — so a translator's bundle wins over the metadata
 * literal, exactly as it does for every other field label on the console. The
 * authored `label` (resolved first, since it may itself be an inline locale
 * map) is that fallback. A filter that names no `object` never reaches the
 * resolver at all, so every dashboard authored before this key existed renders
 * unchanged.
 */
function useFilterLabel(def: DashboardFilterDef): string {
  const { language } = useObjectTranslation();
  const { fieldLabel } = useSafeFieldLabel();
  const authored = pickLocalized(def.label, language);
  return def.object ? fieldLabel(def.object, def.field, authored) : authored;
}

/** Sentinel for the Select's clear item (Radix Select forbids empty values). */
const ALL_VALUE = '__all__';
/** Sentinel for the date-range Select's "Custom…" item. */
const CUSTOM_VALUE = '__custom__';

export interface DashboardFilterBarProps {
  defs: DashboardFilterDef[];
  values: Record<string, any>;
  onChange: (name: string, value: any) => void;
  onReset?: () => void;
  dataSource?: any;
  className?: string;
}

/** Format an ISO date (or macro token) for the trigger label. */
function rangeLabel(value: DateRangeValue | undefined, presetLabel: (p: string) => string): string | undefined {
  if (!value) return undefined;
  if (value.preset) return presetLabel(value.preset);
  if (value.from || value.to) return `${value.from ?? '…'} – ${value.to ?? '…'}`;
  return undefined;
}

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * The wiring between the date select's "Custom…" item and the range calendar's
 * popover (objectui#10843).
 *
 * Two facts rule out the obvious wiring (opening the popover from the
 * select's `onValueChange`). Both were read in Chromium when this was written;
 * `DashboardFilterBar.customReopen-10843.test.tsx` re-derives them through the
 * real select on every run.
 *
 *  1. **An unchanged value is never reported.** Radix Select reports a pick
 *     through controllable state, which calls back only when the value CHANGES.
 *     With a custom range stored the select's value already is the "Custom…"
 *     item, so picking it again reported nothing and the calendar never opened:
 *     a stored range could not be reopened for editing.
 *  2. **The select's focus return dismisses a popover opened during the pick.**
 *     Once its closing animation ends, the select's content hands focus back to
 *     its trigger. A popover opened by the pick is already showing by then, and
 *     that focus leaving it dismisses it. From a preset the calendar mounted and
 *     was gone as soon as the select finished closing.
 *
 * Radix Select items have no `onSelect` event (that is the menu primitives').
 * Radix picks "Custom…" in two ways, and each needs its own wiring:
 *
 *  - **From the open list:** the item's pointer-up, click or Enter/Space key,
 *    depending on the input. The item marks its own activation, and the
 *    popover opens in the select's `onCloseAutoFocus`, after the list is gone,
 *    where the focus return is cancelled so the popover can take focus itself.
 *    The mark lives for that one event only: it counts when the select closes
 *    DURING it, which is what a pick does (the item runs its own handlers
 *    before Radix's, and a controlled `open` reports the close synchronously).
 *    A key or pointer event on the item that does not close the select, such
 *    as a space typed as part of type-ahead, has cleared its mark before any
 *    later close reads it.
 *  - **From the CLOSED trigger's type-ahead:** typing the first letter of
 *    "Custom…" on the focused, closed select changes the value with no item
 *    event and no list, so no focus return follows and the popover opens
 *    straight from `onValueChange` (`onCustomValue`). Only a changed value is
 *    reported here too, so with a custom range already stored this path does
 *    nothing, as Radix's type-ahead skips the current item. An in-list pick
 *    also reports a changed value, but while the select is still open (Radix
 *    calls `onValueChange` before `onOpenChange(false)`); `onCustomValue`
 *    leaves that one to the item's mark. Opening there would be wrong as well
 *    as early: an Enter pick opened the calendar during its own keydown, the
 *    key's activation then landed on the calendar's first button (its
 *    previous-month arrow), and the calendar opened a month back.
 *
 * The popover's own trigger is an invisible anchor that cannot take focus, so
 * closing the calendar would leave focus on the page body. Focus goes back to
 * the select's trigger instead, unless the calendar closed because the user
 * pointed or tabbed somewhere else: the same rule Radix's non-modal popover
 * applies to its own trigger.
 */
function useCustomRangePopover() {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);
  const selectTrigger = useRef<HTMLButtonElement>(null);
  const activating = useRef(false);
  const pickedOnClose = useRef(false);
  const leftOutside = useRef(false);

  const mark = () => {
    activating.current = true;
    queueMicrotask(() => { activating.current = false; });
  };

  return {
    select: {
      open: selectOpen,
      onOpenChange: (open: boolean) => {
        if (!open && activating.current) pickedOnClose.current = true;
        setSelectOpen(open);
      },
    },
    selectTrigger: { ref: selectTrigger },
    selectContent: {
      onCloseAutoFocus: (event: Event) => {
        if (!pickedOnClose.current) return;
        pickedOnClose.current = false;
        event.preventDefault();
        setPopoverOpen(true);
      },
    },
    customItem: {
      onPointerUp: mark,
      onClick: mark,
      onKeyDown: (event: React.KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') mark();
      },
    },
    onCustomValue: () => {
      if (!selectOpen) setPopoverOpen(true);
    },
    popover: { open: popoverOpen, onOpenChange: setPopoverOpen },
    popoverContent: {
      onInteractOutside: () => { leftOutside.current = true; },
      onCloseAutoFocus: (event: Event) => {
        event.preventDefault();
        if (!leftOutside.current) selectTrigger.current?.focus();
        leftOutside.current = false;
      },
    },
  };
}

function DateRangeFilter({ def, value, onChange }: { def: DashboardFilterDef; value: DateRangeValue | undefined; onChange: (v: DateRangeValue | undefined) => void }) {
  const tt = useSafeTranslate();
  const label = useFilterLabel(def);
  const custom = useCustomRangePopover();
  const allowCustom = def.allowCustomRange !== false;
  const presetLabel = (p: string) => tt(`dashboard.filters.range.${p}`, p.replace(/_/g, ' '));

  const selectValue = value?.preset ?? (value?.from || value?.to ? CUSTOM_VALUE : ALL_VALUE);
  // The stored bounds are date-only (`toIsoDate` below writes the LOCAL day),
  // so they are read back through the shared parse step, which rebuilds a
  // date-only string at local midnight of the day it names. The engine's own
  // parse read it as UTC midnight, and west of UTC the calendar highlighted
  // and opened on the day before the one stored (objectui#10844, the
  // objectui#10183 convention).
  const rangeFrom = value?.from && !value.from.startsWith('{') ? toDisplayDate(value.from) : undefined;
  const rangeTo = value?.to && !value.to.startsWith('{') ? toDisplayDate(value.to) : undefined;
  // The range calendar opens on the month of its first day, and on today's
  // with none (objectui#10799): react-day-picker's `selected` does not move the
  // month it opens on. A `from` that names no instant is no first day:
  // react-day-picker throws on an invalid `defaultMonth`.
  const openingMonth = rangeFrom && !Number.isNaN(rangeFrom.getTime()) ? rangeFrom : undefined;

  return (
    <div className="flex items-center gap-1" data-testid={`dashboard-filter-${def.name}`}>
      <Select
        value={selectValue}
        {...custom.select}
        onValueChange={(v) => {
          if (v === ALL_VALUE) onChange(undefined);
          // Picking "Custom…" commits nothing; it opens the calendar, from the
          // list or from the closed trigger's type-ahead (`useCustomRangePopover`).
          else if (v === CUSTOM_VALUE) custom.onCustomValue();
          else onChange({ preset: v });
        }}
      >
        <SelectTrigger {...custom.selectTrigger} className="h-8 w-auto min-w-36 gap-1" aria-label={label || tt('dashboard.filters.dateRange', 'Date range')}>
          <CalendarIcon className="size-3.5 opacity-60" />
          <SelectValue placeholder={tt('dashboard.filters.dateRange', 'Date range')}>
            {rangeLabel(value, presetLabel) ?? tt('dashboard.filters.allTime', 'All time')}
          </SelectValue>
        </SelectTrigger>
        <SelectContent {...custom.selectContent}>
          <SelectItem value={ALL_VALUE}>{tt('dashboard.filters.allTime', 'All time')}</SelectItem>
          {DATE_RANGE_PRESETS.map((p) => (
            <SelectItem key={p} value={p}>{presetLabel(p)}</SelectItem>
          ))}
          {allowCustom && (
            <SelectItem value={CUSTOM_VALUE} {...custom.customItem}>{tt('dashboard.filters.custom', 'Custom…')}</SelectItem>
          )}
        </SelectContent>
      </Select>
      {allowCustom && (
        <Popover {...custom.popover}>
          {/* Invisible anchor — the popover is driven by the "Custom…" select item. */}
          <PopoverTrigger asChild>
            <span aria-hidden className="size-0" />
          </PopoverTrigger>
          <PopoverContent {...custom.popoverContent} className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              numberOfMonths={2}
              defaultMonth={openingMonth}
              selected={{ from: rangeFrom, to: rangeTo }}
              onSelect={(range: any) => {
                if (!range?.from && !range?.to) { onChange(undefined); return; }
                onChange({
                  ...(range?.from ? { from: toIsoDate(range.from) } : {}),
                  ...(range?.to ? { to: toIsoDate(range.to) } : {}),
                });
              }}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/**
 * Pair an option-source response into `{ value, label }` options — the
 * COMMITTED value from the server's raw grouped values, the visible text from
 * the displayed row (objectui#4465).
 *
 * The dataset option source is a GROUP BY whose response carries the same two
 * forms every dataset answer does: `rows` holds the SERVER-RESOLVED DISPLAY
 * LABELS (`{status: 'In Review'}`) and the index-aligned `drillRawRows` holds
 * the RAW stored values (`{status: 'in_review'}`). Reading the value off `rows`
 * committed `status = 'In Review'` into every bound widget's `runtimeFilter`,
 * and no stored record carries that string — the widgets re-queried and
 * repainted to "No rows". Only the label was ever meant to come from `rows`.
 *
 * The reading discipline is MIRRORED from the drill path, which consumes this
 * exact response correctly and always has: `DatasetWidget`'s `openDrill` reads
 * `drillRawRows?.[index]` at the SAME INDEX the display row was resolved at,
 * and `buildDatasetDrillFilter` documents why ("the dimension's RAW grouped
 * value … NOT the visible row which carries the display LABEL — a
 * select/lookup label would mis-filter"). One response, one reading. No helper
 * is shared with it: that one builds an ObjectQL filter keyed by object FIELD
 * (ANDing `runtimeFilter` and date ranges), which has no overlap with pairing
 * an option list, and reshaping it to fit would refactor the drill path to
 * serve this call site.
 *
 * Two deliberate abstentions, both landing on today's read (labels as values)
 * rather than on a guess:
 *
 *  - **Length disagreement.** Index pairing is only meaningful while the two
 *    arrays are index-aligned, and a length mismatch is the one signal that
 *    they are not. Pairing anyway would commit ANOTHER row's raw value —
 *    silently wrong in a NEW way, and indistinguishable from a correct filter
 *    that legitimately matched nothing. Labels-as-values is at least visibly
 *    wrong, and it is what this call site did before.
 *  - **The raw rows do not speak this field at all.** A `dateGranularity`
 *    dimension is excluded from `drillRawRows` by the server (it sends
 *    `drillRanges` instead), so raw rows carrying none of `valueField` are the
 *    server saying "there is no raw form of this dimension", not a defect.
 *
 * Within a trusted pairing an INDIVIDUAL row whose raw value is absent/empty is
 * skipped, exactly as an absent/empty displayed value was skipped before —
 * falling back to that row's label there would re-commit a label as a value for
 * that one option, which is the defect, one row at a time. `rawRows` absent
 * entirely (the client-side `find` path, or a server that sends no drill
 * metadata) is the same abstention: value and label both come from the row, as
 * before.
 */
function pairOptionRows(
  rows: any[],
  rawRows: any[] | undefined,
  from: { valueField: string; labelField?: string },
): Array<{ value: string; label: string }> {
  const aligned =
    Array.isArray(rawRows) &&
    rawRows.length === rows.length &&
    rawRows.some((rr) => rr?.[from.valueField] !== undefined)
      ? rawRows
      : undefined;
  const seen = new Map<string, string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const v = aligned ? aligned[i]?.[from.valueField] : r?.[from.valueField];
    if (v === undefined || v === null || v === '') continue;
    const key = String(v);
    if (seen.has(key)) continue;
    // The label always comes from the DISPLAYED row — `labelField` when the
    // author named one, else the same dimension's resolved display text.
    const shown = from.labelField ? r?.[from.labelField] : r?.[from.valueField];
    seen.set(key, String(shown ?? key));
  }
  return Array.from(seen, ([v, l]) => ({ value: v, label: l }));
}

function SelectFilter({ def, value, onChange, dataSource }: { def: DashboardFilterDef; value: string | undefined; onChange: (v: string | undefined) => void; dataSource?: any }) {
  const tt = useSafeTranslate();
  const { language } = useObjectTranslation();
  const { translateOptions } = useSafeFieldLabel();
  const resolvedLabel = useFilterLabel(def);
  const [dynamicOptions, setDynamicOptions] = useState<Array<{ value: string; label: string }> | null>(null);

  // Dynamic options, server-side first (#2578 item 5): when the data source
  // supports dataset queries, distinct values come from a GROUP BY on the
  // server (an inline dataset draft over the source object), so the option
  // list is complete regardless of row count. Falls back to the original
  // best-effort client-side dedupe (top 200 records) when dataset queries
  // are unavailable or the draft is rejected; degrades to an empty list on
  // total failure (same tolerance style as DatasetWidget's option-color
  // fetch).
  const from = def.optionsFrom;
  // objectui#10664 — both reads below send `from.filter`, so the effect keys on
  // it, by CONTENT: an equal filter in a fresh object is not a change
  // (AGENTS.md #10).
  const optionsFilterKey = JSON.stringify(from?.filter ?? null);
  // objectui#10887 — the data-invalidation bus (`notifyDataChanged` from
  // `@object-ui/react`), read the objectui#10853 way (the record picker's
  // options): the nonce moves when the bus reports a change to the object the
  // options are read from (or `'*'`), and the effect below names it, so the
  // options are re-read. Before, a page action over raw HTTP left them stale
  // unless `PageView` remounted the page, and objectui#10519 removes that
  // remount. The re-read is in place: the options on screen stay until the
  // answer swaps them (nothing here resets `dynamicOptions`), and the selected
  // value is the dashboard variable's, which this effect never writes.
  // Subscribed exactly when the effect below can read (an `optionsFrom` and an
  // adapter that serves either read).
  const invalidationNonce = useDataInvalidation(
    from && dataSource && (typeof dataSource.queryDataset === 'function' || typeof dataSource.find === 'function')
      ? from.object || undefined
      : undefined,
  );
  useEffect(() => {
    if (!from || !dataSource) return;
    let cancelled = false;

    const clientSideFallback = () => {
      if (typeof dataSource.find !== 'function') {
        if (!cancelled) setDynamicOptions([]);
        return;
      }
      dataSource
        .find(from.object, {
          // `$select` / `$top`, not `fields` / `top` (objectui#5458).
          // `convertQueryParams` copies exactly the `$`-prefixed keys
          // `QueryParams` declares, so BOTH unprefixed spellings here reached no
          // branch and were dropped: this "best-effort client-side dedupe (top
          // 200 records)" was in fact fetching every row AND every column of the
          // source object. Nothing rejected it — the index signature that then
          // stood for adapter-specific params let both keys type-check
          // (retired in objectui#7497; `tsc` refuses them now).
          // Deduped: `valueField === labelField` is the common case (both
          // default to the same column), and this projection only started
          // reaching the wire when the key was corrected above — so a repeated
          // entry would be a NEW thing to send, not a pre-existing one.
          $select: [...new Set([from.valueField, ...(from.labelField ? [from.labelField] : [])])],
          ...(from.filter ? { $filter: from.filter } : {}),
          $top: 200,
        })
        .then((records: any) => {
          if (cancelled) return;
          // `QueryResult` carries `data` — never `items`, which is not a member
          // of the contract. With a real adapter the old read resolved to `[]`,
          // so this fallback path produced NO options at all (objectui#5458).
          const rows: any[] = Array.isArray(records) ? records : records?.data ?? [];
          // Real records, not an aggregate answer: `r[valueField]` IS the
          // stored value here, so there is no raw sidecar to pair with.
          setDynamicOptions(pairOptionRows(rows, undefined, from));
        })
        .catch(() => { if (!cancelled) setDynamicOptions([]); });
    };

    if (typeof dataSource.queryDataset === 'function') {
      const dimensions = [{ name: from.valueField, field: from.valueField }];
      if (from.labelField && from.labelField !== from.valueField) {
        dimensions.push({ name: from.labelField, field: from.labelField });
      }
      dataSource
        .queryDataset(
          {
            name: 'dashboard_filter_options',
            label: 'Dashboard filter options',
            object: from.object,
            dimensions,
            measures: [{ name: 'option_count', aggregate: 'count' }],
          },
          {
            dimensions: dimensions.map((d) => d.name),
            measures: ['option_count'],
            ...(from.filter ? { runtimeFilter: from.filter } : {}),
            order: { [from.valueField]: 'asc' as const },
            limit: 1000,
          },
        )
        .then((res: any) => {
          if (cancelled) return;
          const rows: any[] = Array.isArray(res?.rows) ? res.rows : [];
          // `rows` carries the display labels; the committed value comes from
          // the index-aligned `drillRawRows` — see `pairOptionRows`.
          const rawRows: any[] | undefined = Array.isArray(res?.drillRawRows) ? res.drillRawRows : undefined;
          setDynamicOptions(pairOptionRows(rows, rawRows, from));
        })
        .catch(() => { if (!cancelled) clientSideFallback(); });
    } else {
      clientSideFallback();
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from?.object, from?.valueField, from?.labelField, optionsFilterKey, dataSource, invalidationNonce]);

  const localizedOptions = useMemo(() => {
    // `def.options` is already normalized to `{ value, label }` PAIRS by
    // `resolveDashboardFilterDefs`; the label's own vocabulary is not, and
    // deliberately so (`@object-ui/core` is locale-free — see
    // `normalizeFilterOptions`). Collapsing each label to the active language
    // is this layer's job, and it happens once here so both the dropdown and
    // the trigger's selected-value text read the same resolved string.
    const authored = def.options?.length ? def.options : (dynamicOptions ?? []);
    return authored.map((o) => ({ value: o.value, label: pickLocalized(o.label, language) || o.value }));
  }, [def.options, dynamicOptions, language]);

  // The second half of `GlobalFilterSchema.object` (`061f5e829`): the spec
  // gives that key BOTH the field label and the option labels, and
  // `translateOptions` is the same convention's option resolver — the one lists
  // and forms call, keyed by option VALUE under the field this filter reads.
  // Each authored label above stays the fallback, so an untranslated option
  // keeps its authored text rather than collapsing to the raw stored value.
  //
  // Deliberately NOT inside the memo above: the resolver arrives as a member of
  // `useSafeFieldLabel()`'s memoised object, and keying a `useMemo` on that
  // identity is what AGENTS.md #10 rules out. The work is one pass over a
  // dropdown's worth of options.
  const options = def.object
    ? translateOptions(def.object, def.field, localizedOptions)
    : localizedOptions;

  const label = resolvedLabel || def.name;
  const selectedLabel = value
    ? options.find((o) => o.value === String(value))?.label ?? String(value)
    : undefined;
  return (
    <Select
      // The variables provider initializes string variables to '' — treat
      // any falsy value as "no selection".
      value={value ? String(value) : ALL_VALUE}
      onValueChange={(v) => onChange(v === ALL_VALUE ? undefined : v)}
    >
      <SelectTrigger className="h-8 w-auto min-w-32" aria-label={label} data-testid={`dashboard-filter-${def.name}`}>
        <SelectValue>{selectedLabel ?? `${label}: ${tt('dashboard.filters.all', 'All')}`}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>{tt('dashboard.filters.all', 'All')}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TextFilter({ def, value, onChange }: { def: DashboardFilterDef; value: any; onChange: (v: any) => void }) {
  const label = useFilterLabel(def) || def.name;
  const [draft, setDraft] = useState<string>(value == null ? '' : String(value));
  useEffect(() => { setDraft(value == null ? '' : String(value)); }, [value]);
  const commit = () => {
    const v = draft.trim();
    if (v === '') { onChange(undefined); return; }
    onChange(def.type === 'number' ? Number(v) : v);
  };
  return (
    <Input
      className="h-8 w-36"
      type={def.type === 'number' ? 'number' : 'text'}
      placeholder={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      aria-label={label}
      data-testid={`dashboard-filter-${def.name}`}
    />
  );
}

export function DashboardFilterBar({ defs, values, onChange, onReset, dataSource, className }: DashboardFilterBarProps) {
  const tt = useSafeTranslate();
  if (defs.length === 0) return null;

  // The variables provider initializes undefined defaults to '' / {} by
  // type — normalize those to "empty" so a pristine bar shows no Reset.
  const isEmpty = (v: any) =>
    v == null || v === '' || (typeof v === 'object' && Object.keys(v).length === 0);
  const isDirty = defs.some((def) => {
    const a = values[def.name];
    const b = def.defaultValue;
    if (isEmpty(a) && isEmpty(b)) return false;
    return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
  });

  return (
    <div
      className={cn('col-span-full flex flex-wrap items-center gap-2', className)}
      data-testid="dashboard-filter-bar"
      role="group"
      aria-label={tt('dashboard.filters.label', 'Dashboard filters')}
    >
      {defs.map((def) => {
        const value = values[def.name];
        const set = (v: any) => onChange(def.name, v);
        if (def.type === 'dateRange' || def.type === 'date') {
          return <DateRangeFilter key={def.name} def={def} value={value} onChange={set} />;
        }
        if (def.type === 'select' || def.type === 'lookup') {
          return <SelectFilter key={def.name} def={def} value={value} onChange={set} dataSource={dataSource} />;
        }
        return <TextFilter key={def.name} def={def} value={value} onChange={set} />;
      })}
      {onReset && isDirty && (
        <Button variant="ghost" size="sm" onClick={onReset} className="text-muted-foreground">
          <RotateCcw className="size-3.5" />
          {tt('dashboard.filters.reset', 'Reset')}
        </Button>
      )}
    </div>
  );
}
