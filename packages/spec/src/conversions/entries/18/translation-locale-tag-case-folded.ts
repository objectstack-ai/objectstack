// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `translation-locale-tag-case-folded` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `translationLocaleTagCaseFolded` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection, renameKey } from '../../walk.js';
import { LocaleSchema } from '../../../system/translation.zod.js';
import { isDict } from '../shared.js';

/**
 * A locale tag written in a case other than BCP-47's becomes the same tag in
 * its canonical case (protocol 18, #28993): `zh-cn` → `zh-CN`, `zh-hans-cn` →
 * `zh-Hans-CN`, `EN` → `en`.
 *
 * The case half of {@link translationLocaleTagCanonicalized}, kept as an entry
 * of its own because it retired a release later. That entry left case as
 * written, on the premise that every resolver folds it. The premise was
 * measured false: a resolver answers one locale for a request, exact match
 * first, so a `zh-cn` translation beside the stock `zh-CN` bundle was never
 * merged into it, and a `zh-CN` session never saw its strings. `LocaleSchema`
 * now folds case on parse, so a live author is corrected there. The metadata
 * save door stores the authored body rather than the parse, so this stored-row
 * pass is what carries the fold to a row saved in lower case, and to an
 * artifact built by 18.2.0 or earlier.
 *
 * **What it rewrites.** A value that is already tag-shaped and differs from
 * its `LocaleSchema` parse only in case. The fold is case only: the language
 * subtag lower case, a 4-letter script title case, a 2-letter region upper
 * case, every subtag after a singleton lower case. It never replaces a legacy
 * subtag (`iw` stays `iw`). A value that is not tag-shaped is not judged here:
 * {@link translationLocaleTagCanonicalized} runs first, rewrites the `_` and
 * padded spellings into tags and reports the rest.
 *
 * **A rewrite changes what renders, on purpose.** A `zh-cn` item's strings
 * start resolving for `zh-CN` sessions. On a bundle, a key that folds onto a
 * key the entry already holds is merged only when the two values are identical
 * (`renameKey`); otherwise both are left as stored and reported, because
 * picking a winner would silently discard one translator's strings.
 * `TranslationBundleSchema` refuses the same pair (`zh-cn` beside `zh-CN`) for
 * the same reason.
 *
 * **Reach.** The surface of {@link translationLocaleTagCanonicalized}: a bare
 * item's `locale`, a bundle entry's locale keys, `i18n.defaultLocale`,
 * `i18n.fallbackLocale`, `i18n.supportedLocales[]` and `data[].locale[]`. A
 * bundle key is rewritten only when it is a tag in another case, so a legacy
 * item's group names (`globalActions`, `dashboards`), which are not tags, are
 * never touched.
 *
 * Retired from the load path from day one: the parse folds case for a live
 * author itself. Stored rows (`applyConversionsToStoredItem`) and a built
 * artifact inside its declared-floor window get the rewrite. Idempotent: a
 * canonical tag is never touched again.
 */
const translationLocaleTagCaseFolded: MetadataConversion = {
  id: 'translation-locale-tag-case-folded',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '18.2.0',
  surface:
    'translation.locale / stack.translations[].<locale> / i18n.defaultLocale / i18n.fallbackLocale / '
    + 'i18n.supportedLocales[] / data[].locale[]',
  summary:
    "a locale tag written in another case than BCP-47's → the same tag in its canonical case "
    + "('zh-cn' → 'zh-CN'): no resolver merged it into the canonical locale, so its strings never "
    + 'rendered; a bundle key that would land on a key holding different strings is left as stored '
    + 'and reported',
  apply(stack, emit, context) {
    /** `v` in its canonical case when `v` is tag-shaped, else `undefined` (left to the entry before). */
    const folded = (v: string): string | undefined => {
      const parsed = LocaleSchema.safeParse(v);
      return parsed.success ? parsed.data : undefined;
    };
    /** A locale value: folded, or returned as is when canonical or not a tag. */
    const value = (raw: string, path: string): string => {
      const tag = folded(raw);
      if (tag === undefined || tag === raw) return raw;
      emit({ from: JSON.stringify(raw), to: JSON.stringify(tag), path });
      return tag;
    };
    const list = (raw: unknown, path: string): unknown => {
      if (!Array.isArray(raw)) return raw;
      let changed = false;
      const next = raw.map((v, i) => {
        if (typeof v !== 'string') return v;
        const mapped = value(v, `${path}[${i}]`);
        if (mapped !== v) changed = true;
        return mapped;
      });
      return changed ? next : raw;
    };

    let next = mapCollection(stack, 'translations', (entry, path) => {
      // A bare `translation` ITEM: its own `locale`.
      if ('locale' in entry) {
        if (typeof entry.locale !== 'string') return entry;
        const locale = value(entry.locale, `${path}.locale`);
        return locale === entry.locale ? entry : { ...entry, locale };
      }
      // A bundle entry: locale code → data.
      let bundle = entry;
      for (const [key, data] of Object.entries(entry)) {
        if (!isDict(data)) continue;
        const tag = folded(key);
        if (tag === undefined || tag === key) continue;
        const renamed = renameKey(bundle, key, tag);
        if (renamed === null) {
          context?.reportTodo?.({
            path: `${path}.${key}`,
            from: JSON.stringify(key),
            reason:
              `The translation bundle locale key is \`${tag}\` in another case, and the entry already holds `
              + `different strings under \`${tag}\`. Left as stored, it is refused where it is parsed, since `
              + '@objectstack/spec 18. Merge the two by hand and keep one key.',
          });
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
        const mapped = value(raw, `i18n.${key}`);
        if (mapped !== raw) config = { ...config, [key]: mapped };
      }
      const supported = list(config.supportedLocales, 'i18n.supportedLocales');
      if (supported !== config.supportedLocales) config = { ...config, supportedLocales: supported };
      if (config !== i18n) next = { ...next, i18n: config };
    }

    return mapCollection(next, 'data', (dataset, path) => {
      const scoped = list(dataset.locale, `${path}.locale`);
      return scoped === dataset.locale ? dataset : { ...dataset, locale: scoped };
    });
  },
  fixture: {
    before: {
      translations: [
        // A stored item saved in lower case.
        { name: 'pt_br', locale: 'pt-br', messages: { commonSave: 'Salvar' } },
        // Already canonical: left alone.
        { name: 'zh_cn', locale: 'zh-CN', messages: { commonSave: '保存' } },
        // Not a tag: not judged here (the entry before reports it).
        { name: 'qa_bad_locale', locale: 'not a locale!!', messages: { commonSave: 'x' } },
        // A bundle entry: two keys in another case (one of them letters only),
        // one canonical tag.
        {
          'ko-kr': { messages: { commonSave: '저장' } },
          IT: { messages: { commonSave: 'Salva' } },
          'zh-CN': { messages: { commonSave: '保存' } },
        },
        // A legacy item without `locale`: its group keys are not tags.
        { name: 'fr', globalActions: { export_all: { label: 'Tout exporter' } } },
      ],
      i18n: { defaultLocale: 'en-us', supportedLocales: ['en-us', 'zh-CN', 'zh-hans-cn'], fallbackLocale: 'en' },
      data: [{ object: 'crm_lead', locale: ['zh-cn'], records: [] }],
    },
    after: {
      translations: [
        { name: 'pt_br', locale: 'pt-BR', messages: { commonSave: 'Salvar' } },
        { name: 'zh_cn', locale: 'zh-CN', messages: { commonSave: '保存' } },
        { name: 'qa_bad_locale', locale: 'not a locale!!', messages: { commonSave: 'x' } },
        {
          'zh-CN': { messages: { commonSave: '保存' } },
          'ko-KR': { messages: { commonSave: '저장' } },
          it: { messages: { commonSave: 'Salva' } },
        },
        { name: 'fr', globalActions: { export_all: { label: 'Tout exporter' } } },
      ],
      i18n: { defaultLocale: 'en-US', supportedLocales: ['en-US', 'zh-CN', 'zh-Hans-CN'], fallbackLocale: 'en' },
      data: [{ object: 'crm_lead', locale: ['zh-CN'], records: [] }],
    },
    // One per rewritten value: the item, two bundle keys, the default locale,
    // two supported locales and the seed scope.
    expectedNotices: 7,
  },
};

export { translationLocaleTagCaseFolded };
