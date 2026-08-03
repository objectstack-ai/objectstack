// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build-time only config for `os i18n extract` (ADR-0029 D8). Not deployed.
 * The service owns the i18n extraction for the objects it owns; the
 * `translations` baseline is this service's OWN generated bundles so re-running
 * `--merge` preserves every hand-translated string.
 *
 * `sys_attachment` is contributed by this plugin but still DEFINED in
 * platform-objects — its translations stay there pending the storage-domain
 * decomposition (see that package's extract config).
 *
 *   os i18n extract packages/services/service-storage/scripts/i18n-extract.config.ts \
 *     --locales=zh-CN,ja-JP,es-ES --fill=default --objects-only --no-metadata-forms \
 *     --out=packages/services/service-storage/src/translations
 */

import { defineStack } from '@objectstack/spec';
import { SystemFile, SystemUploadSession } from '../src/objects/index.js';
import { enObjects } from '../src/translations/en.objects.generated.js';
import { zhCNObjects } from '../src/translations/zh-CN.objects.generated.js';
import { jaJPObjects } from '../src/translations/ja-JP.objects.generated.js';
import { esESObjects } from '../src/translations/es-ES.objects.generated.js';

export default defineStack({
  objects: [SystemFile, SystemUploadSession] as any,
  translations: [
    { en: { objects: enObjects } },
    { 'zh-CN': { objects: zhCNObjects } },
    { 'ja-JP': { objects: jaJPObjects } },
    { 'es-ES': { objects: esESObjects } },
  ],
});
