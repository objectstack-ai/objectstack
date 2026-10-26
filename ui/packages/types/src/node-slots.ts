/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Per-type NODE SLOTS — where a renderer hands authored nodes back to
 * `SchemaRenderer` through a key other than `children` (objectui#11170).
 *
 * ## What this declares, and what it does not
 *
 * `SchemaRenderer` does not recurse on its own. `BaseSchema.children` is the
 * protocol's one COMPOSITION key, legal on every node, and every walk over a
 * document follows it unconditionally. Beyond it, each renderer decides which
 * of its keys hold nodes it puts on the page: a dialog's `trigger` and
 * `content`, a tab item's `content`, a page's `regions[].components`. Those
 * are per-type facts about the RENDERER, and before this module nothing
 * declared them, so the three walks that judge a document — the `objectui
 * check` unevaluated-expression gate (`findUnbindableTextExpressions` in
 * `@object-ui/cli`), `validateChildren` in `@object-ui/core`'s schema
 * validator and `validateTree` in `@object-ui/sdui-parser` — stopped at
 * `children` and never reached a node under a slot: a `${…}` on such a node's
 * `title` reached the user as literal text, unrefused.
 *
 * ⛔ This is not a list of every key whose VALUE happens to be an object with a
 * string `type`. A form's `fields[]` entries are field definitions rendered by
 * the form's field widgets, a grid's `columns[]` entries are column
 * definitions and `{ "type": "multiple" }` can be a selection mode; walking
 * them refuses things that are not nodes (measured as PR #11126's ablation 2).
 * A key is here because its renderer was measured handing the value to
 * `SchemaRenderer` — through `renderChildren`, `renderNodeSlot`,
 * `renderTriggerSlot` or a direct `SchemaRenderer schema={…}` of it.
 *
 * ⛔ Not a second child-list key. `body` was retired as the generic child-list
 * spelling (objectui#6771) and stays retired: it appears below ONLY on the
 * types whose renderer was measured still reading it for stored documents,
 * marked `retired`, and the parser tier's refusal of the spelling by name
 * (`RETIRED_CHILD_LIST_KEY` in `@object-ui/sdui-parser`) is unchanged.
 *
 * ## Where each row comes from
 *
 *  - The `page:*` family's positions are `@objectstack/spec`'s, read by
 *    reference rather than copied: the spec derives `pageComponentSlotPositions()`
 *    from the `ComponentPropsMap` rows that declare a slot, and
 *    `__tests__/node-slots-11170.test.ts` holds this module's `page:*` rows
 *    against that export in both directions, so a spec row that moves is a red
 *    test here. The spec's list is by SHAPE over the whole family; the rows
 *    below are the same positions placed on the types whose renderer reads
 *    them (`page:tabs` and `page:accordion` read `items[].children`,
 *    `page:card` reads `footer` and the retired `body`).
 *  - Every other row is objectui's own: the installed spec declares no slot
 *    for these types, and the registry's `inputs` cannot spell a nested
 *    position (`items[].content` is not a `ComponentInput`). Each is held
 *    against the live renderer by
 *    `packages/components/src/renderers/__tests__/node-slot-declaration-11170.test.tsx`
 *    (a node authored at every declared position reaches the DOM; every
 *    `type: 'slot'` input a registration declares has a row here) and, for
 *    the plugin-registered types, by the `nodeSlotDeclaration-11170` suite in
 *    each plugin package.
 *
 * ## The spelling of a position
 *
 * A path of keys separated by `.`; a key followed by `[]` means "each element
 * of the array under that key". The value at the end of the path is ONE node
 * or a LIST of nodes, which is what every slot renderer accepts
 * (`renderChildren` in `@object-ui/components`). So:
 *
 *   - `trigger` — the node(s) under `node.trigger`;
 *   - `items[].content` — for each element of `node.items`, the node(s) under
 *     its `content`;
 *   - `regions[].components` — for each region, the list under `components`;
 *   - `items[]` — each element of `node.items` is itself a node or a list
 *     (the `carousel` renderer hands every item to `renderChildren`);
 *   - `report.sections[].content` — through the `report` object, then each
 *     section's `content`.
 *
 * {@link nodeSlotValues} walks a node by this grammar and is what the three
 * readers call, so the grammar is implemented once. Readers spell the
 * resulting path their own way (`children → 0 → title` in the CLI,
 * `schema.items[0].content` in core).
 *
 * ## Namespaced spellings
 *
 * The registry stores a registration under its namespaced key AND, unless
 * `skipFallback` is set, its bare name; both resolve to the same renderer, so
 * both are listed and the census above pins that twins agree. A key the
 * registry stores only namespaced (`page:card`) is listed once.
 */

/** One node slot a type's renderer reads. */
export interface NodeSlotDeclaration {
  /** The position, in the key-path grammar this module's header states. */
  readonly path: string;
  /**
   * The spelling is RETIRED: not authorable, refused by name on the authoring
   * faces, but still read by the renderer for stored documents (`page:card`'s
   * `body`, objectstack#5775 / objectui#6771). A walk that judges what the
   * renderer paints descends it; the authoring tier's manifest projection
   * leaves it out, as the spec's own authoring walks do.
   */
  readonly retired?: true;
}

/** One renderer's slots, under every registry key that resolves to it. */
export interface NodeSlotRow {
  readonly types: readonly string[];
  readonly slots: readonly NodeSlotDeclaration[];
}

const slot = (path: string): NodeSlotDeclaration => Object.freeze({ path });
const retired = (path: string): NodeSlotDeclaration => Object.freeze({ path, retired: true });
const row = (types: readonly string[], slots: readonly NodeSlotDeclaration[]): NodeSlotRow =>
  Object.freeze({ types: Object.freeze([...types]), slots: Object.freeze([...slots]) });

/** The overlay primitives that wrap a Radix `*Trigger` around `trigger` and render `content` in the portal. */
const TRIGGER_AND_CONTENT = [slot('trigger'), slot('content')] as const;

/**
 * THE declaration, one row per renderer. `children` is never listed: it is
 * every node's composition key and every walk follows it unconditionally.
 */
export const NODE_SLOT_DECLARATIONS: readonly NodeSlotRow[] = Object.freeze([
  // ── @object-ui/components, overlays ───────────────────────────────────────
  row(['alert-dialog', 'ui:alert-dialog'], TRIGGER_AND_CONTENT),
  row(['context-menu', 'ui:context-menu'], [slot('trigger')]),
  row(['dialog', 'ui:dialog'], [...TRIGGER_AND_CONTENT, slot('footer')]),
  row(['drawer', 'ui:drawer'], TRIGGER_AND_CONTENT),
  row(['dropdown-menu', 'ui:dropdown-menu'], [slot('trigger')]),
  row(['hover-card', 'ui:hover-card'], TRIGGER_AND_CONTENT),
  row(['popover', 'ui:popover'], TRIGGER_AND_CONTENT),
  row(['sheet', 'ui:sheet'], [...TRIGGER_AND_CONTENT, slot('footer')]),
  // `tooltip` places `content` RAW in a React child position (text only,
  // objectui#10295); only its trigger is a node slot.
  row(['tooltip', 'ui:tooltip'], [slot('trigger')]),
  row(['collapsible', 'ui:collapsible'], TRIGGER_AND_CONTENT),
  // ── @object-ui/components, direct slots ───────────────────────────────────
  row(['card', 'ui:card'], [slot('header'), slot('footer')]),
  row(['table', 'ui:table'], [slot('footer')]),
  row(['data-table', 'ui:data-table'], [slot('emptyAction')]),
  row(['empty', 'ui:empty'], [slot('action')]),
  row(['header-bar', 'ui:header-bar'], [slot('actions'), slot('rightContent')]),
  // ── @object-ui/components, panel lists ────────────────────────────────────
  row(['tabs', 'ui:tabs'], [slot('items[].content')]),
  row(['accordion', 'ui:accordion'], [slot('items[].content')]),
  row(['list', 'ui:list'], [slot('items[].content')]),
  row(['resizable', 'ui:resizable'], [slot('panels[].content')]),
  row(['carousel', 'ui:carousel'], [slot('items[]')]),
  // ── the page document: five registry keys, one `PageRenderer` ─────────────
  row(
    ['page', 'ui:page', 'app', 'ui:app', 'utility', 'ui:utility', 'home', 'ui:home', 'record', 'ui:record'],
    [slot('regions[].components')],
  ),
  // ── the `page:*` family — the spec's positions, by reference (see header) ──
  row(['page:tabs'], [slot('items[].children')]),
  row(['page:accordion'], [slot('items[].children')]),
  row(['page:card'], [slot('footer'), retired('body')]),
  row(['page:section'], [retired('body')]),
  row(['page:footer'], [retired('body')]),
  row(['page:sidebar'], [retired('body')]),
  // ── plugins ───────────────────────────────────────────────────────────────
  row(
    ['detail', 'view:detail', 'detail-view', 'plugin-detail:detail-view'],
    [
      slot('header'),
      slot('footer'),
      slot('actions'),
      slot('tabs[].content'),
      slot('sections[].fields[].render'),
      slot('fields[].render'),
    ],
  ),
  row(['detail-section', 'plugin-detail:detail-section'], [slot('fields[].render')]),
  row(['report-viewer', 'plugin-report:report-viewer'], [slot('report.sections[].content')]),
  row(['plugin-timeline:timeline'], [slot('items[].content')]),
  row(['view-switcher', 'view:view-switcher'], [slot('views[].schema')]),
  row(['dashboard', 'plugin-dashboard:dashboard'], [slot('widgets[].component')]),
]);

const NO_SLOTS: readonly NodeSlotDeclaration[] = Object.freeze([]);

const BY_TYPE: ReadonlyMap<string, readonly NodeSlotDeclaration[]> = (() => {
  const map = new Map<string, readonly NodeSlotDeclaration[]>();
  for (const entry of NODE_SLOT_DECLARATIONS) {
    for (const type of entry.types) {
      if (map.has(type)) throw new Error(`NODE_SLOT_DECLARATIONS lists \`${type}\` twice`);
      map.set(type, entry.slots);
    }
  }
  return map;
})();

/**
 * The node slots of a registry type, by its spelling as authored — the same
 * verbatim lookup the three readers make. A type with no row answers the one
 * frozen empty list: an unknown or custom type has no declared slot, and its
 * `children` are still walked by every reader.
 */
export function nodeSlotsFor(type: string): readonly NodeSlotDeclaration[] {
  return BY_TYPE.get(type) ?? NO_SLOTS;
}

/** One segment of a slot path: the key, and whether `[]` followed it. */
export interface NodeSlotSegment {
  readonly key: string;
  readonly each: boolean;
}

const EACH_SUFFIX = '[]';

/**
 * A slot path split into its segments — `items[].content` is
 * `[{ key: 'items', each: true }, { key: 'content', each: false }]`. An empty
 * key, or `[]` on its own, is a malformed path and throws: a declaration that
 * cannot be walked must not read as "no slot".
 */
export function nodeSlotPathSegments(path: string): readonly NodeSlotSegment[] {
  return path.split('.').map((segment) => {
    const each = segment.endsWith(EACH_SUFFIX);
    const key = each ? segment.slice(0, -EACH_SUFFIX.length) : segment;
    if (key.length === 0) throw new Error(`Malformed node-slot path \`${path}\``);
    return { key, each };
  });
}

/** One value found at a slot position, with the path that reached it from the node. */
export interface NodeSlotValue {
  /** Keys and array indices from the node to the value: `['items', 0, 'content', 1]`. */
  readonly segments: readonly (string | number)[];
  /** The value at that position — a node, a primitive, or anything else the author wrote. */
  readonly value: unknown;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Every value a slot position holds on `node`, in document order, with the
 * path to each. A list at the end of the path is expanded to its elements
 * (one path entry per index), because a slot holds one node OR a list of
 * nodes and both spellings render. Nothing is filtered: a reader decides what
 * a node is (an object with a string `type`, for the gate; any object, for
 * core), so a primitive or a malformed entry comes back for the reader to
 * skip, never silently dropped here.
 */
export function nodeSlotValues(node: unknown, path: string): readonly NodeSlotValue[] {
  let holders: NodeSlotValue[] = [{ segments: [], value: node }];
  for (const { key, each } of nodeSlotPathSegments(path)) {
    const next: NodeSlotValue[] = [];
    for (const holder of holders) {
      if (!isPlainObject(holder.value)) continue;
      const value = holder.value[key];
      if (!each) {
        next.push({ segments: [...holder.segments, key], value });
      } else if (Array.isArray(value)) {
        value.forEach((element, index) => {
          next.push({ segments: [...holder.segments, key, index], value: element });
        });
      }
    }
    holders = next;
  }
  const found: NodeSlotValue[] = [];
  for (const holder of holders) {
    if (Array.isArray(holder.value)) {
      holder.value.forEach((element, index) => {
        found.push({ segments: [...holder.segments, index], value: element });
      });
    } else if (holder.value !== undefined) {
      found.push(holder);
    }
  }
  return found;
}
