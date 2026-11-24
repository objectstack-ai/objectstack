// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A new dashboard made from the design mode's 「Add menu item」
 * (objectstack#36364): named in the picker, created where the menu is
 * saved, and put in the menu in the place the editor held for it.
 *
 * Where it is saved is the menu's own package (`prepareAppMenuSave`): the
 * app's package when the server lists it writable, else its customization
 * package (ADR-0146 D2, the maintainer's 「定制都进 .custom」; objectstack#35624
 * ruling C). Where no such package can be had the menu cannot be saved
 * either, so nothing is created: there is no package-less fallback here.
 *
 * The order is what keeps a refused save from leaving anything behind:
 *
 * 1. every check of the menu save is made first, and nothing is written
 *    before they pass;
 * 2. the item is created and published in that package (a dashboard empty,
 *    `saveDashboardInPlace`; a report as the builder made it,
 *    `saveAndPublishInPackage`), so everyone the menu shows it to finds it,
 *    never a missing one;
 * 3. the menu is written and published (`writeAppMenu`), the new entry and
 *    every other staged menu edit with it;
 * 4. when the menu is refused, the item made in step 2 is removed again
 *    (the item's delete in its package), and the refusal is said. Should that
 *    removal be refused too, the refusal says the item was left.
 *
 * A dashboard is created from its name alone. A report is not: the spec
 * refuses a report without `dataset` and `values`, so 「New report…」 opens
 * the report builder instead (the seat's option A), and the report is
 * created here, by the same steps, with the body the builder made, once the
 * builder saves (`designModeReportSlot`). Cancelling the builder writes
 * nothing.
 *
 * @module
 */

import { emitMetadataRefresh } from '../assistant/assistantBus.js';
import { slugify } from '../views/metadata-admin/createDerive.js';
import { loadHanRomanizer, romanizeHan, romanizerPending } from '../views/metadata-admin/romanizeHan.js';
import { saveAndPublishInPackage, saveDashboardInPlace } from '../views/runtime-metadata-persistence.js';
import type { Menu } from './designModeMenuModel.js';
import {
  prepareAppMenuSave,
  writeAppMenu,
  type AppMenuSaveDoors,
  type AppMenuSaveTexts,
} from './designModeMenuSave.js';

/** The kinds of thing the picker creates from a name alone. */
export const NEW_MENU_ITEM_KINDS = ['dashboard'] as const;
export type NewMenuItemKind = (typeof NEW_MENU_ITEM_KINDS)[number];

/** Every kind a menu entry can be created with: a report comes from the report builder. */
export type CreatedMenuItemKind = NewMenuItemKind | 'report';

export function isNewMenuItemKind(kind: string): kind is NewMenuItemKind {
  return (NEW_MENU_ITEM_KINDS as readonly string[]).includes(kind);
}

/**
 * The thing to create: its kind, its machine name and the name the reader
 * gave it; a report also carries the body the report builder made.
 */
export type NewMenuItem =
  | { readonly kind: NewMenuItemKind; readonly name: string; readonly label: string }
  | { readonly kind: 'report'; readonly name: string; readonly label: string; readonly body: Record<string, unknown> };

/** The sentences a refused create is said with, in the viewer's language. */
export interface NewMenuItemTexts extends AppMenuSaveTexts {
  /** A draft is already pending under the new item's name. */
  readonly itemPendingDraft: string;
  /** The menu was refused and the item created for it could not be removed; `{{name}}` is its name. */
  readonly itemLeft: string;
}

/** The longest machine name the generator writes, before a numeric suffix. */
const NAME_MAX = 48;

/**
 * A machine name for a new `kind` named `label`: the name's snake_case form
 * (a Chinese name through its pinyin, `romanizeHan`), else the kind, made
 * unique against `taken` with a `_2`, `_3`, … suffix.
 */
export function uniqueItemName(kind: NewMenuItemKind, label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let base = slugify(romanizeHan(label)).slice(0, NAME_MAX).replace(/_+$/g, '');
  if (!/^[a-z_][a-z0-9_]*$/.test(base)) base = kind;
  if (!used.has(base)) return base;
  for (let i = 2; i < 10_000; i += 1) {
    const candidate = `${base}_${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}_${Date.now().toString(36)}`;
}

/** How many names {@link freeItemName} asks the server about before it gives up. */
const NAME_TRIES = 20;

/**
 * A machine name for a new `kind` named `label` that no item of that kind
 * holds, in any package: each candidate ({@link uniqueItemName}, `taken`
 * left out) is read by name, and a name the read finds is passed over. A
 * read that fails is thrown: a name that could not be checked is not used,
 * since saving over an existing item would publish over it. A Chinese name
 * waits for the pinyin dictionary first, so its machine name reads as it.
 */
export async function freeItemName(
  kind: NewMenuItemKind,
  label: string,
  taken: Iterable<string>,
  client: { get: (type: string, name: string) => Promise<unknown> },
): Promise<string> {
  if (romanizerPending(label)) await loadHanRomanizer();
  const used = new Set(taken);
  for (let i = 0; i < NAME_TRIES; i += 1) {
    const candidate = uniqueItemName(kind, label, used);
    if ((await client.get(kind, candidate)) == null) return candidate;
    used.add(candidate);
  }
  throw new Error(`No free ${kind} name was found for "${label}".`);
}

/** The body a new `kind` is created with: an empty dashboard, or the report the builder made. */
export function newItemBody(item: NewMenuItem): Record<string, unknown> {
  switch (item.kind) {
    case 'dashboard':
      return { name: item.name, label: item.label, widgets: [] };
    case 'report':
      return { ...item.body, name: item.name };
  }
}

/**
 * Create `item`, then save the menu edits that turned `served` into
 * `navigation` (the new item's entry among them), in that order and in the
 * same package; when the menu is refused, the item is removed again.
 */
export async function saveAppMenuWithNewItem(
  input: { appName: string; packageId: string; served: Menu; navigation: Menu; item: NewMenuItem },
  texts: NewMenuItemTexts,
  doors: AppMenuSaveDoors,
): Promise<void> {
  const { item } = input;
  const prepared = await prepareAppMenuSave(input, texts, doors);
  const outcome =
    item.kind === 'dashboard'
      ? await saveDashboardInPlace(
          item.name,
          newItemBody(item),
          { kind: 'package', packageId: prepared.target },
          { metadataClient: doors.client },
        )
      : await saveAndPublishInPackage(item.kind, item.name, newItemBody(item), prepared.target, {
          metadataClient: doors.client,
        });
  if (outcome === 'pending-draft') throw new Error(texts.itemPendingDraft);
  try {
    await writeAppMenu(prepared, texts, doors);
  } catch (err) {
    try {
      await doors.client.reset(item.kind, item.name, { packageId: prepared.target });
    } catch (removeErr) {
      console.error(`[design-mode] the ${item.kind} "${item.name}" created for a refused menu was left:`, removeErr);
      const reason = err instanceof Error ? err.message : String(err);
      throw Object.assign(new Error(`${reason} ${texts.itemLeft}`), { cause: err });
    } finally {
      emitMetadataRefresh();
    }
    throw err;
  }
}
