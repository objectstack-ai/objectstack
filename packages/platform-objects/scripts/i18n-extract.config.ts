// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Synthetic stack config for `os i18n extract`.
 *
 * Imports every sys_* platform object plus the Setup app's existing
 * translations so that `os i18n extract` (and `os i18n check`) can be
 * pointed at this file via `bundle-require`:
 *
 *   os i18n extract packages/platform-objects/scripts/i18n-extract.config.ts \
 *     --locales=zh-CN,ja-JP,es-ES \
 *     --fill=default \
 *     --out=packages/platform-objects/src/apps/translations
 *
 * From the repo root that is `pnpm i18n:extract`, and `pnpm check:i18n` is the
 * same run with `--check`: it writes nothing and fails if the committed
 * bundles differ from a fresh extract. CI runs the latter (lint.yml), so a
 * schema change that adds, removes or renames a label now fails the build
 * instead of silently rotting the bundles until someone re-runs this by hand
 * (#3670).
 *
 * The config is **build-time only** — it is not deployed and not used at
 * runtime. The Setup App still ships its own bundle via plugin-auth.
 *
 * NOTE: `translations` is the merge baseline — what a re-run treats as
 * ALREADY TRANSLATED. It must therefore carry everything this config
 * declares, from both halves of this package's i18n:
 *
 *   - `objects` / `metadataForms` — GENERATED. Emitted by this command into
 *     `<locale>.objects.generated.ts` / `<locale>.metadata-forms.generated.ts`
 *     and gated by `pnpm check:i18n`, which fails when the committed bundle
 *     differs from a fresh extract.
 *   - `apps` / `dashboards` / `pages` — HAND-AUTHORED in `<locale>.ts`, and
 *     they have to stay that way. The Setup app is a shell of empty group
 *     anchors (ADR-0029 D7); its ~25 menu entries are contributed at RUNTIME
 *     by `SETUP_NAV_CONTRIBUTIONS` and by capability plugins, so a bundle
 *     generated from a static walk of `SETUP_APP` would be structurally
 *     incomplete — regenerating over it would DELETE 40 live nav
 *     translations per locale. Their gate is `pnpm check:app-nav-i18n`
 *     (`packages/cli/scripts/check-app-nav-i18n.mjs`), which boots the real
 *     composition and judges the MERGED app — not the bundle-drift gate, and
 *     not the coverage ratchet.
 *
 *     This paragraph used to end "Their gate is the coverage ratchet
 *     (`scripts/check-i18n-coverage.mjs`), baselined at 0 for this package",
 *     and that sentence was half of the #5750 defect. The ratchet runs
 *     `os lint` over STATIC configs — the same static walk two lines up says
 *     is structurally incomplete for Setup — so it could never see a
 *     runtime-contributed label. Its 0 for this package meant "not looked at
 *     here", not "checked, clean", while `app-nav-translation-parity.test.ts`
 *     excluded Setup and pointed at the ratchet from the other side. Four
 *     `zh-CN` nav labels were missing under a fully green build. The ratchet
 *     still gates this package's STATIC declared surface and its 0 is real for
 *     that; it simply is not the owner of the runtime half.
 *
 * Omitting the hand-authored half was a measurable bug, not a style choice:
 * this config declares SETUP_APP / STUDIO_APP / ACCOUNT_APP and
 * SystemOverviewDashboard, so coverage counted all 77 `apps.*`/`dashboards.*`
 * keys as untranslated in every locale — 231 strings of phantom debt — while
 * 76 of the 77 had been translated for months. Only
 * `apps.studio.navigation.nav_app_builder.label` was genuinely missing.
 *
 * Still do NOT add `SetupAppTranslations` or `MetadataFormsTranslations`:
 * those are the outer wrappers. Import the per-locale assembler (`en.js`,
 * `zh-CN.js`, …) and pin `objects`/`metadataForms` to the generated files
 * explicitly, as below.
 */

import { defineStack } from '@objectstack/spec';

// ── Identity ──────────────────────────────────────────────────────────────
import {
  SysUser,
  SysSession,
  SysAccount,
  SysVerification,
  SysOrganization,
  SysMember,
  SysInvitation,
  SysTeam,
  SysTeamMember,
  SysBusinessUnit,
  SysBusinessUnitMember,
  SysApiKey,
  SysTwoFactor,
  SysDeviceCode,
  SysUserPreference,
  SysOauthApplication,
  SysOauthAccessToken,
  SysOauthRefreshToken,
  SysOauthConsent,
  SysOauthResource,
  SysOauthClientResource,
  SysOauthClientAssertion,
  SysJwks,
  SysSsoProvider,
  SysScimProvider,
} from '../src/identity/index.js';

// ── Security ──────────────────────────────────────────────────────────────
// RBAC objects moved to @objectstack/plugin-security and sharing objects to
// @objectstack/plugin-sharing (ADR-0029 K2 / D8). Their i18n extraction must
// move to those plugins before the next regeneration; existing generated
// bundles keep working until then.

// ── Audit ─────────────────────────────────────────────────────────────────
// sys_audit_log / sys_activity / sys_comment moved to @objectstack/plugin-audit
// and sys_presence to @objectstack/service-realtime (ADR-0029 K2 / D8). Their
// i18n extraction lives in those packages (each has its own
// scripts/i18n-extract.config.ts + src/translations bundles) and the leftover
// copies here were pruned in the #2834 ⑤ regeneration — verified line-by-line
// against the owning plugins' bundles before committing. The
// bundle-ownership test guards this invariant from here on: this package's
// bundles carry ONLY this package's objects. sys_attachment stays here
// pending the storage-domain decomposition (it belongs with service-storage).
import {
  SysNotification,
  SysAttachment,
  SysEmail,
  SysEmailTemplate,
  SysSavedReport,
  SysReportSchedule,
  // sys_approval_* moved to @objectstack/plugin-approvals (ADR-0029 K2.b / D8).
  SysJob,
  SysJobRun,
  SysJobQueue,
  SysImportJob,
} from '../src/audit/index.js';

// ── Integration ───────────────────────────────────────────────────────────
// sys_webhook moved to @objectstack/plugin-webhooks per ADR-0029 (K2.a).
// Its i18n extraction must move to that plugin before the next regeneration
// (ADR-0029 D8); existing generated bundles keep working until then.

// ── Metadata ──────────────────────────────────────────────────────────────
import {
  SysMetadataObject,
  SysMetadataHistoryObject,
  SysViewDefinitionObject,
  SysMetadataAuditObject,
} from '../src/metadata/index.js';

// ── System ────────────────────────────────────────────────────────────────
import { SysSetting, SysSecret, SysSettingAudit, SysMigration } from '../src/system/index.js';

// ── Existing Setup app + dashboards + translations ────────────────────────
import { SETUP_APP } from '../src/apps/setup.app.js';
import { STUDIO_APP } from '../src/apps/studio.app.js';
import { ACCOUNT_APP } from '../src/apps/account.app.js';
import {
  SystemOverviewDashboard,
} from '../src/apps/dashboards/index.js';

// ── Existing generated translations (merge baseline) ──────────────────────
// Import the generated files DIRECTLY (not via SetupAppTranslations, which
// would also pull in `apps.setup.*` hand-edits and is therefore safe — but
// using the generated files alone keeps the loop self-contained and lets
// `os i18n extract --merge` preserve every hand-translated string that
// already exists in `zh-CN.objects.generated.ts`, `zh-CN.metadata-forms.
// generated.ts`, etc. New schema keys are filled per `--fill`; existing
// keys are never overwritten.
import { enObjects } from '../src/apps/translations/en.objects.generated.js';
import { zhCNObjects } from '../src/apps/translations/zh-CN.objects.generated.js';
import { jaJPObjects } from '../src/apps/translations/ja-JP.objects.generated.js';
import { esESObjects } from '../src/apps/translations/es-ES.objects.generated.js';
import { enMetadataForms } from '../src/apps/translations/en.metadata-forms.generated.js';
import { zhCNMetadataForms } from '../src/apps/translations/zh-CN.metadata-forms.generated.js';
import { jaJPMetadataForms } from '../src/apps/translations/ja-JP.metadata-forms.generated.js';
import { esESMetadataForms } from '../src/apps/translations/es-ES.metadata-forms.generated.js';

// ── Existing hand-authored app/dashboard/page translations ────────────────
// The per-locale assemblers, NOT the `SetupAppTranslations` wrapper. Each one
// already re-exports the generated `objects` bundle above and adds the
// hand-written `apps` / `dashboards` / `pages` subtrees.
//
// These must be in the baseline for the same reason the generated bundles are,
// and the omission was measurable: `apps.*` and `dashboards.*` are declared by
// this config (it lists SETUP_APP / STUDIO_APP / ACCOUNT_APP and
// SystemOverviewDashboard) but their translations were not, so coverage
// reported all 77 as untranslated. 76 of them had been translated for months —
// only `apps.studio.navigation.nav_app_builder.label` was genuinely missing.
// The whole 231 in the ratchet baseline was that artifact, not a real debt.
//
// Safe for the emit, which is the reason the split existed: `--objects-only`
// writes `data.objects` alone, so nothing here can reach
// `<locale>.objects.generated.ts`. It only changes what MERGE and COVERAGE
// consider already-translated, which is exactly what was wrong.
import { en } from '../src/apps/translations/en.js';
import { zhCN } from '../src/apps/translations/zh-CN.js';
import { jaJP } from '../src/apps/translations/ja-JP.js';
import { esES } from '../src/apps/translations/es-ES.js';

export default defineStack({
  objects: [
    // Identity
    SysUser,
    SysSession,
    SysAccount,
    SysVerification,
    SysOrganization,
    SysMember,
    SysInvitation,
    SysTeam,
    SysTeamMember,
    SysBusinessUnit,
    SysBusinessUnitMember,
    SysApiKey,
    SysTwoFactor,
    SysDeviceCode,
    SysUserPreference,
    SysOauthApplication,
    SysOauthAccessToken,
    SysOauthRefreshToken,
    SysOauthConsent,
    SysOauthResource,
    SysOauthClientResource,
    SysOauthClientAssertion,
    SysJwks,
    SysSsoProvider,
    SysScimProvider,

    // Security: RBAC moved to @objectstack/plugin-security, sharing to
    // @objectstack/plugin-sharing (ADR-0029 K2 / D8).

    // Audit (sys_audit_log / sys_activity / sys_comment moved to
    // @objectstack/plugin-audit; sys_presence to @objectstack/service-realtime;
    // sys_attachment stays pending storage-domain decomposition)
    SysNotification,
    SysAttachment,
    SysEmail,
    SysEmailTemplate,
    SysSavedReport,
    SysReportSchedule,
    // sys_approval_* moved to @objectstack/plugin-approvals (ADR-0029 K2.b / D8).
    SysJob,
    SysJobRun,
    SysJobQueue,
    SysImportJob,

    // Integration: sys_webhook moved to @objectstack/plugin-webhooks (ADR-0029 D8).

    // Metadata
    SysMetadataObject,
    SysMetadataHistoryObject,
    SysViewDefinitionObject,
    SysMetadataAuditObject,

    // System
    SysSetting,
    SysSecret,
    SysSettingAudit,
    SysMigration,
  ] as any,

  apps: [SETUP_APP, STUDIO_APP, ACCOUNT_APP] as any,
  dashboards: [SystemOverviewDashboard] as any,

  translations: [
    // `...en` supplies the hand-authored apps/dashboards/pages; `objects` and
    // `metadataForms` are then pinned to the generated files explicitly, so the
    // merge baseline is the committed artifact rather than whatever the
    // assembler happens to re-export.
    { en: { ...en, objects: enObjects, metadataForms: enMetadataForms } },
    { 'zh-CN': { ...zhCN, objects: zhCNObjects, metadataForms: zhCNMetadataForms } },
    { 'ja-JP': { ...jaJP, objects: jaJPObjects, metadataForms: jaJPMetadataForms } },
    { 'es-ES': { ...esES, objects: esESObjects, metadataForms: esESMetadataForms } },
  ],
});
