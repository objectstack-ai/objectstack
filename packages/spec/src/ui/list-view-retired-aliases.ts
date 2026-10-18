// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The list view's two retired binding aliases, `objectName` and `viewType`,
 * with the prescription each is refused with — declared ONCE, read by both
 * tiers that refuse them (#22444, ruling C: one list view has one set of
 * property names wherever it is embedded):
 *
 * - the react tier: `REACT_RETIRED_OVERLAY_PROPS.ListView` (`./react-blocks.ts`,
 *   #14791), which `validate-react-page-props` quotes when a `kind: 'react'`
 *   page writes either prop on `<ListView>`;
 * - the metadata page tier: `ComponentPropsMap['list-view']`
 *   (`./component.zod.ts`), whose guidance quotes the same note when a page
 *   `list-view` node writes either key in its `properties` bag.
 *
 * A module of its own, outside the `ui` barrel, for one reason: the props row
 * cannot import `./react-blocks.ts`, which reads `ComponentPropsMap` at module
 * load, so the one prescription lives below both (the
 * `./list-view-export-options.ts` precedent). The value is published through
 * `REACT_RETIRED_OVERLAY_PROPS`, as it was.
 *
 * `replacedBy` names the list view member that carries the binding now;
 * `note` is the one-line fix.
 */
export const LIST_VIEW_RETIRED_ALIASES: Readonly<Record<'objectName' | 'viewType', { replacedBy: string; note: string }>> = {
  // Commit 5383fa670 published these as deprecated aliases of ListViewSchema's own
  // `data` / `type`; #14791 retires them outright, the consumer fold having
  // landed (objectui `normalizeListViewSchema`, console pin a472b071).
  objectName: {
    replacedBy: 'data',
    note: "Write data={{ provider: 'object', object: '…' }} — the metadata-tier data source, the same spelling a metadata list view authors.",
  },
  viewType: {
    replacedBy: 'type',
    note: 'Write type="kanban" — ListViewSchema\'s own `type`, the metadata-tier view kind.',
  },
};
