// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Built-in Settings translations.
 *
 * Mirrors the CRM example's `src/translations/{en,zh-CN,ja-JP}.ts` convention —
 * one file per locale, aggregated into a `PlatformTranslationBundle` here —
 * the platform face, because `settings` is a platform-only group.
 *
 * Hosts merge `settingsBuiltinTranslations` into the i18next resource tree
 * under whatever namespace makes sense (the console wires it as `system`),
 * making keys resolvable as `<ns>.settings.<namespace>.{title,description,...}`.
 *
 * Besides the manifests bundled here, the locale files carry the copy for
 * `lifecycle` (Data Lifecycle), the manifest `@objectstack/objectql` registers
 * into the same hub: that package ships no translation bundle of its own.
 * `settings-translation-coverage.test.ts` holds both to the same coverage.
 */

import type { PlatformTranslationBundle } from '@objectstack/spec/system';
import { en } from './en.js';
import { zhCN } from './zh-CN.js';
import { jaJP } from './ja-JP.js';
import { esES } from './es-ES.js';
import { zhHant } from './zh-Hant.js';
import { ar } from './ar.js';
import { fr } from './fr.js';
import { ptBR } from './pt-BR.js';
import { ru } from './ru.js';
import { de } from './de.js';
import { ko } from './ko.js';

export { en, zhCN, jaJP, esES, zhHant, ar, fr, ptBR, ru, de, ko };

export const settingsBuiltinTranslations: PlatformTranslationBundle = {
  en,
  'zh-CN': zhCN,
  'ja-JP': jaJP,
  'es-ES': esES,
  'zh-Hant': zhHant,
  'ar': ar,
  'fr': fr,
  'pt-BR': ptBR,
  'ru': ru,
  'de': de,
  'ko': ko,
};
