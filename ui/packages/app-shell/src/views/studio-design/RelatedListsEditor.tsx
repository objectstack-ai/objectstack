/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The object's `relatedLists` as its record page's TAB LIST (objectstack#27069,
 * #35897, #35899): the inbound relationships and the built-in tabs the record
 * page shows after the overview, in order — what `highlightFields` is to
 * fields, for the tabs.
 *
 *  - The rows are the declared entries, in order: drag one to a new place, or
 *    move it with its up / down buttons (the shared `OrderedRowList`, the
 *    rows `HighlightFieldsEditor` draws).
 *  - A row is a relationship (the child, or `child.field`) or one of the three
 *    built-in tabs, named by the platform object each draws: attachments
 *    (`sys_attachment`), approvals (`sys_approval_request`) and the activity
 *    stream (`sys_activity`). The add picker offers the built-ins not yet
 *    listed (attachments only when the object enables files) and every
 *    relationship no entry names.
 *  - Once anything is listed, a relationship no entry names shows no tab: it
 *    is listed below, greyed, as not shown (a table a field group places in
 *    the overview stays there). With nothing listed every list shows in the
 *    default order.
 *  - A relationship row's Edit opens its own title and columns (the entry's
 *    object form, `{ list, label?, columns? }`), which win over the child FK's
 *    `relatedListTitle` / `relatedListColumns`; clearing both writes the bare
 *    name again. A built-in takes neither.
 *  - Every write is checked first ({@link acceptTabListEntries}): an entry
 *    that names no inbound relationship and no built-in never enters the
 *    value, since the spec's `defineStack` check and the publish door's lint
 *    both refuse it. A stored one keeps its row, marked, and the next write
 *    leaves it out. An entry's object form and a built-in name survive every
 *    write.
 *  - Removing the last entry removes the key.
 *  - A preview draws what the record page will use, through the record page's
 *    own derivation: the body tables, and the tabs in order.
 */

import React from 'react';
import { Pencil } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@object-ui/components';
import { isRecordPageBuiltinTab, relatedListEntryName, type RecordPageBuiltinTab, type RelatedListEntryInput } from '@objectstack/spec/data';
import {
  deriveRelatedLists,
  type DerivedRelatedList,
} from '../../utils/deriveRelatedLists.js';
import { moveArray } from '../metadata-admin/inspectors/_shared.js';
import { t, tFormat, type SupportedLocale } from '../metadata-admin/i18n.js';
import { OrderedRowList } from './OrderedRowList.js';
import {
  acceptTabListEntries,
  BUILTIN_TABS,
  builtinTabLabelKey,
  childColumnChoices,
  entryDetails,
  entryWithDetails,
  relationshipEntry,
  relationshipLabel,
  relationshipsNamedBy,
  useRelatedListCatalog,
} from './relatedListVocabulary.js';

function Badges({ named, locale }: { named: readonly DerivedRelatedList[]; locale?: SupportedLocale }) {
  const hidden = named.length > 0 && named.every((r) => r.isHidden);
  const primary = !hidden && named.length > 0 && named.every((r) => r.isPrimary);
  // objectstack#35901 — a list another package brings: shown read-only with its source.
  const fromPackage = named.find((r) => r.fromPackage !== undefined)?.fromPackage;
  if (!hidden && !primary && fromPackage === undefined) return null;
  return (
    <>
      {(hidden || primary) && (
        <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">
          {hidden ? t('engine.studio.settings.relatedListsHidden', locale) : t('engine.studio.settings.relatedListsPrimary', locale)}
        </span>
      )}
      {fromPackage !== undefined && (
        <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground" data-testid="related-lists-from-package">
          {tFormat('engine.studio.settings.relatedListsFromPackage', locale, { package: fromPackage })}
        </span>
      )}
    </>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">{children}</span>;
}

/** A row's label; none for an entry that names no relationship (its spelling is all it has). */
function entryLabel(entry: string, named: readonly DerivedRelatedList[]): string {
  if (named.length === 0) return '';
  // A bare child name stands for every list of that child: name the child.
  return entry.includes('.') ? relationshipLabel(named[0]) : named[0].childLabel;
}

/** One relationship entry's own title and columns. */
function EntryDetailsEditor({
  name,
  entry,
  named,
  choices,
  onChange,
  locale,
}: {
  name: string;
  entry: unknown;
  named: readonly DerivedRelatedList[];
  choices: Array<{ name: string; label: string }> | undefined;
  onChange: (next: RelatedListEntryInput) => void;
  locale?: SupportedLocale;
}) {
  const details = entryDetails(entry);
  const columns = details.columns ?? [];
  const write = (patch: { label?: string; columns?: readonly string[] }) =>
    onChange(entryWithDetails(name, { label: details.label, columns, ...patch }));
  const known = new Set((choices ?? []).map((c) => c.name));
  const labelOf = (col: string) => choices?.find((c) => c.name === col)?.label ?? col;
  const remaining = (choices ?? []).filter((c) => !columns.includes(c.name));
  // The title the record page draws when the entry sets none.
  const fallback = named[0] ? (named[0].title || named[0].childLabel) : name;
  return (
    <div className="space-y-1.5 rounded-md border bg-muted/20 p-2" data-testid={`related-lists-details-${name}`}>
      <label className="block space-y-0.5">
        <span className="block text-[10px] text-muted-foreground">{t('engine.studio.settings.relatedListsTitle', locale)}</span>
        <input
          type="text"
          data-testid={`related-lists-title-${name}`}
          value={details.label ?? ''}
          placeholder={fallback}
          onChange={(e) => write({ label: e.target.value })}
          className="h-7 w-full min-w-0 rounded-md border bg-background px-2 text-[12px]"
        />
      </label>
      <div className="space-y-1">
        <span className="block text-[10px] text-muted-foreground">
          {t(columns.length > 0 ? 'engine.studio.settings.relatedListsColumns' : 'engine.studio.settings.relatedListsColumnsDefault', locale)}
        </span>
        <OrderedRowList
          items={columns}
          ariaLabel={t('engine.studio.settings.relatedListsColumns', locale)}
          rowTestId={(col) => `related-lists-column-${name}-${col}`}
          renderRow={(col) => (
            <span className={choices && !known.has(col) ? 'text-destructive' : undefined}>
              {labelOf(col)}
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">{col}</span>
            </span>
          )}
          onMove={(from, to) => write({ columns: moveArray(columns, from, to) })}
          onRemove={(col) => write({ columns: columns.filter((c) => c !== col) })}
          removeLabel={(col) => tFormat('engine.studio.settings.removeField', locale, { field: col })}
        />
        {remaining.length > 0 && (
          <Select
            value="0"
            onValueChange={(token) => {
              const picked = remaining[Number(token) - 1];
              if (picked) write({ columns: [...columns, picked.name] });
            }}
          >
            <SelectTrigger data-testid={`related-lists-column-add-${name}`} className="h-6 w-auto gap-1 px-1.5 py-0.5 text-[11px] text-muted-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{t('engine.studio.settings.relatedListsColumnAdd', locale)}</SelectItem>
              {remaining.map((c, i) => (
                <SelectItem key={c.name} value={String(i + 1)}>{`${c.label} (${c.name})`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

export function RelatedListsEditor({
  name,
  draft,
  onChange,
  disabled,
  locale,
  renderAdd,
}: {
  /** The object's name (the parent every relationship points at). */
  name: string;
  /** The object draft (reads `relatedLists`; its own fields may add a self-reference). */
  draft: Record<string, unknown>;
  /** The next list; `undefined` removes the key. */
  onChange: (next: RelatedListEntryInput[] | undefined) => void;
  disabled?: boolean;
  locale?: SupportedLocale;
  /**
   * The host's "add" picker over `options` (the built-in tabs and the
   * relationships not listed); `add` appends one, through the same pre-write
   * check.
   */
  renderAdd?: (options: Array<{ value: string; label: string }>, add: (entry: string) => void) => React.ReactNode;
}) {
  const { catalog, relationships, ready } = useRelatedListCatalog(name, draft);
  const [editing, setEditing] = React.useState<string | null>(null);
  const storedEntries = Array.isArray(draft.relatedLists) ? (draft.relatedLists as unknown[]) : [];
  // The rows: the stored entries, in order, once per name. An entry that names
  // no inbound relationship keeps its row (marked) until a write leaves it out.
  const entryByName = new Map<string, unknown>();
  for (const entry of storedEntries) {
    const entryName = relatedListEntryName(entry);
    if (entryName !== undefined && !entryByName.has(entryName)) entryByName.set(entryName, entry);
  }
  const rows = [...entryByName.keys()];
  const listed = acceptTabListEntries(storedEntries, relationships);
  const listedNames = listed.map((e) => relatedListEntryName(e)!);
  const unmatched = ready ? rows.filter((e) => !listedNames.includes(e)) : [];
  const locked = !!disabled || !ready;
  const filesOn = (draft.enable as { files?: unknown } | undefined)?.files === true;

  // The pre-write check: nothing that names no inbound relationship and no
  // built-in tab is written.
  const write = (next: readonly unknown[]) => {
    const accepted = acceptTabListEntries(next, relationships);
    onChange(accepted.length > 0 ? accepted : undefined);
  };
  const entriesFor = (names: readonly string[]) => names.map((n) => entryByName.get(n) ?? n);

  const named = (entry: string) => relationshipsNamedBy(entry, relationships);
  const builtinLabel = (tab: RecordPageBuiltinTab) => t(builtinTabLabelKey(tab), locale);
  const tail = relationships.filter((r) => !listedNames.some((entry) => named(entry).includes(r)));
  const addOptions = [
    ...BUILTIN_TABS
      .filter((tab) => !rows.includes(tab) && (tab !== 'sys_attachment' || filesOn))
      .map((tab) => ({ value: tab, label: `${builtinLabel(tab)} (${tab})` })),
    ...tail.map((r) => {
      const entry = relationshipEntry(r, relationships);
      return { value: entry, label: `${relationshipLabel(r)} (${entry})` };
    }),
  ];

  // What the record page will draw: its own derivation, over what a write keeps
  // (with the served object's package, so a list another package brings shows
  // as it will, objectstack#35901).
  const servedPackage = catalog.find((o) => (o as { name?: unknown }).name === name)?._packageId;
  const preview = deriveRelatedLists(
    { ...draft, name, relatedLists: listed, ...(servedPackage !== undefined ? { _packageId: servedPackage } : {}) },
    catalog as never[],
  );
  const body = preview.filter((r) => r.isPrimary);
  const side = preview.filter((r) => !r.isPrimary);
  // The tab strip after the overview: the listed tabs in order, then
  // approvals and the activity stream when they are not listed. Attachments
  // show only when listed and the object enables files.
  const tabs: string[] = [];
  const placedSide = new Set<DerivedRelatedList>();
  // Where the unlisted side lists go (objectstack#35901: before a trailing run
  // of listed approvals / stream tabs, as the record page arranges them).
  let unlistedAt = 0;
  for (const entry of listedNames) {
    if (isRecordPageBuiltinTab(entry)) {
      if (entry !== 'sys_attachment' || filesOn) tabs.push(builtinLabel(entry));
      if (entry !== 'sys_approval_request' && entry !== 'sys_activity') unlistedAt = tabs.length;
      continue;
    }
    for (const r of side) {
      if (placedSide.has(r) || !named(entry).some((n) => n.childObject === r.childObject && n.referenceField === r.referenceField)) continue;
      placedSide.add(r);
      tabs.push(relationshipLabel(r));
    }
    unlistedAt = tabs.length;
  }
  tabs.splice(unlistedAt, 0, ...side.filter((r) => !placedSide.has(r)).map(relationshipLabel));
  if (listedNames.length === 0 && filesOn) tabs.push(builtinLabel('sys_attachment'));
  for (const tab of ['sys_approval_request', 'sys_activity'] as const) {
    if (!listedNames.includes(tab)) tabs.push(builtinLabel(tab));
  }

  const editingEntry = editing !== null && rows.includes(editing) && !unmatched.includes(editing) && !isRecordPageBuiltinTab(editing)
    ? editing
    : null;

  return (
    <div className="space-y-1.5" data-testid="related-lists-editor">
      {!ready && (
        <p className="text-[11px] text-muted-foreground" data-testid="related-lists-loading">
          {t('engine.studio.settings.relatedListsLoading', locale)}
        </p>
      )}
      <OrderedRowList
        items={rows}
        ariaLabel={t('engine.studio.settings.relatedLists', locale)}
        rowTestId={(entry) => `related-lists-row-${entry}`}
        renderRow={(entry) => {
          if (isRecordPageBuiltinTab(entry)) {
            return (
              <span>
                {builtinLabel(entry)}
                <span className="ml-1 font-mono text-[10px] text-muted-foreground">{entry}</span>
                <Tag>{t('engine.studio.settings.relatedListsBuiltin', locale)}</Tag>
              </span>
            );
          }
          const isUnmatched = unmatched.includes(entry);
          const own = entryDetails(entryByName.get(entry));
          return (
            <span className="flex min-w-0 items-center gap-1">
              <span className={'min-w-0 flex-1 truncate' + (isUnmatched ? ' text-destructive' : '')}>
                {own.label || entryLabel(entry, named(entry))}
                <span className={isUnmatched ? 'font-mono text-[10px]' : 'ml-1 font-mono text-[10px] text-muted-foreground'}>{entry}</span>
                <Badges named={named(entry)} locale={locale} />
                {own.columns && own.columns.length > 0 && (
                  <Tag>{tFormat('engine.studio.settings.relatedListsColumnCount', locale, { count: String(own.columns.length) })}</Tag>
                )}
              </span>
              {!locked && !isUnmatched && (
                <button
                  type="button"
                  aria-label={tFormat('engine.studio.settings.relatedListsEdit', locale, { entry })}
                  aria-expanded={editingEntry === entry}
                  data-testid={`related-lists-edit-${entry}`}
                  onClick={() => setEditing(editingEntry === entry ? null : entry)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </span>
          );
        }}
        onMove={(from, to) => write(entriesFor(moveArray(rows, from, to)))}
        onRemove={(entry) => write(entriesFor(rows.filter((x) => x !== entry)))}
        removeLabel={(entry) => tFormat('engine.studio.settings.removeField', locale, { field: entry })}
        disabled={locked}
      />
      {editingEntry !== null && (
        <EntryDetailsEditor
          name={editingEntry}
          entry={entryByName.get(editingEntry)}
          named={named(editingEntry)}
          choices={childColumnChoices(named(editingEntry), catalog)}
          onChange={(next) => write(rows.map((n) => (n === editingEntry ? next : entryByName.get(n) ?? n)))}
          locale={locale}
        />
      )}
      {rows.includes('sys_attachment') && !filesOn && (
        <p className="text-[11px] text-muted-foreground" data-testid="related-lists-attachments-off">
          {t('engine.studio.settings.relatedListsAttachmentsOff', locale)}
        </p>
      )}
      {unmatched.length > 0 && (
        <div className="space-y-0.5" data-testid="related-lists-unmatched">
          {unmatched.map((entry) => (
            <p key={entry} className="text-[11px] text-destructive">
              {tFormat('engine.studio.settings.relatedListsUnmatched', locale, { entry })}
            </p>
          ))}
        </div>
      )}
      {ready && relationships.length === 0 && (
        <span className="block text-[11px] text-muted-foreground" data-testid="related-lists-none">
          {t('engine.studio.settings.relatedListsNone', locale)}
        </span>
      )}
      {tail.length > 0 && (
        <div className="space-y-1" data-testid="related-lists-tail">
          <span className="block text-[10px] text-muted-foreground">
            {t(listed.length > 0 ? 'engine.studio.settings.relatedListsTail' : 'engine.studio.settings.relatedListsUndeclared', locale)}
          </span>
          <ul className="space-y-1">
            {tail.map((r) => {
              const entry = relationshipEntry(r, relationships);
              return (
                <li
                  key={`${r.childObject}.${r.referenceField}`}
                  aria-disabled="true"
                  data-testid={`related-lists-tail-row-${r.childObject}.${r.referenceField}`}
                  className="flex items-center gap-1.5 rounded-md border border-dashed px-1.5 py-1 text-[12px] text-muted-foreground"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {relationshipLabel(r)}
                    <span className="ml-1 font-mono text-[10px]">{entry}</span>
                    <Badges named={[r]} locale={locale} />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {!locked && addOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">{renderAdd?.(addOptions, (entry) => write([...entriesFor(rows), entry]))}</div>
      )}
      {ready && (preview.length > 0 || tabs.length > 0) && (
        <div className="space-y-1">
          <span className="block text-[10px] text-muted-foreground">{t('engine.studio.settings.relatedListsPreview', locale)}</span>
          <div data-testid="related-lists-preview" className="space-y-1 rounded-md border bg-muted/20 px-3 py-2 text-[11px]">
            {body.length > 0 && (
              <div data-testid="related-lists-preview-body">
                <span className="text-muted-foreground">{t('engine.studio.settings.relatedListsPreviewBody', locale)}: </span>
                {body.map(relationshipLabel).join(' · ')}
              </div>
            )}
            {tabs.length > 0 && (
              <div data-testid="related-lists-preview-side">
                <span className="text-muted-foreground">{t('engine.studio.settings.relatedListsPreviewSide', locale)}: </span>
                {tabs.join(' · ')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
