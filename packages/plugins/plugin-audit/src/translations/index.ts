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

import type { TranslationBundle, TranslationData } from '@objectstack/spec/system';
import { withSourceFallback } from '@objectstack/platform-objects/apps';
import { enObjects } from './en.objects.generated.js';
import { zhCNObjects } from './zh-CN.objects.generated.js';
import { jaJPObjects } from './ja-JP.objects.generated.js';
import { esESObjects } from './es-ES.objects.generated.js';
import { zhCNGeneratedSourceHashes } from './zh-CN.source-hashes.generated.js';
import { jaJPGeneratedSourceHashes } from './ja-JP.source-hashes.generated.js';
import { esESGeneratedSourceHashes } from './es-ES.source-hashes.generated.js';
import { enMessages, zhCNMessages, jaJPMessages, esESMessages } from './messages.js';

/**
 * ## The provenance companions are READ here, not merely recorded
 *
 * `os i18n extract --source-hashes` writes `<locale>.source-hashes.generated.ts`
 * beside these bundles (maintainer ruling #12069 Option A, #11671). A record
 * says: "this locale's leaf at that path is still a byte copy of THAT source
 * revision". Recording alone changes nothing a user sees — the substitution is
 * what {@link withSourceFallback} does, and until it was wired here this set
 * recorded the drift and went on serving the superseded draft.
 *
 * That gap was invisible by construction: a leaf revised in ONE locale is
 * reported by `findStaleFills`, and every gate stays green — `check:i18n`
 * compares key sets, `check:i18n-coverage` counts a stale leaf as translated,
 * and `check:i18n-stale-fill` needs two locales holding the same stale bytes
 * before it can testify. So the only reader-visible consequence was the wrong
 * string on the page.
 *
 * `recorded` (3rd argument) stays `undefined` on purpose: it judges the
 * HAND-AUTHORED sections (`apps` / `dashboards` / `pages`), which this set does
 * not have — its bundles are entirely generated. The companion goes in the 4th
 * slot, which judges the generated ones. This is the shape
 * `@objectstack/platform-objects`'s own `metadata-translations/index.ts` uses.
 *
 * ⛔ Do not drop the 4th argument to quiet a staleness report. Serving the
 * superseded draft is the bug; `check:i18n-stale-fill`'s UNSERVED PROVENANCE
 * verdict fails the build if a committed companion stops being consulted here.
 */
const enSource: TranslationData = { objects: enObjects, messages: enMessages };

export const AuditTranslations: TranslationBundle = {
  en: enSource,
  'zh-CN': withSourceFallback({ objects: zhCNObjects, messages: zhCNMessages }, enSource, undefined, zhCNGeneratedSourceHashes),
  'ja-JP': withSourceFallback({ objects: jaJPObjects, messages: jaJPMessages }, enSource, undefined, jaJPGeneratedSourceHashes),
  'es-ES': withSourceFallback({ objects: esESObjects, messages: esESMessages }, enSource, undefined, esESGeneratedSourceHashes),
};
