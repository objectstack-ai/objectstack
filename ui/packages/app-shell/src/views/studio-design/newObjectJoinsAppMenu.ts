// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A new object joins its package's app menu (objectstack#36748, folded in by
 * the maintainer's 「这张卡里一起做」).
 *
 * The landing's 「新建应用」 door creates the app before any object exists, so
 * its menu starts empty. Only the top bar's Create app seeded a menu, from the
 * objects already there; nothing added a later object, and the app opened on
 * an empty screen. So Studio's 新建对象, once the object is live, adds it to
 * the menu of its package's app:
 *
 *   - only when the package has exactly ONE published app: with none there is
 *     no menu (Create app seeds one later); with several, which menu is the
 *     author's call, made in design mode;
 *   - only when no entry of that menu already opens the object;
 *   - through the design mode's menu save (`saveAppMenu`, objectstack#36363):
 *     the stored menu, the entry appended at the top level, written as a draft
 *     under the first-write pin and published at once. A draft somebody left
 *     pending on the app is refused, never overwritten; a refused publish
 *     discards the draft the save wrote.
 *
 * The entry is the one a seeded menu carries (`buildAppSkeleton`): an object
 * entry with no `label`, so it shows the object's current label.
 *
 * This never undoes the object: a failure is answered to the caller, which
 * says so and leaves the menu to design mode.
 */

import {
  consoleAppMenuDoors,
  readStoredMenu,
  saveAppMenu,
  type AppMenuSaveDoors,
  type AppMenuSaveTexts,
} from '../../layout/designModeMenuSave.js';
import { withEntryIds, type Menu, type MenuEntry } from '../../layout/designModeMenuModel.js';
import type { I18nLabel } from '@objectstack/spec/ui';

/** What adding the new object to its package's app menu came to. */
export type AppMenuJoin =
  | { kind: 'added'; app: { name: string; label: I18nLabel } }
  | { kind: 'skipped'; why: 'no-app' | 'several-apps' | 'already-there' }
  | { kind: 'failed'; app: { name: string; label: I18nLabel }; error: unknown };

/** Every entry of a menu, its groups' children included. */
function entriesOf(menu: Menu): MenuEntry[] {
  return menu.flatMap((entry) => [entry, ...(Array.isArray(entry.children) ? entriesOf(entry.children as Menu) : [])]);
}

/** The entry that opens `objectName`, with an id no entry of `menu` holds (`nav_NAME`, then `nav_NAME_2`, …). */
export function objectMenuEntry(objectName: string, menu: Menu): MenuEntry {
  const taken = new Set(entriesOf(menu).map((e) => e.id).filter((id): id is string => typeof id === 'string'));
  let id = `nav_${objectName}`;
  for (let n = 2; taken.has(id); n++) id = `nav_${objectName}_${n}`;
  return { id, type: 'object', objectName };
}

export async function addNewObjectToAppMenu(
  client: AppMenuSaveDoors['client'] & { list: (type: string, options: { packageId: string }) => Promise<unknown> },
  input: { packageId: string; objectName: string },
  texts: AppMenuSaveTexts,
  doors: AppMenuSaveDoors = consoleAppMenuDoors(client),
): Promise<AppMenuJoin> {
  const { packageId, objectName } = input;
  const listed = (await client.list('app', { packageId })) as Array<Record<string, unknown>> | null;
  const apps = (listed ?? [])
    .filter((a) => typeof a?.name === 'string' && a.name)
    .map((a) => ({ name: String(a.name), label: (a.label ?? a.name) as I18nLabel }));
  if (apps.length === 0) return { kind: 'skipped', why: 'no-app' };
  if (apps.length > 1) return { kind: 'skipped', why: 'several-apps' };
  const [app] = apps;
  try {
    const stored = await readStoredMenu(app.name, packageId, client);
    if (stored === null) throw new Error(texts.notListed);
    if (entriesOf(stored).some((e) => e.type === 'object' && e.objectName === objectName)) {
      return { kind: 'skipped', why: 'already-there' };
    }
    // As the design mode's editor does: the stored menu, each entry given an
    // id, is the menu the edit started from.
    const served = withEntryIds(stored);
    const navigation = [...served, objectMenuEntry(objectName, served)];
    await saveAppMenu({ appName: app.name, packageId, served, navigation }, texts, doors);
    return { kind: 'added', app };
  } catch (error) {
    return { kind: 'failed', app, error };
  }
}
