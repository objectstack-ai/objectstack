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

export { en, zhCN, jaJP, esES };

export const settingsBuiltinTranslations: PlatformTranslationBundle = {
  en,
  'zh-CN': zhCN,
  'ja-JP': jaJP,
  'es-ES': esES,
};
