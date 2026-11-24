// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The name the left menu draws for each of its six groups (objectstack
 * ADR-0084, amended 2026-11-24; decision 11 of #36890): the registered domain's
 * label, except two the amendment renames for the menu, `system` → Platform /
 * 平台 and `security` → Access / 访问.
 *
 * Menu-only on purpose. The shared dictionary (`translateMetadataDomain`) keeps
 * System / 系统 and Security / 安全: it has readers outside the menu, Setup's
 * datasource pages among them (`PageShell`'s domain badge), and no other
 * Studio heading or chip is renamed by this.
 */

import { t, translateMetadataDomain } from '../metadata-admin/i18n.js';
import type { StudioMenuGroup } from './studioMenuModel.js';

const MENU_GROUP_LABEL_KEYS: Partial<Record<StudioMenuGroup, string>> = {
  system: 'engine.studio.menu.groupSystem',
  security: 'engine.studio.menu.groupSecurity',
};

export function studioMenuGroupLabel(group: StudioMenuGroup, locale: string): string {
  const key = MENU_GROUP_LABEL_KEYS[group];
  return key ? t(key, locale) : translateMetadataDomain(group, locale);
}
