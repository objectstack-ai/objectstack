// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29786 — the items other installed packages contribute to a
 * read-only base, as the Studio pillars draw them: greyed, read-only and
 * labelled with the contributing package (ADR-0146 D3, "On top, one
 * surface"; ADR-0029 D7 for the navigation half). Pure, so the placement
 * rules are pinned without a render.
 *
 * ## The facts it reads, and only those
 *
 * The base's ONE customization read (`GET /api/v1/packages/:id/customizations`,
 * `contributions`), the same answer the rails' marks come from
 * (`usePackageCustomizations`): every `field`, `flow` and `nav` entry, each
 * naming its contributing package. The package's display name is the listed
 * package's, looked up by that id as the base's own name is.
 *
 * ⛔ Nothing is joined client-side on names (ruling 6566915346, letter E): a
 * `nav` entry names the item's id and no label, and its row says the id. The
 * contributor's manifest is never read for a label, a target or an order —
 * that would be a second copy of the server's navigation fold.
 *
 * ## Where a `nav` entry goes
 *
 * Under the group the entry names when the open app's navigation declares a
 * `type: 'group'` item of that id, at any depth — the one question the
 * server's fold asks (`findNavGroup`, `@objectstack/objectql`). Otherwise at
 * the top level, as the fold appends it; an entry that names a group the app
 * does not declare says so (`undeclaredGroup`).
 */

import type { PackageCustomizationsState } from './CustomizationMark.js';

/** What every contributed item carries. */
interface ContributedBase {
  /** The item's name: a field name, a flow name, a nav item's id. */
  name: string;
  /** The contributing package's id. */
  packageId: string;
  /** The contributing package's listed name, else its id. */
  packageName: string;
}

/** A field or flow another package contributes to one of the base's objects. */
export interface ContributedOnObject extends ContributedBase {
  kind: 'field' | 'flow';
  /** The base-owned object it is on. */
  object: string;
}

/** A navigation item another package contributes to one of the base's apps. */
export interface ContributedNav extends ContributedBase {
  kind: 'nav';
  app: string;
  /** The group the contribution targets, as declared; absent for the top level. */
  group?: string;
}

/** A base's contributed items, by kind. */
export interface BaseContributions {
  nav: readonly ContributedNav[];
  fields: readonly ContributedOnObject[];
  flows: readonly ContributedOnObject[];
}

/**
 * The contributed items of a base's read, or `null` when there is no answer
 * to draw from: no read, one in flight, or a failed one (the rail's filter
 * already says why). Entries keep the read's order.
 */
export function baseContributionsOf(state: PackageCustomizationsState | null | undefined): BaseContributions | null {
  if (!state || state.status !== 'read') return null;
  const nameOf = (id: string) => state.contributorNames.get(id) ?? id;
  const nav: ContributedNav[] = [];
  const fields: ContributedOnObject[] = [];
  const flows: ContributedOnObject[] = [];
  for (const entry of state.read.contributions) {
    if (entry.kind === 'nav') {
      nav.push({
        kind: 'nav',
        app: entry.app,
        ...(entry.group !== undefined ? { group: entry.group } : {}),
        name: entry.name,
        packageId: entry.packageId,
        packageName: nameOf(entry.packageId),
      });
    } else {
      const item: ContributedOnObject = {
        kind: entry.kind,
        object: entry.object,
        name: entry.name,
        packageId: entry.packageId,
        packageName: nameOf(entry.packageId),
      };
      (entry.kind === 'field' ? fields : flows).push(item);
    }
  }
  return { nav, fields, flows };
}

/** The fields contributed to one object, by field name. */
export function contributedFieldsOf(
  contributions: BaseContributions | null,
  object: string | null | undefined,
): ReadonlyMap<string, ContributedOnObject> {
  const out = new Map<string, ContributedOnObject>();
  if (!contributions || !object) return out;
  for (const f of contributions.fields) if (f.object === object && !out.has(f.name)) out.set(f.name, f);
  return out;
}

/**
 * The `type: 'group'` nav item of id `groupId` in `items`, at any depth, or
 * `undefined`. The server's fold asks exactly this (both conditions: an entry
 * of another type sharing the id is no container), so a group this finds is
 * the one the served navigation fills.
 */
export function findDeclaredNavGroup(items: unknown, groupId: string): Record<string, unknown> | undefined {
  if (!Array.isArray(items)) return undefined;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const node = item as Record<string, unknown>;
    if (node.id === groupId && node.type === 'group') return node;
    const found = findDeclaredNavGroup(node.children, groupId);
    if (found) return found;
  }
  return undefined;
}

/** A contributed nav row drawn at the app's top level. */
export interface TopLevelContributedNav {
  entry: ContributedNav;
  /** The group the entry names that the app does not declare, or `null`. */
  undeclaredGroup: string | null;
}

/** Where one app's contributed nav rows go in its tree. */
export interface NavContributionPlacement {
  /** By declared group id: the rows drawn after that group's own children. */
  byGroup: ReadonlyMap<string, readonly ContributedNav[]>;
  /** The rows drawn after the app's own top-level entries. */
  top: readonly TopLevelContributedNav[];
}

const NO_PLACEMENT: NavContributionPlacement = { byGroup: new Map(), top: [] };

/**
 * Place the contributions to `app` in its `navigation` (the tree the rail
 * draws). Entries for other apps are left out.
 */
export function placeNavContributions(
  contributions: BaseContributions | null,
  app: string | null,
  navigation: unknown,
): NavContributionPlacement {
  if (!contributions || !app) return NO_PLACEMENT;
  const byGroup = new Map<string, ContributedNav[]>();
  const top: TopLevelContributedNav[] = [];
  for (const entry of contributions.nav) {
    if (entry.app !== app) continue;
    if (entry.group === undefined) {
      top.push({ entry, undeclaredGroup: null });
    } else if (findDeclaredNavGroup(navigation, entry.group)) {
      const list = byGroup.get(entry.group) ?? [];
      list.push(entry);
      byGroup.set(entry.group, list);
    } else {
      top.push({ entry, undeclaredGroup: entry.group });
    }
  }
  return byGroup.size === 0 && top.length === 0 ? NO_PLACEMENT : { byGroup, top };
}

/** Whether a placement draws any row. */
export function placesAnyNav(placement: NavContributionPlacement): boolean {
  return placement.top.length > 0 || placement.byGroup.size > 0;
}

/** A flow rail group with the flows other packages trigger on its object. */
export interface GroupWithContributedFlows<G> {
  group: G;
  contributed: readonly ContributedOnObject[];
}

/**
 * The Automations rail's groups, each with the contributed flows on its
 * object. A contributed flow whose object has no group of the base's own gets
 * one, labelled as the rail labels an object (`labelOf`), after the base's
 * object groups and before the "No object" group, in the read's order.
 */
export function withContributedFlowGroups<G extends { key: string; objectName: string | null }>(
  groups: readonly G[],
  contributions: BaseContributions | null,
  makeGroup: (object: string) => G,
): Array<GroupWithContributedFlows<G>> {
  const byObject = new Map<string, ContributedOnObject[]>();
  for (const flow of contributions?.flows ?? []) {
    const list = byObject.get(flow.object) ?? [];
    list.push(flow);
    byObject.set(flow.object, list);
  }
  const out: Array<GroupWithContributedFlows<G>> = [];
  const held = new Set<string>();
  for (const group of groups) {
    if (group.objectName !== null) held.add(group.objectName);
  }
  const added = [...byObject.keys()]
    .filter((object) => !held.has(object))
    .map((object) => ({ group: makeGroup(object), contributed: byObject.get(object) ?? [] }));
  let addedPlaced = false;
  for (const group of groups) {
    if (group.objectName === null && !addedPlaced) {
      out.push(...added);
      addedPlaced = true;
    }
    out.push({ group, contributed: group.objectName === null ? [] : (byObject.get(group.objectName) ?? []) });
  }
  if (!addedPlaced) out.push(...added);
  return out;
}

// ---------------------------------------------------------------------------
// objectstack#29851 — the served text of a contributed nav entry, and what a
// contributor-only package adds elsewhere.
// ---------------------------------------------------------------------------

/**
 * The served navigation entries of one app that its published layer does not
 * hold, by id: the entries the server's fold added (ADR-0029 D7), as the live
 * app serves them, label included.
 *
 * `published` is the app's `/layers` effective document; `served` is the
 * app's row of the `/meta/app?package=` list the Interfaces pillar already
 * reads (the same pair `servedNavTextOf` reads). A lookup BY ID in a served
 * read, never a join on names: nothing is read from the contributor's
 * manifest.
 *
 * An id is kept only when the served tree holds it exactly once and the
 * published layer not at all. An id the base also holds, or one two
 * contributions share, is left out, so its row keeps the bare id instead of
 * a guessed label.
 *
 * Empty when either side is missing (a never-published app has no served
 * row) or when the two documents are not the same app.
 */
export interface ServedContributedNav {
  app: string | null;
  entries: ReadonlyMap<string, Record<string, unknown>>;
}

export const NO_SERVED_CONTRIBUTED_NAV: ServedContributedNav = { app: null, entries: new Map() };

export function servedContributedNavOf(
  published: Record<string, unknown> | null | undefined,
  served: Record<string, unknown> | null | undefined,
): ServedContributedNav {
  if (!published || !served) return NO_SERVED_CONTRIBUTED_NAV;
  if (typeof published.name !== 'string' || published.name !== served.name) return NO_SERVED_CONTRIBUTED_NAV;
  const own = new Set<string>();
  visitNavEntries(published.navigation, (_node, id) => own.add(id));
  const seen = new Map<string, number>();
  const byId = new Map<string, Record<string, unknown>>();
  visitNavEntries(served.navigation, (node, id) => {
    seen.set(id, (seen.get(id) ?? 0) + 1);
    if (!byId.has(id)) byId.set(id, node);
  });
  const entries = new Map<string, Record<string, unknown>>();
  for (const [id, node] of byId) {
    if (!own.has(id) && seen.get(id) === 1) entries.set(id, node);
  }
  return { app: published.name, entries };
}

/** The served entry a contributed nav row is drawn from, or `undefined` (the row keeps its id). */
export function servedEntryOf(
  served: ServedContributedNav,
  entry: Pick<ContributedNav, 'app' | 'name'>,
): Record<string, unknown> | undefined {
  return served.app !== null && served.app === entry.app ? served.entries.get(entry.name) : undefined;
}

function visitNavEntries(nodes: unknown, visit: (node: Record<string, unknown>, id: string) => void): void {
  if (!Array.isArray(nodes)) return;
  for (const item of nodes) {
    if (!item || typeof item !== 'object') continue;
    const node = item as Record<string, unknown>;
    if (typeof node.id === 'string') visit(node, node.id);
    visitNavEntries(node.children, visit);
  }
}

/**
 * The apps a package's listed manifest declares navigation for
 * (`navigationContributions[].app`), each once, in declared order.
 *
 * ADDRESSES ONLY: where to ask. Nothing a person sees is drawn from the
 * declaration — the target's owner comes from the served app read, and what
 * the package adds from the owner's served customization read
 * ({@link contributedNavCountOf}).
 */
export function declaredNavTargetApps(manifest: Record<string, unknown> | null | undefined): string[] {
  const declared = manifest?.navigationContributions;
  if (!Array.isArray(declared)) return [];
  const apps: string[] = [];
  for (const c of declared) {
    const app = c && typeof c === 'object' ? (c as { app?: unknown }).app : undefined;
    if (typeof app === 'string' && app && !apps.includes(app)) apps.push(app);
  }
  return apps;
}

/**
 * How many navigation entries the owner's served customization read lists for
 * `packageId` on `app`: the `nav` contributions stamped with that package.
 * A disabled package's are not listed by the server, so it counts 0.
 */
export function contributedNavCountOf(
  read: { contributions: ReadonlyArray<{ kind: string; packageId: string; app?: string }> },
  packageId: string,
  app: string,
): number {
  let n = 0;
  for (const c of read.contributions) if (c.kind === 'nav' && c.packageId === packageId && c.app === app) n += 1;
  return n;
}

/** What a package with no app of its own adds to one other package's app, as served. */
export interface ContributedElsewhere {
  app: string;
  ownerId: string;
  ownerName: string;
  count: number;
}
