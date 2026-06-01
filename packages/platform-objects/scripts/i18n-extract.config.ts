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
 * The config is **build-time only** — it is not deployed and not used at
 * runtime. The Setup App still ships its own bundle via plugin-auth.
 *
 * NOTE: `translations` lists the *currently committed* generated files
 * (plus the curated zh-CN overlay) as merge baselines so that re-running
 * `os i18n extract --merge` preserves every existing translation and only
 * fills in newly-added schema keys per `--fill`. Do NOT add
 * `SetupAppTranslations` or `MetadataFormsTranslations` here — those
 * bundles re-export the same generated files and importing them through
 * the wrapper risks pulling in unrelated hand-edits.
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
  SysDepartment,
  SysDepartmentMember,
  SysApiKey,
  SysTwoFactor,
  SysDeviceCode,
  SysUserPreference,
  SysOauthApplication,
  SysOauthAccessToken,
  SysOauthRefreshToken,
  SysOauthConsent,
  SysJwks,
} from '../src/identity/index.js';

// ── Security ──────────────────────────────────────────────────────────────
// RBAC objects moved to @objectstack/plugin-security and sharing objects to
// @objectstack/plugin-sharing (ADR-0029 K2 / D8). Their i18n extraction must
// move to those plugins before the next regeneration; existing generated
// bundles keep working until then.

// ── Audit ─────────────────────────────────────────────────────────────────
// sys_audit_log / sys_activity / sys_comment moved to @objectstack/plugin-audit
// and sys_presence to @objectstack/service-realtime (ADR-0029 K2 / D8). Their
// i18n extraction now lives in those packages; the already-generated bundles
// here keep working until the next regeneration. sys_attachment stays here
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
import { SysSetting, SysSecret, SysSettingAudit } from '../src/system/index.js';

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

export default defineStack({
  name: 'platform-objects-i18n-extract',

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
    SysDepartment,
    SysDepartmentMember,
    SysApiKey,
    SysTwoFactor,
    SysDeviceCode,
    SysUserPreference,
    SysOauthApplication,
    SysOauthAccessToken,
    SysOauthRefreshToken,
    SysOauthConsent,
    SysJwks,

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
  ] as any,

  apps: [SETUP_APP, STUDIO_APP, ACCOUNT_APP] as any,
  dashboards: [SystemOverviewDashboard] as any,

  translations: [
    { en: { objects: enObjects, metadataForms: enMetadataForms } },
    { 'zh-CN': { objects: zhCNObjects, metadataForms: zhCNMetadataForms } },
    { 'ja-JP': { objects: jaJPObjects, metadataForms: jaJPMetadataForms } },
    { 'es-ES': { objects: esESObjects, metadataForms: esESMetadataForms } },
  ],
});
