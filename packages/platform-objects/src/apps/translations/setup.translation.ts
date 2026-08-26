// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { TranslationBundle } from '@objectstack/spec/system';
import { en } from './en.js';
import { zhCN } from './zh-CN.js';
import { jaJP } from './ja-JP.js';
import { esES } from './es-ES.js';
import { zhCNSourceHashes } from './zh-CN.source-hashes.js';
import { jaJPSourceHashes } from './ja-JP.source-hashes.js';
import { esESSourceHashes } from './es-ES.source-hashes.js';
import { zhCNGeneratedSourceHashes } from './zh-CN.source-hashes.generated.js';
import { jaJPGeneratedSourceHashes } from './ja-JP.source-hashes.generated.js';
import { esESGeneratedSourceHashes } from './es-ES.source-hashes.generated.js';
import { withSourceFallback } from './source-hash.js';

/**
 * Setup App — Internationalization (i18n)
 *
 * Mirrors the CRM example's `per_locale` convention: each language lives
 * in its own file (`en.ts`, `zh-CN.ts`, `ja-JP.ts`, `es-ES.ts`) and is
 * assembled into a single `TranslationBundle` here.
 *
 * Loaded into the kernel's i18n service by `plugin-auth` during
 * `kernel:ready` (auth is the natural registration point for the Setup
 * App — see `auth-plugin.ts`).
 *
 * Supported locales: en, zh-CN, ja-JP, es-ES.
 *
 * ## This assembly is where staleness is resolved (#8765)
 *
 * The three translated bundles pass through {@link withSourceFallback}, which
 * replaces any leaf whose RECORDED source hash disagrees with the current
 * `en` source string by that source string. This is the serving seam for the
 * package: `plugin.ts` hands exactly this object to the kernel's i18n service
 * at `kernel:ready`, one locale at a time.
 *
 * Consequences worth stating, because both were ruled (#8765, Option B):
 *
 *  - **Edit a source string ⇒ that leaf falls back to source in every locale
 *    that had translated it**, instead of serving the previous translation
 *    under a green build. The reader sees the source string — the same
 *    degradation an untranslated key already produces, not a new state.
 *  - **Update ONE translation (value + its recorded hash) ⇒ that locale alone
 *    recovers.** The hash tables are per-locale, so zh-CN catching up says
 *    nothing about ja-JP.
 *
 * A leaf with NO recorded hash is legacy-trusted and served verbatim.
 *
 * ## The generated half joined this seam in #11671
 *
 * The fourth argument is the GENERATED provenance table
 * (`<locale>.source-hashes.generated.ts`, written by `os i18n extract
 * --source-hashes`). `zhCN` and friends carry `objects` as well as the
 * hand-authored sections, so this one call now covers both halves — the third
 * argument judging `apps`/`dashboards`/`pages`, the fourth judging `objects`.
 *
 * The module note in `source-hash.ts` records why the generated half was
 * excluded until now and why that reason was wrong. On the day this landed no
 * generated leaf was stale (every record equals the current source's digest by
 * construction), so this changed what is SERVED for exactly zero leaves — it
 * changes what happens the next time a source string moves underneath one.
 *
 * `en` is not passed through: it is the source, not a translation of it, so
 * there is nothing for it to be stale against.
 */
export const SetupAppTranslations: TranslationBundle = {
  en,
  'zh-CN': withSourceFallback(zhCN, en, zhCNSourceHashes, zhCNGeneratedSourceHashes),
  'ja-JP': withSourceFallback(jaJP, en, jaJPSourceHashes, jaJPGeneratedSourceHashes),
  'es-ES': withSourceFallback(esES, en, esESSourceHashes, esESGeneratedSourceHashes),
};
