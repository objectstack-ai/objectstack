// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Copy-on-write walkers over the collections conversions target.
 *
 * A conversion must rewrite deep-nested metadata (`flows[].nodes[]`, `pages[]`)
 * without mutating the caller's input and without cloning branches it doesn't
 * touch — `normalizeStackInput` shares array/object references from the caller's
 * definition, and an ObjectStack stack can carry non-clonable values (plugin
 * instances with methods), so a blanket `structuredClone` is both wasteful and
 * unsafe. These helpers copy **only** the path from the root down to a changed
 * leaf; if a mapper returns its input unchanged, the original references are
 * preserved all the way up.
 */

import { FLOW_REGION_SLOTS_BY_TYPE } from '../automation/region-slots.js';
import { deepEqualAuthored } from '../shared/deep-equal.js';

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/*
 * Reaching a node inside an ADR-0031 region (#4347) is what makes a conversion
 * position-independent. A pass that walked only `flows[].nodes[]` saw the
 * container and stopped: the same node converted at the top level and did not
 * one level in — a `webhook` callout inside a loop body kept a type no executor
 * owns (the run fails), and a `delete_record` kept `config.filters`, leaving the
 * canonical `filter` the executor reads absent, which is the erased-condition
 * hazard `flow-node-crud-filter-alias` exists to prevent.
 *
 * WHERE those regions live is declared once in `automation/region-slots.ts`
 * (#4401) — an import-free data module, so this stays the pure shape walker it
 * was written as and still shares one table with the schema-side walks and the
 * lint walk.
 */

/**
 * Depth ceiling for the region recursion. Containers nest, but not deeply, and
 * a stack handed to `defineStack` is hand-built objects rather than parsed JSON
 * — so a self-referencing region is reachable, and would otherwise be an
 * unbounded recursion on the load path. Mirrors the ceiling the region walks in
 * `automation/control-flow.zod.ts` use.
 */
const MAX_REGION_DEPTH = 32;

/**
 * Immutably map every node of one structured region (`{ nodes, edges }`).
 *
 * A value that is not region-shaped passes through untouched: the `config` keys
 * above are only *conventionally* regions (`config` is an open record, and
 * `body` in particular is also an ordinary key elsewhere — an `http` node's
 * request payload), so the shape is checked, never assumed.
 */
function mapRegionNodes(
  region: unknown,
  path: string,
  mapper: (node: Dict, path: string) => Dict,
  depth: number,
): unknown {
  if (!isDict(region) || !Array.isArray(region.nodes)) return region;
  let changed = false;
  const nextNodes = region.nodes.map((node, i) => {
    if (!isDict(node)) return node;
    const mapped = mapNodeTree(node, `${path}.nodes[${i}]`, mapper, depth);
    if (mapped !== node) changed = true;
    return mapped;
  });
  return changed ? { ...region, nodes: nextNodes } : region;
}

/**
 * Map one flow node **and everything nested under it**: the node itself, then
 * the nodes of every region its `config` carries, recursively — regions nest (a
 * `loop` inside a `try_catch` inside a `loop`).
 *
 * The mapper runs on the container FIRST and the region lookup keys off the
 * *mapped* node's `type`, so a conversion that renames a container type still
 * has its body walked, under the canonical id.
 */
function mapNodeTree(
  node: Dict,
  path: string,
  mapper: (node: Dict, path: string) => Dict,
  depth: number,
): Dict {
  const mapped = mapper(node, path);
  if (depth >= MAX_REGION_DEPTH) return mapped;
  const slots = typeof mapped.type === 'string' ? FLOW_REGION_SLOTS_BY_TYPE.get(mapped.type) : undefined;
  if (!slots) return mapped;
  const config = mapped.config;
  if (!isDict(config)) return mapped;

  let nextConfig = config;
  for (const { key, arity } of slots) {
    const raw = nextConfig[key];
    if (arity === 'many') {
      if (!Array.isArray(raw)) continue;
      let branchesChanged = false;
      const nextBranches = raw.map((branch, i) => {
        const next = mapRegionNodes(branch, `${path}.config.${key}[${i}]`, mapper, depth + 1);
        if (next !== branch) branchesChanged = true;
        return next;
      });
      if (branchesChanged) nextConfig = { ...nextConfig, [key]: nextBranches };
    } else {
      const next = mapRegionNodes(raw, `${path}.config.${key}`, mapper, depth + 1);
      if (next !== raw) nextConfig = { ...nextConfig, [key]: next };
    }
  }

  return nextConfig === config ? mapped : { ...mapped, config: nextConfig };
}

/**
 * Immutably map every flow node in `stack.flows[].nodes[]` — **including the
 * nodes nested inside ADR-0031 structured regions** (`loop.config.body`,
 * `parallel.config.branches[]`, `try_catch.config.try`/`.catch`), to any depth.
 *
 * `mapper` receives each node dict and its path (`flows[i].nodes[j]`, or
 * `flows[i].nodes[j].config.body.nodes[k]` for a nested one) and returns either
 * the same reference (no change) or a new dict. The stack, the `flows` array, an
 * individual flow, its `nodes` array, and every container `config` on the way
 * down are each copied only when a descendant actually changed.
 */
export function mapFlowNodes(
  stack: Dict,
  mapper: (node: Dict, path: string) => Dict,
): Dict {
  const flows = stack.flows;
  if (!Array.isArray(flows)) return stack;

  let flowsChanged = false;
  const nextFlows = flows.map((flow, fi) => {
    if (!isDict(flow) || !Array.isArray(flow.nodes)) return flow;
    let nodesChanged = false;
    const nextNodes = flow.nodes.map((node, ni) => {
      if (!isDict(node)) return node;
      const mapped = mapNodeTree(node, `flows[${fi}].nodes[${ni}]`, mapper, 0);
      if (mapped !== node) nodesChanged = true;
      return mapped;
    });
    if (!nodesChanged) return flow;
    flowsChanged = true;
    return { ...flow, nodes: nextNodes };
  });

  if (!flowsChanged) return stack;
  return { ...stack, flows: nextFlows };
}

/**
 * Immutably map every page in `stack.pages[]`.
 *
 * `mapper` receives each page dict and its path (`pages[i]`) and returns the
 * same reference (no change) or a new dict. The stack and `pages` array are
 * copied only when a page actually changed.
 */
export function mapPages(stack: Dict, mapper: (page: Dict, path: string) => Dict): Dict {
  const pages = stack.pages;
  if (!Array.isArray(pages)) return stack;

  let changed = false;
  const nextPages = pages.map((page, pi) => {
    if (!isDict(page)) return page;
    const mapped = mapper(page, `pages[${pi}]`);
    if (mapped !== page) changed = true;
    return mapped;
  });

  if (!changed) return stack;
  return { ...stack, pages: nextPages };
}

/**
 * Depth ceiling for the page-component recursion, mirroring
 * {@link MAX_REGION_DEPTH} and for the same reason: a stack handed to
 * `defineStack` is hand-built objects rather than parsed JSON, so a component
 * whose `properties.children` contains itself is reachable and would otherwise
 * be an unbounded recursion on the load path.
 */
const MAX_COMPONENT_DEPTH = 32;

/**
 * The container keys a page component nests its sub-tree under, listed exactly
 * as `walkPageComponents` (`packages/lint/src/page-walk.ts`) lists them:
 * `page:card` → `body` / `footer`, every layout container → `children`.
 * `page:tabs` / `page:accordion` hang theirs off `items[].children`, handled
 * separately below because of the extra index.
 *
 * Recognised by SHAPE — an array — and deliberately NOT keyed by component
 * `type`, which is the same rule lint applies: `properties` is an open bag that
 * nothing validates per-type on the load path, and layout containers compose
 * `children` without ever declaring it in a props schema. A `body: 'Confirm the
 * work'` string on a `record:alert` is not an array and so is never mistaken
 * for a slot; a non-dict element inside one is passed through untouched.
 */
const COMPONENT_CHILD_KEYS = ['children', 'body', 'footer'] as const;

/**
 * Map a list of page components, immutably. Returns the SAME array reference
 * when nothing under it changed, so the copy-on-write contract survives the
 * descent.
 */
function mapComponentList(
  list: unknown[],
  basePath: string,
  mapper: (component: Dict, path: string) => Dict,
  depth: number,
): unknown[] {
  let changed = false;
  const next = list.map((child, i) => {
    if (!isDict(child)) return child;
    const mapped = mapComponentTree(child, `${basePath}[${i}]`, mapper, depth);
    if (mapped !== child) changed = true;
    return mapped;
  });
  return changed ? next : list;
}

/**
 * Map one page component **and everything nested under it** — the component
 * itself, then the components inside its `properties` containers, recursively
 * (a card inside a tab panel inside a card).
 *
 * The mapper runs on the container FIRST and the descent then reads the
 * *mapped* component's `properties`, the same ordering {@link mapNodeTree} uses
 * for flow regions. That is what keeps the walk single-visit under a conversion
 * that MOVES a container key: `page-card-body-to-children` renames
 * `properties.body` → `properties.children`, and because the descent happens
 * after the rename, the sub-tree is walked once under the canonical key instead
 * of once per spelling.
 */
function mapComponentTree(
  component: Dict,
  path: string,
  mapper: (component: Dict, path: string) => Dict,
  depth: number,
): Dict {
  const mapped = mapper(component, path);
  if (depth >= MAX_COMPONENT_DEPTH) return mapped;
  const properties = mapped.properties;
  if (!isDict(properties)) return mapped;

  let nextProps = properties;

  // `page:tabs` / `page:accordion` — `items[].children[]`.
  const items = nextProps.items;
  if (Array.isArray(items)) {
    let itemsChanged = false;
    const nextItems = items.map((item, i) => {
      if (!isDict(item) || !Array.isArray(item.children)) return item;
      const nextChildren = mapComponentList(
        item.children,
        `${path}.properties.items[${i}].children`,
        mapper,
        depth + 1,
      );
      if (nextChildren === item.children) return item;
      itemsChanged = true;
      return { ...item, children: nextChildren };
    });
    if (itemsChanged) nextProps = { ...nextProps, items: nextItems };
  }

  for (const key of COMPONENT_CHILD_KEYS) {
    const list = nextProps[key];
    if (!Array.isArray(list)) continue;
    const next = mapComponentList(list, `${path}.properties.${key}`, mapper, depth + 1);
    if (next !== list) nextProps = { ...nextProps, [key]: next };
  }

  return nextProps === properties ? mapped : { ...mapped, properties: nextProps };
}

/**
 * Immutably map every page component — the two places a `PageComponentSchema`
 * lives (`stack.pages[].regions[].components[]` and `stack.pages[].slots.<slot>`,
 * which is `PageComponent | PageComponent[]`) **plus everything nested inside a
 * component's `properties` containers**, to any depth.
 *
 * `mapper` receives each component dict and its path
 * (`pages[i].regions[j].components[k]`, `pages[i].slots.tabs`,
 * `pages[i].slots.tabs[0]`,
 * `pages[i].regions[j].components[k].properties.items[0].children[1]`) and
 * returns the same reference (no change) or a new dict. Every container on the
 * way — the stack, `pages`, a page, its `regions`, a region, its `components`,
 * its `slots`, and each `properties` bag on the way down — is copied only when
 * a descendant actually changed: {@link mapPages}' contract, all the way down.
 *
 * **The reach is `walkPageComponents`'s reach (#6775), and getting there took
 * two goes.** This walker's comment used to call region level "the whole
 * surface", reasoning that a conversion can only reach what the type declares
 * and that everything else sits in a free-form bag which the tombstone (`tsc` +
 * the parse) covers instead. Both halves failed where it counted:
 *
 *   - **`slots` (#6776)** is as typed as a region component — `PageSchema.slots`
 *     is a closed map of seven named slots, each
 *     `z.union([PageComponentSchema, z.array(PageComponentSchema)])` — and is
 *     the canonical authoring shape for a `kind: 'slotted'` record page. All
 *     four in-repo `page:tabs` sites are `slots.tabs`, so a region-only rewrite
 *     left `os migrate meta` unable to touch the only shape that key is written
 *     in, while the tombstone's prescription promised it would.
 *   - **Container nesting (#6775)** is where "the tombstone covers it" fails: a
 *     tombstone only fires for a key some props schema judges, and `properties`
 *     is an open bag nothing validates by `type` on the load path. So
 *     `page-header-subtitle-alias`, whose retired `description` is tombstoned
 *     nowhere (`description` is a live declared prop on other components), got
 *     no diagnostic at a nested site from any layer: the conversion did not
 *     fire, `PageSchema` stayed green, and the advisory props gate runs CLI-only
 *     and on already-converted metadata. A slotted record page — the shape
 *     objectui's own guide recommends — could carry a header the rewrite never
 *     saw, so objectui's `subtitle ?? description` fallback could not retire
 *     without silently dropping those subtitles.
 *
 * `walkPageComponents` in `packages/lint` has visited all three surfaces from
 * the start, so until now every conversion here reached strictly less than the
 * lint rule that judges its result — "same key, different meaning depending on
 * where you put it", the position-dependence the flow-node region recursion
 * (#4347) was built to abolish.
 *
 * Two differences from the lint walk remain, both deliberate:
 *
 *   1. **Source-authored pages** (`kind: 'html' | 'react' | 'jsx'`) are visited
 *      here and skipped there. For lint that skip prevents findings about a
 *      DERIVED region cache the author never wrote; a conversion still has to
 *      normalize that cache, or a stored page rehydrates in a shape the runtime
 *      no longer serves. Skipping them here would REMOVE reach conversions have
 *      had since #5509.
 *   2. **The {@link MAX_COMPONENT_DEPTH} ceiling** has no counterpart in lint,
 *      which walks parsed JSON only. This walker also runs on hand-built
 *      `defineStack` objects, where a self-referencing `children` is reachable.
 */
export function mapPageComponents(
  stack: Dict,
  mapper: (component: Dict, path: string) => Dict,
): Dict {
  return mapPages(stack, (page, pagePath) => {
    let nextPage = page;

    const regions = page.regions;
    if (Array.isArray(regions)) {
      let regionsChanged = false;
      const nextRegions = regions.map((region, ri) => {
        if (!isDict(region)) return region;
        const components = region.components;
        if (!Array.isArray(components)) return region;

        const nextComponents = mapComponentList(
          components,
          `${pagePath}.regions[${ri}].components`,
          mapper,
          0,
        );

        if (nextComponents === components) return region;
        regionsChanged = true;
        return { ...region, components: nextComponents };
      });

      if (regionsChanged) nextPage = { ...nextPage, regions: nextRegions };
    }

    const slots = page.slots;
    if (isDict(slots)) {
      let slotsChanged = false;
      const nextSlots: Dict = { ...slots };
      for (const [slot, value] of Object.entries(slots)) {
        // A slot holds one component or an array of them — the same
        // normalization `walkPageComponents` does, and the path spelling
        // matches it so a conversion notice and a lint finding name one site
        // with one string.
        if (Array.isArray(value)) {
          const nextList = mapComponentList(value, `${pagePath}.slots.${slot}`, mapper, 0);
          if (nextList === value) continue;
          nextSlots[slot] = nextList;
          slotsChanged = true;
        } else {
          if (!isDict(value)) continue;
          const mapped = mapComponentTree(value, `${pagePath}.slots.${slot}`, mapper, 0);
          if (mapped === value) continue;
          nextSlots[slot] = mapped;
          slotsChanged = true;
        }
      }
      if (slotsChanged) nextPage = { ...nextPage, slots: nextSlots };
    }

    return nextPage;
  });
}

/**
 * Immutably map every datasource in `stack.datasources[]`.
 *
 * `mapper` receives each datasource dict and its path (`datasources[i]`) and
 * returns the same reference (no change) or a new dict. The stack and the
 * `datasources` array are copied only when a datasource actually changed —
 * the {@link mapPages} contract, delegated to {@link mapCollection}.
 */
export function mapDatasources(
  stack: Dict,
  mapper: (datasource: Dict, path: string) => Dict,
): Dict {
  return mapCollection(stack, 'datasources', mapper);
}

/**
 * Immutably map every dict item of a top-level array collection
 * (`stack[key][]`) — the generic form of {@link mapPages}, for conversions
 * targeting `objects`, `books`, `sharingRules`, `views`, ….
 *
 * `mapper` receives each item dict and its path (`<key>[i]`) and returns the
 * same reference (no change) or a new dict. Non-array collections and
 * non-dict items pass through untouched.
 */
export function mapCollection(
  stack: Dict,
  key: string,
  mapper: (item: Dict, path: string) => Dict,
): Dict {
  const items = stack[key];
  if (!Array.isArray(items)) return stack;

  let changed = false;
  const next = items.map((item, i) => {
    if (!isDict(item)) return item;
    const mapped = mapper(item, `${key}[${i}]`);
    if (mapped !== item) changed = true;
    return mapped;
  });

  if (!changed) return stack;
  return { ...stack, [key]: next };
}

/**
 * Rename `dict[from]` → `dict[to]`, immutably. Returns `null` when there is
 * nothing to do — the caller keeps the original reference and emits no notice.
 *
 * Three cases, and the third is the one #4923 ruled on:
 *
 * 1. **`from` absent (or null)** → `null`. Nothing to convert.
 * 2. **`from` present, `to` absent** → the plain rename. The value moves to the
 *    canonical key and the old spelling is deleted.
 * 3. **BOTH present** — the author wrote two names for one slot — splits *by
 *    value*, because the two halves are genuinely different facts:
 *    - **values structurally equal** → the alias carries nothing the canonical
 *      key does not already carry, so deleting it is **lossless hygiene** and
 *      squarely inside the D2 contract ("the runtime only ever sees the
 *      canonical shape"). The alias is dropped and the caller emits its notice,
 *      so the rewrite stays loud.
 *    - **values differ** → `null`, and BOTH spellings survive. This is real
 *      author ambiguity, and an upgrade tool that picked the canonical one
 *      would be editing a configuration the customer never agreed to. The
 *      surviving pair is what lets the strict node-config gates refuse with a
 *      prescription that NAMES BOTH KEYS (`builtin-node-config.zod.ts` and
 *      friends) instead of the platform choosing silently.
 *
 * Before #4923 case 3 was uniformly "leave the alias shadowed", which is why
 * every `renameFlowConfigAliases` entry's fixture used to pin a retired
 * spelling surviving in its `after` half. Case 3's equal branch also makes the
 * transform **idempotent in both shape and notices**: once the twin is gone,
 * a replay hits case 1.
 *
 * Structural equality (not `===`) is the right test because these values are
 * authored data, not identities: two separately-written `{ status: 'stale' }`
 * filters are the same declaration. It is the same predicate the composer uses
 * for "same value composes fine" (#5005) — deliberately one definition, so the
 * two surfaces cannot disagree about whether a pair of values is "the same".
 */
export function renameKey(dict: Dict, from: string, to: string): Dict | null {
  // A pair that renames a key to itself has no work to do, and the equal-value
  // branch below would otherwise read it as "a twin identical to the canonical
  // key" and delete the only copy. No registry pair is written that way today;
  // this is here so one added later fails to convert instead of erasing data.
  if (from === to) return null;
  if (!(from in dict) || dict[from] == null) return null;
  const next: Dict = { ...dict };
  if (dict[to] != null) {
    // Both spellings present (#4923). Only a redundant twin may be removed.
    if (!deepEqualAuthored(dict[from], dict[to])) return null;
    delete next[from];
    return next;
  }
  next[to] = next[from];
  delete next[from];
  return next;
}

/**
 * Rename `config[from]` → `config[to]` on a node dict, immutably.
 *
 * A thin positional wrapper over {@link renameKey} — deliberately delegating
 * rather than re-implementing, so the shadowed-alias rule #4923 settled has
 * exactly one definition and a flow node's `config` cannot drift from every
 * other dict the conversion layer rewrites.
 */
export function renameConfigKey(node: Dict, from: string, to: string): Dict | null {
  const config = node.config;
  if (!isDict(config)) return null;
  const nextConfig = renameKey(config, from, to);
  if (!nextConfig) return null;
  return { ...node, config: nextConfig };
}
