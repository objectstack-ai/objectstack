/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The PAGE spelling of a `list-view` node, spelled ONCE for the pins that judge
 * a list view at the published door (objectui#12670). Test-only: `__tests__/`
 * is excluded from this package's build, and nothing re-exports this module.
 *
 * Since objectui#12670 two schemas judge a list view, and they take two
 * spellings of it:
 *
 *  - `ListViewSchema`, the `ListView` component's props: `objectName` names the
 *    object, `viewType` the kind, every prop on the node itself.
 *  - `ListViewBlockSchema`, the arm `AnyComponentSchema` (and so
 *    `safeValidateSchema`, the strict authoring face and `objectui validate`)
 *    judges an authored page node with: its props in the `properties` bag, the
 *    object named in `data: { provider: 'object', object }`, the kind as the
 *    bag's `type` (ruling C on objectstack-ai/objectstack#22444). `objectName`
 *    and `viewType` are refused there by name.
 *
 * The pins that used to hand the component spelling to the published door
 * re-spell it here, so each one keeps judging the same list view on both
 * doors. Every key but the node-level ones moves into the bag, and a page
 * issue's path is read relative to the bag ({@link bagPath}), so an assertion
 * written against the component spelling's paths reads the same.
 */

/** The keys that stay on the page node: the node base's own and the node's binding. */
const NODE_LEVEL = new Set(['id', 'className', 'style', 'dataSource', 'responsiveStyles']);

/**
 * `view`, in the component spelling (`{ type: 'list-view', objectName, viewType, … }`),
 * re-spelled as the page node `ListViewBlockSchema` judges.
 */
export function asPageListView(view: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const node: Record<string, unknown> = { type: 'list-view' };
  const bag: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(view)) {
    if (key === 'type') continue;
    if (key === 'objectName') bag.data = { provider: 'object', object: value };
    else if (key === 'viewType') bag.type = value;
    else if (NODE_LEVEL.has(key)) node[key] = value;
    else bag[key] = value;
  }
  node.properties = bag;
  return node;
}

/** An issue path read relative to the page node's bag: `properties.options.chart` → `options.chart`. */
export function bagPath(path: readonly PropertyKey[]): string {
  return (path[0] === 'properties' ? path.slice(1) : path).map(String).join('.');
}

type Issued = { success: boolean; error?: { issues: readonly { path: PropertyKey[] }[] } };

/**
 * A published door, judging the page spelling of what it is handed: `parse`
 * receives {@link asPageListView} of the document, and every issue comes back
 * with its path relative to the bag, so a table of component-spelling paths
 * reads the same on the mirror and on the door.
 */
export function onPageSpelling<R extends Issued>(parse: (doc: unknown) => R): (doc: unknown) => R {
  return (doc) => {
    const r = parse(asPageListView(doc as Record<string, unknown>));
    if (r.success || !r.error) return r;
    const issues = r.error.issues.map((issue) => ({
      ...issue,
      path: issue.path[0] === 'properties' ? issue.path.slice(1) : issue.path,
    }));
    return { ...r, error: { issues } } as R;
  };
}
