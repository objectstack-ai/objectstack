// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ObjectPicker — the one object-name input the Studio inspectors share
 * (objectui#11783): a Lookup's *Related object*, a summary's child object, and
 * every flow reference whose kind is `object` (the trigger's *Object*, a CRUD
 * node's object, a screen's object form, …).
 *
 * ## Why it exists
 *
 * Both object-name inputs it replaces were a native `<input list>` that
 * committed the draft on every keystroke. The committed name is what the
 * inspectors downstream resolve (`useObjectFields` keys on the Lookup's
 * `reference`; `useFlowScope` and the entry-condition builder key on the
 * trigger's `objectName`), so typing one name sent one
 * `GET /meta/object/PREFIX` per keystroke, each a 404. And the datalist listed
 * every served object by bare name, the platform's own plumbing first.
 *
 * ## What it does instead
 *
 * - **Typing is local.** The text the author types lives here until it is
 *   COMMITTED: an option is chosen, Enter is pressed, or the input loses focus.
 *   Only then does `onCommit` run, so the draft — and everything that resolves
 *   the name — sees one value, once.
 * - **The value is still free text.** Enter and blur commit exactly what was
 *   typed, matched or not: a flow reference may hold an expression, and the
 *   server judges an unknown name as it always did. Escape abandons the typing.
 * - **The options are the names already held,** from one list read made when
 *   the picker mounts ({@link useObjectCatalog}), shown with their labels and
 *   in three groups: this package's objects, then the other objects, then the
 *   platform's own objects in a *System* group that starts collapsed. A search
 *   reaches System objects without opening it, because a Lookup to `sys_user`
 *   is a real author need.
 *
 * "System" is the platform's own mark — the served object's `isSystem`
 * (`ObjectSchema` in `@objectstack/spec`) — never a name prefix and never a
 * list kept here.
 *
 * - **At rest it reads as the label (objectui#12303).** While the input does
 *   not have focus, a committed name the catalog knows shows as that object's
 *   label, with the name beneath it as secondary text — smaller, monospace and
 *   muted, and the input's description — the way each option already reads
 *   and the Studio object header shows an object. Focus puts the name back in
 *   the input to edit, and a value the catalog does not know (an expression,
 *   a name not served) shows as itself, in monospace, as before. Display only:
 *   what is committed is always the name.
 *
 * Module-private: imported by its sibling inspectors and the flow header,
 * exported from no barrel.
 */

import * as React from 'react';
import { useParams } from 'react-router-dom';
import { cn, Input, Label } from '@object-ui/components';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMetadataClient } from '../useMetadata.js';
import { usePickerLoad } from '../loadState.js';
import { t, tFormat, useMetadataLocale, type SupportedLocale } from '../i18n.js';

/** One object the picker can offer, read off one served list entry. */
export interface ObjectCatalogEntry {
  name: string;
  /** The authored label; absent when the object declares none. */
  label?: string;
  /** The served `isSystem` mark. */
  isSystem: boolean;
  /** The owning package (`_packageId`), when the entry names one. */
  packageId?: string;
  /** Served from its pending draft (`_draft`), not from the published version. */
  draft: boolean;
}

/**
 * Read one entry of `GET /meta/object?preview=draft`.
 *
 * `isSystem` is `true` only when the entry says so. A runtime-authored body —
 * published or draft — is served as stored and carries no `isSystem` key, and
 * the spec declares the key's default as `false`, so an absent key is the
 * declared default, not a guess.
 */
function readCatalogEntry(raw: unknown): ObjectCatalogEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || !r.name) return null;
  const label = typeof r.label === 'string' && r.label.trim() ? r.label : undefined;
  const packageId = typeof r._packageId === 'string' && r._packageId ? r._packageId : undefined;
  return {
    name: r.name,
    ...(label ? { label } : {}),
    isSystem: r.isSystem === true,
    ...(packageId ? { packageId } : {}),
    draft: r._draft === true,
  };
}

/**
 * The object catalog every picker offers: ONE read, made when the picker
 * mounts and never again while the author types.
 *
 * It reads the draft-overlaid list (`?preview=draft`) rather than the published
 * one plus the draft headers, because that one answer carries what the picker
 * shows for a draft-only object of this package — its own label from its
 * draft, its package and its `_draft` mark — where the draft headers carry the
 * name alone. A caller the server does not admit to pending drafts is answered
 * the published list, which is the list it could pick from anyway.
 *
 * The flow header's Trigger pill names its object through this same read
 * (objectui#13056), so the header and the Start node's picker draw one label.
 */
export function useObjectCatalog() {
  const client = useMetadataClient();
  // The read is asked ONCE per mount. The client is reached through a ref so
  // that a fresh client object (a discarded memo, a test double minted per
  // call) neither re-asks it nor keys anything on its identity (AGENTS.md #10).
  const clientRef = React.useRef(client);
  React.useEffect(() => {
    clientRef.current = client;
  });
  const load = React.useCallback(
    () =>
      clientRef.current
        .withPreviewDrafts(true)
        .list<unknown>('object')
        .then((items) => {
          const byName = new Map<string, ObjectCatalogEntry>();
          for (const raw of items) {
            const entry = readCatalogEntry(raw);
            if (entry && !byName.has(entry.name)) byName.set(entry.name, entry);
          }
          return [...byName.values()];
        }),
    [],
  );
  return usePickerLoad(load);
}

/**
 * The package the author is editing in: Studio's `/studio/:packageId/...`
 * route, else the `?package=` an editor URL carries (ADR-0048), where `all` is
 * the list's "every package" scope and names none.
 */
function useEditingPackageId(): string | undefined {
  const { packageId } = useParams<{ packageId?: string }>();
  if (packageId) return packageId;
  try {
    const p = new URLSearchParams(window.location.search).get('package');
    return p && p !== 'all' ? p : undefined;
  } catch {
    return undefined;
  }
}

type GroupKey = 'package' | 'other' | 'system';

/** The catalog before it answered: one stable empty list, not a fresh one per render. */
const NO_ENTRIES: ObjectCatalogEntry[] = [];

type Row =
  | { kind: 'option'; id: string; entry: ObjectCatalogEntry }
  | { kind: 'system-toggle'; id: string };

interface Section {
  key: GroupKey;
  /** The group's accessible name. */
  name: string;
  /** Whether the name is also drawn as a visible heading. */
  headed: boolean;
  rows: Row[];
}

function displayName(e: ObjectCatalogEntry): string {
  return e.label ?? e.name;
}

function byDisplayName(a: ObjectCatalogEntry, b: ObjectCatalogEntry): number {
  return displayName(a).localeCompare(displayName(b)) || a.name.localeCompare(b.name);
}

export interface ObjectPickerProps {
  /**
   * The visible label this picker renders and associates with its input. Omit
   * it when the caller draws its own label, and pass `ariaLabel` instead.
   */
  label?: string;
  /** The input's accessible name when the picker draws no label of its own. */
  ariaLabel?: string;
  /** The committed name. */
  value: string;
  /** Runs once per commit — a choice, Enter, or blur — never per keystroke. */
  onCommit: (name: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** The designer locale; defaults to the one the designer context carries. */
  locale?: SupportedLocale;
}

export function ObjectPicker({
  label,
  ariaLabel,
  value,
  onCommit,
  disabled,
  placeholder,
  locale: localeProp,
}: ObjectPickerProps) {
  const contextLocale = useMetadataLocale();
  const locale = localeProp ?? contextLocale;
  const catalog = useObjectCatalog();
  const editingPackageId = useEditingPackageId();

  const inputId = React.useId();
  const listId = React.useId();
  const optionIdBase = React.useId();
  const nameLineId = React.useId();

  const [focused, setFocused] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  // What the author is typing. Shown instead of `value` only while the input
  // has focus; nothing outside this component sees it until a commit.
  const [text, setText] = React.useState(value);
  // Whether the author typed since the input took focus: the list filters on
  // the text only then, so focusing a filled input still offers every object.
  const [typed, setTyped] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const [systemOpen, setSystemOpen] = React.useState(false);

  const entries = catalog.status === 'loaded' ? catalog.data : NO_ENTRIES;
  const query = typed ? text.trim().toLowerCase() : '';

  const sections = React.useMemo<Section[]>(() => {
    const matches = (e: ObjectCatalogEntry) =>
      !query || e.name.toLowerCase().includes(query) || (e.label?.toLowerCase().includes(query) ?? false);
    const groupOf = (e: ObjectCatalogEntry): GroupKey =>
      e.isSystem ? 'system' : editingPackageId && e.packageId === editingPackageId ? 'package' : 'other';
    const pick = (g: GroupKey) => entries.filter((e) => groupOf(e) === g).sort(byDisplayName);

    const optionRow = (entry: ObjectCatalogEntry): Row => ({ kind: 'option', id: '', entry });
    const own = pick('package').filter(matches).map(optionRow);
    const other = pick('other').filter(matches).map(optionRow);
    const systemAll = pick('system');
    const packageName = t('engine.inspector.objectPicker.groupPackage', locale);
    const otherName = t('engine.inspector.objectPicker.groupOther', locale);
    const systemName = t('engine.inspector.objectPicker.groupSystem', locale);
    const out: Section[] = [];
    if (own.length) out.push({ key: 'package', name: packageName, headed: true, rows: own });
    // With no package group above it, the other objects are simply the list,
    // and draw no heading.
    if (other.length) out.push({ key: 'other', name: otherName, headed: own.length > 0, rows: other });
    if (query) {
      const found = systemAll.filter(matches).map(optionRow);
      if (found.length) out.push({ key: 'system', name: systemName, headed: true, rows: found });
    } else if (systemAll.length) {
      out.push({
        key: 'system',
        name: systemName,
        headed: false,
        rows: [{ kind: 'system-toggle', id: '' }, ...(systemOpen ? systemAll.map(optionRow) : [])],
      });
    }
    let i = 0;
    for (const s of out) for (const r of s.rows) r.id = `${optionIdBase}-${i++}`;
    return out;
  }, [entries, query, editingPackageId, systemOpen, locale, optionIdBase]);

  const rows = React.useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const systemCount = React.useMemo(() => entries.filter((e) => e.isSystem).length, [entries]);
  const activeRow = active >= 0 ? rows[active] : undefined;

  const activeId = activeRow?.id;
  React.useEffect(() => {
    if (!activeId) return;
    document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  const close = () => {
    setOpen(false);
    setActive(-1);
    setTyped(false);
  };

  /** The one door to `onCommit`; an unchanged value is not a commit. */
  const commit = (next: string) => {
    setText(next);
    close();
    if (next !== value) onCommit(next);
  };

  const choose = (row: Row) => {
    if (row.kind === 'system-toggle') {
      setSystemOpen((o) => !o);
      return;
    }
    commit(row.entry.name);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && activeRow) choose(activeRow);
      else if (typed) commit(text);
      else close();
    } else if (e.key === 'Escape' && open) {
      // Handled here, so the inspector does not read it as "clear selection".
      e.preventDefault();
      e.stopPropagation();
      setText(value);
      close();
    }
  };

  // At rest, a name the catalog knows reads as its label; the name is the
  // secondary line under the input (objectui#12303).
  const restingLabel = focused ? undefined : entries.find((e) => e.name === value)?.label;
  const shown = focused ? text : (restingLabel ?? value);
  const listLabel = label ?? ariaLabel;

  return (
    <div className="space-y-1">
      {label && (
        <Label htmlFor={inputId} className="text-xs text-muted-foreground">
          {label}
        </Label>
      )}
      <div className="relative">
        <Input
          id={inputId}
          role="combobox"
          aria-label={label ? undefined : ariaLabel}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && activeRow ? activeRow.id : undefined}
          aria-describedby={restingLabel ? nameLineId : undefined}
          autoComplete="off"
          spellCheck={false}
          value={shown}
          disabled={disabled}
          placeholder={placeholder}
          className={cn('h-8 text-sm', !restingLabel && 'font-mono')}
          onFocus={() => {
            setFocused(true);
            setText(value);
            setTyped(false);
            setActive(-1);
            setOpen(true);
          }}
          onChange={(e) => {
            setText(e.target.value);
            setTyped(true);
            setActive(-1);
            setOpen(true);
          }}
          onBlur={() => {
            setFocused(false);
            // Only what the author typed is committed: a focus that typed
            // nothing must not write back a value that moved underneath it.
            if (typed) commit(text);
            else close();
          }}
          onKeyDown={onKeyDown}
        />
        {open && catalog.status !== 'error' && (
          <div
            id={listId}
            role="listbox"
            aria-label={listLabel}
            // Keep focus in the input, so choosing an option is not first a blur.
            onMouseDown={(e) => e.preventDefault()}
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {catalog.status === 'loading' && (
              <p className="px-2 py-1.5 text-[11px] text-muted-foreground">{t('engine.form.loadingOptions', locale)}</p>
            )}
            {catalog.status === 'loaded' && rows.length === 0 && (
              <p className="px-2 py-1.5 text-[11px] text-muted-foreground">{t('engine.inspector.objectPicker.noMatch', locale)}</p>
            )}
            {sections.map((s) => (
              <div key={s.key} role="group" aria-label={s.name}>
                {s.headed && (
                  <div aria-hidden className="px-2 pb-0.5 pt-1.5 text-[11px] font-medium text-muted-foreground">
                    {s.name}
                  </div>
                )}
                {s.rows.map((row) => {
                  const isActive = activeRow?.id === row.id;
                  if (row.kind === 'system-toggle') {
                    const Chevron = systemOpen ? ChevronDown : ChevronRight;
                    return (
                      <div
                        key={row.id}
                        id={row.id}
                        role="option"
                        aria-selected={isActive}
                        data-system-toggle=""
                        onClick={() => choose(row)}
                        className={cn(
                          'flex cursor-pointer items-center gap-1 rounded-sm px-2 py-1 text-[11px] font-medium text-muted-foreground',
                          isActive && 'bg-accent text-accent-foreground',
                        )}
                      >
                        <Chevron className="h-3 w-3 shrink-0" />
                        {systemOpen
                          ? t('engine.inspector.objectPicker.hideSystem', locale)
                          : tFormat('engine.inspector.objectPicker.showSystem', locale, { count: systemCount })}
                      </div>
                    );
                  }
                  const { entry } = row;
                  return (
                    <div
                      key={row.id}
                      id={row.id}
                      role="option"
                      aria-selected={isActive}
                      data-object-name={entry.name}
                      onClick={() => choose(row)}
                      className={cn(
                        'flex cursor-pointer flex-col rounded-sm px-2 py-1',
                        isActive && 'bg-accent text-accent-foreground',
                        entry.name === value && 'font-medium',
                      )}
                    >
                      {/* Two lines, so neither the label nor the name is cut
                          short in a narrow inspector. Explicit spaces between
                          the parts: each is its own element, so without them
                          the option's accessible name reads as one run-on word. */}
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="min-w-0 truncate text-sm">{displayName(entry)}</span>
                        {entry.draft && (
                          <>
                            {' '}
                            <span data-draft-marker="" className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                              {t('engine.inspector.draftSuffix', locale)}
                            </span>
                          </>
                        )}
                      </span>
                      {entry.label && (
                        <>
                          {' '}
                          <span className="truncate font-mono text-[11px] text-muted-foreground">{entry.name}</span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
      {restingLabel && (
        <p id={nameLineId} data-object-name-line="" className="truncate font-mono text-[10px] leading-tight text-muted-foreground">
          {value}
        </p>
      )}
      {catalog.status === 'error' && (
        <p role="status" className="text-[11px] leading-snug text-amber-600 dark:text-amber-300">
          {t('engine.form.optionsLoadFailedTitle', locale)}
          {catalog.message ? (
            <>
              {' '}
              <span className="break-words font-mono text-[10px] opacity-80">{catalog.message}</span>
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}
