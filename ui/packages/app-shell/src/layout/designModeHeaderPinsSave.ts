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
 * - else the base's paired customization package: `actionLayout` is one of
 *   the keys `CUSTOM_ARRANGEMENT_KEYS` names, so this save is a caller of the
 *   one writer of an installed object's arrangement
 *   (`saveObjectExtensionArrangement`, `../views/objectExtensionArrangementSave.ts`),
 *   never a second writer: it asks the ensure door for the pair, refuses a pair
 *   the server does not list writable, and keeps every key the pair's stored
 *   extension holds. This module only composes the `actionLayout` it hands
 *   over, from the one the stored extension holds. The fold carries it onto
 *   the object.
 *
 * How it is written is the runtime's confirmed-save rule, as the app menu's
 * save (`designModeMenuSave.ts`) and the one writer: the draft is written with
 * the first-write pin, so a draft somebody left pending is refused, never
 * overwritten nor published on its saver's behalf, and the refusal is said; a
 * publish the server refuses discards the draft this save wrote. A landed
 * publish announces itself (`emitMetadataRefresh`), and the console re-reads
 * the object.
 *
 * Before anything is written, every name of both parts is checked against the
 * object as served (every package's actions): a name that is no action of the
 * object, or one not placed in that arm's scope, is refused with its reason.
 * (More than three pinned, and a name in both parts, the schema refuses at
 * the server's door, with its own reason.)
 *
 * @module
 */

import type { ObjectActionLayout } from '@objectstack/spec/data';
import { emitMetadataRefresh } from '../assistant/assistantBus.js';
import { isDraftVersionConflict } from '../views/metadata-admin/draftVersionGuard.js';
import { authoredPublished, type AuthoredLayers } from '../views/metadata-admin/authoredObjectBuffer.js';
import { saveObjectExtensionArrangement } from '../views/objectExtensionArrangementSave.js';
import {
  ensureCustomizationPackage,
  fetchListedPackageManifests,
  type EnsuredCustomizationPackage,
  type ListedPackageManifest,
} from '../views/studio-design/packages-io.js';
import { pinsRefusal, servedPins, type ObjectPins, type PinPage } from './designModeHeaderPinsModel.js';

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
  /** The customization package the server answered for an installed object is not writable. */
  readonly pairNotWritable: string;
  /** `name` is no action of the object. */
  readonly unknown: (name: string) => string;
  /** `name` is an action of the object not placed in that arm's scope. */
  readonly notPlaced: (name: string) => string;
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
function actionLayoutValue(held: unknown, pins: ObjectPins, changed: readonly PinPage[]): ObjectActionLayout | undefined {
  const out: Record<string, unknown> =
    held && typeof held === 'object' && !Array.isArray(held) ? { ...(held as Record<string, unknown>) } : {};
  for (const scope of changed) {
    const arm = pins[scope];
    if (arm) out[scope] = armValue(arm);
    else delete out[scope];
  }
  return Object.keys(out).length > 0 ? (out as ObjectActionLayout) : undefined;
}

/** `body` with its `actionLayout` set to `layout`, or without the key when `layout` is `undefined`. */
function withActionLayout(body: Record<string, unknown>, layout: ObjectActionLayout | undefined): Record<string, unknown> {
  const { actionLayout: _held, ...rest } = body;
  return layout ? { ...rest, actionLayout: layout } : rest;
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

  if (!listed.writable) {
    // An installed object: the one writer of its arrangement writes the pair.
    await saveObjectExtensionArrangement(
      {
        objectName,
        basePackageId: packageId,
        arrange: ({ extension }) => ({ actionLayout: actionLayoutValue(extension?.actionLayout, pins, changed) }),
      },
      { notListed: texts.notListed, pendingDraft: texts.pendingDraft, notWritable: texts.pairNotWritable },
      { ...doors, listPackages: async () => manifests, refreshed: emitMetadataRefresh },
    );
    return;
  }

  const layers = (await doors.client.layered('object', objectName, { packageId })) as AuthoredLayers | null;
  if (layers && 'draft' in layers && layers.draft) throw new Error(texts.pendingDraft);
  const authored = authoredPublished('object', layers) as Record<string, unknown>;
  const body = withActionLayout({ ...authored, name: objectName }, actionLayoutValue(authored.actionLayout, pins, changed));
  try {
    await doors.client.save('object', objectName, body, { mode: 'draft', packageId, ifNoneMatch: '*' });
  } catch (err) {
    if (isDraftVersionConflict(err)) throw Object.assign(new Error(texts.pendingDraft), { cause: err });
    throw err;
  }
  try {
    await doors.client.publish('object', objectName, { packageId });
  } catch (err) {
    try {
      await doors.client.reset('object', objectName, { state: 'draft', packageId });
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
