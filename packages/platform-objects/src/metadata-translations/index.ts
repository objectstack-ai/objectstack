// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { TranslationBundle } from '@objectstack/spec/system';
import { enMetadataForms } from '../apps/translations/en.metadata-forms.generated.js';
import { zhCNMetadataForms } from '../apps/translations/zh-CN.metadata-forms.generated.js';
import { jaJPMetadataForms } from '../apps/translations/ja-JP.metadata-forms.generated.js';
import { esESMetadataForms } from '../apps/translations/es-ES.metadata-forms.generated.js';
import { zhCNGeneratedSourceHashes } from '../apps/translations/zh-CN.source-hashes.generated.js';
import { jaJPGeneratedSourceHashes } from '../apps/translations/ja-JP.source-hashes.generated.js';
import { esESGeneratedSourceHashes } from '../apps/translations/es-ES.source-hashes.generated.js';
import { withSourceFallback } from '../apps/translations/source-hash.js';

/** The source bundle these three are judged against — `en` is a copy of it. */
const enSource = { metadataForms: enMetadataForms };

/**
 * `MetadataFormsTranslations`
 *
 * Platform-default i18n bundle for the metadata-type configuration forms
 * (object / field / agent / flow / view / …) shipped from `@objectstack/spec`.
 *
 * Single source of truth: the `*.metadata-forms.generated.ts` files in
 * `apps/translations/`. Edit the generated files directly — they are
 * hand-editable. Re-running
 *
 *   pnpm --filter @objectstack/platform-objects i18n:extract
 *
 * preserves existing translations (via `--merge`) and only fills newly
 * added schema keys per `--fill=default`.
 *
 * ## Staleness (#11671)
 *
 * "Only fills newly added keys" is exactly the sticky drift the source-hash
 * mechanism exists for: a leaf filled from the source and then left behind when
 * the source was revised keeps serving a superseded draft, present and in sync
 * by key, forever. The three translated locales therefore pass through
 * `withSourceFallback`, judged by the generated provenance tables. The THIRD
 * argument is `undefined` on purpose — the hand-authored table judges
 * `apps`/`dashboards`/`pages`, and this bundle carries none of those.
 */
export const MetadataFormsTranslations: TranslationBundle = {
  en: { metadataForms: enMetadataForms },
  'zh-CN': withSourceFallback({ metadataForms: zhCNMetadataForms }, enSource, undefined, zhCNGeneratedSourceHashes),
  'ja-JP': withSourceFallback({ metadataForms: jaJPMetadataForms }, enSource, undefined, jaJPGeneratedSourceHashes),
  'es-ES': withSourceFallback({ metadataForms: esESMetadataForms }, enSource, undefined, esESGeneratedSourceHashes),
};
