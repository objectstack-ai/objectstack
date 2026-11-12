// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0131 D2–D4 — the ONE read of the security catalog: positions, permission
 * sets and capabilities, looked up BY NAME in the environment registry.
 *
 * ## What this is, and what it is not yet
 *
 * ADR-0131 D3 gives the catalog one home — the environment registry, fed by
 * code-declared packages and by environment metadata a metadata author saved
 * (`sys_metadata`, hydrated into the same registry by `loadMetaFromDb`) — and
 * D4 makes every reference to a catalog item a NAME that "resolution reads the
 * registry" for. This module is that read and nothing else. The authorization
 * resolver (`resolve-authz-context.ts`) reads positions, their permission sets
 * and the set bodies through it, from the reader the security plugin binds to
 * its engine ({@link bindSecurityCatalogReader}).
 *
 * ## Two in-process readers, read in a fixed order
 *
 * No single in-process reader holds the whole catalog today. Measured on a
 * booted showcase in three postures (`single`, `single` with the Default
 * Organization, and walled), at objectstack `3d9188502e`, names per reader:
 *
 *  | type         | engine registry | metadata service | metadata door |
 *  |--------------|-----------------|------------------|---------------|
 *  | `position`   |  0              | 10               | 10            |
 *  | `permission` | 17              |  9               | 17            |
 *  | `capability` |  2              |  2               |  2            |
 *
 *  - The ENGINE REGISTRY (ObjectQL's `SchemaRegistry`) carries every package
 *    manifest's `permissions` and `capabilities` — the platform's bootstrap
 *    permission sets among them (`admin_full_access`, `member_default`, …,
 *    which `plugin-security` ships on its own manifest) — and every
 *    environment-authored item hydrated from `sys_metadata`. It carries no
 *    stack-declared position: the engine's stack-collection list does not
 *    decompose `positions`.
 *  - The METADATA SERVICE carries the stack-declared security collections an
 *    app registers in memory (`positions`, `permissions`, `capabilities`) plus
 *    whatever its loaders hold — but not the platform's bootstrap permission
 *    sets.
 *  - The metadata DOOR (`GET /api/v1/meta/:type`) merges both with the stored
 *    rows, and its names equal the union of the first two in every posture
 *    measured. It is a serving surface (decorations, per-request row reads),
 *    not something an in-process resolver reads.
 *
 * So the reader is the union, in ONE order: the engine registry first, then the
 * metadata service ({@link SECURITY_CATALOG_READ_ORDER}). A name the registry
 * answers is answered by the registry — which is also where an ADR-0005
 * overlay of a packaged item lives — and the metadata service answers only the
 * names the registry does not hold. ⛔ Never `metadataService.list` alone: it
 * misses the platform's own permission sets, so a resolver reading it would
 * fail the platform administrator anchor closed.
 *
 * ## Permission sets are keyed by (package, name) — ADR-0150 D3/D4/D7
 *
 * A permission set is behavioural metadata (ADR-0150 D1 bucket 2): its
 * identity is `(package, name)`, and a bare name resolves by ADR-0150 D3 —
 * the caller's own package, else the unique holder in its declared dependency
 * closure (plus `sys`), else a refusal naming every candidate; a caller with
 * no package resolves environment-wide (the environment's own item, else the
 * unique package holder, else the refusal). This read does not implement that
 * rule: it calls the one rule, `resolvePackageScopedHolders` (core
 * `package-scoped-resolution.ts`, epic #31527 children R and R2), over the
 * engine registry's own package-scoped reads — the holder set
 * `objectql`'s `resolvePackageScopedName` hands the same rule — and the one
 * declared-closure walk, `packageResolutionClosure`
 * (`@objectstack/metadata-core`). ⛔ No second rule, no second closure.
 *
 *  - **Who asks.** A stored reference that carries its package column
 *    (ADR-0150 D8: a grant's `sys_user_permission_set.permission_set_package`,
 *    R1; a suggestion's, R3) names the exact holder, passed as
 *    {@link SecurityCatalogReferenceScope.packageId}: that package's set. A
 *    stale column (that package no longer serves the set) reads as a null
 *    one, said once. One whose column is null resolves by D3 from the package that
 *    wrote it ({@link SecurityCatalogReferenceScope.callerPackageId}, R3's
 *    `package_id`), or as a caller with no package (a grant, R1, and every
 *    other by-name read with no position) — so two holders are refused,
 *    naming every candidate, and never picked
 *    ({@link storedPermissionSetScope} builds the scope from a row). A
 *    position's `permissionSets` resolves from the package that
 *    declared the position (ADR-0150 D7), passed as
 *    {@link SecurityCatalogReferenceScope.position}. Three positions are the
 *    environment's reference instead, resolved as a caller with no package:
 *    an environment-authored position; an ADR-0005 overlay of a package's
 *    position, or a declared override in its paired `.custom` package (ADR-0150
 *    D3: a reference written in an environment-authored overlay is the
 *    environment's, never the customized package's); and the audience anchors
 *    `everyone` and `guest`, whose bindings the platform composes from the
 *    deployment's configuration and its administrators' acceptance of package
 *    defaults (ADR-0090 D5/D9), the binding ADR-0150 D7 gives to the
 *    environment.
 *  - **A refusal confers nothing and is never a guess.** A name the rule
 *    refuses (two holders, or no holder the caller may reach) resolves to no
 *    definition here, so it grants nothing, and {@link
 *    SecurityCatalogReader.resolveReference} names every candidate — the boot
 *    report prints them (plugin-security `catalog-reference-report.ts`).
 *    ⛔ No first-registered fallback, and no second lookup once the registry
 *    has answered: a holder it resolved that may not be served (a disabled
 *    package's set) is not-found. The metadata service is read only for a
 *    name the registry holds nowhere, and it reads by name only, so its body
 *    is the environment's: a caller with no package is served it, and a
 *    package's reference is the D3 (a) refusal naming the environment.
 *  - **The list** answers one entry per `(package, name)` holder, plus the
 *    environment's own item — never one entry per name picked among holders.
 *  - **Positions are unchanged** (ADR-0150 D7, ruled Q2 = A): one
 *    environment-wide slot per name, by the registry's own read, and the
 *    one-holder refusal (`@objectstack/objectql`,
 *    `security-catalog-namespace.ts`) still refuses a second package holder.
 *    So do capabilities, which are bucket 1 (`NS.SHORT`).
 *  - **Phase 1 still stands.** The same refusal holds every permission-set
 *    name to one holder per environment until its ADR-0150 D9 child narrows
 *    it, so for every reference with a package-less or in-closure holder the
 *    answer is the one the registry's by-name read gave before. What changes
 *    is the reference a package's position makes to a set it cannot reach:
 *    one only the environment holds (ADR-0150 D3 (a), the declared narrowing),
 *    or one a package outside its declared closure holds.
 *
 * A registry that lacks the package-scoped reads (a test stand-in holding one
 * item per name) is read by name, as before; ObjectQL's `SchemaRegistry`
 * carries all of them, so every catalog over an engine registry reads
 * permission sets by `(package, name)`. A registry carrying only SOME of them
 * is refused at construction.
 *
 * ## What this read does NOT answer
 *
 *  - ⛔ **Whether an item is in effect.** No definition carries the switch:
 *    deactivation is the activation ledger's (`sys_metadata_activation`, one
 *    row per `(metadata_type, name)`; ADR-0126 §3 regime C as ADR-0131 D6
 *    amends it), read through `readDisabledCatalogNames`
 *    (`resolve-authz-context.ts`) — never a catalog row's `active` column. An
 *    entry here says a definition EXISTS under that name — never that it
 *    grants. A caller that reads a definition and skips the ledger would let a
 *    deactivated set grant again: the one widening this read must never open.
 *  - **The position → permission-set binding as a separate fact.** It is part
 *    of the position definition (`PositionSchema.permissionSets`, ADR-0131
 *    D3/D4); the resolver reads it from the entry this module answers, and no
 *    junction row.
 *  - **Organization scope.** The catalog is environment-level (ADR-0131 D3);
 *    this read takes no organization and never filters by one.
 *
 * ## The one rule it does apply: a disabled package's item is not served
 *
 * The registry hides every item of a disabled package from its list
 * (`listItems`), and the by-name read applies the same rule, so the two reads
 * of this module cannot disagree about whether a name exists: a definition
 * whose `_packageId` names a disabled package answers neither. An item that
 * names no package (an environment-authored row, a position registered in
 * memory without an owner) has no package to be disabled.
 *
 * ## A read that did not happen is loud
 *
 * A miss and an outage are different facts with opposite security meanings
 * (ADR-0110 D3). When a reader throws, or the metadata service reports a read
 * that lost a loader and nothing answered, this module raises
 * {@link AuthzStoreUnavailableError} instead of answering "no such item" — the
 * same loud failure the resolver raises for an unreadable permission store.
 */

import { AUDIENCE_ANCHOR_POSITIONS } from '@objectstack/spec/identity';
import { KERNEL_NAMESPACE, packageResolutionClosure, type PackageClosureRegistry } from '@objectstack/metadata-core';
import { AuthzStoreUnavailableError } from './authz-store-unavailable.js';
import {
  describePackageScopedHolder,
  packageScopedRefusalMessage,
  resolvePackageScopedHolders,
  type PackageScopedHolder,
  type PackageScopedResolution,
} from '../package-scoped-resolution.js';

/** The three catalog types ADR-0131 D3 gives one home. */
const SECURITY_CATALOG_TYPES = ['position', 'permission', 'capability'] as const;

/** A security catalog type, spelled as the registry keys it. */
export type SecurityCatalogType = (typeof SECURITY_CATALOG_TYPES)[number];

/** The readers, in the order a by-name read asks them (module doc). */
const SECURITY_CATALOG_READ_ORDER = ['registry', 'metadata'] as const;

/** Which reader answered for an entry. */
export type SecurityCatalogSourceName = (typeof SECURITY_CATALOG_READ_ORDER)[number];

/**
 * The engine registry, as this read uses it — ObjectQL's `SchemaRegistry`
 * (`engine.registry`) satisfies it as it stands.
 */
export interface SecurityCatalogRegistry {
  /** The registry's by-name read: bare-slot overlay first, else the first-registered package's item. */
  getItem(type: string, name: string): unknown;
  /** Every item of a type, a disabled package's items already hidden. */
  listItems(type: string): readonly unknown[];
  /** Whether the package an item names as its owner is disabled. */
  isPackageDisabled(packageId?: string): boolean;
}

/**
 * The kernel `metadata` service, as this read uses it — the `MetadataManager`
 * satisfies it as it stands. The two `*Diagnosed` members are optional; when
 * present they are what lets a degraded read be told apart from a miss.
 */
export interface SecurityCatalogMetadataService {
  get(type: string, name: string): unknown;
  list(type: string): unknown;
  getDiagnosed?(type: string, name: string): Promise<{ data?: unknown; degraded?: boolean; errors?: readonly string[] }>;
  listDiagnosed?(type: string): Promise<{ items?: readonly unknown[]; degraded?: boolean; errors?: readonly string[] }>;
}

/**
 * [ADR-0150 D3/D4] The registry's package-scoped reads — ObjectQL's
 * `SchemaRegistry` carries every one of them. The catalog reads permission
 * sets by `(package, name)` through them, and the closure through
 * `getPackage`/`getAllPackages` (`PackageClosureRegistry`).
 */
export interface SecurityCatalogPackageScopedRegistry extends PackageClosureRegistry {
  /** Every package holding `(type, name)`, each once; the caller's own bundle addition counts for it. */
  packageScopedHoldersOf(type: string, name: string, callerPackageId?: string | null): readonly string[];
  /** A package holder's item, with whatever binds to it (its ADR-0005 overlay). */
  getPackageScopedItem(type: string, name: string, packageId: string): unknown;
  /** The environment's own item of the name, bound to no package. */
  getEnvironmentScopedItem(type: string, name: string): unknown;
  /** The package's own shipped item, prefer-local; a bare-slot row is a different object. */
  getArtifactItem(type: string, name: string, currentPackageId?: string): unknown;
}

/**
 * The reads that make a registry one the catalog reads by `(package, name)`:
 * a registry carrying any of them must carry all of them. `getPackage` and
 * `getAllPackages` (the closure walk's) stay optional, as the walk reads them:
 * without them a package caller's closure is empty, which only refuses more.
 */
const PACKAGE_SCOPED_REGISTRY_MEMBERS = [
  'packageScopedHoldersOf',
  'getPackageScopedItem',
  'getEnvironmentScopedItem',
  'getArtifactItem',
] as const;
/** The holder reads alone — what tells a package-scoped registry from a by-name stand-in. */
const PACKAGE_SCOPED_HOLDER_READS = ['packageScopedHoldersOf', 'getPackageScopedItem', 'getEnvironmentScopedItem'] as const;

/** Where the catalog read looks. Both readers are required: neither holds the whole catalog. */
export interface SecurityCatalogSources {
  /**
   * ObjectQL's `SchemaRegistry` — `engine.registry`. Its package-scoped reads
   * ({@link SecurityCatalogPackageScopedRegistry}) are what permission sets
   * are read by `(package, name)` through (module doc).
   */
  registry: SecurityCatalogRegistry | (SecurityCatalogRegistry & SecurityCatalogPackageScopedRegistry);
  /** The kernel `metadata` service. */
  metadata: SecurityCatalogMetadataService;
  /**
   * [ADR-0150 D8] Where a stale stored package column is said, once per
   * (package, name) for the reader's life: a column naming a package that no
   * longer serves the set (module doc, "Who asks"). Optional; unsaid without.
   */
  logger?: { warn(message: string, meta?: Record<string, unknown>): void };
}

/** One catalog definition, as the reader that answered holds it. */
export interface SecurityCatalogEntry {
  readonly type: SecurityCatalogType;
  readonly name: string;
  /**
   * The definition itself — the reader's own object, shared with every other
   * reader of the registry. ⛔ Never mutate it. It carries no activation
   * verdict (module doc).
   */
  readonly definition: Readonly<Record<string, unknown>>;
  /** Which reader answered. */
  readonly source: SecurityCatalogSourceName;
  /** The package the definition names as its owner (`_packageId`), when it names one. */
  readonly packageId?: string;
}

/**
 * [ADR-0150 D7] Who refers to the name being resolved. Omitted: a by-name read
 * with no package (a stored grant, a door), resolved environment-wide.
 */
export interface SecurityCatalogReferenceScope {
  /**
   * The position whose `permissionSets` names the permission set: the set
   * resolves from the package that declared the position (module doc). Read
   * for a permission set only.
   */
  readonly position?: SecurityCatalogEntry;
  /**
   * [ADR-0150 D8] The package a stored reference names beside the set — its
   * `permission_set_package` column (R1, R3): the exact holder, never a
   * caller, read ahead of every other member here. When that package no
   * longer serves the set (it moved on an upgrade, or was renamed and its name
   * taken by another), the column is stale and the reference is read as one
   * with no package: by D3, from {@link callerPackageId} or with no caller —
   * one holder grants, two are refused naming every candidate — and the stale
   * column is said once (`SecurityCatalogSources.logger`). Read for a
   * permission set only.
   */
  readonly packageId?: string;
  /**
   * [ADR-0150 D3] The package that WROTE a stored reference whose package
   * column is null (R3's `package_id`): the set resolves from it, by D3.
   * `null` is a caller with no package. Read for a permission set only,
   * ahead of {@link SecurityCatalogReferenceScope.position}.
   */
  readonly callerPackageId?: string | null;
}

/**
 * [ADR-0150 D8] The scope a stored reference to a permission set is read in:
 * its package column when it carries one (the exact holder), and the package
 * that wrote it (R3's `package_id`) — the D3 caller a null or stale column is
 * read from — else none: a caller with no package (R1). Blank values read as
 * absent.
 */
export function storedPermissionSetScope(
  packageColumn: unknown,
  writerPackageId?: unknown,
): SecurityCatalogReferenceScope | undefined {
  const column = typeof packageColumn === 'string' && packageColumn.trim() !== '' ? packageColumn.trim() : undefined;
  const writer = typeof writerPackageId === 'string' && writerPackageId.trim() !== '' ? writerPackageId.trim() : undefined;
  if (column === undefined && writer === undefined) return undefined;
  return {
    ...(column !== undefined ? { packageId: column } : {}),
    ...(writer !== undefined ? { callerPackageId: writer } : {}),
  };
}

/** [ADR-0150 D3] A by-name read's whole answer — a refusal included, naming every candidate. */
export type SecurityCatalogResolution =
  | { readonly status: 'resolved'; readonly entry: SecurityCatalogEntry }
  | { readonly status: 'not-found' }
  | {
      readonly status: 'refused';
      readonly reason: string;
      /** Every candidate, each as one display string (`package "com.acme.crm"`) — what a report prints. */
      readonly candidates: readonly string[];
      readonly message: string;
      /**
       * [ADR-0150 D3/D5, #32164] The same candidates, structured, in the same
       * order — what a door answers a `409 RESOURCE_CONFLICT` with
       * (`candidates: [{ kind: 'package', packageId }]`, the shape `/actions`
       * and the activation door's declaration types answer), so no caller
       * parses a display string back into a package id. Every refusal
       * {@link createSecurityCatalogReader} builds carries it; optional so a
       * hand-made reader's refusal stays well-typed without it.
       */
      readonly holders?: readonly PackageScopedHolder[];
    };

/** The catalog read. Its members answer the same question, so they never disagree. */
export interface SecurityCatalogReader {
  /**
   * The definition a name resolves to, or `undefined` when no reader holds one
   * — or when ADR-0150 D3 refuses the name for this reference, which confers
   * nothing ({@link SecurityCatalogReader.resolveReference} says why).
   */
  resolve(type: SecurityCatalogType, name: string, scope?: SecurityCatalogReferenceScope): Promise<SecurityCatalogEntry | undefined>;
  /**
   * {@link SecurityCatalogReader.resolve}'s whole answer: a refusal is told
   * apart from a miss and names every candidate. Optional for a hand-made
   * reader; the one {@link createSecurityCatalogReader} builds carries it.
   */
  resolveReference?(type: SecurityCatalogType, name: string, scope?: SecurityCatalogReferenceScope): Promise<SecurityCatalogResolution>;
  /**
   * One entry per name — each the entry {@link SecurityCatalogReader.resolve}
   * answers for it — except permission sets, which list one entry per
   * `(package, name)` holder plus the environment's own item (ADR-0150 D4).
   */
  list(type: SecurityCatalogType): Promise<SecurityCatalogEntry[]>;
}

/**
 * [ADR-0150 D3] The whole answer for a reference, from a reader with or
 * without {@link SecurityCatalogReader.resolveReference}: a reader without it
 * answers resolved or not-found, never a refusal it cannot tell apart.
 */
export async function resolveCatalogReference(
  catalog: SecurityCatalogReader,
  type: SecurityCatalogType,
  name: string,
  scope?: SecurityCatalogReferenceScope,
): Promise<SecurityCatalogResolution> {
  if (typeof catalog.resolveReference === 'function') return catalog.resolveReference(type, name, scope);
  const entry = await catalog.resolve(type, name, scope);
  return entry ? { status: 'resolved', entry } : { status: 'not-found' };
}

type Definition = Record<string, unknown>;

/** The `_packageId` a row rehydrated from `sys_metadata` carries: not a package. */
const OVERLAY_PROVENANCE_SENTINEL = 'sys_metadata';

function isDefinition(value: unknown): value is Definition {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ownerOf(definition: Definition): string | undefined {
  const owner = definition._packageId;
  return typeof owner === 'string' && owner !== '' ? owner : undefined;
}

function nameOf(definition: Definition): string | undefined {
  const name = definition.name;
  return typeof name === 'string' && name !== '' ? name : undefined;
}

function assertCatalogType(type: unknown): asserts type is SecurityCatalogType {
  if (!(SECURITY_CATALOG_TYPES as readonly unknown[]).includes(type)) {
    throw new TypeError(
      `security catalog: "${String(type)}" is not a catalog type; the catalog holds ${SECURITY_CATALOG_TYPES.join(', ')}.`,
    );
  }
}

/** The loud failure for a catalog read that did not happen (module doc). */
function unreadable(source: SecurityCatalogSourceName, type: SecurityCatalogType, cause?: unknown): AuthzStoreUnavailableError {
  return new AuthzStoreUnavailableError(`security catalog: ${source} (${type})`, cause);
}

/**
 * Build the catalog read over the two in-process readers.
 *
 * Refuses, at construction, a source that lacks a member the read calls — a
 * read with a reader missing would answer "no such item" for every name only
 * that reader holds, which is a fact it never established.
 */
export function createSecurityCatalogReader(sources: SecurityCatalogSources): SecurityCatalogReader {
  const registry = sources?.registry;
  const metadata = sources?.metadata;
  if (
    !registry
    || typeof registry.getItem !== 'function'
    || typeof registry.listItems !== 'function'
    || typeof registry.isPackageDisabled !== 'function'
  ) {
    throw new TypeError(
      'security catalog: the engine registry is required (getItem, listItems, isPackageDisabled) — '
        + 'it holds the platform permission sets and every package manifest\'s catalog items.',
    );
  }
  if (!metadata || typeof metadata.get !== 'function' || typeof metadata.list !== 'function') {
    throw new TypeError(
      'security catalog: the metadata service is required (get, list) — '
        + 'it holds the stack-declared positions the engine registry does not.',
    );
  }
  const carries = (member: string) => typeof (registry as unknown as Record<string, unknown>)[member] === 'function';
  const isScoped = PACKAGE_SCOPED_HOLDER_READS.some(carries);
  if (isScoped && !PACKAGE_SCOPED_REGISTRY_MEMBERS.every(carries)) {
    throw new TypeError(
      `security catalog: a registry with package-scoped reads must carry all of ${PACKAGE_SCOPED_REGISTRY_MEMBERS.join(', ')} — `
        + 'a partial one would read some permission sets by (package, name) and others by name alone.',
    );
  }
  /** [ADR-0150 D3/D4] The registry, when it is read by `(package, name)` (module doc). */
  const scoped = isScoped ? (registry as SecurityCatalogRegistry & SecurityCatalogPackageScopedRegistry) : undefined;

  /** [ADR-0150 D8] Each stale (package, name) column is said once (`SecurityCatalogSources.logger`). */
  const staleSaid = new Set<string>();
  const warnStale = (packageId: string, name: string, answer: SecurityCatalogResolution): void => {
    const key = `${packageId}::${name}`;
    if (!sources.logger || staleSaid.has(key)) return;
    staleSaid.add(key);
    const read = answer.status === 'resolved'
      ? `it now reads ${answer.entry.packageId ? `package "${answer.entry.packageId}"'s set` : 'the environment\'s set'}`
      : answer.status === 'refused'
        ? `it is refused: ${answer.message}`
        : 'nothing serves it';
    try {
      sources.logger.warn(
        `[security] a stored reference names permission set "${name}" of package "${packageId}", which no longer serves it; `
          + `it is read by the resolution rule instead, as a reference with no package is, and ${read}. `
          + 'Review it with `os migrate stored-references` and bind it again.',
        { type: 'permission', name, packageId, answer: answer.status },
      );
    } catch { /* a sink that throws says nothing; the read goes on */ }
  };

  /** A definition the reader may serve: an object, named as asked, of an enabled package. */
  const servable = (value: unknown, name?: string): Definition | undefined => {
    if (!isDefinition(value)) return undefined;
    const own = nameOf(value);
    if (own === undefined || (name !== undefined && own !== name)) return undefined;
    const owner = ownerOf(value);
    if (owner !== undefined && registry.isPackageDisabled(owner)) return undefined;
    return value;
  };

  const entry = (
    type: SecurityCatalogType,
    definition: Definition,
    source: SecurityCatalogSourceName,
  ): SecurityCatalogEntry => {
    const owner = ownerOf(definition);
    return {
      type,
      name: nameOf(definition) as string,
      definition,
      source,
      ...(owner !== undefined ? { packageId: owner } : {}),
    };
  };

  const fromRegistry = (type: SecurityCatalogType, name: string): Definition | undefined => {
    let found: unknown;
    try {
      found = registry.getItem(type, name);
    } catch (error) {
      throw unreadable('registry', type, error);
    }
    return servable(found, name);
  };

  const fromMetadata = async (type: SecurityCatalogType, name: string): Promise<Definition | undefined> => {
    let data: unknown;
    let degraded = false;
    let errors: readonly string[] = [];
    try {
      if (typeof metadata.getDiagnosed === 'function') {
        const diagnosed = await metadata.getDiagnosed(type, name);
        data = diagnosed?.data;
        degraded = diagnosed?.degraded === true;
        errors = Array.isArray(diagnosed?.errors) ? diagnosed.errors : [];
      } else {
        data = await metadata.get(type, name);
      }
    } catch (error) {
      throw unreadable('metadata', type, error);
    }
    if ((data === undefined || data === null) && degraded) {
      throw unreadable('metadata', type, new Error(errors.length > 0 ? errors.join('; ') : 'a metadata loader could not be read'));
    }
    return servable(data, name);
  };

  const listMetadata = async (type: SecurityCatalogType): Promise<readonly unknown[]> => {
    let items: unknown;
    let degraded = false;
    let errors: readonly string[] = [];
    try {
      if (typeof metadata.listDiagnosed === 'function') {
        const diagnosed = await metadata.listDiagnosed(type);
        items = diagnosed?.items;
        degraded = diagnosed?.degraded === true;
        errors = Array.isArray(diagnosed?.errors) ? diagnosed.errors : [];
      } else {
        items = await metadata.list(type);
      }
    } catch (error) {
      throw unreadable('metadata', type, error);
    }
    // A list that lost a loader is a PARTIAL catalog presented as a whole one.
    if (degraded) {
      throw unreadable('metadata', type, new Error(errors.length > 0 ? errors.join('; ') : 'a metadata loader could not be read'));
    }
    return Array.isArray(items) ? items : [];
  };

  /**
   * [ADR-0150 D3/D7] The package a position's `permissionSets` resolve from,
   * or `null` for the environment's reference (module doc): an
   * environment-authored position, an overlay or `.custom` override of a
   * package's position, and the audience anchors.
   */
  const referenceCaller = (
    scope: SecurityCatalogPackageScopedRegistry,
    position: SecurityCatalogEntry | undefined,
  ): string | null => {
    if (!position) return null;
    if ((AUDIENCE_ANCHOR_POSITIONS as readonly string[]).includes(position.name)) return null;
    const owner = position.packageId;
    if (owner === undefined || owner === OVERLAY_PROVENANCE_SENTINEL) return null;
    // The package's own shipped position is its composite slot; an
    // environment row, an overlay or a `.custom` override served under the
    // same name is a different object, and is the environment's reference.
    if (position.source === 'registry' && scope.getArtifactItem('position', position.name, owner) !== position.definition) return null;
    return owner;
  };

  /**
   * A permission set by ADR-0150 D3 (module doc): the one rule over the
   * registry's holders of the name and the one closure walk — the holder set
   * `resolvePackageScopedName` (`@objectstack/objectql`) hands the same rule.
   */
  const resolvePermissionScoped = async (
    scope: SecurityCatalogPackageScopedRegistry,
    name: string,
    reference: SecurityCatalogReferenceScope | undefined,
  ): Promise<SecurityCatalogResolution> => {
    const exact = reference?.packageId;
    if (typeof exact === 'string' && exact !== '') {
      // [ADR-0150 D8] The stored package column: that package's set, or
      // nothing — never another holder of the name, and never the metadata
      // service's by-name body.
      let item: unknown;
      try {
        item = scope.getPackageScopedItem('permission', name, exact);
      } catch (error) {
        throw unreadable('registry', 'permission', error);
      }
      const definition = servable(item, name);
      if (definition) return { status: 'resolved', entry: entry('permission', definition, 'registry') };
      // A stale column — the set moved to another package on an upgrade, or
      // was renamed and its name taken by another — is read as an unbound
      // row: the rule below grants the one holder and refuses two, naming
      // every candidate. Never not-found on its own say: a grant would be
      // dropped silently where a column-less one is honoured.
      const { packageId: _stale, ...unbound } = reference as SecurityCatalogReferenceScope;
      const answer = await resolvePermissionScoped(scope, name, unbound);
      warnStale(exact, name, answer);
      return answer;
    }
    let caller: string | null;
    let outcome: PackageScopedResolution;
    try {
      caller = reference && 'callerPackageId' in reference
        ? (reference.callerPackageId ?? null)
        : referenceCaller(scope, reference?.position);
      outcome = resolvePackageScopedHolders(
        { type: 'permission', name, callerPackageId: caller },
        {
          packageHolders: scope.packageScopedHoldersOf('permission', name, caller),
          packageItem: (packageId) => scope.getPackageScopedItem('permission', name, packageId),
          environmentItem: () => scope.getEnvironmentScopedItem('permission', name),
        },
        (callerPackageId) => packageResolutionClosure(scope, callerPackageId),
      );
    } catch (error) {
      throw unreadable('registry', 'permission', error);
    }
    if (outcome.status === 'refused') {
      // ⛔ Never a fallback: a refusal is the answer, and it confers nothing.
      return {
        status: 'refused',
        reason: outcome.reason,
        candidates: outcome.candidates.map(describePackageScopedHolder),
        message: outcome.message,
        holders: outcome.candidates,
      };
    }
    if (outcome.status === 'resolved') {
      // The registry's answer is final: a holder it resolved that may not be
      // served (a disabled package's set) is not-found, never a second,
      // by-name lookup in the metadata service.
      const definition = servable(outcome.item, name);
      return definition ? { status: 'resolved', entry: entry('permission', definition, 'registry') } : { status: 'not-found' };
    }
    // The registry holds the name nowhere. The metadata service reads by name
    // only, so its body is the environment's: it answers a caller with no
    // package, and for a package's reference it is the D3 (a) refusal, naming
    // the environment — reported, never served and never hidden as a miss.
    const declared = await fromMetadata('permission', name);
    if (!declared) return { status: 'not-found' };
    if (caller === null) return { status: 'resolved', entry: entry('permission', declared, 'metadata') };
    const environment: PackageScopedHolder = { kind: 'environment' };
    const refusal = {
      status: 'refused' as const,
      reason: 'outside-closure' as const,
      type: 'permission' as const,
      name,
      callerPackageId: caller,
      candidates: [environment],
    };
    return {
      status: 'refused',
      reason: refusal.reason,
      candidates: refusal.candidates.map(describePackageScopedHolder),
      message: packageScopedRefusalMessage(refusal),
      holders: refusal.candidates,
    };
  };

  const resolveReference = async (
    type: SecurityCatalogType,
    name: string,
    reference?: SecurityCatalogReferenceScope,
  ): Promise<SecurityCatalogResolution> => {
    assertCatalogType(type);
    if (typeof name !== 'string' || name === '') return { status: 'not-found' };
    if (type === 'permission' && scoped) return resolvePermissionScoped(scoped, name, reference);
    const registered = fromRegistry(type, name);
    if (registered) return { status: 'resolved', entry: entry(type, registered, 'registry') };
    const declared = await fromMetadata(type, name);
    return declared ? { status: 'resolved', entry: entry(type, declared, 'metadata') } : { status: 'not-found' };
  };

  /** [ADR-0150 D4] Every holder's entry of a permission-set name, one per `(package, name)`. */
  const permissionHolderEntries = (scope: SecurityCatalogPackageScopedRegistry, name: string): SecurityCatalogEntry[] => {
    const items: unknown[] = [];
    try {
      for (const packageId of scope.packageScopedHoldersOf('permission', name) ?? []) {
        items.push(scope.getPackageScopedItem('permission', name, packageId));
      }
      items.push(scope.getEnvironmentScopedItem('permission', name));
    } catch (error) {
      throw unreadable('registry', 'permission', error);
    }
    const out: SecurityCatalogEntry[] = [];
    for (const item of items) {
      const definition = servable(item, name);
      if (definition) out.push(entry('permission', definition, 'registry'));
    }
    return out;
  };

  return {
    async resolve(type, name, reference) {
      const answer = await resolveReference(type, name, reference);
      return answer.status === 'resolved' ? answer.entry : undefined;
    },

    resolveReference,

    async list(type) {
      assertCatalogType(type);
      let registered: readonly unknown[];
      try {
        registered = registry.listItems(type) ?? [];
      } catch (error) {
        throw unreadable('registry', type, error);
      }
      const declared = await listMetadata(type);

      // The metadata service's own body per name, read once — the answer its
      // by-name read gives for a name the registry does not serve.
      const declaredByName = new Map<string, Definition>();
      for (const item of declared) {
        const definition = servable(item);
        if (definition && !declaredByName.has(nameOf(definition) as string)) {
          declaredByName.set(nameOf(definition) as string, definition);
        }
      }

      const out: SecurityCatalogEntry[] = [];
      const seen = new Set<string>();
      const names = [
        ...registered.filter(isDefinition).map(nameOf),
        ...declaredByName.keys(),
      ];
      for (const name of names) {
        if (name === undefined || seen.has(name)) continue;
        seen.add(name);
        if (type === 'permission' && scoped) {
          // [ADR-0150 D4] One entry per (package, name) holder, never one
          // picked among them; the metadata service only where the registry
          // serves no holder of the name.
          const held = permissionHolderEntries(scoped, name);
          if (held.length > 0) {
            out.push(...held);
            continue;
          }
          const fromMeta = declaredByName.get(name);
          if (fromMeta) out.push(entry(type, fromMeta, 'metadata'));
          continue;
        }
        // Each name gets the answer the by-name read gives it: the registry's
        // own precedence first, the metadata service's body only where the
        // registry serves nothing under that name.
        const fromReg = fromRegistry(type, name);
        if (fromReg) {
          out.push(entry(type, fromReg, 'registry'));
          continue;
        }
        const fromMeta = declaredByName.get(name);
        if (fromMeta) out.push(entry(type, fromMeta, 'metadata'));
      }
      return out;
    },
  };
}

/**
 * The reader bound to each engine. Keyed by the engine AND by its registry, so
 * a caller that hands the resolver the engine, or a view of it that exposes the
 * same per-engine registry, finds the same reader.
 */
const boundReaders = new WeakMap<object, SecurityCatalogReader>();

/**
 * Bind the catalog read to an ObjectQL engine — the security plugin does it at
 * `start()`, where it holds both the engine and the metadata service. Every
 * authorization resolution over that engine then reads its catalog through
 * `reader` ({@link securityCatalogReaderOf}).
 *
 * @returns whether anything was bound — `false` for a value that is not an
 *   object, which the caller reports (absence is loud).
 */
export function bindSecurityCatalogReader(engine: unknown, reader: SecurityCatalogReader): boolean {
  if (!engine || typeof engine !== 'object') return false;
  boundReaders.set(engine, reader);
  const registry = (engine as { registry?: unknown }).registry;
  if (registry && typeof registry === 'object') boundReaders.set(registry, reader);
  return true;
}

/**
 * [ADR-0150 D2/D3] Is the holder `packageId` of a permission set the
 * PLATFORM's own, on `engine` — the holder an identity the platform derives
 * from a set's name (`admin_full_access`, the organization-administrator sets)
 * may be read from?
 *
 * The platform's metadata belongs to the reserved kernel namespace `sys`
 * (ADR-0150 D2; ADR-0028 TL;DR 5), so a holder is the platform's when:
 *
 *  - it is a package whose manifest, as the engine's registry holds it,
 *    declares the namespace `sys` — the security plugin's own shipped sets;
 *  - it names no package: the environment's own item, or an ADR-0005 overlay
 *    rehydrated from `sys_metadata` (D4: a package-less row that bears a
 *    package-held name is that holder's customization, never a second item);
 *  - the registry reads permission sets by name alone (a test stand-in, or a
 *    host with no package-scoped reads): it holds one item per name, so the
 *    name IS the holder, and the answer is the one a by-name read gave.
 *
 * Any other package — one of another namespace, or one the registry cannot
 * produce — is not: a set it ships under a platform name is that package's
 * set, granted as any other, and never the platform's identity.
 */
export function permissionSetHolderIsPlatform(engine: unknown, packageId: string | null | undefined): boolean {
  if (typeof packageId !== 'string' || packageId === '' || packageId === OVERLAY_PROVENANCE_SENTINEL) return true;
  const registry = registryOf(engine);
  if (!registry || !PACKAGE_SCOPED_HOLDER_READS.every((member) => typeof registry[member] === 'function')) return true;
  const getPackage = registry.getPackage;
  if (typeof getPackage !== 'function') return false;
  let row: { manifest?: unknown } | undefined;
  try {
    row = (getPackage as (id: string) => { manifest?: unknown } | undefined).call(registry, packageId);
  } catch {
    return false;
  }
  const manifest = row?.manifest as { namespace?: unknown } | undefined;
  return manifest?.namespace === KERNEL_NAMESPACE;
}

/** The registry `engine` carries (or `engine` itself when it is one), as a record of its members. */
function registryOf(engine: unknown): Record<string, unknown> | undefined {
  if (!engine || typeof engine !== 'object') return undefined;
  const registry = (engine as { registry?: unknown }).registry;
  if (registry && typeof registry === 'object') return registry as Record<string, unknown>;
  return engine as Record<string, unknown>;
}

/** What {@link holdsPlatformPermissionSet} reads: a context's or a grant envelope's held sets. */
export interface HeldPermissionSets {
  readonly permissions?: readonly string[];
  readonly permissionSetAddresses?: readonly { readonly packageId: string | null; readonly name: string }[];
}

/**
 * [ADR-0150 D3] Does `held` — an execution context or a resolved grant
 * envelope — hold the PLATFORM's permission set `name`
 * ({@link permissionSetHolderIsPlatform})? The one reading for every identity
 * derived from a set's name, so none of them reads a bare name that another
 * package could also hold:
 *
 *  - the name must be held at all (`permissions`);
 *  - a name carried with its addresses (`permissionSetAddresses`) is the
 *    platform's when one of those holders is;
 *  - a name carried with none (an API key's seed, a context built before the
 *    pipeline carried addresses) is read as a caller with no package reads it
 *    (D3), by the one rule over the registry's holders — the read the catalog
 *    and the evaluator make: the environment's own item, or the one holder,
 *    answers; two holders are refused and hold nothing. A name the registry
 *    holds nowhere is the environment's (or no one's) and answers as a by-name
 *    read did, as does any name on a registry read by name alone.
 *
 * Synchronous: it reads only the registry, so a predicate that answers inline
 * (an override check, a posture derivation) asks it without a second path.
 */
export function holdsPlatformPermissionSet(engine: unknown, held: HeldPermissionSets | undefined, name: string): boolean {
  const names = Array.isArray(held?.permissions) ? held.permissions : [];
  if (!names.includes(name)) return false;
  const addressed = (Array.isArray(held?.permissionSetAddresses) ? held.permissionSetAddresses : [])
    .filter((address) => address?.name === name);
  if (addressed.length > 0) return addressed.some((address) => permissionSetHolderIsPlatform(engine, address.packageId));
  const registry = registryOf(engine);
  if (!registry || !PACKAGE_SCOPED_HOLDER_READS.every((member) => typeof registry[member] === 'function')) return true;
  const scope = registry as unknown as SecurityCatalogPackageScopedRegistry;
  let outcome: PackageScopedResolution;
  try {
    outcome = resolvePackageScopedHolders(
      { type: 'permission', name, callerPackageId: null },
      {
        packageHolders: scope.packageScopedHoldersOf('permission', name, null),
        packageItem: (packageId) => scope.getPackageScopedItem('permission', name, packageId),
        environmentItem: () => scope.getEnvironmentScopedItem('permission', name),
      },
      (callerPackageId) => packageResolutionClosure(scope, callerPackageId),
    );
  } catch {
    return false;
  }
  if (outcome.status === 'refused') return false;
  if (outcome.status !== 'resolved' || outcome.holder.kind !== 'package') return true;
  const packageId = outcome.holder.packageId;
  const disabled = typeof registry.isPackageDisabled === 'function'
    && (registry.isPackageDisabled as (id: string) => boolean).call(registry, packageId);
  return !disabled && permissionSetHolderIsPlatform(engine, packageId);
}

/**
 * The catalog read bound to `engine`, or `undefined` when none was bound — an
 * engine no security plugin started on. The resolver reads that as an empty
 * catalog, exactly as it reads an engine with no permission tables
 * provisioned: no position distributes a set and no set has a body, so nothing
 * is granted through the catalog. It is never read as permission to grant.
 */
export function securityCatalogReaderOf(engine: unknown): SecurityCatalogReader | undefined {
  if (!engine || typeof engine !== 'object') return undefined;
  const own = boundReaders.get(engine);
  if (own) return own;
  const registry = (engine as { registry?: unknown }).registry;
  return registry && typeof registry === 'object' ? boundReaders.get(registry) : undefined;
}
