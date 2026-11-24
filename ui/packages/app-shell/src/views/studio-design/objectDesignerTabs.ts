// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The object designer's tabs and their address (objectstack#36904, epic
 * objectstack#36890; #36513 section 一).
 *
 * The designer's own views come first, in #36513's order: Records, Field
 * layout, Validations, Actions, Settings, Hooks, API (`dataTabsFold.ts` folds
 * Hooks and API first). The item tools follow as tabs of the same row
 * (epic decision 8, `ItemToolTabs`): References, History (its audit log
 * inside it) and Source (its layered comparison inside it).
 *
 * The open tab is in the address, `?tab=` (the console's reserved `tab`, the
 * key the generic item page writes), so a refresh, a shared link or ‹ › reopens
 * it. Records is the default and writes nothing. A tool tab writes the
 * `ItemToolTabs` value (`history`, `audit`, `source`, `layers`, `references`),
 * so `/history` on the area's history address lands on History here as on
 * every item page.
 */

import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ITEM_TOOL_TAB_PARAM,
  itemToolAddress,
  readItemToolLocation,
  type ItemToolLocation,
  type ItemToolTab,
} from '../item-tools/ItemToolTabs.js';

/** A view of the designer's own (the buffer it edits is the same object for all of them). */
export type ObjectDesignerView = 'grid' | 'form' | 'rules' | 'actions' | 'settings' | 'hooks' | 'api';

/** The designer's views in #36513's order, each with its address value and label key. */
export const OBJECT_DESIGNER_VIEWS: ReadonlyArray<{ view: ObjectDesignerView; address: string; label: string }> = [
  { view: 'grid', address: 'records', label: 'engine.studio.data.tab.records' },
  { view: 'form', address: 'layout', label: 'engine.studio.data.tab.form' },
  { view: 'rules', address: 'validations', label: 'engine.studio.data.tab.rules' },
  { view: 'actions', address: 'actions', label: 'engine.studio.data.tab.actions' },
  { view: 'settings', address: 'settings', label: 'engine.studio.data.tab.settings' },
  { view: 'hooks', address: 'hooks', label: 'engine.studio.data.tab.hooks' },
  { view: 'api', address: 'api', label: 'engine.studio.data.tab.api' },
];

/** The views that are always flat; the rest fold (`dataTabsFold.ts`). */
export const OBJECT_DESIGNER_ALWAYS_FLAT: readonly ObjectDesignerView[] = ['grid', 'form'];

/** The views folded first at a narrow width: the technical two. */
export const OBJECT_DESIGNER_FOLD_FIRST: readonly ObjectDesignerView[] = ['hooks', 'api'];

/** The item tools the designer offers as tabs, after its own views. */
export const OBJECT_DESIGNER_TOOL_TABS: readonly ItemToolTab[] = ['references', 'history', 'source'];

/** Where the designer is open: one of its views, or an item tool. */
export type ObjectDesignerLocation = { view: ObjectDesignerView; tool: null } | { view: 'grid'; tool: ItemToolLocation };

/** The location an address value names, or Records for a value that opens nothing here. */
export function readObjectDesignerTab(raw: string | null | undefined, tools: readonly ItemToolTab[]): ObjectDesignerLocation {
  const own = OBJECT_DESIGNER_VIEWS.find((v) => v.address === raw);
  if (own) return { view: own.view, tool: null };
  const tool = readItemToolLocation(raw, tools);
  return tool ? { view: 'grid', tool } : { view: 'grid', tool: null };
}

/** The address value of a location, `null` on the default (Records). */
export function objectDesignerTabAddress(location: ObjectDesignerLocation): string | null {
  if (location.tool) return itemToolAddress(location.tool);
  return location.view === 'grid' ? null : (OBJECT_DESIGNER_VIEWS.find((v) => v.view === location.view)?.address ?? null);
}

export interface ObjectDesignerTabState {
  location: ObjectDesignerLocation;
  /** The `?tab=` value in force, `null` on Records. */
  address: string | null;
  selectView: (view: ObjectDesignerView) => void;
  selectTool: (tool: ItemToolLocation) => void;
}

/**
 * The open tab, seeded from the address and written back to it (replace), as
 * `useItemToolTab` does for the generic item page: read in the initializer,
 * written with `history.replaceState`, re-written after a router navigation
 * drops it. A tool tab not offered to this caller (History without the trail
 * capabilities) opens Records.
 */
export function useObjectDesignerTab(tools: readonly ItemToolTab[]): ObjectDesignerTabState {
  const [choice, setChoice] = React.useState<string | null>(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(ITEM_TOOL_TAB_PARAM),
  );
  const location = readObjectDesignerTab(choice, tools);
  const address = objectDesignerTabAddress(location);

  const [searchParams] = useSearchParams();
  const routerSearch = searchParams.toString();
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if ((url.searchParams.get(ITEM_TOOL_TAB_PARAM) ?? null) === address) return;
    if (address) url.searchParams.set(ITEM_TOOL_TAB_PARAM, address);
    else url.searchParams.delete(ITEM_TOOL_TAB_PARAM);
    window.history.replaceState(window.history.state, '', url.toString());
  }, [address, routerSearch]);

  const selectView = React.useCallback((view: ObjectDesignerView) => {
    setChoice(objectDesignerTabAddress({ view, tool: null }));
  }, []);
  const selectTool = React.useCallback((tool: ItemToolLocation) => {
    setChoice(itemToolAddress(tool));
  }, []);
  return { location, address, selectView, selectTool };
}
