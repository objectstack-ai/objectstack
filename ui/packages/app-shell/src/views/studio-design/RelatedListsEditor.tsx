/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The object's `relatedLists` (objectstack#27069) as an ORDERED list of its
 * inbound relationships — what `highlightFields` is to fields, for the lists of
 * child records on the record page.
 *
 *  - The rows are the declared entries, in order: drag one to a new place, or
 *    move it with its up / down buttons (the shared `OrderedRowList`, the
 *    rows `HighlightFieldsEditor` draws).
 *  - Every relationship no entry names follows, greyed and not draggable, in
 *    the derived order the record page gives it (owned `master_detail`
 *    children, then `lookup` children); the add picker lists exactly those.
 *  - It orders; it does not show or hide. A relationship hidden by
 *    `relatedList: false` on its FK is listed (an entry may name it) and
 *    marked hidden; the switch itself stays on the field.
 *  - Every write is checked first ({@link acceptRelatedListEntries}): an entry
 *    that names no inbound relationship never enters the value, since the
 *    spec's `defineStack` check and the publish door's lint both refuse it. A
 *    stored one keeps its row, marked, and the next write leaves it out.
 *  - Removing the last entry removes the key.
 *  - A preview draws the order the record page will use, through the record
 *    page's own derivation, split into body tables and side cards (the order
 *    applies within each).
 */

import React from 'react';
import {
  deriveRelatedLists,
  type DerivedRelatedList,
} from '../../utils/deriveRelatedLists.js';
import { moveArray } from '../metadata-admin/inspectors/_shared.js';
import { t, tFormat, type SupportedLocale } from '../metadata-admin/i18n.js';
import { OrderedRowList } from './OrderedRowList.js';
import {
  acceptRelatedListEntries,
  relationshipEntry,
  relationshipLabel,
  relationshipsNamedBy,
  useRelatedListCatalog,
} from './relatedListVocabulary.js';

function Badges({ named, locale }: { named: readonly DerivedRelatedList[]; locale?: SupportedLocale }) {
  const hidden = named.length > 0 && named.every((r) => r.isHidden);
  const primary = !hidden && named.length > 0 && named.every((r) => r.isPrimary);
  if (!hidden && !primary) return null;
  return (
    <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">
      {hidden ? t('engine.studio.settings.relatedListsHidden', locale) : t('engine.studio.settings.relatedListsPrimary', locale)}
    </span>
  );
}

function entryLabel(entry: string, named: readonly DerivedRelatedList[]): string {
  if (named.length === 0) return entry;
  // A bare child name stands for every list of that child: name the child.
  return entry.includes('.') ? relationshipLabel(named[0]) : named[0].childLabel;
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
  onChange: (next: string[] | undefined) => void;
  disabled?: boolean;
  locale?: SupportedLocale;
  /**
   * The host's "add relationship" picker over `options` (the unlisted
   * relationships); `add` appends one, through the same pre-write check.
   */
  renderAdd?: (options: Array<{ value: string; label: string }>, add: (entry: string) => void) => React.ReactNode;
}) {
  const { catalog, relationships, ready } = useRelatedListCatalog(name, draft);
  const stored = Array.isArray(draft.relatedLists)
    ? (draft.relatedLists as unknown[]).filter((e): e is string => typeof e === 'string')
    : [];
  // The rows: the stored entries, in order, once each. An entry that names no
  // inbound relationship keeps its row (marked) until a write leaves it out.
  const rows = [...new Set(stored)];
  const listed = acceptRelatedListEntries(rows, relationships);
  const unmatched = ready ? rows.filter((e) => !listed.includes(e)) : [];
  const locked = !!disabled || !ready;

  // The pre-write check: nothing that names no inbound relationship is written.
  const write = (next: readonly string[]) => {
    const accepted = acceptRelatedListEntries(next, relationships);
    onChange(accepted.length > 0 ? accepted : undefined);
  };

  const named = (entry: string) => relationshipsNamedBy(entry, relationships);
  const tail = relationships.filter((r) => !listed.some((entry) => named(entry).includes(r)));
  const addOptions = tail.map((r) => {
    const entry = relationshipEntry(r, relationships);
    return { value: entry, label: `${relationshipLabel(r)} (${entry})` };
  });

  // What the record page will draw: its own derivation, over what a write keeps.
  const preview = deriveRelatedLists({ ...draft, name, relatedLists: listed }, catalog as never[]);
  const body = preview.filter((r) => r.isPrimary);
  const side = preview.filter((r) => !r.isPrimary);

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
        renderRow={(entry) => (
          <span className={unmatched.includes(entry) ? 'text-destructive' : undefined}>
            {entryLabel(entry, named(entry))}
            <span className="ml-1 font-mono text-[10px] text-muted-foreground">{entry}</span>
            <Badges named={named(entry)} locale={locale} />
          </span>
        )}
        onMove={(from, to) => write(moveArray(rows, from, to))}
        onRemove={(entry) => write(rows.filter((x) => x !== entry))}
        removeLabel={(entry) => tFormat('engine.studio.settings.removeField', locale, { field: entry })}
        disabled={locked}
      />
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
        <div className="flex flex-wrap items-center gap-1.5">{renderAdd?.(addOptions, (entry) => write([...rows, entry]))}</div>
      )}
      {ready && preview.length > 0 && (
        <div className="space-y-1">
          <span className="block text-[10px] text-muted-foreground">{t('engine.studio.settings.relatedListsPreview', locale)}</span>
          <div data-testid="related-lists-preview" className="space-y-1 rounded-md border bg-muted/20 px-3 py-2 text-[11px]">
            {body.length > 0 && (
              <div data-testid="related-lists-preview-body">
                <span className="text-muted-foreground">{t('engine.studio.settings.relatedListsPreviewBody', locale)}: </span>
                {body.map(relationshipLabel).join(' · ')}
              </div>
            )}
            {side.length > 0 && (
              <div data-testid="related-lists-preview-side">
                <span className="text-muted-foreground">{t('engine.studio.settings.relatedListsPreviewSide', locale)}: </span>
                {side.map(relationshipLabel).join(' · ')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
