/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Skeleton,
  useIsMobile,
} from '@object-ui/components';
import { Search, Loader2, AlertCircle } from 'lucide-react';
import type { DataSource, LookupFilterDef } from '@object-ui/types';
import { useRecordQuery } from './useRecordQuery.js';
// The repo's single filter sink — conjoins filter sources under one `and`
// instead of spreading them, so an id restriction can never overwrite a
// declared filter on the same field (#5195).
import { mergeFilterNodes, toFilterNodeSafely, type FilterNodeResult } from '@object-ui/core';
import { usePermissions } from '@object-ui/permissions';
import { lookupFiltersToRecord } from './RecordPickerDialog.js';
import { getPersonId, getPersonNameFields } from './personDisplay.js';
import { PersonRow } from './PersonRow.js';
import { SelectionTray } from './SelectionTray.js';
import { getRecentLookupIds, pushRecentLookupId } from './recentLookups.js';
import { useFieldTranslation } from './useFieldTranslation.js';

/**
 * PeoplePicker — the Tier 0, search-first user picker (issue #2112).
 *
 * A single-column picker: search box → recent contacts → rich candidate rows
 * (avatar + name + department·email) → a live SelectionTray for multi-select.
 * Composed from the reusable {@link useRecordQuery} kernel and
 * {@link SelectionTray}; a future org-tree tier reuses both beside a left tree.
 *
 * Container is responsive: a centered Dialog on desktop, a bottom Sheet on
 * mobile (<768px). Interaction: full keyboard model (↑/↓ move the cursor, ↵
 * toggles/commits, Backspace on an empty search removes the last chip, Esc
 * closes), matched-term highlighting in rows, skeletons on first load with no
 * flash-to-empty on refetch, and friendly empty / error+retry states.
 *
 * Candidate hygiene (e.g. `banned != true`), the department `$expand`, and the
 * avatar/subtitle field config are supplied by the caller (UserField). Pinyin /
 * employee-id search is server-side and transparent — the client only sends the
 * term.
 */
export interface PeoplePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  multiple?: boolean;

  dataSource: DataSource;
  /** Object to query — `sys_user` for user fields. */
  objectName: string;

  /**
   * The person's name field (default `name`), read first of the name ladder
   * (then `name`, `username`, `label`). Once the permission policy has loaded,
   * a rung the user may not read on `objectName` is skipped.
   */
  displayField?: string;
  idField?: string;
  /**
   * Dotted field paths for the row subtitle, e.g. `['primary_business_unit_id.name','email']`.
   * Once the permission policy has loaded, a path whose field on `objectName`
   * the user may not read is not drawn.
   */
  subtitleFields?: string[];
  /** Avatar image field; not drawn once the loaded policy denies it on `objectName`. */
  avatarField?: string;
  /**
   * Related entities to expand (e.g. `['primary_business_unit_id']` for the
   * department name). Once the permission policy has loaded, a relation the
   * user may not read on `objectName` is left out, as it is from the list
   * derived from `subtitleFields` when this is not passed.
   */
  expand?: string[];
  /** Narrow the server searchable set (ADR-0061). */
  searchFields?: string[];
  pageSize?: number;
  /** Base candidate filters (e.g. exclude banned users). */
  lookupFilters?: LookupFilterDef[];
  /**
   * Hard filter constraints in QueryParams.$filter record form — the
   * dependent (cascading) lookup chain (#2215). Always ANDed into the
   * candidate query; spread after `lookupFilters` so it wins on conflicts.
   */
  baseFilter?: Record<string, any>;

  /** Current selection (id, or id[] when `multiple`). */
  value?: any;
  onSelect: (value: any) => void;
  onSelectRecords?: (records: any[]) => void;

  /**
   * Render as an inline combobox anchored to {@link trigger} — a Popover
   * dropdown on desktop, a bottom Sheet on mobile — instead of a centered
   * modal Dialog. In inline mode multi-select commits live on each toggle
   * (the caller's field chips are the selection), so there's no staging tray
   * or confirm button.
   */
  inline?: boolean;
  /** The element the inline dropdown/sheet anchors to (the field trigger). */
  trigger?: React.ReactNode;
}

const DEFAULT_PAGE_SIZE = 25;
const SKELETON_ROWS = 6;

export function PeoplePicker({
  open,
  onOpenChange,
  title,
  multiple = false,
  dataSource,
  objectName,
  displayField = 'name',
  idField = 'id',
  subtitleFields,
  avatarField = 'image',
  expand,
  searchFields,
  pageSize = DEFAULT_PAGE_SIZE,
  lookupFilters,
  baseFilter: baseFilterProp,
  value,
  onSelect,
  onSelectRecords,
  inline = false,
  trigger,
}: PeoplePickerProps) {
  const { t } = useFieldTranslation();
  const isMobile = useIsMobile();

  const baseFilter = useMemo<Record<string, any> | undefined>(() => {
    const combined = {
      ...(lookupFilters?.length ? lookupFiltersToRecord(lookupFilters) : {}),
      ...(baseFilterProp ?? {}),
    };
    return Object.keys(combined).length > 0 ? combined : undefined;
  }, [lookupFilters, baseFilterProp]);

  // Auto-expand relation subtitles (e.g. `primary_business_unit_id.name` needs
  // `$expand: ['primary_business_unit_id']`) unless the caller passed `expand`.
  //
  // Field-level security gates the OUTPUT (objectui#10373), in the shape the
  // objectui#7215 / objectui#7230 rulings set and every other `$expand` in this
  // package already has: once the policy has loaded, a relation the user may
  // not read on `objectName` (the object this picker queries) is not asked
  // for; before it loads nothing is filtered, and `perms` in the deps
  // re-derives the list when the answer arrives. The gate reads the list that
  // goes out, whichever source filled it — a caller's `expand` or the one
  // derived from the subtitle paths. A subtitle path through a relation left
  // out resolves to nothing and drops out of the row, as it does for a backend
  // that ignores `$expand`.
  const perms = usePermissions();
  const effectiveExpand = useMemo<string[] | undefined>(() => {
    let requested: string[];
    if (expand && expand.length) {
      requested = expand;
    } else {
      const rels = new Set<string>();
      (subtitleFields ?? []).forEach(f => {
        if (f.includes('.')) rels.add(f.split('.')[0]);
      });
      requested = Array.from(rels);
    }
    const readable = requested.filter(
      f => !perms.isLoaded || perms.checkField(objectName, f, 'read'),
    );
    return readable.length ? readable : undefined;
  }, [expand, subtitleFields, perms, objectName]);

  // The subtitle fields and the avatar a row DRAWS, gated the same way
  // (objectui#10433). Gating `$expand` alone left them on screen: a row read
  // every subtitle path and the avatar straight off the served row, so on a
  // backend that does not strip denied keys (ObjectStack's `FieldMasker` does)
  // a plain field such as `email` showed. A path is judged by the field it
  // reads on `objectName`, its first segment — the name the `$expand` gate
  // above judges, and the only one a policy on this object can name. A
  // withheld avatar is `null`, never `undefined`: the row and the tray default
  // an `undefined` one back to `image`.
  const readableSubtitleFields = useMemo<string[] | undefined>(
    () =>
      subtitleFields?.filter(
        f => !perms.isLoaded || perms.checkField(objectName, f.split('.')[0], 'read'),
      ),
    [subtitleFields, perms, objectName],
  );
  const readableAvatarField = useMemo<string | null>(
    () =>
      !perms.isLoaded || perms.checkField(objectName, avatarField.split('.')[0], 'read')
        ? avatarField
        : null,
    [avatarField, perms, objectName],
  );
  // The name a row and the tray draw, gated the same way (objectui#10535). It
  // is read down a ladder of fields on `objectName` — the display field, then
  // `name`, `username`, `label` (`getPersonNameFields`) — and a rung the policy
  // denies is left out, so the name falls through to the next readable one:
  // the fallback the lookup editor's option label has (objectui#10411), and
  // what the row a stripping backend serves reads. With no rung readable the
  // row and the tray draw their no-name placeholder, as for that row. The
  // records themselves are kept as served, and the name is derived per render,
  // so a policy that arrives later relabels them.
  const readableNameFields = useMemo<string[]>(
    () =>
      getPersonNameFields(displayField).filter(
        f => !perms.isLoaded || perms.checkField(objectName, f.split('.')[0], 'read'),
      ),
    [displayField, perms, objectName],
  );

  // Main candidate query (search + candidate hygiene).
  const query = useRecordQuery({
    dataSource,
    objectName,
    enabled: open,
    pageSize,
    filter: baseFilter,
    expand: effectiveExpand,
    searchFields,
  });

  // Recent ids captured once per open.
  const recentIds = useMemo(
    () => (open ? getRecentLookupIds(objectName) : []),
    [open, objectName],
  );

  // The current value's ids, for hydrating the SelectionTray on edit.
  const valueIds = useMemo<any[]>(() => {
    if (multiple) return Array.isArray(value) ? value : [];
    return value != null && value !== '' ? [value] : [];
  }, [multiple, value]);

  // Recents and the current value used to ride ONE unfiltered `$in` query
  // (`seedIds = valueIds + recentIds`), which is the defect in #5195: the main
  // candidate query above merges `baseFilter` (the author's `lookupFilters`
  // plus the `dependsOn` cascade the host passes down) and this one merged
  // nothing, so the "Recently used" rail kept offering records the declared
  // filters exclude — a product from the previously-selected project, still
  // selectable after switching parents.
  //
  // They are split because they answer DIFFERENT questions, and only one of
  // them is about candidates:
  //
  //   valueQuery  — what does the record already hold? Stays UNFILTERED. The
  //                 value is committed; dropping it here would empty the tray
  //                 and make a no-op Confirm silently clear the field, which
  //                 is a worse bug than the one being fixed.
  //   recentQuery — what may the user pick right now? Carries the SAME merged
  //                 filter as the main candidate query, so the server decides
  //                 admissibility once, in one vocabulary.
  //
  // `mergeFilterNodes` (the repo's single filter sink) conjoins rather than
  // spreads, so an id restriction can never overwrite a declared filter keyed
  // on the same field and widen what we are here to narrow. With nothing
  // declared there is nothing to enforce, and the plain record form goes out
  // exactly as before.
  const valueQuery = useRecordQuery({
    dataSource,
    objectName,
    enabled: open && valueIds.length > 0,
    pageSize: Math.max(1, valueIds.length),
    filter: { [idField]: { $in: valueIds } },
    expand: effectiveExpand,
  });

  // ⚠️ `baseFilter` is lowered through `toFilterNodeSafely` before the merge —
  // objectui#10789. This is a RENDER-time `useMemo`, and the lowering refuses a
  // malformed authored filter (`lookupFilters`, the host's `baseFilter`) with a
  // `FilterOperatorError`: uncaught, that threw out of render into the error
  // boundary. The refusal is kept as a VALUE: the recents query does not run
  // (never "no filter", which would offer every record), and the candidate
  // area below reports it in the error slot the main query's own refusal
  // reaches through `dataSource.find`.
  const recentFilter = useMemo<FilterNodeResult>(() => {
    const idRestriction = { [idField]: { $in: recentIds } };
    if (!baseFilter) return { ok: true, node: idRestriction };
    const lowered = toFilterNodeSafely(baseFilter);
    return lowered.ok ? { ok: true, node: mergeFilterNodes(lowered.node, idRestriction) } : lowered;
  }, [baseFilter, idField, recentIds]);
  const recentFilterRefusal = recentFilter.ok ? undefined : recentFilter.refusal;

  const recentQuery = useRecordQuery({
    dataSource,
    objectName,
    enabled: open && recentIds.length > 0 && recentFilter.ok,
    pageSize: Math.max(1, recentIds.length),
    filter: recentFilter.ok ? recentFilter.node : undefined,
    expand: effectiveExpand,
  });

  // Tray hydration reads the value leg only — a recents hit must never stand in
  // for a value the value query did not return.
  const recordsById = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of valueQuery.records) m.set(String(getPersonId(r, idField)), r);
    return m;
  }, [valueQuery.records, idField]);

  // --- selection state (full records so the tray can show avatar + name) ---
  const [selectedRecords, setSelectedRecords] = useState<any[]>([]);
  const seededRef = useRef(false);
  // On open, valueQuery.loading is still false for one render (its fetch is
  // kicked off in an effect that runs after this one), so an eager seed would
  // read an empty recordsById, seed nothing, and lock — wiping an existing
  // selection on confirm. Only seed after we've observed the fetch start.
  const sawSeedLoadingRef = useRef(false);

  useEffect(() => {
    if (!open) {
      seededRef.current = false;
      sawSeedLoadingRef.current = false;
      setSelectedRecords([]);
    }
  }, [open]);

  // Seed the tray from the current value once its records resolve (once per open).
  useEffect(() => {
    if (!open || seededRef.current) return;
    if (valueIds.length === 0) {
      seededRef.current = true;
      return;
    }
    if (valueQuery.loading) {
      sawSeedLoadingRef.current = true;
      return;
    }
    // The seed fetch hasn't started yet this open — wait for it before locking.
    if (!sawSeedLoadingRef.current) return;
    const seeded = valueIds.map(id => recordsById.get(String(id))).filter(Boolean);
    setSelectedRecords(seeded);
    seededRef.current = true;
  }, [open, valueIds, valueQuery.loading, recordsById]);

  const selectedIds = useMemo(
    () => new Set(selectedRecords.map(r => String(getPersonId(r, idField)))),
    [selectedRecords, idField],
  );

  const commit = useCallback(
    (ids: any[], records: any[]) => {
      onSelect(multiple ? ids : (ids[0] ?? null));
      onSelectRecords?.(records);
      ids.forEach(id => pushRecentLookupId(objectName, id));
      onOpenChange(false);
    },
    [multiple, objectName, onSelect, onSelectRecords, onOpenChange],
  );

  // Inline mode has no confirm step — push the value out on every change.
  const commitLive = useCallback(
    (records: any[]) => {
      onSelect(records.map(r => getPersonId(r, idField)));
      onSelectRecords?.(records);
    },
    [onSelect, onSelectRecords, idField],
  );

  const handleRowSelect = useCallback(
    (record: any) => {
      const id = getPersonId(record, idField);
      if (!multiple) {
        commit([id], [record]);
        return;
      }
      const key = String(id);
      const exists = selectedRecords.some(r => String(getPersonId(r, idField)) === key);
      const next = exists
        ? selectedRecords.filter(r => String(getPersonId(r, idField)) !== key)
        : [...selectedRecords, record];
      setSelectedRecords(next);
      // Inline: commit live (chips live in the field), stay open for more.
      // Modal: stage in the tray until Confirm.
      if (inline) {
        if (!exists) pushRecentLookupId(objectName, id);
        commitLive(next);
      }
    },
    [multiple, idField, commit, selectedRecords, inline, objectName, commitLive],
  );

  const handleRemove = useCallback(
    (id: any) => {
      const key = String(id);
      const next = selectedRecords.filter(r => String(getPersonId(r, idField)) !== key);
      setSelectedRecords(next);
      if (inline) commitLive(next);
    },
    [idField, selectedRecords, inline, commitLive],
  );

  const handleConfirm = useCallback(() => {
    commit(selectedRecords.map(r => getPersonId(r, idField)), selectedRecords);
  }, [commit, selectedRecords, idField]);

  const hasSearch = query.search.trim().length > 0;

  // Recent contacts (only when not searching), in MRU order.
  //
  // Membership comes from the FILTERED recents query alone (#5195), never from
  // the value leg: the currently-selected record is usually also the most
  // recent one, and reading it out of the unfiltered tray map is exactly how a
  // record the declared filters exclude used to walk back onto the rail. An id
  // the filtered query did not return is dropped — it fails the filters, or it
  // no longer exists, and neither is offerable.
  const recentRecords = useMemo(() => {
    if (hasSearch) return [];
    const admissible = new Map<string, any>(
      recentQuery.records.map(r => [String(getPersonId(r, idField)), r]),
    );
    return recentIds.map(id => admissible.get(String(id))).filter(Boolean);
  }, [hasSearch, recentIds, recentQuery.records, idField]);

  // Candidate list; drop recents when idle to avoid showing them twice.
  const resultRecords = useMemo(() => {
    if (hasSearch) return query.records;
    const recentSet = new Set(recentIds.map(String));
    return query.records.filter(r => !recentSet.has(String(getPersonId(r, idField))));
  }, [hasSearch, query.records, recentIds, idField]);

  // Flat, in-display-order list the keyboard cursor walks.
  const navList = useMemo(
    () => [...recentRecords, ...resultRecords],
    [recentRecords, resultRecords],
  );

  // --- keyboard cursor ---
  const [activeIndex, setActiveIndex] = useState(-1);
  // Reset the cursor when the query results are actually *replaced* — keyed on
  // the record-id signature, not the array identity. A background refetch that
  // returns the same records (StrictMode double-effect, refetch-on-focus)
  // re-emits a new array; resetting on identity alone yanked the cursor to -1
  // mid-navigation (flaky ArrowDown→Enter, and a real UX nit).
  //
  // The id separator is the escaped U+0000 spelling, not the byte itself
  // (objectstack#5450): one raw NUL made this whole file binary to grep and
  // ripgrep — a content search printed `binary file matches` and no line. The
  // runtime value is unchanged, and it is the same separator the `cursorEpoch`
  // key below already spelled this way.
  const recordsSignature = useMemo(
    () => query.records.map(r => String(getPersonId(r, idField))).join('\u0000'),
    [query.records, idField],
  );
  // The reset runs in the RENDER PHASE (the "adjusting state during render"
  // pattern), NOT in an effect. An effect flushes asynchronously after the
  // render that delivered the records — so a reset queued by their arrival
  // could land AFTER a subsequent ArrowDown and eat the just-set cursor.
  // That is the residual ArrowDown→Enter flake the signature key above did
  // not close (CI reproduced it under load), and a real fast-fingers UX bug:
  // rows appear, the user presses ArrowDown, the highlight vanishes.
  // Resetting during the same render that shows the new rows makes the
  // ordering deterministic — by the time the rows are visible, the reset
  // has already happened.
  const cursorEpoch = `${query.search}\u0000${recordsSignature}`;
  const [seenCursorEpoch, setSeenCursorEpoch] = useState(cursorEpoch);
  if (seenCursorEpoch !== cursorEpoch) {
    setSeenCursorEpoch(cursorEpoch);
    setActiveIndex(-1);
  }
  // Keep it in range if the list shrinks.
  useEffect(() => {
    setActiveIndex(i => (i >= navList.length ? navList.length - 1 : i));
  }, [navList.length]);

  const onSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(i => (navList.length ? Math.min(navList.length - 1, i + 1) : -1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(i => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        if (activeIndex >= 0 && activeIndex < navList.length) {
          e.preventDefault();
          handleRowSelect(navList[activeIndex]);
        }
      } else if (
        e.key === 'Backspace' &&
        query.search.length === 0 &&
        multiple &&
        selectedRecords.length > 0
      ) {
        handleRemove(getPersonId(selectedRecords[selectedRecords.length - 1], idField));
      }
    },
    [navList, activeIndex, handleRowSelect, query.search, multiple, selectedRecords, handleRemove, idField],
  );

  // The candidate area's error: the main query's own failure, else the refusal
  // of the declared filter the recents merge could not lower (objectui#10789).
  const candidateError = query.error ?? recentFilterRefusal?.message ?? null;
  const initialLoading =
    query.loading && !candidateError && query.records.length === 0 && recentRecords.length === 0;
  const refetching = query.loading && !initialLoading;
  const isEmpty =
    !query.loading &&
    !candidateError &&
    resultRecords.length === 0 &&
    recentRecords.length === 0;

  const renderRow = (record: any, index: number) => {
    const id = getPersonId(record, idField);
    return (
      <PersonRow
        key={String(id)}
        record={record}
        displayField={displayField}
        nameFields={readableNameFields}
        subtitleFields={readableSubtitleFields}
        avatarField={readableAvatarField}
        selected={selectedIds.has(String(id))}
        active={index === activeIndex}
        highlightQuery={query.search}
        onSelect={handleRowSelect}
      />
    );
  };

  const titleText = title || t('lookup.selectRecord');

  // Container-agnostic body — rendered inside a Dialog (desktop) or Sheet (mobile).
  const body = (
    <>
      {/* Search */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          autoFocus={!isMobile}
          value={query.search}
          onChange={e => query.setSearch(e.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder={t('table.search')}
          className="px-8"
          role="combobox"
          aria-expanded
          aria-controls="people-picker-list"
          data-testid="people-picker-search"
        />
        {query.loading && (
          <Loader2
            className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden
          />
        )}
      </div>

      {/* Candidate area */}
      <ScrollArea className="min-h-0 flex-1" data-testid="people-picker-list">
        <div
          id="people-picker-list"
          role="listbox"
          aria-busy={query.loading}
          className={cn('flex flex-col gap-0.5 pr-2 transition-opacity', refetching && 'opacity-70')}
        >
          {candidateError ? (
            <div
              className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground"
              data-testid="people-picker-error"
            >
              <AlertCircle className="size-5 text-destructive" aria-hidden />
              <span className="max-w-xs">{candidateError}</span>
              {/* A retry re-runs a failed READ; it cannot repair an authored
                  filter this picker refused before reading. */}
              {query.error ? (
                <Button type="button" variant="outline" size="sm" onClick={query.refetch}>
                  {t('lookup.retry')}
                </Button>
              ) : null}
            </div>
          ) : initialLoading ? (
            Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-1.5">
                <Skeleton className="size-9 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-2.5 w-1/2" />
                </div>
              </div>
            ))
          ) : (
            <>
              {recentRecords.length > 0 && (
                <>
                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                    {t('lookup.recentlyUsed')}
                  </div>
                  {recentRecords.map((r, i) => renderRow(r, i))}
                  {resultRecords.length > 0 && (
                    <div className="mt-1 flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted-foreground">
                      <span>{t('lookup.allResults')}</span>
                      <span className="font-normal opacity-70">· {query.total}</span>
                    </div>
                  )}
                </>
              )}

              {resultRecords.map((r, i) => renderRow(r, recentRecords.length + i))}

              {isEmpty && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {t('lookup.noRecords')}
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>

      {/* Multi-select tray + confirm — modal only; inline commits live and
          shows the selection as chips in the caller's field. */}
      {multiple && !inline && (
        <>
          <SelectionTray
            records={selectedRecords}
            onRemove={handleRemove}
            onClear={() => setSelectedRecords([])}
            clearLabel={t('lookup.clear')}
            displayField={displayField}
            nameFields={readableNameFields}
            avatarField={readableAvatarField}
            idField={idField}
            label={t('table.selected', { count: selectedRecords.length })}
            className={cn('border-t pt-3')}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={handleConfirm}>
              {t('common.confirm')}
            </Button>
          </div>
        </>
      )}
    </>
  );

  // Inline combobox: anchored Popover on desktop, bottom Sheet (opened from the
  // same trigger) on mobile. The trigger is the caller's field control.
  if (inline) {
    if (isMobile) {
      return (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetTrigger asChild>{trigger}</SheetTrigger>
          <SheetContent
            side="bottom"
            className="flex h-[85vh] flex-col gap-3"
            data-testid="people-picker-sheet"
          >
            <SheetHeader className="text-left">
              <SheetTitle>{titleText}</SheetTitle>
            </SheetHeader>
            {body}
          </SheetContent>
        </Sheet>
      );
    }
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          align="start"
          className="flex max-h-[min(28rem,60vh)] w-[var(--radix-popover-trigger-width)] min-w-72 flex-col gap-3 p-3"
          data-testid="people-picker-inline"
        >
          {body}
        </PopoverContent>
      </Popover>
    );
  }

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="flex h-[85vh] flex-col gap-3"
          data-testid="people-picker-sheet"
        >
          <SheetHeader className="text-left">
            <SheetTitle>{titleText}</SheetTitle>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[80vh] flex-col gap-3 sm:max-w-lg"
        data-testid="people-picker-dialog"
      >
        <DialogHeader>
          <DialogTitle>{titleText}</DialogTitle>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
