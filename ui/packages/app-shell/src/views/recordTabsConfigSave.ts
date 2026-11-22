// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The write behind the record page's 「Configure tabs」 「Save」
 * (objectstack#36499): the object's `relatedLists`, written where the object
 * is kept and published at once, so everyone sees it.
 *
 * Where it is written is decided once, here ({@link resolveRecordTabsSaveTarget}):
 * the object's own package, when the server lists it writable (an object of a
 * self-built app). An object of a package the server lists read-only (an
 * installed app) is not offered the entry yet: its arrangement belongs in the
 * base's paired `.custom` package (ADR-0146 D10), a second target of this one
 * seam, never a second editor.
 *
 * What is written is the object as STORED, never as served — the precedent of
 * the design mode's menu save (`saveAppMenu`, objectstack#36363, review
 * 7081226692): the served object carries read decorations and may carry
 * another package's `place` spliced into its `relatedLists`, so writing it
 * back would store what the object never declared. The stored object is the
 * layered read, and the draft is replayed over its `relatedLists`
 * (`recordTabsEntries`).
 *
 * How it is written is the runtime's confirmed-save rule (objectstack#35955):
 * the draft is written with the first-write pin, so a draft somebody left
 * pending (in Studio, say) is refused, never overwritten nor published on its
 * saver's behalf, and the refusal is said; a publish the server refuses
 * discards the draft this save wrote. A landed publish announces itself
 * (`emitMetadataRefresh`), and the console reads the object again.
 *
 * @module
 */

import { stripReadDecorations } from '@objectstack/spec/kernel';
import { emitMetadataRefresh } from '../assistant/assistantBus.js';
import { isDraftVersionConflict } from './metadata-admin/DraftConflictDialog.js';
import {
  fetchListedPackageManifests,
  type ListedPackageManifest,
} from './studio-design/packages-io.js';
import { recordTabsEntries, type RecordTabsCatalog, type RecordTabsDraft } from './recordTabsConfig.js';

/** The doors the save goes through; the defaults are the console's own. */
export interface RecordTabsSaveDoors {
  readonly listPackages: () => Promise<ReadonlyMap<string, Pick<ListedPackageManifest, 'writable'>>>;
  readonly client: {
    layered: (type: string, name: string, options: { packageId?: string }) => Promise<unknown>;
    save: (type: string, name: string, body: unknown, options: Record<string, unknown>) => Promise<unknown>;
    publish: (type: string, name: string, options: { packageId?: string }) => Promise<unknown>;
    reset: (type: string, name: string, options: Record<string, unknown>) => Promise<unknown>;
  };
}

/** The sentences a refused save is said with, in the viewer's language. */
export interface RecordTabsSaveTexts {
  /** The object's package is not one the server lists. */
  readonly notListed: string;
  /** A draft of the object is already pending. */
  readonly pendingDraft: string;
  /** The object's package is not writable. */
  readonly notWritable: string;
}

/**
 * Where a save of an object's tabs lands. One kind today: the object's own
 * package. The installed-object arrangement (the paired `.custom` package's
 * object extension) is the second kind this union grows.
 */
export type RecordTabsSaveTarget = { readonly kind: 'package'; readonly packageId: string };

/**
 * The target for an object of `packageId`, from the package list: its own
 * package when listed writable, else `null` (not offered here).
 */
export function resolveRecordTabsSaveTarget(
  packageId: string,
  manifests: ReadonlyMap<string, Pick<ListedPackageManifest, 'writable'>>,
): RecordTabsSaveTarget | null {
  const listed = manifests.get(packageId);
  return listed?.writable ? { kind: 'package', packageId } : null;
}

/** A document as stored, less what a read adds and what belongs to its package. */
function documentOf(read: unknown): Record<string, unknown> {
  const body = stripReadDecorations((read ?? {}) as Record<string, unknown>) as Record<string, unknown>;
  const doc: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) if (!key.startsWith('_')) doc[key] = value;
  return doc;
}

/** The stored object of a layered read: its effective layer, else its code. */
export function storedObjectOf(layers: unknown): Record<string, unknown> {
  const read = (layers ?? {}) as { effective?: unknown; code?: unknown };
  return documentOf(read.effective ?? read.code ?? {});
}

/**
 * Save `draft` as the record-page tabs of the object `objectName` of the
 * package `packageId`, and publish it.
 */
export async function saveRecordTabs(
  input: { objectName: string; packageId: string; draft: RecordTabsDraft; catalog: RecordTabsCatalog },
  texts: RecordTabsSaveTexts,
  doors: RecordTabsSaveDoors,
): Promise<void> {
  const { objectName, packageId, draft, catalog } = input;
  const manifests = await doors.listPackages();
  if (!manifests.has(packageId)) throw new Error(texts.notListed);
  const target = resolveRecordTabsSaveTarget(packageId, manifests);
  if (!target) throw new Error(texts.notWritable);
  const stored = storedObjectOf(await doors.client.layered('object', objectName, { packageId: target.packageId }));
  const base = Array.isArray(stored.relatedLists) ? (stored.relatedLists as unknown[]) : undefined;
  const entries = recordTabsEntries(draft, base, catalog);
  const { relatedLists: _previous, ...rest } = stored;
  const body: Record<string, unknown> = { ...rest, name: objectName, ...(entries ? { relatedLists: entries } : {}) };
  try {
    await doors.client.save('object', objectName, body, { mode: 'draft', packageId: target.packageId, ifNoneMatch: '*' });
  } catch (err) {
    if (isDraftVersionConflict(err)) throw Object.assign(new Error(texts.pendingDraft), { cause: err });
    throw err;
  }
  try {
    await doors.client.publish('object', objectName, { packageId: target.packageId });
  } catch (err) {
    try {
      await doors.client.reset('object', objectName, { state: 'draft', packageId: target.packageId });
    } catch (discardErr) {
      console.error('[record-tabs] a refused publish left the object draft pending:', discardErr);
    }
    emitMetadataRefresh();
    throw err;
  }
  emitMetadataRefresh();
}

/** The console's doors, around `client` (`useMetadataClient()`). */
export function consoleRecordTabsDoors(client: RecordTabsSaveDoors['client']): RecordTabsSaveDoors {
  return { listPackages: fetchListedPackageManifests, client };
}

/**
 * The object's stored `relatedLists` (the layered read), `null` when the read
 * fails. The editor compares a tab's shown name with the stored one to tell a
 * translated name from the stored one (the menu's rename precedent).
 */
export async function readStoredRelatedLists(
  objectName: string,
  packageId: string,
  client: Pick<RecordTabsSaveDoors['client'], 'layered'>,
): Promise<unknown[] | null> {
  try {
    const stored = storedObjectOf(await client.layered('object', objectName, { packageId }));
    return Array.isArray(stored.relatedLists) ? (stored.relatedLists as unknown[]) : [];
  } catch {
    return null;
  }
}
