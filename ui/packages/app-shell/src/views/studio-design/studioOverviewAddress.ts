// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37454 (ADR-0084, amended 2026-11-26, 概览 Overview) — the
 * address of a package's own page and of its open tab.
 *
 * The open tab rides on the console's reserved `?tab=`
 * ({@link RECORD_DETAIL_TAB_PARAM}, `urlParams.ts`; ui AGENTS rule #8), the
 * key Studio's item pages read too (`ITEM_TOOL_TAB_PARAM` aliases it). It is
 * not restated as a Studio constant.
 *
 * Why this is not in `studioAddress.ts` with the other builders:
 * `urlParams.ts` imports `studioAddress.ts` (it re-exports
 * `STUDIO_RETURN_PARAM` and lists it in `RESERVED_URL_PARAMS` at module
 * scope), so `studioAddress.ts` importing `urlParams.ts` back would make a
 * cycle whose evaluation order decides whether that list reads an
 * uninitialised binding. This module imports both and is imported by neither.
 * The address table (`studioAddressTable.ts`) still lists the builder.
 *
 * Pure: no React, no router.
 */

import { RECORD_DETAIL_TAB_PARAM } from '../../urlParams.js';
import { STUDIO_OVERVIEW_SECTION, studioPath } from './studioAddress.js';

/** The overview's tabs, in their order: 信息 Info, then 待发布 Pending. */
export const STUDIO_OVERVIEW_TABS = ['info', 'pending'] as const;
export type StudioOverviewTab = (typeof STUDIO_OVERVIEW_TABS)[number];

/** The overview's tab a `?tab=` value names: `pending`, else Info (the default). */
export function studioOverviewTab(value: string | null | undefined): StudioOverviewTab {
  return value === 'pending' ? 'pending' : 'info';
}

/**
 * A package's 概览 Overview, `/studio/<package>/overview`, on its Info tab, or
 * on its Pending tab (`?tab=pending`, where the menu's pending badge leads).
 */
export function studioPackageOverviewPath(packageId: string, options: { tab?: StudioOverviewTab } = {}): string {
  const query = options.tab && options.tab !== 'info' ? new URLSearchParams([[RECORD_DETAIL_TAB_PARAM, options.tab]]) : null;
  return studioPath(packageId, STUDIO_OVERVIEW_SECTION, null, { query });
}
