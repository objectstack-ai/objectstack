/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The synthesized record page at two widths (objectstack#26678).
 *
 * The maintainer's ruling on the record-page epic: the drawer and the full
 * page are ONE page at two widths. So the default record page keeps a single
 * description — the tabbed page `buildDefaultPageSchema` synthesizes, which is
 * also what Studio's page-create seeds and what a slotted page fills — and the
 * WIDTH decides how its content is laid out:
 *
 *  - 1280 px and up: three resident columns, details | timeline | related;
 *  - 1024 – 1279 px: details | timeline, the related column folded into a rail
 *    behind a toggle;
 *  - below 1024 px, and whenever the page is embedded (drawer / split pane):
 *    the tab strip, exactly as before.
 *
 * ## Why the columns are derived, never authored
 *
 * The tiers are the renderer's. No metadata key, no page template and no node
 * type says "columns": the spec's page vocabulary is closed inside its own
 * namespaces (`record:*`, `page:*`), so a columns node would be a type an
 * author — or an AI — could write and the spec could not judge, and a Studio
 * seed carrying it would be refused at save. The layout is therefore read off
 * the synthesized page itself, by the stable semantic `value` every tab item
 * carries (`buildDefaultTabs`, objectui#2257): `details` is the details
 * column, `activity` / `history` join the discussion footer in the timeline
 * column, and every related tab, `approvals` and `attachments` go to the
 * related column. The page's opt-in `aside` (the reference rail and the
 * `rightRail` slot) folds into that same related column — one rail, not two.
 *
 * A page this module cannot read — no synthesized tab strip, or a tab whose
 * value it does not know (an authored `slots.tabs` strip) — answers `null`,
 * and the host draws the tabs. Tabs are the correct rendering of any strip.
 */

/** A container at least this wide lays the default record page out in three columns. */
export const RECORD_PAGE_THREE_COLUMN_MIN_WIDTH = 1280;

/** A container at least this wide (and narrower than the three-column floor) lays it out in two. */
export const RECORD_PAGE_TWO_COLUMN_MIN_WIDTH = 1024;

/** How the synthesized default record page is laid out at the width it has. */
export type RecordPageTier = 'tabs' | 'two-column' | 'three-column';

/**
 * The tier a record page takes in a container `width` CSS pixels wide.
 *
 * Measured on the container the record page occupies, never the viewport: the
 * same page in a drawer is narrow on a wide screen. An embedded page (drawer /
 * split pane) is always tabbed, whatever its width, and an unknown width (zero
 * or not a number — no layout yet, or a test environment) keeps the tabs.
 */
export function recordPageTierFor(width: number, options: { embedded?: boolean } = {}): RecordPageTier {
  if (options.embedded) return 'tabs';
  if (!(width > 0)) return 'tabs';
  if (width >= RECORD_PAGE_THREE_COLUMN_MIN_WIDTH) return 'three-column';
  if (width >= RECORD_PAGE_TWO_COLUMN_MIN_WIDTH) return 'two-column';
  return 'tabs';
}

/** The three resident columns of the wide record page. */
export type RecordPageColumn = 'details' | 'timeline' | 'related';

/**
 * The column a synthesized tab lands in, by the tab's stable `value`; `null`
 * for a value the synthesizer does not emit.
 *
 * Every value `buildDefaultTabs` can produce has a row here, and the test
 * beside this module enumerates them from a maximal synthesis, so a new tab
 * added to the synthesizer without a column fails there instead of silently
 * keeping the whole page tabbed.
 */
export function recordPageColumnOfTab(value: unknown): RecordPageColumn | null {
  if (typeof value !== 'string') return null;
  if (value === 'details') return 'details';
  if (value === 'activity' || value === 'history') return 'timeline';
  if (value === 'related' || value.startsWith('related:')) return 'related';
  if (value === 'approvals' || value === 'attachments') return 'related';
  return null;
}

/** The synthesized record page, partitioned for the column tiers. */
export interface DefaultPageColumns {
  /**
   * The record header: every node the page places before its tab strip
   * (`page:header`, the actions / alerts slots, highlights, the stage path).
   * The same nodes the tabbed page draws — one header for every tier.
   */
  header: any[];
  /** The Details tab's body. */
  details: any[];
  /** The discussion footer first (the composer on top), then Activity and History. */
  timeline: any[];
  /**
   * Related lists in the strip's order, then the folded `aside` (reference
   * rail, `rightRail` slot), then Approvals and Attachments.
   */
  related: any[];
  /**
   * How many related collections the related column shows: one per
   * `record:related_list`, one per reference-rail entry. Labels the
   * two-column tier's rail toggle.
   */
  relatedCount: number;
}

type PageNode = Record<string, any>;

const asNode = (value: unknown): PageNode | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as PageNode) : null;

const nodeList = (value: unknown): any[] => (Array.isArray(value) ? value.filter((n) => n != null) : []);

/** Count the related collections a related-column node shows. */
function relatedCollectionsIn(nodes: any[]): number {
  let count = 0;
  for (const raw of nodes) {
    const node = asNode(raw);
    if (!node) continue;
    if (node.type === 'record:related_list') count += 1;
    else if (node.type === 'record:reference_rail') count += nodeList(asNode(node.properties)?.entries).length;
  }
  return count;
}

/**
 * Partition a synthesized default record page (`buildDefaultPageSchema`'s
 * output, after any host pruning) into the column tiers' header and columns.
 *
 * Reads the page exactly as the synthesizer writes it: a `main` region whose
 * one `page:tabs` node carries its items in the node's `properties` bag
 * (`componentNode`, ADR-0089 D3a), and an optional `aside` region. Answers
 * `null` — draw the tabs — for anything else: no `main` region, no tab strip
 * or more than one, a strip carrying its items elsewhere, an item gated by
 * `visibleWhen`, or an item whose value has no column.
 */
export function buildDefaultPageColumns(page: unknown): DefaultPageColumns | null {
  const regions = nodeList(asNode(page)?.regions);
  const main = regions.map(asNode).find((r) => r?.name === 'main');
  if (!main) return null;
  const components = nodeList(main.components);
  const tabIndexes = components
    .map((node, index) => (asNode(node)?.type === 'page:tabs' ? index : -1))
    .filter((index) => index >= 0);
  if (tabIndexes.length !== 1) return null;
  const tabIndex = tabIndexes[0];
  const items = asNode(asNode(components[tabIndex])?.properties)?.items;
  if (!Array.isArray(items) || items.length === 0) return null;

  const details: any[] = [];
  const timelineTabs: any[] = [];
  const relatedLists: any[] = [];
  const relatedPanels: any[] = [];
  for (const rawItem of items) {
    const item = asNode(rawItem);
    if (!item) return null;
    if (item.visibleWhen !== undefined && item.visibleWhen !== null) return null;
    const column = recordPageColumnOfTab(item.value);
    if (!column) return null;
    const children = nodeList(item.children);
    if (column === 'details') details.push(...children);
    else if (column === 'timeline') timelineTabs.push(...children);
    else if (item.value === 'approvals' || item.value === 'attachments') relatedPanels.push(...children);
    else relatedLists.push(...children);
  }

  const aside = regions.map(asNode).find((r) => r?.name === 'aside');
  const folded = nodeList(aside?.components);
  const related = [...relatedLists, ...folded, ...relatedPanels];
  return {
    header: components.slice(0, tabIndex),
    details,
    timeline: [...components.slice(tabIndex + 1), ...timelineTabs],
    related,
    relatedCount: relatedCollectionsIn(related),
  };
}
