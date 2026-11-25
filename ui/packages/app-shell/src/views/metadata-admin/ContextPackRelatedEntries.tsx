// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `related-list-entries` block under a context pack (`ai_context`,
 * objectstack ADR-0160 D1, card #37143): the pack's child lists.
 *
 * An object's `relatedLists` entry is a bare name or `{ list, label?, columns? }`;
 * a pack's `related` entry is `{ object, field?, fields? }` — the child object,
 * its reference field that points at the pack's root, and the columns read for
 * each row. The block tells the two apart by the entry schema it is handed
 * ({@link isContextPackEntrySchema}), never by the metadata type's name, and
 * this component draws the pack's shape:
 *
 *  - The add picker offers every relationship that points at the root: each
 *    reference field (`REFERENCE_VALUE_TYPES`, resolved by the spec's own
 *    `referenceTargetOf`) of every object the console serves whose target is
 *    the root — the link the save-time judge (`validateAiContext`) resolves.
 *    A picked relationship is written `{ object, field }`: naming the field
 *    keeps the entry resolvable if the child later gains a second link.
 *  - Each entry's columns are picked from THAT child object's fields
 *    (`useObjectFields`, draft-overlaid), never the root's.
 *  - A stored entry keeps every key it carries; a write changes only what the
 *    author touched. An entry whose link the catalog does not show is kept and
 *    marked: the save-time report is the one judge of it.
 *  - The bounds the schema refuses at parse are bounds of the controls: no
 *    add past `maxItems` lists or columns, and an emptied list or column set
 *    removes its key (both arrays are `minItems: 1`).
 */

import * as React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@object-ui/components';
import { useMetadata } from '@object-ui/react';
import { REFERENCE_VALUE_TYPES, referenceTargetOf } from '@objectstack/spec/data';
import { t, tFormat, useMetadataLocale } from './i18n.js';
import { useObjectFields } from './previews/useObjectFields.js';

/** One stored `related` entry of a context pack, as far as the editor reads it. */
export interface ContextPackRelatedEntry {
  object: string;
  field?: string;
  fields?: string[];
  [key: string]: unknown;
}

/** One relationship that points at the root: a reference field of a child object. */
export interface ContextPackLink {
  object: string;
  objectLabel: string;
  field: string;
  fieldLabel: string;
}

type AnyRec = Record<string, unknown>;

/**
 * Whether a `related-list-entries` block is editing a context pack's `related`:
 * its entries are objects that declare an `object` key (the pack's entry
 * schema), not the object form's names or `{ list, … }` entries.
 */
export function isContextPackEntrySchema(schema: Record<string, any> | undefined): boolean {
  const props = schema?.items?.properties;
  return !!props && typeof props === 'object' && 'object' in props && !('list' in props);
}

/** The `maxItems` a JSON Schema array node declares, if any. */
export function maxItemsOf(schema: Record<string, any> | undefined): number | undefined {
  const max = schema?.maxItems;
  return typeof max === 'number' && Number.isFinite(max) ? max : undefined;
}

/** A field map in either served shape (name-keyed record or array of `{ name }`). */
function fieldEntriesOf(object: AnyRec): Array<[string, AnyRec]> {
  const raw = object.fields;
  if (Array.isArray(raw)) {
    return raw
      .filter((f): f is AnyRec => !!f && typeof f === 'object' && typeof (f as AnyRec).name === 'string')
      .map((f) => [f.name as string, f]);
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).filter(
      (e): e is [string, AnyRec] => !!e[1] && typeof e[1] === 'object',
    );
  }
  return [];
}

function labelOf(def: AnyRec, fallback: string): string {
  return typeof def.label === 'string' && def.label.trim() ? def.label : fallback;
}

/** The object a reference field points at, or `undefined` for any other field. */
function targetOf(def: AnyRec): string | undefined {
  if (typeof def.type !== 'string' || !REFERENCE_VALUE_TYPES.has(def.type)) return undefined;
  try {
    return referenceTargetOf(def);
  } catch {
    // An unreadable carrier links nowhere here; the save-time report names it.
    return undefined;
  }
}

/**
 * Every relationship that points at `root` in `objects`, in catalog order:
 * one per reference field whose target is the root (a self-reference counts).
 */
export function contextPackLinks(root: string | undefined, objects: readonly unknown[]): ContextPackLink[] {
  if (!root) return [];
  const out: ContextPackLink[] = [];
  for (const o of objects) {
    if (!o || typeof o !== 'object') continue;
    const object = o as AnyRec;
    const name = typeof object.name === 'string' ? object.name : '';
    if (!name) continue;
    for (const [field, def] of fieldEntriesOf(object)) {
      if (targetOf(def) !== root) continue;
      out.push({ object: name, objectLabel: labelOf(object, name), field, fieldLabel: labelOf(def, field) });
    }
  }
  return out;
}

/** The stored entries read as pack entries; anything else is kept as it is. */
function entriesOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isPackEntry(entry: unknown): entry is ContextPackRelatedEntry {
  return !!entry && typeof entry === 'object' && !Array.isArray(entry) && typeof (entry as AnyRec).object === 'string';
}

/** Whether a stored entry names `link`: the same child, and the same field or none. */
export function entryNamesLink(entry: unknown, link: ContextPackLink): boolean {
  if (!isPackEntry(entry) || entry.object !== link.object) return false;
  return entry.field === undefined || entry.field === link.field;
}

/** The link a stored entry resolves to, the way the save-time judge resolves it. */
function resolvedLink(entry: ContextPackRelatedEntry, links: readonly ContextPackLink[]): ContextPackLink | undefined {
  const ofChild = links.filter((l) => l.object === entry.object);
  if (entry.field !== undefined) return ofChild.find((l) => l.field === entry.field);
  return ofChild.length === 1 ? ofChild[0] : undefined;
}

/** `entry` with `fields` replaced; an empty column set removes the key. */
export function withColumns(entry: ContextPackRelatedEntry, columns: readonly string[]): ContextPackRelatedEntry {
  const { fields: _drop, ...rest } = entry;
  return columns.length > 0 ? { ...rest, fields: [...columns] } : (rest as ContextPackRelatedEntry);
}

const ADD_NONE = '';

function linkKey(link: Pick<ContextPackLink, 'object' | 'field'>): string {
  return `${link.object}.${link.field}`;
}

/** One entry's columns: the child object's fields, picked in order. */
function EntryColumns({
  entry,
  maxColumns,
  readOnly,
  onChange,
}: {
  entry: ContextPackRelatedEntry;
  maxColumns: number | undefined;
  readOnly?: boolean;
  onChange: (next: ContextPackRelatedEntry) => void;
}) {
  const locale = useMetadataLocale();
  const { fields, loading, error } = useObjectFields(entry.object);
  const columns = Array.isArray(entry.fields) ? entry.fields.filter((c): c is string => typeof c === 'string') : [];
  const labelFor = (name: string) => fields.find((f) => f.name === name)?.label || name;
  const remaining = fields.filter((f) => !columns.includes(f.name));
  const full = maxColumns !== undefined && columns.length >= maxColumns;
  const placeholder = error
    ? t('engine.form.optionsLoadFailedTitle', locale)
    : loading
      ? t('engine.form.loadingOptions', locale)
      : full
        ? tFormat('engine.form.contextPack.columnsFull', locale, { max: String(maxColumns) })
        : remaining.length
          ? t('engine.form.contextPack.addColumn', locale)
          : t('engine.form.allFieldsAdded', locale);
  return (
    <div className="space-y-1" data-testid={`context-pack-columns-${entry.object}`}>
      {columns.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{t('engine.form.contextPack.columnsDefault', locale)}</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {columns.map((col) => (
            <span
              key={col}
              data-testid={`context-pack-column-${entry.object}-${col}`}
              className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs"
            >
              <span>{labelFor(col)}</span>
              <code className="text-[10px] text-muted-foreground">{col}</code>
              {!readOnly && (
                <button
                  type="button"
                  aria-label={tFormat('engine.form.removeNamed', locale, { name: col })}
                  onClick={() => onChange(withColumns(entry, columns.filter((c) => c !== col)))}
                  className="text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {!readOnly && (
        <Select
          value={ADD_NONE}
          onValueChange={(v) => v && onChange(withColumns(entry, [...columns, v]))}
          disabled={full || loading || !!error || remaining.length === 0}
        >
          <SelectTrigger
            aria-label={tFormat('engine.form.contextPack.addColumnTo', locale, { list: entry.object })}
            data-testid={`context-pack-add-column-${entry.object}`}
            className="h-7 text-xs"
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {remaining.map((f) => (
              <SelectItem key={f.name} value={f.name}>
                <span className="flex items-center gap-2">
                  <span>{f.label || f.name}</span>
                  <code className="text-xs text-muted-foreground">{f.name}</code>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

/** What the object catalog behind the link list can say: an answer, not yet, or nothing. */
export type ContextPackCatalogState = 'ready' | 'loading' | 'error';

/** The metadata context's per-type status, read as the catalog's state (absent = ready). */
export function catalogStateOf(status: string | undefined): ContextPackCatalogState {
  if (status === undefined || status === 'ready') return 'ready';
  return status === 'error' ? 'error' : 'loading';
}

export interface ContextPackRelatedEntriesProps {
  /** The naming props of the block's primary control (the host's `controlNaming`). */
  naming: { id?: string; 'aria-labelledby'?: string; 'aria-required'?: true };
  /** The `related` array's JSON Schema node (its `maxItems`, its entry's `fields.maxItems`). */
  schema: Record<string, any>;
  /** The pack's root object (the draft's `object`). */
  root: string | undefined;
  value: unknown;
  onChange: (v: unknown) => void;
  readOnly?: boolean;
}

export function ContextPackRelatedEntries({ naming, schema, root, value, onChange, readOnly }: ContextPackRelatedEntriesProps) {
  const locale = useMetadataLocale();
  const metadata = useMetadata();
  const objects = metadata.objects;
  // The link catalog is only an answer once the object list has loaded: while
  // it is in flight, or after it failed, "nothing links here" would be false,
  // so no stored entry is marked unlinked and the add picker says why it is
  // empty. Read after `objects`, whose getter starts the load. A context with
  // no `getTypeStatus` is always ready (the field's own contract).
  const catalog = catalogStateOf(metadata.getTypeStatus?.('object'));
  const links = React.useMemo(
    () => (catalog === 'ready' ? contextPackLinks(root, Array.isArray(objects) ? objects : []) : []),
    [root, objects, catalog],
  );
  const entries = entriesOf(value);
  const maxLists = maxItemsOf(schema);
  const maxColumns = maxItemsOf(schema?.items?.properties?.fields);
  const offered = links.filter((l) => !entries.some((e) => entryNamesLink(e, l)));
  const full = maxLists !== undefined && entries.length >= maxLists;

  const write = (next: unknown[]) => onChange(next.length > 0 ? next : undefined);
  const add = (key: string) => {
    const link = links.find((l) => linkKey(l) === key);
    if (!link || full) return;
    write([...entries, { object: link.object, field: link.field }]);
  };
  const replaceAt = (i: number, entry: ContextPackRelatedEntry) => {
    const next = entries.slice();
    next[i] = entry;
    write(next);
  };
  const removeAt = (i: number) => {
    const next = entries.slice();
    next.splice(i, 1);
    write(next);
  };

  const placeholder = !root
    ? t('engine.form.contextPack.chooseRootFirst', locale)
    : catalog === 'loading'
      ? t('engine.form.loadingOptions', locale)
      : catalog === 'error'
        ? t('engine.form.optionsLoadFailedTitle', locale)
        : full
      ? tFormat('engine.form.contextPack.listsFull', locale, { max: String(maxLists) })
      : links.length === 0
        ? t('engine.form.contextPack.noLinks', locale)
        : offered.length === 0
          ? t('engine.form.contextPack.allListed', locale)
          : t('engine.form.contextPack.addList', locale);

  return (
    <div className="space-y-2" data-testid="context-pack-related" data-catalog={catalog}>
      {catalog === 'error' && (
        <div
          data-testid="context-pack-catalog-failed"
          role="status"
          className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"
        >
          <div className="font-medium">{t('engine.form.optionsLoadFailedTitle', locale)}</div>
          <p className="mt-1 text-amber-800">{t('engine.form.optionsLoadFailedDesc', locale)}</p>
        </div>
      )}
      {entries.map((raw, i) => {
        if (!isPackEntry(raw)) {
          // Not a pack entry at all: kept as stored, removable, judged at save.
          return (
            <div key={i} className="flex items-center gap-2 rounded border border-input px-2 py-1 text-xs">
              <code className="flex-1 truncate">{JSON.stringify(raw)}</code>
              {!readOnly && (
                <button
                  type="button"
                  aria-label={tFormat('engine.form.removeNamed', locale, { name: String(i + 1) })}
                  onClick={() => removeAt(i)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              )}
            </div>
          );
        }
        const link = resolvedLink(raw, links);
        return (
          <div
            key={`${raw.object}.${raw.field ?? ''}.${i}`}
            data-testid={`context-pack-entry-${raw.object}`}
            className="space-y-1.5 rounded-md border bg-muted/20 p-2"
          >
            <div className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">
                <span>{link?.objectLabel ?? raw.object}</span>
                <code className="ml-2 text-xs text-muted-foreground">{raw.object}</code>
                {link ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {tFormat('engine.form.contextPack.via', locale, { field: link.fieldLabel })}
                  </span>
                ) : catalog !== 'ready' ? null : (
                  <span
                    data-testid={`context-pack-unlinked-${raw.object}`}
                    className="ml-2 rounded bg-amber-50 px-1 text-[10px] text-amber-800"
                  >
                    {t('engine.form.contextPack.notLinked', locale)}
                  </span>
                )}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  aria-label={tFormat('engine.form.removeNamed', locale, { name: raw.object })}
                  onClick={() => removeAt(i)}
                  className="px-1 text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              )}
            </div>
            <EntryColumns
              entry={raw}
              maxColumns={maxColumns}
              readOnly={readOnly}
              onChange={(next) => replaceAt(i, next)}
            />
          </div>
        );
      })}
      {/* The block's primary control, rendered in every state (disabled when it
          cannot add) so the host's label always names a labelable element. */}
      <Select value={ADD_NONE} onValueChange={add} disabled={readOnly || full || offered.length === 0}>
        <SelectTrigger {...naming} data-testid="context-pack-add-list">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {offered.map((l) => (
            <SelectItem key={linkKey(l)} value={linkKey(l)}>
              <span className="flex items-center gap-2">
                <span>{l.objectLabel}</span>
                <span className="text-xs text-muted-foreground">
                  {tFormat('engine.form.contextPack.via', locale, { field: l.fieldLabel })}
                </span>
                <code className="text-xs text-muted-foreground">{linkKey(l)}</code>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
