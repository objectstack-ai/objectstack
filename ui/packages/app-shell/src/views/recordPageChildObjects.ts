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
    if (node.type === 'record:related_list') {
      relatedListObjects(node).forEach(add);
    } else if (node.type === 'record:reference_rail') {
      for (const entry of railEntries(node)) if (isRecord(entry)) add(entry.objectName);
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(page);
  return [...out].sort();
}

/**
 * The record page with every list it names for an object this install does
 * not hold left out (objectstack#26988).
 *
 * Since ADR-0141 a module's objects can really be absent, and an app's record
 * page may still list them: drawn anyway, the block humanized the raw name
 * ("Crm Quote 0 — No related records found"), the rail folded it into its
 * empty chip, and both asked `/meta/object` and `/data` for a name that answers
 * 404. The rule is `DashboardView`'s `requiresObject` / `widget.object` filter
 * and `NavigationItem.requiresObject`'s: an object-bound entry the registered
 * object list does not hold is not drawn. The same two arms as
 * {@link recordPageChildObjects}:
 *
 *  - a `record:related_list` block whose `properties.objectName` or
 *    `dataSource.object` names an unregistered object is removed;
 *  - a `record:reference_rail` entry whose `objectName` does is removed, and a
 *    rail left with no entries is removed with it.
 *
 * Only a string names an object, so a block that names one some other way is
 * kept. `registered` is the caller's registered object list; while it is
 * empty the list has not loaded, and the page is returned as it is — an empty
 * set would hide every list on the first render (the deferral `DashboardView`
 * makes). Identity-preserving: a page with nothing to leave out is returned
 * itself, and so is every subtree with nothing to leave out.
 */
export function pruneUnregisteredRecordPageObjects<T>(page: T, registered: ReadonlySet<string>): T {
  if (registered.size === 0) return page;
  const unregistered = (value: unknown) => typeof value === 'string' && !!value && !registered.has(value);
  const DROP = Symbol('drop');
  const prune = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      let changed = false;
      const out: unknown[] = [];
      for (const item of node) {
        const next = prune(item);
        if (next !== item) changed = true;
        if (next !== DROP) out.push(next);
      }
      return changed ? out : node;
    }
    if (!isRecord(node)) return node;
    if (node.type === 'record:related_list' && relatedListObjects(node).some(unregistered)) return DROP;
    let next: Record<string, unknown> = node;
    if (node.type === 'record:reference_rail') {
      const entries = railEntries(node);
      const kept = entries.filter((entry) => !(isRecord(entry) && unregistered(entry.objectName)));
      if (kept.length !== entries.length) {
        if (kept.length === 0) return DROP;
        next = { ...node, properties: { ...(node.properties as Record<string, unknown>), entries: kept } };
      }
    }
    for (const [key, child] of Object.entries(next)) {
      const pruned = prune(child);
      if (pruned === child) continue;
      if (next === node) next = { ...node };
      if (pruned === DROP) delete next[key];
      else next[key] = pruned;
    }
    return next;
  };
  const out = prune(page);
  return (out === DROP ? page : out) as T;
}

/** The objects a `record:related_list` block names: `properties.objectName`, or its `dataSource.object` binding. */
function relatedListObjects(node: Record<string, unknown>): unknown[] {
  const props = isRecord(node.properties) ? node.properties : undefined;
  return [props?.objectName, isRecord(node.dataSource) ? node.dataSource.object : undefined];
}

/** A `record:reference_rail` block's `properties.entries`, or none. */
function railEntries(node: Record<string, unknown>): unknown[] {
  const props = isRecord(node.properties) ? node.properties : undefined;
  return Array.isArray(props?.entries) ? props.entries : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
