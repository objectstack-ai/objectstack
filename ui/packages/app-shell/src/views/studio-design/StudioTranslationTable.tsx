// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30285 — the translation item's editor in Studio: one language,
 * a row per string the package declares, its source text beside the
 * translation, a filter for what is still untranslated and a count of it. The
 * rows and what counts as translated are `translationTable.ts`'s.
 *
 * Every edit writes the item's own JSON at the row's key, the shape the JSON
 * editor writes, so saving sends the same `translation` item to the same
 * place: this editor changes how the item is edited, not what is stored
 * (ADR-0146 D2). What the table does not list stays editable as JSON below it.
 */

import * as React from 'react';
import { Input, Switch, Textarea, cn } from '@object-ui/components';
import { useAdapter } from '@object-ui/react';
import { collectExpectedEntries, type ExpectedEntry } from '@objectstack/lint';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';
import { t, tFormat } from '../metadata-admin/i18n.js';
import {
  buildTranslationRows,
  countUntranslated,
  readDeclaredStack,
  writeTranslationAt,
  type DeclaredStackClient,
  type TranslationRow,
} from './translationTable.js';

type Dict = Record<string, unknown>;

/** The item's own keys, which the table and the JSON view leave to the form above them. */
const IDENTITY_KEYS = new Set(['name', 'label', 'locale', 'description', 'overrides']);

/** The kinds a row can be, by the walk's `source`; a kind with no entry shows its id. */
const KIND_KEYS = new Set([
  'object',
  'field',
  'option',
  'section',
  'view',
  'action',
  'globalAction',
  'app',
  'navigation',
  'dashboard',
  'widget',
  'dataset',
  'report',
  'picklist',
  'page',
  'flow',
  'hook',
  'position',
  'permission',
  'book',
]);

export interface StudioTranslationTableProps {
  /** The package whose declarations are listed. */
  packageId: string;
  /** The translation item as edited. */
  draft: Dict;
  onChange: (next: Dict) => void;
  readOnly: boolean;
  /** The designer's language, the one this editor's own words read in. */
  locale: string;
  /** Test seam: the walk over the package. Defaults to the declared-stack read and `@objectstack/lint`. */
  readEntries?: (onProgress: (done: number, total: number) => void) => Promise<ExpectedEntry[]>;
  /** Test seam: the language's served translations, `null` when unknown. Defaults to the SDK's i18n read. */
  readServed?: (bundleLocale: string) => Promise<Dict | null>;
}

type EntriesState =
  | { status: 'reading'; done: number; total: number }
  | { status: 'ready'; entries: ExpectedEntry[] }
  | { status: 'error' };

function useDefaultReaders(packageId: string) {
  const client = useMetadataClient();
  const adapter = useAdapter() as { getClient?: () => { i18n?: { getTranslations?: (l: string) => Promise<unknown> } } } | null;
  const readEntries = React.useCallback(
    async (onProgress: (done: number, total: number) => void) => {
      const { stack } = await readDeclaredStack(client as unknown as DeclaredStackClient, packageId, onProgress);
      return collectExpectedEntries(stack);
    },
    [client, packageId],
  );
  const readServed = React.useCallback(
    async (bundleLocale: string): Promise<Dict | null> => {
      const read = adapter?.getClient?.()?.i18n?.getTranslations;
      if (!read) return null;
      const answer = (await read(bundleLocale)) as { locale?: unknown; translations?: unknown } | null;
      // A fallback language is not this one: what it serves translates nothing here.
      if (!answer || answer.locale !== bundleLocale) return null;
      const tree = answer.translations;
      return tree && typeof tree === 'object' ? (tree as Dict) : null;
    },
    [adapter],
  );
  return { readEntries, readServed };
}

export function StudioTranslationTable({
  packageId,
  draft,
  onChange,
  readOnly,
  locale,
  readEntries: readEntriesProp,
  readServed: readServedProp,
}: StudioTranslationTableProps): React.ReactElement {
  const defaults = useDefaultReaders(packageId);
  const readEntries = readEntriesProp ?? defaults.readEntries;
  const readServed = readServedProp ?? defaults.readServed;
  const bundleLocale = typeof draft.locale === 'string' ? draft.locale : '';

  const [entriesState, setEntriesState] = React.useState<EntriesState>({ status: 'reading', done: 0, total: 0 });
  const [readNonce, setReadNonce] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    setEntriesState({ status: 'reading', done: 0, total: 0 });
    readEntries((done, total) => {
      if (!cancelled) setEntriesState({ status: 'reading', done, total });
    }).then(
      (entries) => {
        if (!cancelled) setEntriesState({ status: 'ready', entries });
      },
      () => {
        if (!cancelled) setEntriesState({ status: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [readEntries, readNonce]);

  const [served, setServed] = React.useState<{ locale: string; tree: Dict | null; failed: boolean } | null>(null);
  React.useEffect(() => {
    if (!bundleLocale) return;
    let cancelled = false;
    readServed(bundleLocale).then(
      (tree) => {
        if (!cancelled) setServed({ locale: bundleLocale, tree, failed: false });
      },
      () => {
        if (!cancelled) setServed({ locale: bundleLocale, tree: null, failed: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [readServed, bundleLocale]);
  const servedTree = served && served.locale === bundleLocale ? served.tree : null;

  const rows = React.useMemo(
    () => (entriesState.status === 'ready' ? buildTranslationRows(entriesState.entries, draft, servedTree, bundleLocale) : []),
    [entriesState, draft, servedTree, bundleLocale],
  );
  const { untranslated, total } = countUntranslated(rows);
  const [onlyMissing, setOnlyMissing] = React.useState(false);
  const shown = onlyMissing ? rows.filter((row) => row.status === 'missing') : rows;
  const groups = React.useMemo(() => {
    const out = new Map<string, TranslationRow[]>();
    for (const row of shown) {
      const list = out.get(row.groupKey);
      if (list) list.push(row);
      else out.set(row.groupKey, [row]);
    }
    return [...out.entries()];
  }, [shown]);

  const setValue = React.useCallback(
    (path: readonly string[], value: string) => onChange(writeTranslationAt(draft, path, value)),
    [draft, onChange],
  );

  return (
    <div className="space-y-3" data-testid="studio-translation-table">
      <div className="flex flex-wrap items-center gap-3">
        {entriesState.status === 'ready' && (
          <p
            data-testid="studio-translation-count"
            data-untranslated={untranslated}
            data-total={total}
            className="text-sm font-medium"
          >
            {tFormat('engine.studio.translationTable.count', locale, { untranslated, total })}
          </p>
        )}
        <label className="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Switch
            data-testid="studio-translation-only-missing"
            checked={onlyMissing}
            onCheckedChange={setOnlyMissing}
            disabled={entriesState.status !== 'ready'}
          />
          {t('engine.studio.translationTable.onlyMissing', locale)}
        </label>
      </div>
      {served?.failed && served.locale === bundleLocale && (
        <p role="note" className="text-xs text-muted-foreground" data-testid="studio-translation-served-unread">
          {tFormat('engine.studio.translationTable.servedUnread', locale, { locale: bundleLocale })}
        </p>
      )}

      {entriesState.status === 'reading' ? (
        <p role="status" className="text-sm text-muted-foreground" data-testid="studio-translation-reading">
          {entriesState.total > 0
            ? tFormat('engine.studio.translationTable.readingCount', locale, {
                done: entriesState.done,
                total: entriesState.total,
              })
            : t('engine.studio.translationTable.reading', locale)}
        </p>
      ) : entriesState.status === 'error' ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="studio-translation-read-error">
          <p role="alert" className="text-destructive">
            {t('engine.studio.translationTable.readError', locale)}
          </p>
          <button
            type="button"
            onClick={() => setReadNonce((n) => n + 1)}
            className="inline-flex h-7 items-center rounded-md border bg-background px-2 text-xs font-medium hover:bg-muted"
          >
            {t('engine.studio.translationTable.retry', locale)}
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="studio-translation-empty">
          {t('engine.studio.translationTable.empty', locale)}
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="studio-translation-none-missing">
          {t('engine.studio.translationTable.noneMissing', locale)}
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map(([groupKey, groupRows]) => (
            <TranslationGroup
              key={groupKey}
              groupKey={groupKey}
              rows={groupRows}
              bundleLocale={bundleLocale}
              locale={locale}
              readOnly={readOnly}
              onValue={setValue}
            />
          ))}
        </div>
      )}

      <TranslationJsonView draft={draft} onChange={onChange} readOnly={readOnly} locale={locale} />
    </div>
  );
}

function TranslationGroup({
  groupKey,
  rows,
  bundleLocale,
  locale,
  readOnly,
  onValue,
}: {
  groupKey: string;
  rows: TranslationRow[];
  bundleLocale: string;
  locale: string;
  readOnly: boolean;
  onValue: (path: readonly string[], value: string) => void;
}): React.ReactElement {
  const [group, item = ''] = groupKey.split('.');
  // The item's own label row names it, as the package declares it.
  const named = rows.find((row) => row.path.length === 3 && row.path[2] === 'label')?.sourceText;
  const missing = rows.filter((row) => row.status === 'missing').length;
  return (
    <section data-testid="studio-translation-group" data-group={groupKey} className="rounded-md border">
      <header className="flex flex-wrap items-baseline gap-2 border-b bg-muted/40 px-3 py-1.5">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {t(`engine.translationPreview.category.${group}`, locale)}
        </span>
        <span className="text-sm font-medium">{named || item}</span>
        {named && named !== item && <code className="font-mono text-[11px] text-muted-foreground">{item}</code>}
        {missing > 0 && (
          <span className="ml-auto text-[11px] text-amber-700 dark:text-amber-300">
            {tFormat('engine.studio.translationTable.groupMissing', locale, { count: missing })}
          </span>
        )}
      </header>
      <table className="w-full table-fixed text-sm">
        <thead className="sr-only">
          <tr>
            <th scope="col">{t('engine.studio.translationTable.col.source', locale)}</th>
            <th scope="col">{tFormat('engine.studio.translationTable.col.translation', locale, { locale: bundleLocale })}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <TranslationRowView key={row.key} row={row} locale={locale} readOnly={readOnly} onValue={onValue} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function TranslationRowView({
  row,
  locale,
  readOnly,
  onValue,
}: {
  row: TranslationRow;
  locale: string;
  readOnly: boolean;
  onValue: (path: readonly string[], value: string) => void;
}): React.ReactElement {
  const kindKey = KIND_KEYS.has(row.kind) ? `engine.studio.translationTable.kind.${row.kind}` : null;
  const statusLabel = t(`engine.studio.translationTable.status.${row.status}`, locale);
  return (
    <tr data-testid="studio-translation-row" data-key={row.key} data-state={row.status} className="border-t first:border-t-0">
      <td className="w-1/2 px-3 py-1.5 align-top">
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
            {kindKey ? t(kindKey, locale) : row.kind}
          </span>
          <span className="min-w-0 break-words">{row.sourceText}</span>
        </div>
        <code className="block truncate font-mono text-[10px] text-muted-foreground" title={row.key}>
          {row.path.slice(2).join('.')}
        </code>
      </td>
      <td className="w-1/2 px-3 py-1.5 align-top">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            title={statusLabel}
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              row.status === 'missing' ? 'bg-amber-500' : row.status === 'here' ? 'bg-emerald-500' : 'bg-sky-500',
            )}
          />
          <Input
            data-testid="studio-translation-input"
            aria-label={`${row.sourceText} (${statusLabel})`}
            value={row.value}
            placeholder={row.served ?? ''}
            readOnly={readOnly}
            onChange={(e) => onValue(row.path, e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        {row.status === 'elsewhere' && row.served && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={row.served}>
            {tFormat('engine.studio.translationTable.servedElsewhere', locale, { text: row.served })}
          </p>
        )}
      </td>
    </tr>
  );
}

/** The item's translation groups as JSON: what the table does not list is edited here. */
function TranslationJsonView({
  draft,
  onChange,
  readOnly,
  locale,
}: {
  draft: Dict;
  onChange: (next: Dict) => void;
  readOnly: boolean;
  locale: string;
}): React.ReactElement {
  const groups = React.useMemo(() => {
    const out: Dict = {};
    for (const [key, value] of Object.entries(draft)) {
      if (!IDENTITY_KEYS.has(key) && !key.startsWith('_')) out[key] = value;
    }
    return out;
  }, [draft]);
  const shownJson = JSON.stringify(groups, null, 2);
  const [text, setText] = React.useState(shownJson);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  // Follows the table's edits while the author is not typing here.
  React.useEffect(() => {
    if (!editing) {
      setText(shownJson);
      setError(null);
    }
  }, [shownJson, editing]);
  const apply = (next: string) => {
    setText(next);
    let parsed: unknown;
    try {
      parsed = JSON.parse(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setError(t('engine.studio.translationTable.jsonNotObject', locale));
      return;
    }
    setError(null);
    const identity: Dict = {};
    for (const [key, value] of Object.entries(draft)) {
      if (IDENTITY_KEYS.has(key) || key.startsWith('_')) identity[key] = value;
    }
    onChange({ ...identity, ...(parsed as Dict) });
  };
  return (
    <details className="rounded-md border" data-testid="studio-translation-json">
      <summary className="cursor-pointer select-none px-3 py-1.5 text-xs font-medium">
        {t('engine.studio.translationTable.advanced', locale)}
      </summary>
      <div className="space-y-1 border-t p-3">
        <p className="text-xs text-muted-foreground">{t('engine.studio.translationTable.advancedHint', locale)}</p>
        <Textarea
          data-testid="studio-translation-json-input"
          aria-label={t('engine.studio.translationTable.advanced', locale)}
          rows={14}
          className="font-mono text-xs"
          value={text}
          readOnly={readOnly}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onChange={(e) => apply(e.target.value)}
        />
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {tFormat('engine.studio.translationTable.jsonInvalid', locale, { error })}
          </p>
        )}
      </div>
    </details>
  );
}
