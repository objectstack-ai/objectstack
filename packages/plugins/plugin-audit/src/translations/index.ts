// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AuditTranslations — i18n bundle owned by this plugin (ADR-0029 D8).
 *
 * Object label/field/view/action translations for the sys_* objects this
 * plugin owns (sys_audit_log / sys_activity / sys_comment / sys_attachment).
 * Loaded at runtime via the plugin's `kernel:ready` hook
 * (`i18n.loadTranslations`). Regenerate with `os i18n extract` against
 * `scripts/i18n-extract.config.ts`.
 */

import type { TranslationBundle } from '@objectstack/spec/system';
import { enObjects } from './en.objects.generated.js';
import { zhCNObjects } from './zh-CN.objects.generated.js';
import { jaJPObjects } from './ja-JP.objects.generated.js';
import { esESObjects } from './es-ES.objects.generated.js';

export const AuditTranslations: TranslationBundle = {
  en: { objects: enObjects },
  'zh-CN': { objects: zhCNObjects },
  'ja-JP': { objects: jaJPObjects },
  'es-ES': { objects: esESObjects },
};
