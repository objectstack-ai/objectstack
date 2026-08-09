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
 * Immutably map every **declared-shape** page component — the two places a
 * `PageComponentSchema` actually lives: `stack.pages[].regions[].components[]`
 * and `stack.pages[].slots.<slot>` (which is `PageComponent | PageComponent[]`).
 *
 * `mapper` receives each component dict and its path
 * (`pages[i].regions[j].components[k]`, `pages[i].slots.tabs`,
 * `pages[i].slots.tabs[0]`) and returns the same reference (no change) or a new
 * dict. Every container on the way — the stack, `pages`, a page, its `regions`,
 * a region, its `components`, its `slots` — is copied only when a descendant
 * actually changed: {@link mapPages}' contract, one level deeper.
 *
 * That is the whole surface, and it is bounded by the type rather than by the
 * shape of any one page: `PageComponentSchema` declares no children key, so
 * anything nested (tab panels, card bodies) sits inside another component's
 * free-form `properties` and is NOT typed page-component shape — the tombstone
 * (`tsc` + the parse) covers those, as every retirement entry's doc says.
 *
 * **`slots` was missing until #6776, and the gap was load-bearing.** This
 * walker's own comment used to call region level "the whole surface", on the
 * reasoning that everything else is inside a free-form bag. `slots` is the
 * counter-example: `PageSchema.slots` is a closed map of seven named slots,
 * each declared `z.union([PageComponentSchema, z.array(PageComponentSchema)])`
 * — exactly as typed as a region component, and the canonical authoring shape
 * for a `kind: 'slotted'` record page. `walkPageComponents` in `packages/lint`
 * has always visited both, so every conversion here reached strictly less than
 * the lint rule that judges the result. #6776 is where that cost something
 * real: all four in-repo `page:tabs` authoring sites are `slots.tabs`, so a
 * region-only rewrite would have left `os migrate meta` unable to touch the
 * only shape that key is written in, while the tombstone's prescription
 * promised it would.
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

        let componentsChanged = false;
        const nextComponents = components.map((component, ci) => {
          if (!isDict(component)) return component;
          const mapped = mapper(component, `${pagePath}.regions[${ri}].components[${ci}]`);
          if (mapped !== component) componentsChanged = true;
          return mapped;
        });

        if (!componentsChanged) return region;
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
          let listChanged = false;
          const nextList = value.map((component, i) => {
            if (!isDict(component)) return component;
            const mapped = mapper(component, `${pagePath}.slots.${slot}[${i}]`);
            if (mapped !== component) listChanged = true;
            return mapped;
          });
          if (!listChanged) continue;
          nextSlots[slot] = nextList;
          slotsChanged = true;
        } else {
          if (!isDict(value)) continue;
          const mapped = mapper(value, `${pagePath}.slots.${slot}`);
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
