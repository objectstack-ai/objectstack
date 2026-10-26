// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * flowGrouping — what the Automations rail reads off each flow's own
 * definition: the object it is grouped under and the kind of trigger that
 * starts it (objectui#12454, epic objectui#12446 decision 5: "Automations
 * groups by trigger object").
 *
 * Pure: flow definitions as the metadata list serves them, the scope's object
 * index (name → label) and the app navigation's object order, in; ordered
 * groups out. Nothing here reads the
 * network or React, so the grouping is pinned without a DOM.
 *
 * ## The object a flow is grouped under
 *
 * Asked in this order; the first answer wins.
 *
 * 1. **The Start node's object.** A record-triggered flow watches
 *    `config.objectName`; a time-relative sweep reads `config.timeRelative.object`
 *    (falling back to `config.objectName`, as the flow header's Trigger pill
 *    does). A screen flow that names its record on the Start node is answered
 *    here too.
 * 2. **The first data node of the flow's own graph**, in graph order from the
 *    Start node, whose object is one of the scope's objects — what a scheduled
 *    sweep queries first ("Find expiring contracts" → Contract).
 * 3. **The first record write anywhere in the flow**, nested regions included
 *    (`collectFlowGraphs` order), on one of the scope's objects — what an
 *    autolaunched subflow, or a sweep that first reads a platform object
 *    (the users it iterates), exists to write.
 * 4. Otherwise none: the flow lands in the trailing "No object" group.
 *
 * "One of the scope's objects" is the object index the rail is handed — the
 * objects the package declares, the ones the Data rail lists. An empty index
 * (the object list failed to load, or an older backend) admits every object,
 * so steps 2 and 3 still answer with what the flow touches first.
 *
 * ## The order of the groups (objectui#12612)
 *
 * The app's navigation decides: the groups follow the order in which the
 * package's app lists its objects (`navigationObjectOrder`). The objects it
 * does not list follow, the one with more flows first, then by label in the
 * display locale, then by api name. "No object" is last. Where the navigation
 * decides, the order is the same in every locale.
 */

import { collectFlowGraphs, resolveFlowTriggerKind } from '@objectstack/spec/automation';

/** The four trigger glyphs the rail draws. */
export type FlowTriggerGlyph = 'record' | 'scheduled' | 'screen' | 'autolaunched';

/** Every glyph, in the legend's order. */
export const FLOW_TRIGGER_GLYPHS: readonly FlowTriggerGlyph[] = ['record', 'scheduled', 'screen', 'autolaunched'];

/** The node types that read or write one object's records, and the ones that write. */
const DATA_NODE_TYPES = new Set(['get_record', 'create_record', 'update_record', 'delete_record']);
const WRITE_NODE_TYPES = new Set(['create_record', 'update_record', 'delete_record']);

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function nodesOf(flow: Rec): Rec[] {
  return Array.isArray(flow.nodes) ? flow.nodes.filter(isRec) : [];
}

function configOf(node: Rec): Rec {
  return isRec(node.config) ? node.config : {};
}

/**
 * Which glyph a flow's row carries: bolt for a record trigger, clock for a
 * schedule or a time-relative sweep, pointer for a screen flow, corner arrow
 * for everything started by something else (a subflow, a button, an API call).
 * The trigger kind is the spec's own resolver's answer, the one the engine
 * arms on.
 */
export function flowTriggerGlyph(flow: unknown): FlowTriggerGlyph {
  const kind = resolveFlowTriggerKind(flow);
  if (kind === 'record_change') return 'record';
  if (kind === 'schedule' || kind === 'time_relative') return 'scheduled';
  if (isRec(flow) && flow.type === 'screen') return 'screen';
  return 'autolaunched';
}

/** The main graph's nodes in graph order from the Start node; unreached nodes follow in authored order. */
function graphOrder(flow: Rec): Rec[] {
  const nodes = nodesOf(flow);
  const byId = new Map<string, Rec>();
  for (const n of nodes) if (typeof n.id === 'string' && !byId.has(n.id)) byId.set(n.id, n);
  const next = new Map<string, string[]>();
  for (const e of Array.isArray(flow.edges) ? flow.edges : []) {
    if (!isRec(e) || typeof e.source !== 'string' || typeof e.target !== 'string') continue;
    const list = next.get(e.source) ?? [];
    list.push(e.target);
    next.set(e.source, list);
  }
  const ordered: Rec[] = [];
  const seen = new Set<string>();
  const queue = nodes.filter((n) => n.type === 'start' && typeof n.id === 'string').map((n) => n.id as string);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (node) ordered.push(node);
    for (const to of next.get(id) ?? []) if (!seen.has(to)) queue.push(to);
  }
  for (const n of nodes) {
    if (typeof n.id === 'string' && seen.has(n.id)) continue;
    ordered.push(n);
  }
  return ordered;
}

/** Every graph of a flow, regions included; a definition the walk cannot read has none. */
function flowGraphs(flow: Rec): ReturnType<typeof collectFlowGraphs> {
  try {
    return collectFlowGraphs(flow as Parameters<typeof collectFlowGraphs>[0]);
  } catch {
    return [];
  }
}

/**
 * The object one flow is grouped under, or `null` (see the file header for the
 * order of the questions). `inScope` says whether an object is one of the
 * scope's own.
 */
export function flowGroupObject(flow: unknown, inScope: (objectName: string) => boolean = () => true): string | null {
  if (!isRec(flow)) return null;
  const start = nodesOf(flow).find((n) => n.type === 'start');
  if (start) {
    const config = configOf(start);
    const sweep = isRec(config.timeRelative) ? nonEmpty(config.timeRelative.object) : null;
    const own = (resolveFlowTriggerKind(flow) === 'time_relative' ? sweep : null) ?? nonEmpty(config.objectName);
    if (own) return own;
  }
  for (const node of graphOrder(flow)) {
    if (typeof node.type !== 'string' || !DATA_NODE_TYPES.has(node.type)) continue;
    const object = nonEmpty(configOf(node).objectName);
    if (object && inScope(object)) return object;
  }
  for (const graph of flowGraphs(flow)) {
    for (const node of graph.nodes) {
      if (!WRITE_NODE_TYPES.has(node.type)) continue;
      const object = nonEmpty(isRec(node.config) ? node.config.objectName : undefined);
      if (object && inScope(object)) return object;
    }
  }
  return null;
}

/** One group of the rail: an object (or none) and the flows under it. */
export interface FlowRailGroup<T> {
  /** A stable key: the object name, or the empty string for "No object". */
  key: string;
  /** The object the group is for; `null` for the trailing "No object" group. */
  objectName: string | null;
  /** The header: the object's label from the index, its name without one, or the "No object" words. */
  label: string;
  /** The flows, in the order the rail was handed them. */
  items: T[];
}

export interface GroupFlowsOptions {
  /** The trailing group's header words. */
  noObjectLabel: string;
  /**
   * The objects in the order the app's navigation lists them
   * (`navigationObjectOrder`); the groups follow it. Empty when the scope has
   * no app (the package-less scope, a package without one): every group is
   * then an unlisted one. Required, so no caller orders the rail by the
   * labels' alphabet by leaving it out (objectui#12612).
   */
  objectOrder: readonly string[];
  /**
   * The collation that breaks ties among the objects the navigation does not
   * list: the locale the pillar reads its labels in. Required, because the
   * group order is author-visible and the machine's locale is neither of the
   * repo's locale channels (objectui#9909).
   */
  locale: string;
}

/**
 * The objects an app's navigation lists, in its order: entries walked depth
 * first with every group opened, object entries only (`type: 'object'` with
 * an `objectName`), each object at its first entry. Anything else answers an
 * empty order.
 */
export function navigationObjectOrder(navigation: unknown): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const walk = (entries: unknown): void => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (!isRec(entry)) continue;
      const object = entry.type === 'object' ? nonEmpty(entry.objectName) : null;
      if (object && !seen.has(object)) {
        seen.add(object);
        order.push(object);
      }
      walk(entry.children);
    }
  };
  walk(navigation);
  return order;
}

/**
 * The rail's groups: one per object, in the app's navigation order, then the
 * objects it does not list (more flows first, then label, then api name), then
 * "No object" last (see the file header). A flow with no served definition
 * lands in "No object". Groups hold only the flows they were handed, so a
 * search filters within groups by handing in fewer flows.
 */
export function groupFlowsByObject<T extends { name: string }>(
  flows: readonly T[],
  definitions: ReadonlyMap<string, unknown>,
  objectLabels: ReadonlyMap<string, string>,
  { noObjectLabel, objectOrder, locale }: GroupFlowsOptions,
): FlowRailGroup<T>[] {
  const inScope = objectLabels.size > 0 ? (name: string) => objectLabels.has(name) : () => true;
  const byObject = new Map<string, FlowRailGroup<T>>();
  const none: FlowRailGroup<T> = { key: '', objectName: null, label: noObjectLabel, items: [] };
  for (const flow of flows) {
    const object = flowGroupObject(definitions.get(flow.name), inScope);
    if (!object) {
      none.items.push(flow);
      continue;
    }
    let group = byObject.get(object);
    if (!group) {
      group = { key: object, objectName: object, label: objectLabels.get(object) || object, items: [] };
      byObject.set(object, group);
    }
    group.items.push(flow);
  }
  const position = new Map<string, number>();
  objectOrder.forEach((name, i) => {
    if (!position.has(name)) position.set(name, i);
  });
  const collator = new Intl.Collator(locale, { sensitivity: 'base' });
  const groups = [...byObject.values()].sort((a, b) => {
    const pa = position.get(a.key);
    const pb = position.get(b.key);
    if (pa !== undefined || pb !== undefined) {
      if (pa === undefined) return 1;
      if (pb === undefined) return -1;
      return pa - pb;
    }
    return (
      b.items.length - a.items.length ||
      collator.compare(a.label, b.label) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    );
  });
  if (none.items.length > 0) groups.push(none);
  return groups;
}
