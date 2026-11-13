// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The language this package writes a sentence in, read from a caller's
 * locale code. One reader for every table of product sentences the package
 * serves: Setup → Storage → 测试连接 (`storage-test-copy.ts`) and [#32712] the
 * upload-link page (`upload-link-copy.ts`), so the two cannot disagree about
 * which language a code names.
 *
 * The keys are the platform locale table's languages
 * (`@objectstack/spec/system` `PLATFORM_LOCALES`), the first four under the
 * older codes this package served them by (`zh-CN`, `ja-JP`, `es-ES`). The
 * caller's code is read through the table's own reader, `platformLocaleTagOf`,
 * so a stored alias (`zh-TW`, `pt`, `en-US`) and a table tag (`zh-Hans`, `ja`)
 * both find their key. A code the table does not name is shortened one subtag
 * at a time (RFC 4647 lookup: `fr-CA` → `fr`, `zh-Hant-TW` → `zh-Hant`);
 * nothing left ⇒ `undefined`, which every table answers in English.
 */

import { platformLocaleTagOf, type PlatformLocaleTag } from '@objectstack/spec/system';

/** A table's keys: the platform locale table's languages, the first four under their older codes. */
export type CopyLocale =
  'en' | 'zh-CN' | 'zh-Hant' | 'es-ES' | 'ar' | 'fr' | 'pt-BR' | 'ru' | 'de' | 'ja-JP' | 'ko';

/** Each platform locale table tag → the key that serves it. */
const KEY_BY_TABLE_TAG: Record<PlatformLocaleTag, CopyLocale> = {
  en: 'en',
  'zh-Hans': 'zh-CN',
  'zh-Hant': 'zh-Hant',
  es: 'es-ES',
  ar: 'ar',
  fr: 'fr',
  'pt-BR': 'pt-BR',
  ru: 'ru',
  de: 'de',
  ja: 'ja-JP',
  ko: 'ko',
};

/** The key that serves a caller's code, or `undefined` (⇒ English). */
export function copyLocaleOf(locale: string | undefined): CopyLocale | undefined {
  if (!locale) return undefined;
  const subtags = locale.split('-');
  for (let n = subtags.length; n > 0; n -= 1) {
    const tag = platformLocaleTagOf(subtags.slice(0, n).join('-'));
    if (tag) return KEY_BY_TABLE_TAG[tag];
  }
  return undefined;
}
