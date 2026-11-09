// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D2, child N] Inside one namespace, a `(type, name)` has one
 * package holder — for the bucket 2/3 types phase 1's one-holder rule does
 * not cover. The ONE predicate both doors ask: the package door
 * ({@link SchemaRegistry.installPackage}, beside the ADR-0130 D3 object check)
 * and `os validate` (`packages/cli/src/utils/namespace-co-owner-names.ts`,
 * which walks an artifact's packages in the order the boot installs them and
 * asks this module the same question about each).
 *
 * ## Why
 *
 * ADR-0150 addresses behavioural metadata by `(namespace, name)` — the URL
 * segment, the AI face's derived flat name — while its identity is
 * `(package id, name)`. ADR-0130 and ADR-0141 let several packages share one
 * namespace (an artifact's packages, a parent and its modules), so the
 * address `crm/home` names one item only if no two co-owners of `crm` both
 * hold a page `home`. D2 (ruled, record 6724570466) extends ADR-0130 D3's
 * object rule to these types: within a namespace, at most one package holder.
 *
 * ## The types
 *
 * {@link NAMESPACE_UNIQUE_TYPES}: the twelve bucket 2/3 types phase 1's
 * `BARE_NAME_ONE_HOLDER_TYPES` does not list in ADR-0150's execution plan —
 * sharing rule, queue, assignment rule, hook, job, app, page, dashboard,
 * report, book, analytics cube and tool. ⛔ No other type: a narrowing beyond
 * these twelve is the maintainer's to rule. (`tool` is in both lists once
 * phase 1 takes it: that rule refuses a second holder anywhere in the
 * deployment after the cold boot; this one refuses a second holder inside one
 * namespace at every install. The two never disagree about a refusal, only
 * about when it applies.)
 *
 * ## The holders
 *
 * A package, by the id the registry installs it under (`artifactPackageId`),
 * and by its `manifest.namespace`. Two packages are in one namespace when they
 * declare the same one. ⛔ Never:
 *
 *  - a package with no namespace — it has no address to share;
 *  - a shareable platform namespace ({@link isNamespaceJudged}): `base`,
 *    `system` and `sys`, the namespaces the install-time namespace gate lets
 *    any number of packages share, and which ADR-0130 D3's co-owner map never
 *    reads either;
 *  - the environment catalog — an environment item belongs to the implicit
 *    environment package, which has no namespace (ADR-0150 D2), and an item
 *    authored under a package's name is that package's ADR-0005 overlay;
 *  - the same package again — a reload, a re-install or an upgrade holds its
 *    own names, and a package declaring one name twice (two `page/home` in
 *    one manifest) is one holder: that duplicate is the intra-package
 *    duplicate rule's, not this one.
 *
 * ## The names
 *
 * Read from the SAME sources the engine's registration seams read
 * ({@link declaredNamespaceUniqueNames}): the manifest's own collections and
 * each nested `plugins[]` entry's, named the way the seams name an item
 * (`name`, else `id`); for `app`, also the manifest-as-app and plugin-as-app
 * rows the engine registers under the manifest's (or plugin's) `name`.
 *
 * ## The residual (#31720)
 *
 * A `packages[]` stack's top-level items that no package body declares (the
 * residual, ADR-0130 D4) register under the stack's own id after every body,
 * never through the package door. {@link residualNamespacePackageOf} reads
 * them as one more holder of the stack's namespace, and the same predicate
 * judges it: at the `manifest` service, once the bodies have installed
 * (`SchemaRegistry.refuseResidualNamespaceNameConflicts`), and in
 * `os validate` / `os build` against the stack's bodies.
 *
 * ⛔ No package-scoped resolution here (that is ADR-0150 child R), and phase
 * 1's one-holder rule is not touched.
 */

import { artifactPackageId } from '@objectstack/core';
import { singularToPlural } from '@objectstack/spec/shared';

/** A type the rule covers, spelt as the registry keys it. */
export type NamespaceUniqueType =
  | 'sharing_rule' | 'queue' | 'assignment_rule'
  | 'hook' | 'job'
  | 'app' | 'page' | 'dashboard' | 'report' | 'book' | 'analytics_cube'
  | 'tool';

/**
 * The covered types, in the order a refusal lists them — ADR-0150's
 * execution-plan order (child N's row).
 */
export const NAMESPACE_UNIQUE_TYPES: readonly NamespaceUniqueType[] = Object.freeze([
  'sharing_rule',
  'queue',
  'assignment_rule',
  'hook',
  'job',
  'app',
  'page',
  'dashboard',
  'report',
  'book',
  'analytics_cube',
  'tool',
]);

/** Is `type` one of the covered types? */
export function isNamespaceUniqueType(type: unknown): type is NamespaceUniqueType {
  return typeof type === 'string' && (NAMESPACE_UNIQUE_TYPES as readonly string[]).includes(type);
}

/**
 * The namespaces any number of packages may share by design — the install
 * gate's exemption (`isShareableNamespace` in `registry.ts`, ADR-0048 Phase 1):
 * the FQN-exempt reserved namespaces plus `sys`. Spelt here because this
 * module may not import the registry; `namespace-co-owner-names.test.ts` holds
 * the two equal.
 */
const SHAREABLE_NAMESPACES: ReadonlySet<string> = new Set(['base', 'system', 'sys']);

/**
 * Does the rule judge names inside `namespace`? A non-empty namespace that is
 * not a shareable platform one.
 */
export function isNamespaceJudged(namespace: unknown): namespace is string {
  return typeof namespace === 'string' && namespace !== '' && !SHAREABLE_NAMESPACES.has(namespace);
}

/** One covered `(type, name)` a manifest declares. */
export interface NamespaceUniqueName {
  readonly type: NamespaceUniqueType;
  readonly name: string;
}

/** The name the engine's collection seam registers an item under (`name`, else `id`). */
function itemName(item: unknown): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const { name, id } = item as { name?: unknown; id?: unknown };
  if (typeof name === 'string' && name !== '') return name;
  if (typeof id === 'string' && id !== '') return id;
  return undefined;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/**
 * Every covered `(type, name)` a manifest declares, in declaration order, read
 * the way the engine registers them:
 *
 *  - the manifest: each covered collection (`singularToPlural(type)`; `apps`
 *    included), and the manifest itself as an app when it registers as one
 *    (a `name` and a `navigation`, and no `apps`: `registersManifestAsApp`);
 *  - each nested `plugins[]` entry, one level deep: its covered collections
 *    except `apps` (the nested seam does not register that key), and the
 *    plugin itself as an app when it carries a `name` and a `navigation`.
 *
 * A name declared twice is returned twice; the predicate counts holders, not
 * declarations.
 */
export function declaredNamespaceUniqueNames(manifest: unknown): NamespaceUniqueName[] {
  const out: NamespaceUniqueName[] = [];
  const read = (source: Record<string, unknown>, nested: boolean) => {
    for (const type of NAMESPACE_UNIQUE_TYPES) {
      if (type === 'app' && nested) continue;
      const items = source[singularToPlural(type)];
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const name = itemName(item);
        if (name !== undefined) out.push({ type, name });
      }
    }
  };
  const root = asRecord(manifest);
  if (!root) return out;
  read(root, false);
  const apps = root.apps;
  if (typeof root.name === 'string' && root.name !== '' && root.navigation && !(Array.isArray(apps) && apps.length > 0)) {
    out.push({ type: 'app', name: root.name });
  }
  if (Array.isArray(root.plugins)) {
    for (const entry of root.plugins) {
      const plugin = asRecord(entry);
      if (!plugin) continue;
      if (typeof plugin.name === 'string' && plugin.name !== '' && plugin.navigation) {
        out.push({ type: 'app', name: plugin.name });
      }
      read(plugin, true);
    }
  }
  return out;
}

/** One package as the predicate sees it. */
export interface NamespacePackage {
  /** The id the registry installs it under (`artifactPackageId`). */
  readonly packageId: string;
  /** Its `manifest.namespace`, if any. */
  readonly namespace: string | undefined;
  /** Its covered names ({@link declaredNamespaceUniqueNames}). */
  readonly names: readonly NamespaceUniqueName[];
}

/** Read one manifest as the predicate sees it, or `undefined` when it has no id. */
export function namespacePackageOf(manifest: unknown): NamespacePackage | undefined {
  const packageId = artifactPackageId(manifest);
  if (packageId === undefined) return undefined;
  const namespace = asRecord(manifest)?.namespace;
  return {
    packageId,
    namespace: typeof namespace === 'string' ? namespace : undefined,
    names: declaredNamespaceUniqueNames(manifest),
  };
}

/**
 * The residual of a `packages[]` stack — the top-level items no package body
 * declares — in the one shape both of its doors read it: `unclaimedTopLevel`
 * (`@objectstack/metadata`), the residual rule's own answer. Spelt
 * structurally here so this module imports nothing above the registry.
 */
export interface ResidualItems {
  /** The id every residual item is registered under (the stack's `manifest.id`). */
  readonly ownerId: string | undefined;
  /** The residual items, each with the metadata type it registers as. */
  readonly items: ReadonlyArray<{ readonly type: string; readonly item: unknown }>;
}

/**
 * [#31720] A `packages[]` stack's residual as the predicate sees it: ONE
 * holder, under the residual's owner id, in the stack's own
 * `manifest.namespace`, holding the residual's items of the covered types —
 * named the way {@link declaredNamespaceUniqueNames} names a package's. The
 * residual registers under that id and is addressed under that namespace, so
 * it is judged as a package of it would be, by {@link namespaceNameConflicts}:
 * no second predicate.
 *
 * `undefined` when there is no residual (a stack without `packages[]`, or a
 * normally composed one), when it has no owner id, or when none of its items
 * is of a covered type.
 */
export function residualNamespacePackageOf(stack: unknown, residual: ResidualItems | undefined): NamespacePackage | undefined {
  if (residual === undefined || residual.ownerId === undefined) return undefined;
  const body: Record<string, unknown> = { id: residual.ownerId };
  for (const { type, item } of residual.items) {
    if (!isNamespaceUniqueType(type)) continue;
    const key = singularToPlural(type);
    ((body[key] ??= []) as unknown[]).push(item);
  }
  const names = declaredNamespaceUniqueNames(body);
  if (names.length === 0) return undefined;
  const namespace = asRecord(asRecord(stack)?.manifest)?.namespace;
  return { packageId: residual.ownerId, namespace: typeof namespace === 'string' ? namespace : undefined, names };
}

/** One `(type, name)` an incoming package would hold beside another package of its namespace. */
export interface NamespaceNameConflict {
  /** The namespace both hold it in. */
  readonly namespace: string;
  /** The covered type, as the registry keys it. */
  readonly type: NamespaceUniqueType;
  /** The name. */
  readonly name: string;
  /** The package whose registration this refuses. */
  readonly incomingPackageId: string;
  /** Every OTHER package of the namespace that already holds it, in the order given. Never empty. */
  readonly existingPackageIds: readonly string[];
}

/**
 * THE predicate: every covered `(type, name)` `incoming` declares that a
 * DIFFERENT package of its namespace among `sitting` already declares — one
 * entry per `(type, name)`, in `incoming`'s declaration order, each naming
 * every other holder. `[]` when `incoming`'s namespace is not judged
 * ({@link isNamespaceJudged}), and for a `sitting` entry with `incoming`'s own
 * id (the same package again, never a second holder).
 */
export function namespaceNameConflicts(
  incoming: NamespacePackage,
  sitting: Iterable<NamespacePackage>,
): NamespaceNameConflict[] {
  const namespace = incoming.namespace;
  if (!isNamespaceJudged(namespace) || incoming.names.length === 0) return [];
  const holders = new Map<string, string[]>();
  const keyOf = (n: NamespaceUniqueName) => `${n.type}\u0000${n.name}`;
  for (const other of sitting) {
    if (other.packageId === incoming.packageId || other.namespace !== namespace) continue;
    for (const n of other.names) {
      const key = keyOf(n);
      const ids = holders.get(key) ?? [];
      if (!ids.includes(other.packageId)) ids.push(other.packageId);
      holders.set(key, ids);
    }
  }
  const out: NamespaceNameConflict[] = [];
  const seen = new Set<string>();
  for (const n of incoming.names) {
    const key = keyOf(n);
    if (seen.has(key)) continue;
    seen.add(key);
    const existing = holders.get(key);
    if (!existing || existing.length === 0) continue;
    out.push({ namespace, type: n.type, name: n.name, incomingPackageId: incoming.packageId, existingPackageIds: existing });
  }
  return out;
}

/** How a refusal names a covered type. */
export function namespaceUniqueTypeLabel(type: NamespaceUniqueType): string {
  switch (type) {
    case 'sharing_rule': return 'sharing rule';
    case 'assignment_rule': return 'assignment rule';
    case 'analytics_cube': return 'analytics cube';
    default: return type;
  }
}

const quoteAll = (ids: readonly string[]): string => {
  const quoted = ids.map((id) => `package "${id}"`);
  return quoted.length <= 1 ? (quoted[0] ?? '') : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
};

/** One conflict's line, the same at both doors: every holder named. */
export function namespaceNameConflictLine(c: NamespaceNameConflict): string {
  return (
    `package "${c.incomingPackageId}" declares the ${namespaceUniqueTypeLabel(c.type)} "${c.name}" in namespace ` +
    `"${c.namespace}", already held there by ${quoteAll(c.existingPackageIds)}`
  );
}

/**
 * The refusal's sentence for `conflicts` (non-empty, one incoming package),
 * the same at both doors.
 */
export function namespaceNameConflictMessage(conflicts: readonly NamespaceNameConflict[]): string {
  const [first] = conflicts;
  const others = [...new Set(conflicts.flatMap((c) => c.existingPackageIds))];
  return (
    `Namespace name conflict: package "${first.incomingPackageId}" cannot register ` +
    `${conflicts.length === 1 ? 'a name' : `${conflicts.length} names`} another package of its namespace already ` +
    `holds — ${conflicts.map(namespaceNameConflictLine).join('; ')}. Packages may share a namespace (an ` +
    `artifact's packages, a package and the packages that declare it), but inside one namespace an item of these ` +
    `types has one package holder, so that the address NAMESPACE/NAME names exactly one item (ADR-0150 D2). ` +
    `Rename the item in "${first.incomingPackageId}" or in ${quoteAll(others)}, or leave one of the packages out.`
  );
}
