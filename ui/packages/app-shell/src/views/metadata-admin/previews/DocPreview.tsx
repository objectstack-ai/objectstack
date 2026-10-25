// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DocPreview — the Studio editor for a `doc` metadata item (ADR-0046): a
 * Markdown source pane beside a live preview, plus the doc's placement in a
 * `book` and its per-locale variants (objectui#10188).
 *
 * ## Why this is the `doc` type's Preview, not a second editing path
 *
 * `doc` is edited by the generic metadata-admin engine like every other type:
 * `ResourceEditPage` loads it, its inspector renders the served JSON Schema
 * for the header keys (`name`, `label`, `description`, `order`, `tags`), and
 * Save goes through the one metadata write door (`PUT /meta/doc/:name`, which
 * admits a runtime-created doc — the registry row carries
 * `allowRuntimeCreate: true`). This component only takes the canvas half of
 * that page, the way the object designer takes `fields`: it owns `content`,
 * `translations` and `group` (see `CANVAS_OWNED_KEYS` in `ResourceEditPage`),
 * and every edit is an `onPatch` into the same draft the Save button sends.
 *
 * ## The keys it writes are the spec's, and only the spec's
 *
 * `DocSchema` (`@objectstack/spec/system`) declares no `title` and no `locale`
 * key: the display title is `label` (`title` is a refused alias of it), and a
 * locale variant is an entry of `translations` — `{ label?, description?,
 * content }` keyed by locale, with the base doc as the fallback the REST layer
 * collapses to. So the locale switcher below edits `translations[locale]`, and
 * a new variant starts as a copy of the base body: a variant whose `content`
 * is empty is served to that locale's readers as an empty page.
 *
 * ## Assigning a doc to a book is a doc-side write
 *
 * A book stores no members (ADR-0046 §6.2.1): membership is DERIVED from each
 * group's `include` rule plus the doc's own explicit `group` key. So placing
 * this doc in a book writes `doc.group` — no book write exists or is needed.
 * The readout under the picker is computed by the spec's own resolver
 * (`resolveBookTree`) over this one doc, so it also reports a placement a
 * group's name/tag rule makes without any explicit `group`. A group key is not
 * book-scoped: every book with a group of that key claims the doc, which is
 * why the readout lists every book it lands in rather than the one picked.
 *
 * ## The preview is the portal's renderer
 *
 * The rendered half goes through `SchemaRenderer` as `{ type: 'markdown' }` —
 * the registry entry `@object-ui/plugin-markdown` provides and the docs portal
 * (`DocPage`) renders with — so this package takes no dependency on the
 * plugin, and what the author sees is what the portal draws. Links inside the
 * preview are not followed: a click there would navigate away from the draft.
 */

import * as React from 'react';
import { BookOpen, FileText, Globe, Languages, Plus, X } from 'lucide-react';
import { SchemaRenderer } from '@object-ui/react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';
import type { MetadataPreviewProps } from '../preview-registry.js';
import { useMetadataClient } from '../useMetadata.js';
import { t as tr, tFormat } from '../i18n.js';
import { PreviewShell, PreviewErrorBoundary } from './PreviewShell.js';
import {
  BASE_LOCALE,
  localeRefusal,
  patchAddLocale,
  patchRemoveLocale,
  patchSource,
  patchVariantField,
  readTranslations,
  resolvePlacements,
  sourceFor,
  toBookOptions,
  type BookOption,
} from './doc-draft.js';

type BooksState =
  | { status: 'loading' }
  | { status: 'loaded'; books: BookOption[] }
  | { status: 'error'; message: string };

/** The listed books, with a load failure kept distinct from "no books". */
function useBooks(): BooksState {
  const client = useMetadataClient();
  const [state, setState] = React.useState<BooksState>({ status: 'loading' });
  React.useEffect(() => {
    let cancelled = false;
    client
      .list<unknown>('book')
      .then((rows) => {
        if (!cancelled) setState({ status: 'loaded', books: toBookOptions(rows ?? []) });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [client]);
  return state;
}

/** The item a stored `group` none of the options carries is shown by. */
const OUTSIDE_OPTIONS = 'outside';

/** One option of the book-section picker: a group key and what it is called. */
interface SectionOption {
  value: string;
  label: string;
}

/**
 * objectui#11865 — the book-section picker, drawn with the shared `Select`, the
 * control the rest of the designer picks with. It used to be a browser-native
 * select element, one optgroup per book. What a pick writes is unchanged:
 * `onPick` receives the picked option's own value (`''` for "not placed in a
 * section", else the group key), the string the native control's `change`
 * carried, and re-picking the current option writes nothing, as it did there.
 *
 * - Items carry their option's INDEX, not its value: "not placed" is `''`,
 *   which `SelectItem` refuses, and a group key is not book-scoped, so two
 *   books can offer the same key. The trigger shows the first option that
 *   carries the stored key, the one the native control selected.
 * - Each book is a `SelectGroup` headed by a `SelectLabel`, where the native
 *   control had an optgroup.
 * - A stored key none of the options carries gets an item of its own, labelled
 *   `outsideLabel`. Once the books are listed the caller says the key is in no
 *   book; while they load, or when they fail to, it is the key itself. The
 *   native control showed "not placed in a section" in those two states.
 *   Picking that item writes nothing.
 * - `id` lands on the trigger, so the caller's `<label htmlFor>` names it as it
 *   named the native control, and `disabled` is the primitive's own.
 */
function BookSectionPicker({
  id,
  value,
  none,
  books,
  outsideLabel,
  disabled,
  onPick,
}: {
  id: string;
  value: string;
  none: SectionOption;
  books: ReadonlyArray<{ name: string; label: string; options: ReadonlyArray<SectionOption> }>;
  outsideLabel: string;
  disabled: boolean;
  onPick: (value: string) => void;
}) {
  const options = [none, ...books.flatMap((b) => b.options)];
  const at = options.findIndex((o) => o.value === value);
  return (
    <Select
      value={at !== -1 ? String(at) : OUTSIDE_OPTIONS}
      disabled={disabled}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the stored key, so there is nothing to write.
        const picked = options[Number(token)];
        if (picked) onPick(picked.value);
      }}
    >
      <SelectTrigger id={id} className="h-7 w-auto max-w-[280px] gap-1 px-2 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="0">{none.label}</SelectItem>
        {books.map((b) => (
          <SelectGroup key={b.name}>
            <SelectLabel>{b.label}</SelectLabel>
            {b.options.map((o) => (
              <SelectItem key={`${b.name}:${o.value}`} value={String(options.indexOf(o))}>
                {o.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
        {at === -1 && <SelectItem value={OUTSIDE_OPTIONS}>{outsideLabel}</SelectItem>}
      </SelectContent>
    </Select>
  );
}

const inputCls = 'h-7 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring';

export function DocPreview({ draft, onPatch, editing, locale, diagnostics }: MetadataPreviewProps) {
  const d = (draft ?? {}) as Record<string, unknown>;
  const canEdit = !!editing && !!onPatch;
  const translations = readTranslations(d);
  const variantLocales = Object.keys(translations).sort();

  const [activeLocale, setActiveLocale] = React.useState<string>(BASE_LOCALE);
  // A variant removed elsewhere (Source tab, reset) falls back to the base doc.
  const shownLocale =
    activeLocale === BASE_LOCALE || variantLocales.includes(activeLocale) ? activeLocale : BASE_LOCALE;
  const [newLocale, setNewLocale] = React.useState('');
  const newLocaleRefusal = newLocale.trim() ? localeRefusal(d, newLocale.trim()) : null;

  const source = sourceFor(d, shownLocale);
  const books = useBooks();
  const group = typeof d.group === 'string' ? d.group : '';
  const placements = books.status === 'loaded' ? resolvePlacements(d, books.books) : [];

  const patch = (p: Record<string, unknown>) => onPatch?.(p);

  const addLocale = () => {
    const tag = newLocale.trim();
    if (!tag || localeRefusal(d, tag)) return;
    patch(patchAddLocale(d, tag));
    setActiveLocale(tag);
    setNewLocale('');
  };

  // Server diagnostics on the keys this canvas owns (hidden from the form), so
  // a refusal naming them is visible next to the text it is about.
  const ownIssues = (diagnostics ?? []).filter((i) =>
    /^(content|translations|group)(\.|$)/.test(i.path ?? ''),
  );

  const placementControl = (
    <div className="flex flex-wrap items-center gap-2">
      <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
      <label htmlFor="doc-book-section" className="text-xs text-muted-foreground shrink-0">
        {tr('engine.docPreview.bookSection', locale)}
      </label>
      <BookSectionPicker
        id="doc-book-section"
        value={group}
        none={{ value: '', label: tr('engine.docPreview.noSection', locale) }}
        books={
          books.status === 'loaded'
            ? books.books.map((b) => ({
                name: b.name,
                label: b.label,
                options: b.groups.map((g) => ({ value: g.key, label: g.label })),
              }))
            : []
        }
        outsideLabel={
          books.status === 'loaded' ? tFormat('engine.docPreview.unknownSection', locale, { key: group }) : group
        }
        disabled={!canEdit}
        onPick={(v) => patch({ group: v || undefined })}
      />
    </div>
  );

  const placementReadout =
    books.status === 'loading' ? (
      <span>{tr('engine.docPreview.booksLoading', locale)}</span>
    ) : books.status === 'error' ? (
      <span role="alert" className="text-destructive">
        {tFormat('engine.docPreview.booksFailed', locale, { message: books.message })}
      </span>
    ) : placements.length > 0 ? (
      <span data-testid="doc-placement">
        {tr('engine.docPreview.appearsIn', locale)}{' '}
        {placements.map((p, i) => (
          <React.Fragment key={`${p.book}:${p.group}`}>
            {i > 0 && ', '}
            <span className="font-medium text-foreground/80">
              {p.bookLabel} › {p.group}
            </span>
            {p.public && (
              <span className="ml-1 inline-flex items-center gap-0.5 text-amber-700 dark:text-amber-300">
                <Globe className="h-3 w-3" aria-hidden />
                {tr('engine.docPreview.publicBook', locale)}
              </span>
            )}
          </React.Fragment>
        ))}
      </span>
    ) : (
      <span data-testid="doc-placement">
        {books.books.length === 0 ? tr('engine.docPreview.noBooks', locale) : tr('engine.docPreview.unplaced', locale)}
      </span>
    );

  const localeBar = (
    <div className="flex flex-wrap items-center gap-1.5">
      <Languages className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
      <div role="tablist" aria-label={tr('engine.docPreview.locales', locale)} className="flex flex-wrap items-center gap-1">
        {[BASE_LOCALE, ...variantLocales].map((loc) => (
          <span key={loc || '(base)'} className="inline-flex items-center">
            <button
              type="button"
              role="tab"
              aria-selected={shownLocale === loc}
              onClick={() => setActiveLocale(loc)}
              className={
                'rounded px-2 py-0.5 text-xs border transition-colors ' +
                (shownLocale === loc
                  ? 'bg-background shadow-sm text-foreground border-border'
                  : 'text-muted-foreground border-transparent hover:text-foreground')
              }
            >
              {loc === BASE_LOCALE ? tr('engine.docPreview.baseLocale', locale) : loc}
            </button>
            {canEdit && loc !== BASE_LOCALE && (
              <button
                type="button"
                aria-label={tFormat('engine.docPreview.removeLocale', locale, { locale: loc })}
                title={tFormat('engine.docPreview.removeLocale', locale, { locale: loc })}
                onClick={() => {
                  patch(patchRemoveLocale(d, loc));
                  if (shownLocale === loc) setActiveLocale(BASE_LOCALE);
                }}
                className="ml-0.5 rounded p-0.5 text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
      </div>
      {canEdit && (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            addLocale();
          }}
        >
          <input
            value={newLocale}
            onChange={(e) => setNewLocale(e.target.value)}
            placeholder={tr('engine.docPreview.localePlaceholder', locale)}
            aria-label={tr('engine.docPreview.addLocaleInput', locale)}
            aria-invalid={newLocaleRefusal ? true : undefined}
            className={`${inputCls} w-24`}
          />
          <button
            type="submit"
            disabled={!newLocale.trim() || !!newLocaleRefusal}
            className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs disabled:opacity-50"
          >
            <Plus className="h-3 w-3" aria-hidden />
            {tr('engine.docPreview.addLocale', locale)}
          </button>
          {newLocaleRefusal && (
            <span role="alert" className="text-[11px] text-destructive">
              {newLocaleRefusal === 'duplicate'
                ? tFormat('engine.docPreview.localeDuplicate', locale, { locale: newLocale.trim() })
                : tr('engine.docPreview.localeInvalid', locale)}
            </span>
          )}
        </form>
      )}
    </div>
  );

  const variant = shownLocale === BASE_LOCALE ? undefined : translations[shownLocale];
  const variantFields = variant && canEdit && (
    <div className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5 bg-muted/10">
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        {tr('engine.docPreview.variantTitle', locale)}
        <input
          value={variant.label ?? ''}
          onChange={(e) => patch(patchVariantField(d, shownLocale, 'label', e.target.value))}
          placeholder={typeof d.label === 'string' ? d.label : ''}
          className={`${inputCls} w-48`}
        />
      </label>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        {tr('engine.docPreview.variantSummary', locale)}
        <input
          value={variant.description ?? ''}
          onChange={(e) => patch(patchVariantField(d, shownLocale, 'description', e.target.value))}
          placeholder={typeof d.description === 'string' ? d.description : ''}
          className={`${inputCls} w-64`}
        />
      </label>
    </div>
  );

  const previewPane = (
    <section
      aria-label={tr('engine.docPreview.preview', locale)}
      className="h-full min-h-[260px] overflow-auto p-4"
      // Links render but are not followed: a click would leave the draft.
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest('a')) e.preventDefault();
      }}
    >
      {source.trim() ? (
        <PreviewErrorBoundary fallbackHint={tr('engine.docPreview.renderFailed', locale)}>
          <SchemaRenderer schema={{ type: 'markdown', content: source } as never} />
        </PreviewErrorBoundary>
      ) : (
        <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground">
          <FileText className="h-6 w-6 opacity-50" aria-hidden />
          {tr(canEdit ? 'engine.docPreview.emptyEditing' : 'engine.docPreview.empty', locale)}
        </div>
      )}
    </section>
  );

  return (
    <PreviewShell hint="doc · markdown">
      <div className="flex h-full flex-col">
        <div className="space-y-1.5 border-b px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {placementControl}
            {localeBar}
          </div>
          <div className="text-[11px] text-muted-foreground">{placementReadout}</div>
        </div>
        {variantFields}
        {ownIssues.length > 0 && (
          <ul className="border-b bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
            {ownIssues.map((i, n) => (
              <li key={n}>
                {i.path ? <code className="font-mono mr-1">{i.path}</code> : null}
                {i.message}
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <div className="grid flex-1 min-h-0 grid-cols-1 divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            <textarea
              value={source}
              onChange={(e) => patch(patchSource(d, shownLocale, e.target.value))}
              spellCheck={false}
              aria-label={
                shownLocale === BASE_LOCALE
                  ? tr('engine.docPreview.source', locale)
                  : tFormat('engine.docPreview.sourceLocale', locale, { locale: shownLocale })
              }
              placeholder={tr('engine.docPreview.sourcePlaceholder', locale)}
              className="h-full min-h-[260px] w-full resize-none bg-background p-3 font-mono text-xs leading-relaxed outline-none"
            />
            {previewPane}
          </div>
        ) : (
          <div className="flex-1 min-h-0">{previewPane}</div>
        )}
      </div>
    </PreviewShell>
  );
}

export default DocPreview;
