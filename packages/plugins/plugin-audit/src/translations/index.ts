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
import { zhHantObjects } from './zh-Hant.objects.generated.js';
import { arObjects } from './ar.objects.generated.js';
import { frObjects } from './fr.objects.generated.js';
import { ptBRObjects } from './pt-BR.objects.generated.js';
import { ruObjects } from './ru.objects.generated.js';
import { deObjects } from './de.objects.generated.js';
import { koObjects } from './ko.objects.generated.js';
import { zhCNGeneratedSourceHashes } from './zh-CN.source-hashes.generated.js';
import { jaJPGeneratedSourceHashes } from './ja-JP.source-hashes.generated.js';
import { esESGeneratedSourceHashes } from './es-ES.source-hashes.generated.js';
import { zhHantGeneratedSourceHashes } from './zh-Hant.source-hashes.generated.js';
import { arGeneratedSourceHashes } from './ar.source-hashes.generated.js';
import { frGeneratedSourceHashes } from './fr.source-hashes.generated.js';
import { ptBRGeneratedSourceHashes } from './pt-BR.source-hashes.generated.js';
import { ruGeneratedSourceHashes } from './ru.source-hashes.generated.js';
import { deGeneratedSourceHashes } from './de.source-hashes.generated.js';
import { koGeneratedSourceHashes } from './ko.source-hashes.generated.js';
import {
  enMessages,
  zhCNMessages,
  jaJPMessages,
  esESMessages,
  zhHantMessages,
  arMessages,
  frMessages,
  ptBRMessages,
  ruMessages,
  deMessages,
  koMessages,
} from './messages.js';
import { auditPageTranslations, auditPageSourceHashes } from './pages.js';

/**
 * ## The provenance companions are READ here, not merely recorded
 *
 * `os i18n extract --source-hashes` writes `<locale>.source-hashes.generated.ts`
 * beside these bundles (maintainer ruling #12069 Option A, commit 09b4f4e4e). A record
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
 * `recorded` (3rd argument) judges the HAND-AUTHORED sections (`apps` /
 * `dashboards` / `pages`). This set has exactly one: the `pages` entry of the
 * record page the plugin ships (`./pages.ts`), whose recorded digests go there.
 * The generated companion goes in the 4th slot, which judges the generated
 * `objects` bundles. Two tables, two predicates — the shape
 * `@objectstack/plugin-approvals` uses for its own record page.
 *
 * ⛔ Do not drop the 4th argument to quiet a staleness report. Serving the
 * superseded draft is the bug; `check:i18n-stale-fill`'s UNSERVED PROVENANCE
 * verdict fails the build if a committed companion stops being consulted here.
 */
const enSource: TranslationData = { objects: enObjects, pages: auditPageTranslations.en, messages: enMessages };

export const AuditTranslations: TranslationBundle = {
  en: enSource,
  'zh-CN': withSourceFallback({ objects: zhCNObjects, pages: auditPageTranslations['zh-CN'], messages: zhCNMessages }, enSource, auditPageSourceHashes['zh-CN'], zhCNGeneratedSourceHashes),
  'ja-JP': withSourceFallback({ objects: jaJPObjects, pages: auditPageTranslations['ja-JP'], messages: jaJPMessages }, enSource, auditPageSourceHashes['ja-JP'], jaJPGeneratedSourceHashes),
  'es-ES': withSourceFallback({ objects: esESObjects, pages: auditPageTranslations['es-ES'], messages: esESMessages }, enSource, auditPageSourceHashes['es-ES'], esESGeneratedSourceHashes),
  'zh-Hant': withSourceFallback({ objects: zhHantObjects, pages: auditPageTranslations['zh-Hant'], messages: zhHantMessages }, enSource, auditPageSourceHashes['zh-Hant'], zhHantGeneratedSourceHashes),
  'ar': withSourceFallback({ objects: arObjects, pages: auditPageTranslations['ar'], messages: arMessages }, enSource, auditPageSourceHashes['ar'], arGeneratedSourceHashes),
  'fr': withSourceFallback({ objects: frObjects, pages: auditPageTranslations['fr'], messages: frMessages }, enSource, auditPageSourceHashes['fr'], frGeneratedSourceHashes),
  'pt-BR': withSourceFallback({ objects: ptBRObjects, pages: auditPageTranslations['pt-BR'], messages: ptBRMessages }, enSource, auditPageSourceHashes['pt-BR'], ptBRGeneratedSourceHashes),
  'ru': withSourceFallback({ objects: ruObjects, pages: auditPageTranslations['ru'], messages: ruMessages }, enSource, auditPageSourceHashes['ru'], ruGeneratedSourceHashes),
  'de': withSourceFallback({ objects: deObjects, pages: auditPageTranslations['de'], messages: deMessages }, enSource, auditPageSourceHashes['de'], deGeneratedSourceHashes),
  'ko': withSourceFallback({ objects: koObjects, pages: auditPageTranslations['ko'], messages: koMessages }, enSource, auditPageSourceHashes['ko'], koGeneratedSourceHashes),
};
