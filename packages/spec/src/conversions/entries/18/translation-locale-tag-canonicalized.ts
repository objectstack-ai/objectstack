// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `translation-locale-tag-canonicalized` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `translationLocaleTagCanonicalized` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection, renameKey } from '../../walk.js';
import { LocaleSchema } from '../../../system/translation.zod.js';
import { isDict } from '../shared.js';

/**
 * A locale written with `_` separators or surrounding whitespace becomes the
 * BCP-47 tag it meant (protocol 18, #25822): `zh_CN` → `zh-CN`, `'en '` → `en`.
 *
 * `LocaleSchema` was a bare string, so a translation item, a bundle's locale
 * key, the stack's `i18n` locales and a seed dataset's `locale` scope all
 * saved any text. The resolvers fold case and nothing else, so a value
 * spelled with `_` or padded with whitespace named a locale no session ever
 * asks for: its strings were stored and never rendered. The schema now
 * refuses anything that is not tag-shaped.
 *
 * **What it rewrites.** Only the two spellings that have exactly one tag they
 * can have meant: `_` used as the subtag separator, and whitespace around the
 * value. Case is kept as written here; its fold is the entry after this one,
 * {@link translationLocaleTagCaseFolded}, retired a release later, because the
 * premise that every resolver folds case was measured false (#28993). The
 * result must pass `LocaleSchema`; a value that still does not (a
 * language name, `not a locale!!`) is left as stored and reported as a TODO,
 * because only its author knows which locale it was for.
 *
 * **A rewrite changes what renders, on purpose.** A `zh_CN` item's strings
 * start resolving for `zh-CN` sessions, the strings their author wrote them
 * for. On a bundle a rename that would land on a locale key the entry already
 * holds is merged only when the two values are identical (`renameKey`);
 * otherwise both are left as stored and reported, because picking a winner
 * would silently discard one translator's strings.
 *
 * **Reach.** `translations[]`: a bare item's `locale` (the shape stored
 * `translation` rows replay through), or a bundle entry's locale keys. A
 * bundle key is judged only when it carries something other than letters, so
 * a legacy item written before `locale` was required, whose top-level keys
 * are group names (`globalActions`, `dashboards`), is never misread as a
 * bundle with bad locale keys. Also `i18n.defaultLocale`,
 * `i18n.fallbackLocale`, `i18n.supportedLocales[]` and `data[].locale[]`.
 *
 * Retired from the load path from day one: a live author meets the parse's
 * refusal and its prescription instead of being rewritten. Stored rows
 * (`applyConversionsToStoredItem`) and a built artifact inside its
 * declared-floor window get the rewrite. Idempotent: a tag-shaped value is
 * never touched again.
 */
const translationLocaleTagCanonicalized: MetadataConversion = {
  id: 'translation-locale-tag-canonicalized',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '18.1.0',
  surface:
    'translation.locale / stack.translations[].<locale> / i18n.defaultLocale / i18n.fallbackLocale / '
    + 'i18n.supportedLocales[] / data[].locale[]',
  summary:
    "a locale written with '_' separators or surrounding whitespace → the BCP-47 tag it meant "
    + "('zh_CN' → 'zh-CN'): no resolver matched it, so its strings never rendered; a value that is "
    + 'still not tag-shaped is left as stored and reported',
  apply(stack, emit, context) {
    const isTag = (v: string): boolean => LocaleSchema.safeParse(v).success;
    /** The one tag `raw` can have meant, or `undefined` when it is a tag already or names none. */
    const canonical = (raw: string): string | undefined => {
      if (isTag(raw)) return undefined;
      const tag = raw.trim().replace(/_/g, '-');
      return isTag(tag) ? tag : undefined;
    };
    const todo = (path: string, from: string, reason: string): void =>
      context?.reportTodo?.({ path, from: JSON.stringify(from), reason });
    const NOT_A_TAG =
      'is not a BCP-47 language tag and has no single tag it can have meant. Left as stored, it is '
      + 'refused where it is parsed. Rewrite it by hand as the tag its strings were written for '
      + '(`en`, `zh-CN`, `zh-Hans-CN`).';
    /** A locale value: rewritten, reported, or (already a tag) returned as is. */
    const value = (raw: string, path: string, subject: string): string => {
      if (isTag(raw)) return raw;
      const tag = canonical(raw);
      if (tag === undefined) {
        todo(path, raw, `${subject} ${NOT_A_TAG}`);
        return raw;
      }
      emit({ from: JSON.stringify(raw), to: JSON.stringify(tag), path });
      return tag;
    };
    const list = (raw: unknown, path: string, subject: string): unknown => {
      if (!Array.isArray(raw)) return raw;
      let changed = false;
      const next = raw.map((v, i) => {
        if (typeof v !== 'string') return v;
        const mapped = value(v, `${path}[${i}]`, subject);
        if (mapped !== v) changed = true;
        return mapped;
      });
      return changed ? next : raw;
    };

    let next = mapCollection(stack, 'translations', (entry, path) => {
      // A bare `translation` ITEM: its own `locale`.
      if ('locale' in entry) {
        if (typeof entry.locale !== 'string') return entry;
        const locale = value(entry.locale, `${path}.locale`, 'The translation item locale');
        return locale === entry.locale ? entry : { ...entry, locale };
      }
      // A bundle entry: locale code → data.
      let bundle = entry;
      for (const [key, data] of Object.entries(entry)) {
        if (!isDict(data) || /^[A-Za-z]+$/.test(key) || isTag(key)) continue;
        const tag = canonical(key);
        if (tag === undefined) {
          todo(`${path}.${key}`, key, `The translation bundle locale key ${NOT_A_TAG}`);
          continue;
        }
        const renamed = renameKey(bundle, key, tag);
        if (renamed === null) {
          todo(
            `${path}.${key}`,
            key,
            `The translation bundle locale key means \`${tag}\`, and the entry already holds different `
              + `strings under \`${tag}\`. Left as stored, it is refused where it is parsed. Merge the two `
              + 'by hand and keep one key.',
          );
          continue;
        }
        emit({ from: JSON.stringify(key), to: JSON.stringify(tag), path: `${path}.${key}` });
        bundle = renamed;
      }
      return bundle;
    });

    const i18n = next.i18n;
    if (isDict(i18n)) {
      let config = i18n;
      for (const key of ['defaultLocale', 'fallbackLocale'] as const) {
        const raw = config[key];
        if (typeof raw !== 'string') continue;
        const mapped = value(raw, `i18n.${key}`, `i18n.${key}`);
        if (mapped !== raw) config = { ...config, [key]: mapped };
      }
      const supported = list(config.supportedLocales, 'i18n.supportedLocales', 'A supported locale');
      if (supported !== config.supportedLocales) config = { ...config, supportedLocales: supported };
      if (config !== i18n) next = { ...next, i18n: config };
    }

    return mapCollection(next, 'data', (dataset, path) => {
      const locale = list(dataset.locale, `${path}.locale`, 'A seed dataset locale');
      return locale === dataset.locale ? dataset : { ...dataset, locale };
    });
  },
  fixture: {
    before: {
      translations: [
        // A stored item under an underscore spelling.
        { name: 'zh_cn', locale: 'zh_CN', messages: { commonSave: '保存' } },
        // Already a tag: left alone. (A tag in another case is the next
        // entry's, `translation-locale-tag-case-folded`; fixtures stay disjoint.)
        { name: 'pt_br', locale: 'pt-BR', messages: { commonSave: 'Salvar' } },
        // Not a tag and no single tag it can have meant: a TODO, left as stored.
        { name: 'qa_bad_locale', locale: 'not a locale!!', messages: { commonSave: 'x' } },
        // A bundle entry: one padded key, one underscore key, one tag.
        {
          'en ': { messages: { commonSave: 'Save' } },
          ja_JP: { messages: { commonSave: '保存' } },
          'zh-CN': { messages: { commonSave: '保存' } },
        },
        // A legacy item without `locale`: its group keys are not locale keys.
        { name: 'fr', globalActions: { export_all: { label: 'Tout exporter' } } },
      ],
      i18n: { defaultLocale: 'en_US', supportedLocales: ['en_US', 'zh-CN', ' ja-JP'], fallbackLocale: 'en' },
      data: [{ object: 'crm_lead', locale: ['zh_CN'], records: [] }],
    },
    after: {
      translations: [
        { name: 'zh_cn', locale: 'zh-CN', messages: { commonSave: '保存' } },
        { name: 'pt_br', locale: 'pt-BR', messages: { commonSave: 'Salvar' } },
        { name: 'qa_bad_locale', locale: 'not a locale!!', messages: { commonSave: 'x' } },
        {
          'zh-CN': { messages: { commonSave: '保存' } },
          en: { messages: { commonSave: 'Save' } },
          'ja-JP': { messages: { commonSave: '保存' } },
        },
        { name: 'fr', globalActions: { export_all: { label: 'Tout exporter' } } },
      ],
      i18n: { defaultLocale: 'en-US', supportedLocales: ['en-US', 'zh-CN', 'ja-JP'], fallbackLocale: 'en' },
      data: [{ object: 'crm_lead', locale: ['zh-CN'], records: [] }],
    },
    // One per rewritten value: the item, two bundle keys, the default locale,
    // two supported locales and the seed scope.
    expectedNotices: 7,
  },
};

export { translationLocaleTagCanonicalized };
