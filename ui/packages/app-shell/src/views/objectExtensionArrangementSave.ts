// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE write of an installed object's arrangement (ADR-0146 D2/D3/D10): the
 * keys `CUSTOM_ARRANGEMENT_KEYS` names (`fieldGroups`, `relatedLists`), written
 * into the object extension of the base's paired `.custom` package and
 * published at once, so everyone sees it.
 *
 * Every arrangement editor of an installed object is a caller of this one
 * writer, never a second writer: the record page's 「Configure tabs」 hands it
 * `relatedLists` (objectstack#36499); a field-layout editor hands it
 * `fieldGroups` the same way.
 *
 * - Where: the pair the ensure door answers for the object's package
 *   (`ensureCustomizationPackage`, which creates it on first use and names
 *   it). The pair's id is never spelled here. A pair the server does not list
 *   writable is refused before anything is written to it.
 * - What: the pair's stored extension of the object (`object_extension`,
 *   filed under the object's name), every key it holds kept (`fields`,
 *   `fieldPatches`, `place`, the other arrangement key, …), with ONLY the keys
 *   the caller returns replaced. A key returned `undefined` is taken off (the
 *   base's arrangement is served again). With no stored extension yet, the
 *   body is `{ extend: <object> }` plus those keys.
 * - From what: the caller composes its keys over what is STORED, never over
 *   what is served (`arrange` receives the stored extension and the stored
 *   object of the layered read): the served object carries read decorations
 *   and translated labels, and the folded result of every package.
 * - How: the runtime's confirmed-save rule (objectstack#35955), as the record
 *   page's own save and the design mode's menu save: the draft is written
 *   with the first-write pin, so a draft somebody left pending (in Studio,
 *   say) is refused, never overwritten nor published on its saver's behalf;
 *   a publish the server refuses discards the draft this save wrote; a landed
 *   publish announces itself and the console reads the object again.
 *
 * @module
 */

import { stripReadDecorations } from '@objectstack/spec/kernel';
import type { CustomArrangementKey } from '@objectstack/spec/data';
import { isDraftVersionConflict } from './metadata-admin/DraftConflictDialog.js';
import { OBJECT_EXTENSION_TYPE, objectExtensionBodyOf, type ObjectExtensionBody } from './studio-design/StudioCustomizeControls.js';
import type { EnsuredCustomizationPackage, ListedPackageManifest } from './studio-design/packages-io.js';

/** The doors the write goes through; the defaults are the console's own (`consoleExtensionArrangementDoors`). */
export interface ExtensionArrangementDoors {
  readonly listPackages: () => Promise<ReadonlyMap<string, Pick<ListedPackageManifest, 'writable'>>>;
  readonly ensureCustomization: (basePackageId: string) => Promise<Pick<EnsuredCustomizationPackage, 'packageId' | 'writable'>>;
  readonly client: {
    get: (type: string, name: string, options: { packageId?: string }) => Promise<unknown>;
    layered: (type: string, name: string, options: { packageId?: string }) => Promise<unknown>;
    save: (type: string, name: string, body: unknown, options: Record<string, unknown>) => Promise<unknown>;
    publish: (type: string, name: string, options: { packageId?: string }) => Promise<unknown>;
    reset: (type: string, name: string, options: Record<string, unknown>) => Promise<unknown>;
  };
  /** Announces the object changed, so the console reads it again. */
  readonly refreshed: () => void;
}

/** The sentences a refused write is said with, in the viewer's language. */
export interface ExtensionArrangementTexts {
  /** The object's package is not one the server lists. */
  readonly notListed: string;
  /** A draft of the pair's extension is already pending. */
  readonly pendingDraft: string;
  /** The customization package the server answered is not writable. */
  readonly notWritable: string;
}

/** What a caller composes its keys over: both as STORED. */
export interface StoredArrangement {
  /** The pair's stored extension of the object, `null` when it has none yet. */
  readonly extension: ObjectExtensionBody | null;
  /** The object as its own package stores it (the layered read), never as served. */
  readonly object: Record<string, unknown>;
}

/** The arrangement keys to write: a key present replaces the stored one; `undefined` takes it off. */
export type ExtensionArrangementPatch = Partial<Record<CustomArrangementKey, unknown[] | undefined>>;

/** A document as stored, less what a read adds and what belongs to its package. */
function documentOf(read: unknown): Record<string, unknown> {
  const body = stripReadDecorations((read ?? {}) as Record<string, unknown>) as Record<string, unknown>;
  const doc: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) if (!key.startsWith('_')) doc[key] = value;
  return doc;
}

/** The stored object of a layered read: its effective layer, else its code. */
function storedObjectOf(layers: unknown): Record<string, unknown> {
  const read = (layers ?? {}) as { effective?: unknown; code?: unknown };
  return documentOf(read.effective ?? read.code ?? {});
}

/** `stored` with `patch`'s keys replaced (or taken off), every other key kept. */
export function extensionWithArrangement(
  stored: ObjectExtensionBody | null,
  objectName: string,
  patch: ExtensionArrangementPatch,
): ObjectExtensionBody {
  const body: ObjectExtensionBody = { ...(stored ?? {}), extend: objectName };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete body[key];
    else body[key] = value;
  }
  return body;
}

/**
 * Write `arrange`'s keys into the pair's extension of the object `objectName`
 * of the read-only package `basePackageId`, and publish it. Answers the pair's
 * id.
 */
export async function saveObjectExtensionArrangement(
  input: {
    objectName: string;
    basePackageId: string;
    arrange: (stored: StoredArrangement) => ExtensionArrangementPatch;
  },
  texts: ExtensionArrangementTexts,
  doors: ExtensionArrangementDoors,
): Promise<string> {
  const { objectName, basePackageId, arrange } = input;
  const manifests = await doors.listPackages();
  if (!manifests.has(basePackageId)) throw new Error(texts.notListed);
  const pair = await doors.ensureCustomization(basePackageId);
  if (!pair.writable) throw new Error(texts.notWritable);
  const target = pair.packageId;
  const [extensionRead, objectRead] = await Promise.all([
    doors.client.get(OBJECT_EXTENSION_TYPE, objectName, { packageId: target }),
    doors.client.layered('object', objectName, { packageId: basePackageId }),
  ]);
  const extension = objectExtensionBodyOf(extensionRead, objectName);
  const body = extensionWithArrangement(
    extension,
    objectName,
    arrange({ extension, object: storedObjectOf(objectRead) }),
  );
  try {
    await doors.client.save(OBJECT_EXTENSION_TYPE, objectName, body, { mode: 'draft', packageId: target, ifNoneMatch: '*' });
  } catch (err) {
    if (isDraftVersionConflict(err)) throw Object.assign(new Error(texts.pendingDraft), { cause: err });
    throw err;
  }
  try {
    await doors.client.publish(OBJECT_EXTENSION_TYPE, objectName, { packageId: target });
  } catch (err) {
    try {
      await doors.client.reset(OBJECT_EXTENSION_TYPE, objectName, { state: 'draft', packageId: target });
    } catch (discardErr) {
      console.error('[object-extension] a refused publish left the extension draft pending:', discardErr);
    }
    doors.refreshed();
    throw err;
  }
  doors.refreshed();
  return target;
}
