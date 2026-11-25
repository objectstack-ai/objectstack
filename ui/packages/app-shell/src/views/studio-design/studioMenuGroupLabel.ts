// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The name the left menu draws for each of its six groups (objectstack
 * ADR-0084, amended 2026-11-24; decision 11 of #36890): the registered domain's
 * name in the shared dictionary (`translateMetadataDomain`), which draws
 * `system` as Platform / 平台 and `security` as Access / 访问.
 *
 * One dictionary, so the menu, the All metadata directory's headings and chips,
 * and a type or item page's domain badge cannot name a group two ways.
 */

import { translateMetadataDomain } from '../metadata-admin/i18n.js';
import type { StudioMenuGroup } from './studioMenuModel.js';

export function studioMenuGroupLabel(group: StudioMenuGroup, locale: string): string {
  return translateMetadataDomain(group, locale);
}
