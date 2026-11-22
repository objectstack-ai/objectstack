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
 * What is written is the app as STORED, never as served (objectstack#36363,
 * review 7081226692): the served app is translated for the reader's language
 * (`translateApp`) and pruned of entries the reader may not open
 * (`filterNav`), so writing it back would store the reader's language on
 * every label and drop what the reader was not shown. The stored app is the
 * layered read (`/layers`, which serves a caller who may write the app its
 * stored version, unpruned and untranslated), and the menu edits are
 * replayed on its navigation by entry id (`rebaseMenuEdits`); an entry
 * naming no target is left out (`navPayloadOf`, as Studio's nav save).
 *
 * Nothing is created before every check has passed: the base's version is
 * read before the customization package is asked for, and a pair the server
 * does not list writable is refused before anything is written to it.
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
import { navPayloadOf } from '../views/metadata-admin/previews/AppNavCanvas.js';
import { rebaseMenuEdits, type Menu } from './designModeMenu.js';

/** The doors the save goes through; the defaults are the console's own. */
export interface AppMenuSaveDoors {
  readonly listPackages: () => Promise<ReadonlyMap<string, ListedPackageManifest>>;
  readonly ensureCustomization: (basePackageId: string) => Promise<EnsuredCustomizationPackage>;
  readonly client: {
    layered: (type: string, name: string, options: { packageId?: string }) => Promise<unknown>;
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
  /** The customization package the server answered is not writable. */
  readonly notWritable: string;
}

/** A document as stored, less what a read adds and what belongs to its package. */
function documentOf(read: unknown): Record<string, unknown> {
  const body = stripReadDecorations((read ?? {}) as Record<string, unknown>) as Record<string, unknown>;
  const doc: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) if (!key.startsWith('_')) doc[key] = value;
  return doc;
}

/** The stored app of a layered read: its effective layer (the override folded over the base), else its code. */
function storedApp(layers: unknown): Record<string, unknown> {
  const read = (layers ?? {}) as { effective?: unknown; code?: unknown };
  return documentOf(read.effective ?? read.code ?? {});
}

/**
 * Save the menu edits that turned `served` (the menu the editor was seeded
 * from) into `navigation`, as the menu of the app `appName` of the package
 * `packageId`, and publish it.
 */
export async function saveAppMenu(
  input: { appName: string; packageId: string; served: Menu; navigation: Menu },
  texts: AppMenuSaveTexts,
  doors: AppMenuSaveDoors,
): Promise<void> {
  const { appName, packageId, served, navigation } = input;
  const manifests = await doors.listPackages();
  const listed = manifests.get(packageId);
  if (!listed) throw new Error(texts.notListed);
  // The app as stored, a customization of an installed app folded in.
  const stored = storedApp(await doors.client.layered('app', appName, { packageId }));
  const storedNav = Array.isArray(stored.navigation) ? (stored.navigation as Menu) : [];
  const nextNav = navPayloadOf(rebaseMenuEdits(served, navigation, storedNav) as unknown[]);
  let body: Record<string, unknown> | null = { ...stored, name: appName, navigation: nextNav };
  let target = packageId;
  if (!listed.writable) {
    body = overrideDraftBody(body, packageId, listedPackageVersion(manifests, packageId));
    if (body === null) throw new Error(texts.noVersion);
    const pair = await doors.ensureCustomization(packageId);
    if (!pair.writable) throw new Error(texts.notWritable);
    target = pair.packageId;
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

/**
 * The stored menu of the app `appName` of the package `packageId`: the
 * navigation of its layered read (`storedApp`), `null` when the read fails.
 * The editor compares an entry's shown label with it to tell a translated
 * label from the stored one (objectstack#36363, ruling (4)).
 */
export async function readStoredMenu(
  appName: string,
  packageId: string,
  client: Pick<AppMenuSaveDoors['client'], 'layered'>,
): Promise<Menu | null> {
  try {
    const stored = storedApp(await client.layered('app', appName, packageId ? { packageId } : {}));
    return Array.isArray(stored.navigation) ? (stored.navigation as Menu) : [];
  } catch {
    return null;
  }
}

let defaultLocaleRead: Promise<string | null> | null = null;

/**
 * The deployment's default language, as `GET /api/v1/i18n/locales` marks it
 * (`isDefault`), read once per page load; `null` when the read fails or marks
 * none. The stored labels are taken to be in it: the server states no
 * `sourceLocale` of its own yet (objectstack#36504).
 */
export function fetchDefaultLocale(): Promise<string | null> {
  if (defaultLocaleRead) return defaultLocaleRead;
  defaultLocaleRead = (async () => {
    try {
      const res = await fetch('/api/v1/i18n/locales', { credentials: 'include' });
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: { locales?: unknown }; locales?: unknown };
      const locales = Array.isArray(json?.data?.locales) ? json.data.locales : Array.isArray(json?.locales) ? json.locales : [];
      const marked = (locales as Array<{ code?: unknown; isDefault?: unknown }>).find((l) => l?.isDefault === true);
      return typeof marked?.code === 'string' && marked.code ? marked.code : null;
    } catch {
      return null;
    }
  })();
  return defaultLocaleRead;
}

/** Test seam: forget the default-language read. Not public. */
export function __resetDefaultLocale(): void {
  defaultLocaleRead = null;
}

/**
 * Whether the session language `language` is the language `locale`: the same
 * tag, letter case aside, or the same base when either names no region
 * (`en` is `en-US`; `zh-CN` is not `zh-TW`).
 */
export function isSameLanguage(language: string, locale: string): boolean {
  const a = language.trim().toLowerCase().replace(/_/g, '-');
  const b = locale.trim().toLowerCase().replace(/_/g, '-');
  if (!a || !b) return false;
  if (a === b) return true;
  const [baseA, ...restA] = a.split('-');
  const [baseB, ...restB] = b.split('-');
  return baseA === baseB && (restA.length === 0 || restB.length === 0);
}
