// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * platform-objects/system — Platform System Objects
 *
 * Cross-cutting system-level objects that don't belong to identity,
 * security, audit, or integration. Hosts the generic settings K/V store
 * backing ADR-0007 (Settings Manifest + K/V Store + Resolver), the
 * deployment-level data-migration flags (#3617), the packaged-metadata
 * activation ledger (ADR-0126 §4), and the environment's trusted plugin-publisher
 * keys (ADR-0025 §3.5 M1).
 */

export { SysSetting } from './sys-setting.object.js';
// [ADR-0131 D7] The settings cascade's global rung, tenant-less.
export { SysPlatformSetting } from './sys-platform-setting.object.js';
export { SysSecret } from './sys-secret.object.js';
// [ADR-0025 §3.5 M1] Trusted plugin-publisher public keys, tenant-less.
export { SysTrustedKey } from './sys-trusted-key.object.js';
export { SysMetadataActivation } from './sys-metadata-activation.object.js';
export { SysSettingAudit } from './sys-setting-audit.object.js';
// [ADR-0131 D7] The settings audit trail's global rung, tenant-less.
export { SysPlatformSettingAudit } from './sys-platform-setting-audit.object.js';
export { SysMigration } from './sys-migration.object.js';
export { SysMigrationJournal } from './sys-migration-journal.object.js';
export {
  readDataMigrationFlag,
  isDataMigrationVerified,
  mayActIrreversibly,
  recordDataMigrationRun,
  // [#15989] The column-move stamp — its own act, written by the step that
  // moves the columns, never implied by a backfill re-run.
  recordFileColumnMove,
  attestFreshDatastore,
  CREATION_ATTESTATION_DETAIL,
  type MigrationFlagEngine,
  type DataMigrationRunOutcome,
  type AttestationLogger,
} from './migration-flag.js';
