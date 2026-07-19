// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build-time only config for `os i18n extract` (ADR-0029 D8). Not deployed.
 * The plugin owns the i18n extraction for the objects it owns; the
 * `translations` baseline is this plugin's OWN generated bundles so re-running
 * `--merge` preserves every hand-translated string. (Initial zh-CN/ja-JP/es-ES
 * strings were seeded from @objectstack/platform-objects.)
 *
 *   os i18n extract packages/plugins/plugin-approvals/scripts/i18n-extract.config.ts \
 *     --locales=zh-CN,ja-JP,es-ES --fill=default --objects-only \
 *     --out=packages/plugins/plugin-approvals/src/translations
 */

import { defineStack } from '@objectstack/spec';
import { SysApprovalRequest } from '../src/sys-approval-request.object.js';
import { SysApprovalAction } from '../src/sys-approval-action.object.js';
import { SysApprovalDelegation } from '../src/sys-approval-delegation.object.js';
import { enObjects } from '../src/translations/en.objects.generated.js';
import { zhCNObjects } from '../src/translations/zh-CN.objects.generated.js';
import { jaJPObjects } from '../src/translations/ja-JP.objects.generated.js';
import { esESObjects } from '../src/translations/es-ES.objects.generated.js';

export default defineStack({
  name: 'plugin-approvals-i18n-extract',
  objects: [SysApprovalRequest, SysApprovalAction, SysApprovalDelegation] as any,
  translations: [
    { en: { objects: enObjects } },
    { 'zh-CN': { objects: zhCNObjects } },
    { 'ja-JP': { objects: jaJPObjects } },
    { 'es-ES': { objects: esESObjects } },
  ],
});
