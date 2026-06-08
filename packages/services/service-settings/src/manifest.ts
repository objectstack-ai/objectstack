// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { SysSetting, SysSecret, SysSettingAudit } from '@objectstack/platform-objects/system';

export const SETTINGS_PLUGIN_ID = 'com.objectstack.service.settings';
export const SETTINGS_PLUGIN_VERSION = '0.1.0';

/** Objects owned by service-settings. Currently just the K/V store. */
export const settingsObjects: any[] = [SysSetting, SysSecret, SysSettingAudit];

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
