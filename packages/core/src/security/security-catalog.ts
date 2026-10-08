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
 * registry" for. This module is that read and nothing else. It is the seam the
 * later stages of the C2 execution card switch readers onto; on its own it
 * changes no grant, because nothing calls it yet.
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
 * ## A name two packages ship — ruled: there is only ever one holder
 *
 * The by-name read takes no package context, because an assignment carries
 * only the name (ADR-0131 D4). So a name two installed packages both shipped
 * would resolve by the registry's own precedence — measured before the ruling:
 * the FIRST-registered package's body, or whichever package stored an override.
 * The maintainer ruled that ambiguity out instead (Q4 = A on #15196): each
 * catalog type holds one name per deployment, and the engine registry refuses
 * a package registering a name an installed package, the environment catalog
 * or a built-in already holds (`@objectstack/objectql`,
 * `security-catalog-namespace.ts`). So this read never chooses between two
 * packages' bodies; a stored override in the bare slot is the holder's own
 * (ADR-0005), and it answers ahead of the holder's shipped body.
 *
 * ## What this read does NOT answer
 *
 *  - ⛔ **Whether an item is in effect.** Deactivation lives on the catalog
 *    ROW (`sys_position.active`, `sys_permission_set.active`; standing ruling:
 *    the row flag stays authoritative), and no definition carries it. An entry
 *    here says a definition EXISTS under that name — never that it grants. A
 *    caller that drops the row flag because it now reads definitions would let
 *    a deactivated set grant again: the one widening this card must never
 *    open. Read the flag with `isRowActive` (`row-active.ts`) as before.
 *  - **The position → permission-set binding.** It stays on its junction rows
 *    until the position definition carries it.
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

import { AuthzStoreUnavailableError } from './authz-store-unavailable.js';

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

/** Where the catalog read looks. Both readers are required: neither holds the whole catalog. */
export interface SecurityCatalogSources {
  /** ObjectQL's `SchemaRegistry` — `engine.registry`. */
  registry: SecurityCatalogRegistry;
  /** The kernel `metadata` service. */
  metadata: SecurityCatalogMetadataService;
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

/** The catalog read. Both members answer the same question, so they never disagree. */
export interface SecurityCatalogReader {
  /** The definition a name resolves to, or `undefined` when no reader holds one. */
  resolve(type: SecurityCatalogType, name: string): Promise<SecurityCatalogEntry | undefined>;
  /** One entry per name — each the entry {@link SecurityCatalogReader.resolve} answers for it. */
  list(type: SecurityCatalogType): Promise<SecurityCatalogEntry[]>;
}

type Definition = Record<string, unknown>;

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

  return {
    async resolve(type, name) {
      assertCatalogType(type);
      if (typeof name !== 'string' || name === '') return undefined;
      const registered = fromRegistry(type, name);
      if (registered) return entry(type, registered, 'registry');
      const declared = await fromMetadata(type, name);
      return declared ? entry(type, declared, 'metadata') : undefined;
    },

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
