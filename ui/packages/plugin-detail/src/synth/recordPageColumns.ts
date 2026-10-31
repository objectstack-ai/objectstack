/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The synthesized record page, laid out by the width it has
 * (objectstack#26678; one rule since objectstack#27524, Target 6).
 *
 * The maintainer's ruling on the record-page epic: the drawer and the full
 * page are ONE page at two widths. So the default record page keeps a single
 * description — the tabbed page `buildDefaultPageSchema` synthesizes, which is
 * also what Studio's page-create seeds and what a slotted page fills — and the
 * WIDTH of the container it occupies decides how its content is laid out, by
 * one rule wherever it is drawn (the page, the split pane, the overlay drawer,
 * the maximized pane, a phone):
 *
 *  - 760 px and up: details | the right column (320 px) — the 动态 panel
 *    first, then the related panels;
 *  - 1120 px and up: the same, wide — the details field grid takes three
 *    columns, the right column 380 px, the 动态 panel five entries;
 *  - below 760 px: ONE column — the details sections, then the right
 *    column's panels in their order.
 *
 * (Container widths — see the two constants for how they are derived.) There
 * is no tabbed tier: the strip's blocks are always laid out
 * (objectstack#27524 retired it with the three-column tier and the related
 * rail), and the 动态 stream is a panel, never a column.
 *
 * ## Why the layout is derived, never authored
 *
 * The tiers are the renderer's. No metadata key, no page template and no node
 * type says "columns": the spec's page vocabulary is closed inside its own
 * namespaces (`record:*`, `page:*`), so a columns node would be a type an
 * author — or an AI — could write and the spec could not judge, and a Studio
 * seed carrying it would be refused at save. The layout is therefore read off
 * the synthesized page itself, by the stable semantic `value` every tab item
 * carries (`buildDefaultTabs`, objectui#2257): `details` is the details
 * column, `timeline` (the one stream, objectstack#27055) is the right
 * column's 动态 panel, and `related`, `approvals` and `attachments` are its
 * panels after it. The synthesized page has one region (`main`); a page with
 * any other region is not the synthesized page (objectstack#27055 removed the
 * opt-in rail and the `rightRail` slot that used to add an `aside`).
 *
 * A page this module cannot read — no synthesized tab strip, or a tab whose
 * value it does not know (an authored strip) — answers `null`,
 * and the host draws the page as written, tabs and all.
 */

/**
 * The console sidebar's width when it is expanded: `SIDEBAR_WIDTH` (16rem) of
 * the sidebar primitive in `@object-ui/components`. Measured on the console
 * (HotCRM contact record page, sidebar expanded, objectstack#27241): the
 * record page root is the window minus this — 1184 px in a 1440 px window,
 * 1024 px in 1280, 768 px in 1024.
 */
const EXPANDED_SIDEBAR_WIDTH = 256;

/**
 * A container at least this wide lays the default record page out wide:
 * the details field grid at three columns, the right column 380 px, the 动态
 * panel showing five entries (objectstack#27524, Target 6).
 *
 * Derived from the window it must serve, not picked (objectstack#27241, the
 * maintainer's ruling 「1440 窗口（含侧栏）」): a 1440 px window with the
 * sidebar expanded is wide.
 *
 *     1440 (window) − 256 (expanded sidebar) = 1184 px of container
 *     1184 − 64 (headroom: a classic 15–17 px scrollbar, browser zoom
 *                rounding, a sidebar a few px wider) = 1120
 *
 * At 1120 the wide template (`1fr : 380px`, 24 px page padding each side, a
 * 24 px gap) leaves 1120 − 48 − 24 − 380 = 668 px for the details, three
 * fields of ≈ 210 px a row. It stays container-measured: the same page in a
 * drawer is narrow on a wide screen.
 */
export const RECORD_PAGE_WIDE_MIN_WIDTH = 1440 - EXPANDED_SIDEBAR_WIDTH - 64;

/**
 * A container at least this wide lays it out in two columns, details | the
 * right column; a narrower one stacks them.
 *
 * Derived the same way (objectstack#27241): a 1024 px window with the sidebar
 * expanded keeps the right column.
 *
 *     1024 (window) − 256 (expanded sidebar) = 768 px of container
 *     768 − 8 (headroom) = 760
 *
 * At 760 the two-column template (24 px page padding each side, a 24 px gap,
 * the 320 px right column) leaves 760 − 48 − 24 − 320 = 368 px for the
 * details — the narrowest a details section's two-field row stays legible.
 * The default split pane (720 px) is below it, so the pane stacks.
 */
export const RECORD_PAGE_TWO_COLUMN_MIN_WIDTH = 1024 - EXPANDED_SIDEBAR_WIDTH - 8;

/**
 * How the synthesized default record page is laid out at the width it has:
 * `stack` is one column (details, then the right column's panels),
 * `two-column` is details | the right column, `wide` is the same with the
 * wide measures.
 */
export type RecordPageTier = 'stack' | 'two-column' | 'wide';

/**
 * The tier a record page takes in a container `width` CSS pixels wide.
 *
 * Measured on the container the record page occupies, never the viewport: the
 * same page in a drawer is narrow on a wide screen. The rule is the same for
 * an embedded page (the split pane, the overlay drawer, the maximized pane):
 * only its width counts. An unknown width (zero or not a number — no layout
 * yet, or a test environment) is the narrowest tier, the stack: it draws every
 * block in one column and assumes no room it was not measured to have.
 */
export function recordPageTierFor(width: number): RecordPageTier {
  if (!(width > 0)) return 'stack';
  if (width >= RECORD_PAGE_WIDE_MIN_WIDTH) return 'wide';
  if (width >= RECORD_PAGE_TWO_COLUMN_MIN_WIDTH) return 'two-column';
  return 'stack';
}

/** Whether a tier draws the right column beside the details (`⊟` applies). */
export function recordPageTierHasRightColumn(tier: RecordPageTier | null | undefined): boolean {
  return tier === 'two-column' || tier === 'wide';
}

/**
 * The 动态 tab's id in the host's `?related=` (objectstack#27524, Target 5):
 * the 动态 panel's 「查看全部 N 条 →」 opens it, beside the related lists'
 * `object.field` ids. Never an `object.field`, so it names no related list.
 */
export const RECORD_PAGE_TIMELINE_PANEL = 'timeline';

/**
 * Where a synthesized tab's blocks land: the details column, the 动态 panel
 * (`timeline`, the first panel of the right column) or the related panels
 * after it.
 */
export type RecordPageColumn = 'details' | 'timeline' | 'related';

/**
 * The column a synthesized tab lands in, by the tab's stable `value`; `null`
 * for a value the synthesizer does not emit.
 *
 * Every value `buildDefaultTabs` can produce has a row here, and the test
 * beside this module enumerates them from a maximal synthesis, so a new tab
 * added to the synthesizer without a column fails there instead of silently
 * drawing the whole page as its tab strip.
 */
export function recordPageColumnOfTab(value: unknown): RecordPageColumn | null {
  if (typeof value !== 'string') return null;
  if (value === 'details') return 'details';
  // `timeline` is the one stream (objectstack#27055); `activity` / `history`
  // are the values a pre-v3 strip carried, kept so such a page still lays out.
  if (value === 'timeline' || value === 'activity' || value === 'history') return 'timeline';
  if (value === 'related' || value.startsWith('related:')) return 'related';
  if (value === 'approvals' || value === 'attachments') return 'related';
  return null;
}

/** The synthesized record page, partitioned for its layout. */
export interface DefaultPageColumns {
  /**
   * The record header: every node the page places before its tab strip
   * (`page:header`, the actions / alerts slots, highlights, the stage path).
   * The same nodes an authored strip draws above it — one header for every
   * tier.
   */
  header: any[];
  /** The Details tab's body. */
  details: any[];
  /**
   * The Timeline tab's stream (objectstack#27055), after any node the page
   * places below its strip: the 动态 panel's blocks (objectstack#27524).
   */
  timeline: any[];
  /** Related lists in the strip's order, then Approvals and Attachments. */
  related: any[];
}

type PageNode = Record<string, any>;

const asNode = (value: unknown): PageNode | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as PageNode) : null;

const nodeList = (value: unknown): any[] => (Array.isArray(value) ? value.filter((n) => n != null) : []);

/**
 * Partition a synthesized default record page (`buildDefaultPageSchema`'s
 * output, after any host pruning) into its header, details, 动态 and related
 * panels.
 *
 * Reads the page exactly as the synthesizer writes it: one `main` region
 * whose one `page:tabs` node carries its items in the node's `properties`
 * bag (`componentNode`, ADR-0089 D3a). Answers `null` — draw the page as
 * written — for
 * anything else: no `main` region or a second region, no tab strip or more
 * than one, a strip carrying its items elsewhere, an item gated by
 * `visibleWhen`, or an item whose value has no column.
 */
export function buildDefaultPageColumns(page: unknown): DefaultPageColumns | null {
  const regions = nodeList(asNode(page)?.regions);
  if (regions.length !== 1) return null;
  const main = asNode(regions[0]);
  if (!main || main.name !== 'main') return null;
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

  return {
    header: components.slice(0, tabIndex),
    details,
    timeline: [...components.slice(tabIndex + 1), ...timelineTabs],
    related: [...relatedLists, ...relatedPanels],
  };
}

/**
 * The relationship ids (`object.field`) of the body tables a synthesized
 * record page draws (objectstack#27055, Target 8): every `record:related_list`
 * among the Details tab's children. Read off the page itself, so the host and
 * the laid-out page agree with what `buildDefaultTabs` placed.
 */
export function bodyTableIdsOf(page: unknown): Set<string> {
  const ids = new Set<string>();
  const regions = nodeList(asNode(page)?.regions);
  for (const region of regions) {
    for (const component of nodeList(asNode(region)?.components)) {
      const tabs = asNode(component);
      if (tabs?.type !== 'page:tabs') continue;
      for (const item of nodeList(asNode(tabs.properties)?.items)) {
        if (asNode(item)?.value !== 'details') continue;
        for (const id of relatedListIdsIn(nodeList(asNode(item)?.children))) ids.add(id);
      }
    }
  }
  return ids;
}

/** The relationship ids of the `record:related_list` nodes among `nodes`. */
export function relatedListIdsIn(nodes: any[]): string[] {
  const out: string[] = [];
  for (const raw of nodes) {
    const node = asNode(raw);
    if (node?.type !== 'record:related_list') continue;
    const props = { ...node, ...(asNode(node.properties) ?? {}) };
    if (typeof props.objectName === 'string' && typeof props.relationshipField === 'string') {
      out.push(`${props.objectName}.${props.relationshipField}`);
    }
  }
  return out;
}
