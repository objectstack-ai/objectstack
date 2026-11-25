// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The flow designer's tabs and their address (objectstack#36903, epic
 * objectstack#36890 decision 8).
 *
 * The designer's own sections come first, in the order the flow's header
 * drew them: Canvas, Variables, Runs, Problems, Debug (`FlowPreviewSection`).
 * The item tools follow as tabs of the same row (`ItemToolTabs`): References,
 * History (its audit log inside it) and Source (its layered comparison inside
 * it). They replace the item-tools menu and its side sheets.
 *
 * The open tab is in the address, `?tab=` (the console's reserved `tab`, the
 * key every item page writes), so a refresh, a shared link or ‹ › reopens it.
 * Canvas is the default and writes nothing. A tool tab writes the
 * `ItemToolTabs` value (`history`, `audit`, `source`, `layers`,
 * `references`), so `/history` on the area's history address lands on History
 * here as on every item page.
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
import type { FlowPreviewSection } from '../metadata-admin/previews/FlowPreview.js';

/** The designer's own sections, each with its address value. Canvas is the default. */
export const FLOW_DESIGNER_SECTIONS: readonly FlowPreviewSection[] = ['canvas', 'variables', 'runs', 'problems', 'debug'];

/** The item tools the designer offers as tabs, after its own sections. */
export const FLOW_DESIGNER_TOOL_TABS: readonly ItemToolTab[] = ['references', 'history', 'source'];

/** Where the designer is open: one of its sections, or an item tool (over the canvas's section). */
export type FlowDesignerLocation =
  | { section: FlowPreviewSection; tool: null }
  | { section: 'canvas'; tool: ItemToolLocation };

/** The location an address value names, or Canvas for a value that opens nothing here. */
export function readFlowDesignerTab(raw: string | null | undefined, tools: readonly ItemToolTab[]): FlowDesignerLocation {
  if (raw && (FLOW_DESIGNER_SECTIONS as readonly string[]).includes(raw)) {
    return { section: raw as FlowPreviewSection, tool: null };
  }
  const tool = readItemToolLocation(raw, tools);
  return tool ? { section: 'canvas', tool } : { section: 'canvas', tool: null };
}

/** The address value of a location, `null` on the default (Canvas). */
export function flowDesignerTabAddress(location: FlowDesignerLocation): string | null {
  if (location.tool) return itemToolAddress(location.tool);
  return location.section === 'canvas' ? null : location.section;
}

export interface FlowDesignerTabState {
  location: FlowDesignerLocation;
  /** The `?tab=` value in force, `null` on Canvas. */
  address: string | null;
  selectSection: (section: FlowPreviewSection) => void;
  selectTool: (tool: ItemToolLocation) => void;
}

/**
 * The open tab, seeded from the address and written back to it (a replace
 * navigation of the router's own location, so the router and the address
 * never disagree, and ‹ › and × read the same query). A tool tab not offered
 * to this caller (History without the trail capabilities) opens Canvas.
 */
export function useFlowDesignerTab(tools: readonly ItemToolTab[]): FlowDesignerTabState {
  const [searchParams, setSearchParams] = useSearchParams();
  const [choice, setChoice] = React.useState<string | null>(() => searchParams.get(ITEM_TOOL_TAB_PARAM));
  const location = readFlowDesignerTab(choice, tools);
  const address = flowDesignerTabAddress(location);

  const inAddress = searchParams.get(ITEM_TOOL_TAB_PARAM);
  React.useEffect(() => {
    if ((inAddress ?? null) === address) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (address) next.set(ITEM_TOOL_TAB_PARAM, address);
        else next.delete(ITEM_TOOL_TAB_PARAM);
        return next;
      },
      { replace: true },
    );
    // Keyed on the values alone: `setSearchParams` is re-minted with every
    // search change (objectui#8640 — never key on a hook's identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, inAddress]);

  const selectSection = React.useCallback((section: FlowPreviewSection) => {
    setChoice(flowDesignerTabAddress({ section, tool: null }));
  }, []);
  const selectTool = React.useCallback((tool: ItemToolLocation) => {
    setChoice(itemToolAddress(tool));
  }, []);
  return { location, address, selectSection, selectTool };
}
