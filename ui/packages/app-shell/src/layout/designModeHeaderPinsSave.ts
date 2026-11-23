// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The write behind the design mode's 「Save」 for an object's action
 * arrangement (objectstack#36366): the object's `actionLayout`, written into
 * its customization layer and published at once, so everyone sees it. Only
 * the arms the administrator changed are written, each whole
 * (`{ pinned, more }`): an arm the staged value carries as the object serves
 * it is left as the target document holds it (or absent), so the served arm
 * of the base or of another layer is never copied in, where it would mask a
 * later change of its owner. The pair's arm replaces the object's arm whole
 * in the fold, and removing it restores the package's own. A built-in
 * (`$import`) is only ever pinned, so `more` is written with action names
 * only.
 *
 * Where it is written follows ADR-0146 D10 (objects are extended, never
 * replaced), as Studio's object editing does:
 *
 * - the object's own package when the server lists it writable: the object as
 *   its author wrote it (`overlay ?? code` of its layered read, never the
 *   served object, which folds other packages' actions and fields in), with
 *   the new `actionLayout`;
 * - else the base's paired customization package, asked of the ensure door
 *   (which creates it on first use and names it): the pair's
 *   `object_extension` of the object, as published there (or a new one), with
 *   the new `actionLayout`. The fold carries it onto the object.
 *
 * How it is written is the runtime's confirmed-save rule, as the app menu's
 * save (`designModeMenuSave.ts`): the draft is written with the first-write
 * pin, so a draft somebody left pending is refused, never overwritten nor
 * published on its saver's behalf, and the refusal is said; a publish the
 * server refuses discards the draft this save wrote. A landed publish
 * announces itself (`emitMetadataRefresh`), and the console re-reads the
 * object.
 *
 * Before anything is written, every name of both parts is checked against the
 * object as served (every package's actions): a name that is no action of the
 * object, or one not placed in that arm's scope, is refused with its reason.
 * (More than three pinned, and a name in both parts, the schema refuses at
 * the server's door, with its own reason.)
 *
 * @module
 */

import { stripReadDecorations } from '@objectstack/spec/kernel';
import { emitMetadataRefresh } from '../assistant/assistantBus.js';
import { isDraftVersionConflict } from '../views/metadata-admin/DraftConflictDialog.js';
import { authoredPublished, type AuthoredLayers } from '../views/metadata-admin/authoredObjectBuffer.js';
import { OBJECT_EXTENSION_TYPE } from '../views/studio-design/StudioCustomizeControls.js';
import {
  ensureCustomizationPackage,
  fetchListedPackageManifests,
  type EnsuredCustomizationPackage,
  type ListedPackageManifest,
} from '../views/studio-design/packages-io.js';
import { pinsRefusal, servedPins, type ObjectPins, type PinPage } from './designModeHeaderPins.js';

/** The doors the save goes through; the defaults are the console's own. */
export interface ObjectPinsSaveDoors {
  readonly listPackages: () => Promise<ReadonlyMap<string, ListedPackageManifest>>;
  readonly ensureCustomization: (basePackageId: string) => Promise<EnsuredCustomizationPackage>;
  readonly client: {
    layered: (type: string, name: string, options: { packageId?: string }) => Promise<unknown>;
    get: (type: string, name: string, options?: Record<string, unknown>) => Promise<unknown>;
    save: (type: string, name: string, body: unknown, options: Record<string, unknown>) => Promise<unknown>;
    publish: (type: string, name: string, options: { packageId?: string }) => Promise<unknown>;
    reset: (type: string, name: string, options: Record<string, unknown>) => Promise<unknown>;
  };
}

/** The sentences a refused save is said with, in the viewer's language. */
export interface ObjectPinsSaveTexts {
  /** The object's package is not one the server lists. */
  readonly notListed: string;
  /** A draft of the object (or of its extension) is already pending. */
  readonly pendingDraft: string;
  /** `name` is no action of the object. */
  readonly unknown: (name: string) => string;
  /** `name` is an action of the object not placed in that arm's scope. */
  readonly notPlaced: (name: string) => string;
}

/** A document as stored, less what a read adds and what belongs to its package. */
function documentOf(read: unknown): Record<string, unknown> {
  const body = stripReadDecorations((read ?? {}) as Record<string, unknown>) as Record<string, unknown>;
  const doc: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) if (!key.startsWith('_')) doc[key] = value;
  return doc;
}

/** One arm as written: its `pinned`, and its `more` (action names only, a built-in being only ever pinned) when it has one. */
function armValue(arm: NonNullable<ObjectPins['list']>): NonNullable<ObjectPins['list']> {
  const more = arm.more?.filter((name) => !name.startsWith('$'));
  return more ? { pinned: [...arm.pinned], more } : { pinned: [...arm.pinned] };
}

const SCOPES: readonly PinPage[] = ['list', 'record'];

/** One arm as compared: absent and a value are different arrangements. */
function armKey(arm: ObjectPins['list']): string {
  return arm ? JSON.stringify(armValue(arm)) : '';
}

/** The scopes whose arm `pins` stages differently from the arm the object is served with. */
export function changedScopes(pins: ObjectPins, served: unknown): PinPage[] {
  const before = servedPins(served);
  return SCOPES.filter((scope) => armKey(pins[scope]) !== armKey(before[scope]));
}

/**
 * The `actionLayout` the target document is written with: the one it holds,
 * with each changed scope's arm as staged (taken off where the staged value
 * has none). `undefined` when it then arranges nothing.
 */
function actionLayoutValue(held: unknown, pins: ObjectPins, changed: readonly PinPage[]): ObjectPins | undefined {
  const out: Record<string, unknown> =
    held && typeof held === 'object' && !Array.isArray(held) ? { ...(held as Record<string, unknown>) } : {};
  for (const scope of changed) {
    const arm = pins[scope];
    if (arm) out[scope] = armValue(arm);
    else delete out[scope];
  }
  return Object.keys(out).length > 0 ? (out as ObjectPins) : undefined;
}

/** `body` with its `actionLayout` set to `layout`, or without the key when `layout` is `undefined`. */
function withActionLayout(body: Record<string, unknown>, layout: ObjectPins | undefined): Record<string, unknown> {
  const { actionLayout: _held, ...rest } = body;
  return layout ? { ...rest, actionLayout: layout } : rest;
}

/** Whether `err` says the item is not there (`404`). */
function isNotFound(err: unknown): boolean {
  return (err as { status?: unknown } | null | undefined)?.status === 404;
}

/** Save `pins` as the action layout of the object `objectName` of the package `packageId`, and publish them. */
export async function saveObjectPins(
  input: { objectName: string; packageId: string; served: unknown; pins: ObjectPins },
  texts: ObjectPinsSaveTexts,
  doors: ObjectPinsSaveDoors,
): Promise<void> {
  const { objectName, packageId, served, pins } = input;
  const refusal = pinsRefusal(served, pins, texts);
  if (refusal) throw new Error(refusal);
  const changed = changedScopes(pins, served);
  if (changed.length === 0) return;
  const manifests = await doors.listPackages();
  const listed = manifests.get(packageId);
  if (!listed) throw new Error(texts.notListed);

  let type = 'object';
  let target = packageId;
  let body: Record<string, unknown>;
  if (listed.writable) {
    const layers = (await doors.client.layered('object', objectName, { packageId })) as AuthoredLayers | null;
    if (layers && 'draft' in layers && layers.draft) throw new Error(texts.pendingDraft);
    const authored = authoredPublished('object', layers) as Record<string, unknown>;
    body = withActionLayout({ ...authored, name: objectName }, actionLayoutValue(authored.actionLayout, pins, changed));
  } else {
    const pair = await doors.ensureCustomization(packageId);
    type = OBJECT_EXTENSION_TYPE;
    target = pair.packageId;
    let published: unknown = null;
    try {
      published = await doors.client.get(OBJECT_EXTENSION_TYPE, objectName, { packageId: target });
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    const doc = documentOf(published);
    body = withActionLayout({ ...doc, extend: objectName }, actionLayoutValue(doc.actionLayout, pins, changed));
  }
  try {
    await doors.client.save(type, objectName, body, { mode: 'draft', packageId: target, ifNoneMatch: '*' });
  } catch (err) {
    if (isDraftVersionConflict(err)) throw Object.assign(new Error(texts.pendingDraft), { cause: err });
    throw err;
  }
  try {
    await doors.client.publish(type, objectName, { packageId: target });
  } catch (err) {
    try {
      await doors.client.reset(type, objectName, { state: 'draft', packageId: target });
    } catch (discardErr) {
      console.error('[design-mode] a refused publish left the action layout draft pending:', discardErr);
    }
    emitMetadataRefresh();
    throw err;
  }
  emitMetadataRefresh();
}

/** The console's doors, around `client` (`useMetadataClient()`). */
export function consoleObjectPinsDoors(client: ObjectPinsSaveDoors['client']): ObjectPinsSaveDoors {
  return { listPackages: fetchListedPackageManifests, ensureCustomization: ensureCustomizationPackage, client };
}
