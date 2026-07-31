// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { SysSetting, SysSettingAudit } from '@objectstack/platform-objects/system';

export const SETTINGS_PLUGIN_ID = 'com.objectstack.service.settings';
export const SETTINGS_PLUGIN_VERSION = '0.1.0';

/**
 * Objects owned by service-settings: the K/V store and its audit trail.
 *
 * `sys_secret` is deliberately NOT here (#4270): its producers span domains
 * (encrypted settings here, the engine's `secret`-field encryption, the
 * datasource credential binder) and the engine fails closed when the store
 * is missing — so it is registered by `PlatformObjectsPlugin` as platform
 * infrastructure, present with or without this service (cf. `sys_migration`,
 * #4243). This service remains a producer/consumer via its secret store.
 */
export const settingsObjects: any[] = [SysSetting, SysSettingAudit];

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
