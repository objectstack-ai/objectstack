// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `doc` editor's draft arithmetic (objectui#10188) — pure functions, no
 * React, so `DocPreview.tsx` exports its component alone. Every patch these
 * return writes only keys `DocSchema` (`@objectstack/spec/system`) declares;
 * `DocPreview.tsx`'s header says why each key is spelled the way it is.
 */

import { resolveBookTree, type Book } from '@objectstack/spec/system';

/** One per-locale variant, as `DocSchema.translations` declares it. */
export interface DocVariant {
  label?: string;
  description?: string;
  content: string;
}

/** The base doc is edited when no variant is selected. */
export const BASE_LOCALE = '';

/**
 * A BCP-47-shaped tag (`zh`, `zh-CN`, `pt-BR`). The spec keys `translations`
 * by any string; this is input hygiene for the add-locale box only — a key the
 * REST layer's locale match (exact tag, then primary subtag) could never
 * select would be stored and never served.
 */
const LOCALE_TAG = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/;

/** The `translations` map of an untrusted draft, well-formed entries only. */
export function readTranslations(draft: Record<string, unknown>): Record<string, DocVariant> {
  const raw = draft.translations;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, DocVariant> = {};
  for (const [locale, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const variant = v as Record<string, unknown>;
    out[locale] = {
      ...(typeof variant.label === 'string' ? { label: variant.label } : {}),
      ...(typeof variant.description === 'string' ? { description: variant.description } : {}),
      content: typeof variant.content === 'string' ? variant.content : '',
    };
  }
  return out;
}

/** The Markdown the source pane shows for `locale` (the base doc for `''`). */
export function sourceFor(draft: Record<string, unknown>, locale: string): string {
  if (locale === BASE_LOCALE) return typeof draft.content === 'string' ? draft.content : '';
  return readTranslations(draft)[locale]?.content ?? '';
}

/** The draft patch that writes `text` as the body of `locale`. */
export function patchSource(
  draft: Record<string, unknown>,
  locale: string,
  text: string,
): Record<string, unknown> {
  if (locale === BASE_LOCALE) return { content: text };
  const translations = readTranslations(draft);
  return { translations: { ...translations, [locale]: { ...translations[locale], content: text } } };
}

/**
 * The draft patch that sets a variant's `label` / `description`. An emptied
 * value removes the key, so the variant falls back to the base doc's value
 * (`resolveDocLocale`'s per-field fallback) instead of rendering a blank.
 */
export function patchVariantField(
  draft: Record<string, unknown>,
  locale: string,
  field: 'label' | 'description',
  value: string,
): Record<string, unknown> {
  const translations = readTranslations(draft);
  const next: DocVariant = { ...(translations[locale] ?? { content: '' }) };
  if (value) next[field] = value;
  else delete next[field];
  return { translations: { ...translations, [locale]: next } };
}

/** The draft patch that adds a variant for `locale`, seeded from the base body. */
export function patchAddLocale(draft: Record<string, unknown>, locale: string): Record<string, unknown> {
  const translations = readTranslations(draft);
  return { translations: { ...translations, [locale]: { content: sourceFor(draft, BASE_LOCALE) } } };
}

/** The draft patch that removes a variant; the last one removes the key. */
export function patchRemoveLocale(draft: Record<string, unknown>, locale: string): Record<string, unknown> {
  const { [locale]: _removed, ...rest } = readTranslations(draft);
  return { translations: Object.keys(rest).length > 0 ? rest : undefined };
}

/** Why a typed locale cannot be added, or `null` when it can. */
export function localeRefusal(
  draft: Record<string, unknown>,
  locale: string,
): 'invalid' | 'duplicate' | null {
  if (!LOCALE_TAG.test(locale)) return 'invalid';
  if (Object.prototype.hasOwnProperty.call(readTranslations(draft), locale)) return 'duplicate';
  return null;
}

/** A listed book, reduced to what the placement picker reads. */
export interface BookOption {
  name: string;
  label: string;
  audience: Book['audience'];
  groups: Array<{ key: string; label: string }>;
  spine: Book;
  packageId?: string;
}

/** Listed `book` rows → picker options; a row without a name or a spine is skipped. */
export function toBookOptions(rows: unknown[]): BookOption[] {
  const out: BookOption[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const b = row as Record<string, unknown>;
    if (typeof b.name !== 'string' || !b.name || !Array.isArray(b.groups)) continue;
    const groups: BookOption['groups'] = [];
    for (const g of b.groups as unknown[]) {
      if (!g || typeof g !== 'object') continue;
      const { key, label } = g as Record<string, unknown>;
      if (typeof key !== 'string') continue;
      groups.push({ key, label: typeof label === 'string' && label ? label : key });
    }
    out.push({
      name: b.name,
      label: typeof b.label === 'string' && b.label ? b.label : b.name,
      audience: b.audience as Book['audience'],
      groups,
      spine: b as unknown as Book,
      packageId: typeof b._packageId === 'string' ? b._packageId : undefined,
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** Where the doc lands, per book: the group label, from the spec's resolver. */
export interface Placement {
  book: string;
  bookLabel: string;
  group: string;
  public: boolean;
}

/**
 * Resolve this one doc against every listed book with `resolveBookTree` — the
 * function `GET /meta/book/:name/tree` answers with — and keep the authored
 * groups it lands in. The resolver appends a synthetic *Uncategorized* group
 * AFTER the authored ones for every doc no group claims; that one is not a
 * placement (`resolveBookClaimedDocs` excludes it the same way), so it is cut
 * by position rather than by key, which an authored group may also spell.
 */
export function resolvePlacements(draft: Record<string, unknown>, books: BookOption[]): Placement[] {
  const name = typeof draft.name === 'string' ? draft.name : '';
  const doc = {
    name,
    label: typeof draft.label === 'string' ? draft.label : undefined,
    order: typeof draft.order === 'number' ? draft.order : undefined,
    group: typeof draft.group === 'string' && draft.group ? draft.group : undefined,
    tags: Array.isArray(draft.tags) ? (draft.tags as unknown[]).filter((x): x is string => typeof x === 'string') : undefined,
    packageId: typeof draft._packageId === 'string' ? draft._packageId : undefined,
  };
  const out: Placement[] = [];
  for (const book of books) {
    let tree;
    try {
      tree = resolveBookTree(book.spine, [doc], book.packageId);
    } catch {
      continue; // a spine the resolver cannot read places nothing
    }
    const authored = tree.groups.slice(0, book.spine.groups.length);
    for (const g of authored) {
      if (g.entries.some((e) => e.doc === name)) {
        out.push({ book: book.name, bookLabel: book.label, group: g.label, public: book.audience === 'public' });
      }
    }
  }
  return out;
}
