/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The child objects a record page's AUTHOR lists on it (objectstack#26890).
 *
 * `RecordDetailView` re-reads its record when one of its related children is
 * written (objectui#12244), so a rollup the server recomputes from the children
 * reaches the header. The children it watched were only the ones the
 * relationship graph derives (`deriveRelatedLists`). An authored page declares
 * its own lists, and a child it lists need not be derived: its FK may opt out
 * of the derived lists (`relatedList: false`), the page then being the only
 * place that child is shown. This names those children, from the page itself:
 *
 *  - every `record:related_list` block's object — `properties.objectName`, or
 *    the node's own `dataSource.object` binding, which the block's element
 *    data-source gate maps onto `objectName`;
 *  - every `record:reference_rail` entry's `objectName`.
 *
 * At any depth of the page's regions, tabs and containers. Only a string names
 * an object. Sorted and deduplicated, so the caller can key on the content.
 */
export function recordPageChildObjects(page: unknown): string[] {
  const out = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value) out.add(value);
  };
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!isRecord(node)) return;
    const props = isRecord(node.properties) ? node.properties : undefined;
    if (node.type === 'record:related_list') {
      add(props?.objectName);
      if (isRecord(node.dataSource)) add(node.dataSource.object);
    } else if (node.type === 'record:reference_rail' && Array.isArray(props?.entries)) {
      for (const entry of props.entries) if (isRecord(entry)) add(entry.objectName);
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(page);
  return [...out].sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
