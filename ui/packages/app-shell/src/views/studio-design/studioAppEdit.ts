// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where a dashboard or a report that the author opens from a Studio list opens:
 * the app's own edit state (objectstack#36906, epic #36890), not Studio's
 * generic item page.
 *
 * The app it opens in (decision 6), first match wins ({@link studioAppEditSegment}):
 *
 *  1. the app the author came from (`utils/appReturnPage.ts`), when it is one
 *     of the open package's published apps, or when its menu opens this item;
 *  2. otherwise the package's first published app;
 *  3. none: the package has no published app, or the item is in no package
 *     (the package-less scope and the cross-package leg). The item then opens
 *     the generic item page (decision 3).
 *
 * Rule 1's first half and rule 2 are the rule Studio's 「‹ Back to app」
 * applies (`studioBackTarget`), so both share {@link rememberedPackageApp} and
 * {@link packageAppSegment}. An app's segment is the one the console resolves:
 * the package id when the package ships one app, else the app's name
 * (ADR-0048 option A, `appAddressSegment`).
 *
 * Pure: no React and no router. The reads happen in `StudioMetadataArea`.
 *
 * @module
 */

import type { I18nLabel } from '@objectstack/spec/ui';
import type { AppReturnPage } from '../../utils/appReturnPage.js';
import { menuTargets, targetKeyFor, type Menu } from '../../layout/designModeMenuModel.js';

/** A published app of the open package. */
export interface StudioAppTarget {
  name: string;
  label: I18nLabel;
}

/** The types that open in an app's edit state, not in Studio's generic item page. */
export const STUDIO_APP_EDIT_TYPES = ['dashboard', 'report'] as const;
export type StudioAppEditType = (typeof STUDIO_APP_EDIT_TYPES)[number];

/** Whether an item of `type` opens in an app's edit state. */
export function isStudioAppEditType(type: string): type is StudioAppEditType {
  return (STUDIO_APP_EDIT_TYPES as readonly string[]).includes(type);
}

/**
 * The app segment of one of the package's published apps: the package id when
 * the package ships one app, else the app's name. With several apps, all of
 * them share the package id, and that id opens only the first one.
 */
export function packageAppSegment(packageId: string, apps: readonly StudioAppTarget[], app: StudioAppTarget): string {
  return apps.length > 1 ? app.name : packageId;
}

/**
 * The published app of the package that the remembered page belongs to, or
 * `undefined`. The page's record names its app by its route key, which is the
 * app's name or the package id.
 */
export function rememberedPackageApp(
  remembered: AppReturnPage | null,
  packageId: string,
  apps: readonly StudioAppTarget[],
): StudioAppTarget | undefined {
  if (!remembered) return undefined;
  const [first] = apps;
  return apps.find((a) => a.name === remembered.app) ?? (remembered.app === packageId ? first : undefined);
}

/** Whether the app `menu` (its `navigation`) opens the item `name` of `type`, at any depth. */
export function menuOpensItem(menu: unknown, type: StudioAppEditType, name: string): boolean {
  if (!Array.isArray(menu)) return false;
  return menuTargets(menu as Menu).has(targetKeyFor(type, name));
}

/**
 * The app segment that the item opens in, or `null` when there is none
 * (rule 3: the generic item page).
 *
 * `rememberedMenu` is the `navigation` of the remembered app when that app is
 * not one of the package's own. It is the app's own read; pass `undefined`
 * when there is no such app or the read failed.
 */
export function studioAppEditSegment({
  packageId,
  apps,
  remembered,
  rememberedMenu,
  type,
  name,
}: {
  packageId: string | null;
  apps: readonly StudioAppTarget[];
  remembered: AppReturnPage | null;
  rememberedMenu?: unknown;
  type: StudioAppEditType;
  name: string;
}): string | null {
  if (packageId === null || !name) return null;
  const own = rememberedPackageApp(remembered, packageId, apps);
  if (own) return packageAppSegment(packageId, apps, own);
  if (remembered && menuOpensItem(rememberedMenu, type, name)) return remembered.app;
  const [first] = apps;
  return first ? packageAppSegment(packageId, apps, first) : null;
}

/**
 * The app segment that a new report opens in (decision 13), or `null` when
 * there is none. A new report has no menu entry yet, so this is
 * {@link studioAppEditSegment} without the menu half of rule 1.
 */
export function studioAppCreateSegment({
  packageId,
  apps,
  remembered,
}: {
  packageId: string | null;
  apps: readonly StudioAppTarget[];
  remembered: AppReturnPage | null;
}): string | null {
  if (packageId === null) return null;
  const app = rememberedPackageApp(remembered, packageId, apps) ?? apps[0];
  return app ? packageAppSegment(packageId, apps, app) : null;
}

/**
 * Whether a create made in a Studio package's area lands on an item that opens
 * in an app (`StudioAreaAppGate`): a dashboard or a report, in a package. The
 * create page's own history entry is then replaced by the item, so Back from
 * the app page lands on the list, not on an empty create page.
 */
export function studioCreateLandsInApp(areaPackageId: string | null | undefined, type: string): boolean {
  return !!areaPackageId && isStudioAppEditType(type);
}

/** The item's page in the app at `segment`: `/apps/<app>/dashboard/<name>` or `/apps/<app>/report/<name>`. */
export function appItemPath(segment: string, type: StudioAppEditType, name: string): string {
  return `/apps/${encodeURIComponent(segment)}/${type}/${encodeURIComponent(name)}`;
}

/** The app's new-report page, `/apps/<app>/reports/new` (decision 13). */
export function appNewReportPath(segment: string): string {
  return `/apps/${encodeURIComponent(segment)}/reports/new`;
}
