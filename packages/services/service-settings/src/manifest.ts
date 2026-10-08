// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { SysPlatformSetting, SysSetting, SysSettingAudit } from '@objectstack/platform-objects/system';

export const SETTINGS_PLUGIN_ID = 'com.objectstack.service.settings';
export const SETTINGS_PLUGIN_VERSION = '0.1.0';

/**
 * Objects owned by service-settings: the K/V store, its tenant-less global
 * rung, and the audit trail.
 *
 * [ADR-0131 D7] `sys_platform_setting` holds the cascade's global rung — one
 * row per `(namespace, key)` for the deployment, no organization column — and
 * `sys_setting` holds the tenant and user rungs. They register together because
 * the resolver reads both on every resolution: a kernel with one and not the
 * other would answer a cascade with a rung missing.
 *
 * `sys_secret` is deliberately NOT here (#4270): its producers span domains
 * (encrypted settings here, the engine's `secret`-field encryption, the
 * datasource credential binder) and the engine fails closed when the store
 * is missing — so it is registered by `PlatformObjectsPlugin` as platform
 * infrastructure, present with or without this service (cf. `sys_migration`,
 * #4243). This service remains a producer/consumer via its secret store.
 */
export const settingsObjects: any[] = [SysSetting, SysPlatformSetting, SysSettingAudit];

/** Manifest header shared by compile-time config and runtime registration. */
export const settingsPluginManifestHeader = {
  id: SETTINGS_PLUGIN_ID,
  namespace: 'sys',
  version: SETTINGS_PLUGIN_VERSION,
  type: 'plugin' as const,
  scope: 'system' as const,
  name: 'Settings Service',
  description:
    'Generic settings registry + K/V resolver with OS_* env > Tenant > User > Default precedence. ADR-0007.',
};
