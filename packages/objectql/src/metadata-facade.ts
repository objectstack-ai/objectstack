// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
  assertMetadataRegisterContract,
  canonicalMetadataServiceType,
} from '@objectstack/core';
import { SchemaRegistry } from './registry.js';

/**
 * Is this (already canonical) type the object metadata type?
 *
 * Every member of this class folds its `type` argument through
 * `canonicalMetadataServiceType` first (#7378 row 2), so the plural spelling
 * never reaches this predicate — `'objects'` arrives here as `'object'`.
 * `SchemaRegistry.getItem` / `listItems` still special-case BOTH spellings to
 * the contributor path (their own callers are not all folded), which is the
 * read-side alias #6725's write fix had to match; the fold upstream makes the
 * two layers agree instead of merely overlapping.
 */
function isObjectType(type: string): boolean {
  return type === 'object';
}

/**
 * The owning-package id used for an object registered through this facade with
 * no `_packageId` of its own. The platform's sentinel for "an overlay row bound
 * to no package" — `isArtifactBacked` (metadata-protocol) and
 * `SchemaRegistry.getArtifactItem` both exclude it explicitly, so it cannot
 * turn a runtime-authored object into an artifact-backed one.
 */
const RUNTIME_AUTHORED_PACKAGE_ID = 'sys_metadata';

/**
 * [#7378] Admit a `register(type, name, data)` payload and key it by the
 * `name` ARGUMENT — under the maintainer's three-cell ruling of 2026-08-12
 * (quoted verbatim in `assertMetadataRegisterContract`'s header,
 * `@objectstack/core`), which supersedes the 2026-08-11 option-(a) ruling this
 * seam previously implemented.
 *
 *  - **Rows 1/3 — refuse, don't resolve.** A `data.name` that disagrees with
 *    the argument, and a `data` that is not a plain object, are both refused
 *    loudly by the shared guard before either store is touched. The previous
 *    behaviours here — reconciling a disagreeing document to the argument, and
 *    boxing a non-object value as `{ name, content }` — were each a silent
 *    resolution the ruling forbids: the reconcile could file an item under a
 *    key the author never intended to be the key, and the box coerced an
 *    unstorable value into storability (colliding with `content` being a REAL
 *    authorable field on `doc` / `knowledge_document`, the #7519 seam).
 *
 *  - **What survives the refusals is pure keying.** An admitted document
 *    either carries the argument as its own `name` already or carries none;
 *    `{ ...data, name }` is then not a conflict resolution, only this class's
 *    way of honouring the argument against two stores that derive their key
 *    from the DOCUMENT — `SchemaRegistry.registerItem` reads
 *    `item[keyField]`, `registerObject` keys `objectContributors` on the
 *    schema's own `name`. It is the same fill-in
 *    `ObjectQL.registerMetadataCollections` applies on the plugin ingest path
 *    (`item.name === itemName ? item : { ...item, name: itemName }`,
 *    engine.ts).
 */
function toKeyedDefinition(type: string, name: string, data: unknown): any {
  assertMetadataRegisterContract(type, name, data);
  return { ...(data as Record<string, unknown>), name };
}

/**
 * MetadataFacade
 *
 * Provides a clean, injectable interface over SchemaRegistry.
 * Registered as the 'metadata' kernel service to eliminate
 * downstream packages needing to manually wrap SchemaRegistry.
 *
 * Implements the async IMetadataService interface.
 * Internally delegates to SchemaRegistry (in-memory) with Promise wrappers.
 *
 * Each facade is bound to a specific SchemaRegistry instance — passed in the
 * constructor — so that multi-kernel servers can give every kernel its own
 * metadata surface without leaking state across tenants.
 */
export class MetadataFacade {
  constructor(private registry: SchemaRegistry) {}

  /**
   * Register a metadata item under the `name` ARGUMENT and the CANONICAL type.
   *
   * [#7378, ruling 2026-08-12] A `data.name` disagreeing with the argument and
   * a non-document `data` are REFUSED loudly ({@link toKeyedDefinition} calls
   * the shared guard — read its header before changing either branch below),
   * and the type store is keyed on the canonical type, so
   * `register('objects', …)` and `register('object', …)` write one store.
   */
  async register(type: string, name: string, data: any): Promise<void> {
    type = canonicalMetadataServiceType(type);
    const definition = toKeyedDefinition(type, name, data);
    // Pass through the item's own source package id (when stamped by an
    // artifact loader) so provenance survives re-registration. Never
    // synthesize one here — unstamped items are runtime-authored by
    // definition and must not become artifact-backed (protocol.ts
    // isArtifactBacked gates write authorization on _packageId).
    const packageId = definition?._packageId;
    if (isObjectType(type)) {
      this.registerObjectBothPlaces(type, definition, packageId);
    } else {
      // Always keyed on `name` — which {@link toKeyedDefinition} has just set
      // to the argument. The former `definition.id ? 'id' : 'name'` keyField
      // was the same defect as `data.name ?? name` one field over: a document
      // carrying an `id` was filed under THAT, so `get(type, name)` missed it
      // whenever the two disagreed (#7378).
      this.registry.registerItem(type, definition, 'name' as any, packageId);
    }
  }

  /**
   * [#6725] An `object` lives in TWO places in a `SchemaRegistry`, and this
   * write has to reach both of them.
   *
   * `SchemaRegistry.unregisterObject`'s header states the invariant directly:
   * "a runtime-authored `object` is written into TWO places (`metadata['object']`
   * via `registerItem` and `objectContributors` via `registerObject`)". This
   * method used to perform only the first half, so a facade write landed
   * nowhere any facade read looks — `registerItem` stores into the generic
   * `metadata` map, while EVERY object read resolves from `objectContributors`:
   *
   *   - `getObject`  → `registry.getObject`  → `objectContributors`
   *   - `get('object', …)` / `exists` → `registry.getItem`, which special-cases
   *     the object type straight back to `registry.getObject`
   *   - `list('object')` / `listNames('object')` → `registry.listItems`, which
   *     special-cases to `registry.getAllObjects`
   *
   * So `register('object', …)` was a silent no-op as far as this class's own
   * contract is concerned: `IMetadataService` (`@objectstack/spec/contracts`)
   * declares `getObject(name)` ≡ `get('object', name)` and its own conformance
   * test round-trips a `register('object', …)` through both members. Dormant
   * in-tree only because nothing on `main` installs a `MetadataFacade` into the
   * `metadata` slot — but the class is exported from this package's root and
   * `core` entrypoints, so a downstream host got the split.
   *
   * The shape mirrors the one in-tree precedent for the same write,
   * `MetadataProtocol.applyObjectRegistryMutation` (metadata-protocol), which
   * calls `registerItem` AND `registerObject` with `packageId || 'sys_metadata'`.
   * Neither half is redundant: the contributor entry is the runtime-effective
   * object every read resolves (post-materialization, extensions merged), the
   * generic-map entry is the stored document, and the contract's `getObject`
   * TSDoc (#6505) already tells consumers those are different things.
   *
   * ── The contributor copy is a COPY, deliberately ──
   *
   * `registerObject` runs `applyProtection`, which stamps `_packageId` /
   * `_provenance` **in place**, and `applySystemFields` returns its input
   * unchanged on the no-injection path (`sys_*`, `systemFields: false`, …).
   * Handing it the same reference `registerItem` stores would therefore write a
   * synthetic package id onto the generic-map entry — precisely what the
   * "never invents a synthetic package id for object registrations" pin in
   * `metadata-facade.test.ts` forbids, and what `isArtifactBacked` keys write
   * authorization off. The generic-map entry keeps its unstamped, as-authored
   * shape; only the contributor copy carries the registry's coordinates.
   *
   * ── Why `_provenance: 'org'` on the package-less copy ──
   *
   * `registerObject` demands a package id, and an item that arrived here with no
   * `_packageId` is runtime-authored by definition (see `register` above). The
   * `'sys_metadata'` sentinel is the id the platform already uses for exactly
   * that case. Stamping `'org'` alongside it is not belt-and-braces: without it
   * `applyProtection` would default the copy to `_provenance: 'package'` and
   * label a runtime-authored object a code artifact — the axis `isTenantAuthored`
   * (registry.ts) exists to keep straight, and the misclassification behind
   * cloud#970. An item that DID carry a real `_packageId` is registered under it
   * and keeps `'package'`, which is true of it.
   *
   * ── Ordering ──
   *
   * The contributor write goes first because it is the half that can refuse:
   * `registerObject` throws when another package already owns the name
   * (ADR-0029). Failing before `registerItem` runs means a refused registration
   * writes nothing at all, rather than re-opening the half-written split from
   * the other side.
   */
  private registerObjectBothPlaces(type: string, definition: any, packageId: string | undefined): void {
    this.registry.registerObject(
      packageId
        ? { ...definition }
        : { ...definition, _provenance: 'org' },
      // `||`, not `??`: an empty-string binding is "no package", the same
      // normalisation the protocol write path applies.
      packageId || RUNTIME_AUTHORED_PACKAGE_ID,
    );
    this.registry.registerItem(type, definition, 'name' as any, packageId);
  }

  /**
   * Get a metadata item by type and name.
   *
   * `currentPackageId` (ADR-0048) opts into package-scoped resolution: when two
   * installed packages ship an item of the same `type`/`name`, the registry
   * prefers the one owned by `currentPackageId` (composite key
   * `${packageId}:${name}`) before falling back to first-match. Omit it for the
   * legacy context-free lookup.
   */
  async get(type: string, name: string, currentPackageId?: string): Promise<any> {
    // [#7378 row 2] Read the store `register` wrote: the canonical type.
    const item = this.registry.getItem(canonicalMetadataServiceType(type), name, currentPackageId) as any;
    return item?.content ?? item;
  }

  /**
   * Get the raw entry (with metadata wrapper)
   */
  getEntry(type: string, name: string): any {
    return this.registry.getItem(canonicalMetadataServiceType(type), name);
  }

  /**
   * List all items of a type
   */
  async list(type: string): Promise<any[]> {
    const items = this.registry.listItems(canonicalMetadataServiceType(type));
    return items.map((item: any) => item?.content ?? item);
  }

  /**
   * Unregister a metadata item
   *
   * [#6725] An object leaves both places it was written into, for the same
   * reason {@link register} writes both: `unregisterItem` only empties the
   * generic `metadata` map, which no object read consults. Removing one half is
   * the exact shape of #6808 — the row was gone and `metadata['object']` was
   * empty while `getObject(name)` kept serving the deleted object for the life
   * of the process, and `getObject` is what the data plane dispatches on. Now
   * that the write reaches `objectContributors`, a removal that did not would
   * make every facade-registered object undeletable through this contract.
   *
   * `unregisterObject` is idempotent (`false` when nothing is registered under
   * the name) and refuses, by design, an object still extended by another
   * package — ADR-0029, the same judgement `unregisterObjectsByPackage`
   * encodes. It runs first so a refusal removes nothing at all.
   */
  async unregister(type: string, name: string): Promise<void> {
    // [#7378 row 2] Same fold as register: one store per canonical type.
    type = canonicalMetadataServiceType(type);
    if (isObjectType(type)) {
      this.registry.unregisterObject(name);
    }
    this.registry.unregisterItem(type, name);
  }

  /**
   * Check if a metadata item exists
   */
  async exists(type: string, name: string): Promise<boolean> {
    const item = this.registry.getItem(canonicalMetadataServiceType(type), name);
    return item !== undefined && item !== null;
  }

  /**
   * List all names of metadata items of a given type
   */
  async listNames(type: string): Promise<string[]> {
    const items = this.registry.listItems(canonicalMetadataServiceType(type));
    return items.map((item: any) => item?.name ?? item?.content?.name ?? '').filter(Boolean);
  }

  /**
   * Unregister all metadata from a package.
   *
   * [#7221] Both stores, for the same reason {@link register} and
   * {@link unregister} reach both: `unregisterObjectsByPackage` walks
   * `objectContributors` alone, so this verb — whose `IMetadataService`
   * contract reads "Unregister all metadata items from a specific package" —
   * used to leave every non-object item the package shipped (`page`, `view`,
   * `flow`, `app`, `api` …) fully resolvable through this class's own `get`,
   * `list`, `listNames` and `exists`, plus the generic-map half of its
   * objects, which {@link registerObjectBothPlaces} writes. A half-uninstall,
   * silently.
   *
   * `SchemaRegistry.unregisterItemsByPackage` is the registry-side verb rather
   * than a scan private to this class, because `SchemaRegistry.uninstallPackage`
   * was measured to have the identical gap — a second copy of the
   * package-ownership rule here would be the #6808 drift, and would have left
   * the registry-direct caller half-done. It deliberately keeps bare-key
   * ADR-0005 runtime/DB overlays and warns about the ones it orphans; see its
   * header for why that is loudness rather than a silent delete.
   *
   * Ordering mirrors {@link unregister}: the object verb runs first because it
   * is the half that can refuse (ADR-0029 extenders), so a refusal removes
   * nothing at all rather than taking the generic half with it.
   */
  async unregisterPackage(packageName: string): Promise<void> {
    this.registry.unregisterObjectsByPackage(packageName);
    this.registry.unregisterItemsByPackage(packageName);
  }

  /**
   * Convenience: get object definition
   */
  async getObject(name: string): Promise<any> {
    return this.registry.getObject(name);
  }

  /**
   * Convenience: list all objects
   */
  async listObjects(): Promise<any[]> {
    return this.registry.getAllObjects();
  }
}
