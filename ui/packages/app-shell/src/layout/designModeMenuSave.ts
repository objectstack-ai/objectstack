// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The write behind the design mode's 「Save」 for the app's menu
 * (objectstack#36363): the app document with its new `navigation`, written
 * where Studio's menu editing writes it and published at once, so everyone
 * sees it.
 *
 * Where it is written is Studio's rule (`StudioDesignSurface`'s nav save,
 * objectstack#30059, ADR-0146 D2/D3): the app's own package when the server
 * lists it writable, else the base's paired customization package, asked of
 * the ensure door (which creates it on first use and names it), the body
 * declaring the override of the base at the base's listed version
 * (`overrideDraftBody`). An installed app's menu is thereby a customization
 * of this environment, as Studio's is.
 *
 * How it is written is the runtime's confirmed-save rule
 * (`saveAndPublishRuntimeMetadata`, objectstack#35955): the draft is written
 * with the first-write pin, so a draft somebody left pending (in Studio, say)
 * is refused, never overwritten nor published on its saver's behalf, and the
 * refusal is said; a publish the server refuses discards the draft this save
 * wrote. A landed publish announces itself (`emitMetadataRefresh`), and the
 * console re-reads the app, its menu included.
 *
 * @module
 */

import { stripReadDecorations } from '@objectstack/spec/kernel';
import { emitMetadataRefresh } from '../assistant/assistantBus.js';
import { isDraftVersionConflict } from '../views/metadata-admin/DraftConflictDialog.js';
import { overrideDraftBody } from '../views/studio-design/StudioCustomizeControls.js';
import {
  ensureCustomizationPackage,
  fetchListedPackageManifests,
  listedPackageVersion,
  type EnsuredCustomizationPackage,
  type ListedPackageManifest,
} from '../views/studio-design/packages-io.js';
import type { Menu } from './designModeMenu.js';

/** The doors the save goes through; the defaults are the console's own. */
export interface AppMenuSaveDoors {
  readonly listPackages: () => Promise<ReadonlyMap<string, ListedPackageManifest>>;
  readonly ensureCustomization: (basePackageId: string) => Promise<EnsuredCustomizationPackage>;
  readonly client: {
    get: (type: string, name: string) => Promise<unknown>;
    save: (type: string, name: string, body: unknown, options: Record<string, unknown>) => Promise<unknown>;
    publish: (type: string, name: string, options: { packageId?: string }) => Promise<unknown>;
    reset: (type: string, name: string, options: Record<string, unknown>) => Promise<unknown>;
  };
}

/** The sentences a refused save is said with, in the viewer's language. */
export interface AppMenuSaveTexts {
  /** The app's package is not one the server lists. */
  readonly notListed: string;
  /** A draft of the app is already pending. */
  readonly pendingDraft: string;
  /** The base's listed manifest states no version to declare the override at. */
  readonly noVersion: string;
}

/** The app document as served, less what a read adds and what belongs to its package. */
function documentOf(served: unknown): Record<string, unknown> {
  const body = stripReadDecorations((served ?? {}) as Record<string, unknown>) as Record<string, unknown>;
  const doc: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) if (!key.startsWith('_')) doc[key] = value;
  return doc;
}

/** Save `navigation` as the menu of the app `appName` of the package `packageId`, and publish it. */
export async function saveAppMenu(
  input: { appName: string; packageId: string; navigation: Menu },
  texts: AppMenuSaveTexts,
  doors: AppMenuSaveDoors,
): Promise<void> {
  const { appName, packageId, navigation } = input;
  const manifests = await doors.listPackages();
  const listed = manifests.get(packageId);
  if (!listed) throw new Error(texts.notListed);
  // The app as everyone sees it now, a customization of an installed app included.
  const served = documentOf(await doors.client.get('app', appName));
  let body: Record<string, unknown> | null = { ...served, name: appName, navigation };
  let target = packageId;
  if (!listed.writable) {
    const pair = await doors.ensureCustomization(packageId);
    target = pair.packageId;
    body = overrideDraftBody(body, packageId, listedPackageVersion(manifests, packageId));
    if (body === null) throw new Error(texts.noVersion);
  }
  try {
    await doors.client.save('app', appName, body, { mode: 'draft', packageId: target, ifNoneMatch: '*' });
  } catch (err) {
    if (isDraftVersionConflict(err)) throw Object.assign(new Error(texts.pendingDraft), { cause: err });
    throw err;
  }
  try {
    await doors.client.publish('app', appName, { packageId: target });
  } catch (err) {
    try {
      await doors.client.reset('app', appName, { state: 'draft', packageId: target });
    } catch (discardErr) {
      console.error('[design-mode] a refused publish left the menu draft pending:', discardErr);
    }
    emitMetadataRefresh();
    throw err;
  }
  emitMetadataRefresh();
}

/** The console's doors, around `client` (`useMetadataClient()`). */
export function consoleAppMenuDoors(client: AppMenuSaveDoors['client']): AppMenuSaveDoors {
  return { listPackages: fetchListedPackageManifests, ensureCustomization: ensureCustomizationPackage, client };
}
