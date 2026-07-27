// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * platform-objects/system — Platform System Objects
 *
 * Cross-cutting system-level objects that don't belong to identity,
 * security, audit, or integration. Hosts the generic settings K/V store
 * backing ADR-0007 (Settings Manifest + K/V Store + Resolver) and the
 * deployment-level data-migration flags (#3617).
 */

export { SysSetting } from './sys-setting.object.js';
export { SysSecret } from './sys-secret.object.js';
export { SysSettingAudit } from './sys-setting-audit.object.js';
export { SysMigration } from './sys-migration.object.js';
export {
  readDataMigrationFlag,
  isDataMigrationVerified,
  recordDataMigrationRun,
  type MigrationFlagEngine,
  type DataMigrationRunOutcome,
} from './migration-flag.js';
