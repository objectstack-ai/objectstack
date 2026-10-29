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
 *  - 1120 px and up: three resident columns, details | timeline | related;
 *  - 760 – 1119 px: details | timeline, the related column folded into a rail
 *    behind a toggle;
 *  - below 760 px, and whenever the page is embedded (drawer / split pane):
 *    the tab strip, exactly as before.
 *
 * (Container widths — see the two constants for how they are derived.)
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
 * column, `timeline` (the one stream, objectstack#27055) is the timeline
 * column, and `related`, `approvals` and `attachments` go to the related
 * column. The synthesized page has one region (`main`); a page with
 * any other region is not the synthesized page (objectstack#27055 removed the
 * opt-in rail and the `rightRail` slot that used to add an `aside`).
 *
 * A page this module cannot read — no synthesized tab strip, or a tab whose
 * value it does not know (an authored strip) — answers `null`,
 * and the host draws the tabs. Tabs are the correct rendering of any strip.
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
 * A container at least this wide lays the default record page out in three
 * columns.
 *
 * Derived from the window it must serve, not picked (objectstack#27241, the
 * maintainer's ruling 「1440 窗口（含侧栏）即三栏」): a 1440 px window with the
 * sidebar expanded is three columns.
 *
 *     1440 (window) − 256 (expanded sidebar) = 1184 px of container
 *     1184 − 64 (headroom: a classic 15–17 px scrollbar, browser zoom
 *                rounding, a sidebar a few px wider) = 1120
 *
 * At 1120 the v3 template (`1.25fr : 1fr : 20rem`, 24 px page padding each
 * side, 24 px gaps) leaves 1120 − 48 − 48 − 320 = 704 px for details +
 * timeline (≈ 391 + 313). It stays container-measured: the same page in a
 * drawer is narrow on a wide screen.
 */
export const RECORD_PAGE_THREE_COLUMN_MIN_WIDTH = 1440 - EXPANDED_SIDEBAR_WIDTH - 64;

/**
 * A container at least this wide (and narrower than the three-column floor)
 * lays it out in two.
 *
 * Derived the same way (objectstack#27241): a 1024 px window with the sidebar
 * expanded stays two columns, not the tabs.
 *
 *     1024 (window) − 256 (expanded sidebar) = 768 px of container
 *     768 − 8 (headroom) = 760
 *
 * At 760 the two-column grid (24 px page padding each side, a 24 px gap)
 * gives each column (760 − 48 − 24) / 2 = 344 px — the narrowest a details
 * section's two-field row stays legible.
 */
export const RECORD_PAGE_TWO_COLUMN_MIN_WIDTH = 1024 - EXPANDED_SIDEBAR_WIDTH - 8;

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
 * Which of the two optional columns a reader keeps shown — the reader's own
 * switches (objectstack#27052), kept per object in the console's
 * workspace-preference store; never metadata. Details is always shown.
 */
export interface RecordPageColumnSwitches {
  timeline: boolean;
  related: boolean;
}

/**
 * How a column tier lays the page out for the reader's switches
 * (objectstack#27052). The tier says how many columns the WIDTH fits; the
 * switches say which columns take part. A column that is off is not drawn:
 *
 *  - timeline off: its blocks fold into a 「动态」 (Activity) card at the foot
 *    of the related column, and the related column takes the timeline's place;
 *  - related off: there is no related column and no rail
 *    (objectstack#27241, 「关联 OFF 就没有栏」) — the switch decides whether
 *    the column exists; the rail toggle only opens or closes a column the
 *    switch allows, when the width cannot fit it resident.
 *
 * So timeline off on a three-column page draws details | related, related off
 * draws details | timeline (no rail), and in the two-column tier related on
 * draws details | timeline with the rail while timeline off draws details |
 * related. With both off the page is the details column alone. Below the
 * column tiers the page is tabbed and the switches are not read; they are
 * kept for when it widens.
 */
export interface RecordPageArrangement {
  /** The resident columns, left to right. Always starts with `details`. */
  columns: RecordPageColumn[];
  /** The timeline's blocks are drawn as the related column's foot card. */
  timelineFolded: boolean;
  /**
   * The related column is drawn as a rail behind a toggle, not resident: the
   * switch keeps it (`related` on) and the tier has no room for it. Never set
   * when the switch is off.
   */
  relatedRail: boolean;
}

/**
 * The arrangement of a column tier for the reader's switches. A pure reading
 * of the two inputs, so the page re-flows by the same rule wherever it is
 * drawn: a column that is off frees its room for the next.
 */
export function recordPageArrangementFor(
  tier: 'two-column' | 'three-column',
  switches: RecordPageColumnSwitches,
): RecordPageArrangement {
  const room = tier === 'three-column' ? 3 : 2;
  const wanted: RecordPageColumn[] = ['details'];
  if (switches.timeline) wanted.push('timeline');
  if (switches.related) wanted.push('related');
  const columns = wanted.slice(0, room);
  return {
    columns,
    timelineFolded: !switches.timeline,
    relatedRail: switches.related && !columns.includes('related'),
  };
}

/** The object-definition shape {@link recordPageColumnDefaults} reads. */
export interface RecordPageObjectLike {
  stageField?: unknown;
  enable?: { files?: unknown } | null;
  fields?: Record<string, unknown> | unknown[] | null;
}

function fieldsOf(object: RecordPageObjectLike | null | undefined): Array<Record<string, unknown>> {
  const fields = object?.fields;
  const list = Array.isArray(fields) ? fields : fields && typeof fields === 'object' ? Object.values(fields) : [];
  return list.filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && !Array.isArray(f));
}

/** Why {@link recordPageColumnDefaults} turned the timeline on — or `null`, off. */
export type RecordTimelineDefaultReason = 'stage-field' | 'option-kinds' | 'files' | null;

/**
 * Why an object is "worked" — the reason its record page shows the timeline
 * by default — or `null` when it is not (objectstack#27052, the maintainer's
 * ruling that the timeline suits only some objects and its presence is each
 * reader's switch with an object-derived default). Read off the object as it
 * is declared, with no key of its own, in this order:
 *
 *  1. `stageField` names a field — the object declares a lifecycle;
 *  2. otherwise (and unless `stageField: false` turned the stage role off),
 *     a field whose options declare a lifecycle `kind` (`open` / `won` /
 *     `lost`) — the same declaration a stage path reads;
 *  3. `enable.files: true` — records collect attachments, work products.
 *
 * Only what the object declares of itself counts. Being the `master_detail`
 * parent of another object does not: a parent that merely owns child rows (a
 * price book, a campaign, an event) is a container, not a worked record, and
 * its middle column would be an empty stream.
 */
export function recordTimelineDefaultReason(
  object: RecordPageObjectLike | null | undefined,
): RecordTimelineDefaultReason {
  if (!object) return null;
  if (typeof object.stageField === 'string' && object.stageField.length > 0) return 'stage-field';
  if (object.stageField !== false) {
    const declaresKinds = fieldsOf(object).some(
      (field) =>
        Array.isArray(field.options) &&
        field.options.some((option) => !!option && typeof option === 'object' && (option as { kind?: unknown }).kind !== undefined),
    );
    if (declaresKinds) return 'option-kinds';
  }
  if (object.enable?.files === true) return 'files';
  return null;
}

/**
 * The column switches a reader who never chose gets for `object`: the
 * timeline on when the object is worked ({@link recordTimelineDefaultReason}),
 * the related column on.
 */
export function recordPageColumnDefaults(object: RecordPageObjectLike | null | undefined): RecordPageColumnSwitches {
  return { timeline: recordTimelineDefaultReason(object) !== null, related: true };
}

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
  // `timeline` is the one stream (objectstack#27055); `activity` / `history`
  // are the values a pre-v3 strip carried, kept so such a page still lays out.
  if (value === 'timeline' || value === 'activity' || value === 'history') return 'timeline';
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
  /** The Timeline tab's stream (objectstack#27055), after any node the page places below its strip. */
  timeline: any[];
  /** Related lists in the strip's order, then Approvals and Attachments. */
  related: any[];
  /**
   * How many related collections the related column shows: one per
   * `record:related_list`. Labels the
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
  }
  return count;
}

/**
 * Partition a synthesized default record page (`buildDefaultPageSchema`'s
 * output, after any host pruning) into the column tiers' header and columns.
 *
 * Reads the page exactly as the synthesizer writes it: one `main` region
 * whose one `page:tabs` node carries its items in the node's `properties`
 * bag (`componentNode`, ADR-0089 D3a). Answers `null` — draw the tabs — for
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

  const related = [...relatedLists, ...relatedPanels];
  return {
    header: components.slice(0, tabIndex),
    details,
    timeline: [...components.slice(tabIndex + 1), ...timelineTabs],
    related,
    relatedCount: relatedCollectionsIn(related),
  };
}

/**
 * The relationship ids (`object.field`) of the body tables a synthesized
 * record page draws (objectstack#27055, Target 8): every `record:related_list`
 * among the Details tab's children. Read off the page itself, so the host and
 * the column tiers agree with what `buildDefaultTabs` placed.
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
