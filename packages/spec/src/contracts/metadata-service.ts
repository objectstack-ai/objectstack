// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * IMetadataService - Metadata Service Contract
 *
 * The unified async interface for managing ALL metadata in the ObjectStack platform.
 * This is the service contract that the Metadata Plugin implements and
 * that all other plugins depend on for metadata operations.
 *
 * Concrete implementations (SchemaRegistry, Database-backed, etc.)
 * should implement this interface.
 *
 * All methods are async to support database-backed persistence via datasource.
 *
 * Follows Dependency Inversion Principle - plugins depend on this interface,
 * not on concrete metadata storage implementations.
 *
 * Aligned with CoreServiceName 'metadata' in core-services.zod.ts.
 *
 * ## Architecture
 * ```
 * ┌──────────────────────┐
 * │   IMetadataService   │  ← Contract (this file)
 * ├──────────────────────┤
 * │  CRUD Operations     │  register / get / list / unregister / exists
 * │  Query / Search      │  query (filter, paginate, sort)
 * │  Bulk Operations     │  bulkRegister / bulkUnregister
 * │  Overlay Management  │  getOverlay / saveOverlay / removeOverlay
 * │  Watch / Subscribe   │  watch / unwatch
 * │  Import / Export     │  exportMetadata / importMetadata
 * │  Validation          │  validate
 * │  Type Registry       │  getRegisteredTypes / getTypeInfo
 * │  Dependencies        │  getDependencies / getDependents
 * │  Endpoint Resolution │  matchEndpoint
 * └──────────────────────┘
 * ```
 */

import type { MetadataQuery, MetadataQueryResult, MetadataValidationResult, MetadataBulkResult, MetadataDependency } from '../kernel/metadata-plugin.zod';
// The PERSISTENCE-side watch event (`added`/`changed`/`deleted`, path +
// file stats) — what `MetadataManager.subscribe` relays, as opposed to the
// registration-level events `watch` forwards (`MetadataWatchCallback` below).
// Spec used to carry a second, differently-shaped `MetadataWatchEvent` on
// `@objectstack/spec/kernel`; it had no consumers and was removed in #4411, so
// this is now the only type by that name.
import type { MetadataWatchEvent } from '../system/metadata-persistence.zod';
import type { ApiEndpoint } from '../api/endpoint.zod';
import type { Action } from '../ui/action.zod';
import type { MetadataOverlay } from '../kernel/metadata-customization.zod';
import type { PackagePublishResult, MetadataHistoryQueryOptions, MetadataHistoryQueryResult, MetadataDiffResult } from '../system/metadata-persistence.zod';

/**
 * Metadata watch callback signature
 */
export type MetadataWatchCallback = (event: {
    type: 'registered' | 'updated' | 'unregistered';
    metadataType: string;
    name: string;
    data?: unknown;
}) => void;

/**
 * Metadata watch subscription handle
 */
export interface MetadataWatchHandle {
    /** Unsubscribe from watch */
    unsubscribe(): void;
}

/**
 * Metadata export options — the parameter type of
 * {@link IMetadataService.exportMetadata}.
 *
 * [#4538] The SOLE declaration of this name. `@objectstack/spec/system` used
 * to export a same-named, differently-shaped options bag
 * (`output`-directory-flavored, from the #4411 duplicate persistence-envelope
 * family); it had no consumer anywhere and was removed. `MetadataManager`
 * implements THIS shape (`options.types` drives the export loop).
 */
export interface MetadataExportOptions {
    /** Filter by metadata types */
    types?: string[];
    /** Filter by namespaces */
    namespaces?: string[];
    /** Export format */
    format?: 'json' | 'yaml';
}

/**
 * Metadata import options — the parameter type of
 * {@link IMetadataService.importMetadata}.
 *
 * [#4538] The SOLE declaration of this name (the same-named
 * `source`/`strategy` bag on `./system` was consumer-free and removed).
 * `MetadataManager` implements THIS shape (`conflictResolution` / `validate` /
 * `dryRun` are what its import loop destructures).
 */
export interface MetadataImportOptions {
    /** Conflict resolution strategy */
    conflictResolution?: 'skip' | 'overwrite' | 'merge';
    /** Validate before import */
    validate?: boolean;
    /** Dry run (don't actually save) */
    dryRun?: boolean;
}

/**
 * Metadata import result
 */
export interface MetadataImportResult {
    /** Total items processed */
    total: number;
    /** Successfully imported */
    imported: number;
    /** Skipped (conflict resolution) */
    skipped: number;
    /** Failed items */
    failed: number;
    /** Per-item error details */
    errors?: Array<{ type: string; name: string; error: string }>;
}

/**
 * Type registry entry info
 */
export interface MetadataTypeInfo {
    /** Metadata type identifier */
    type: string;
    /** Human-readable label */
    label: string;
    /** Description */
    description?: string;
    /** File glob patterns */
    filePatterns: string[];
    /** Supports overlay customization */
    supportsOverlay: boolean;
    /** Protocol domain */
    domain: string;
    /**
     * Declarative type-level actions (buttons) for this metadata type — the
     * merged result of the registry entry's declarative `actions` and any
     * plugin-registered actions (`registerMetadataTypeActions`). The Studio
     * metadata-admin engine renders these the same way `ObjectView` renders
     * an object's actions. Omitted/empty when the type declares none.
     */
    actions?: Action[];
}

/**
 * Options for the {@link IMetadataService} write path
 * (`register` / `unregister` and their bulk forms).
 */
export interface MetadataWriteOptions {
    /**
     * Announce the write to `subscribe(type, …)` watchers. Default `true`.
     *
     * A write that changes what readers see must reach the consumers that
     * cache it — ObjectQL's SchemaRegistry bridge, the HMR SSE stream —
     * otherwise they serve the pre-write definition until the process
     * restarts. Announcing is therefore the default, so a new call site is
     * correct without knowing this contract exists.
     *
     * Pass `false` ONLY for bulk ingest whose subscribers either do not exist
     * yet (boot-time registration) or re-read the whole set from a different
     * signal — those paths MUST announce by other means, as the artifact
     * reload path does via the `metadata:reloaded` hook. Silencing a write
     * that nothing else announces is exactly how runtime consumers go stale.
     */
    notify?: boolean;

    /**
     * The user (actor) performing this write, when known. Carried into the
     * realtime `MetadataEvent` (`@objectstack/spec/api`) published for the
     * write as its `userId` field (#4602). Omit for system-initiated writes
     * (boot registration, package install) — `MetadataEvent.userId` is
     * optional and absence means "no human actor".
     */
    userId?: string;
}

/**
 * The result of {@link IMetadataService.matchEndpoint} — a declared
 * `api` metadata item that owns the requested `method`+`path`, together with
 * the path parameters extracted while matching it.
 *
 * [#5040 E1] Declared ahead of any implementation (contract-first). The
 * consumer side is the dispatcher's endpoint step; the producer side is the
 * `metadata` slot's own endpoint index.
 */
export interface ApiEndpointMatch {
    /**
     * The matched endpoint as `ApiEndpointSchema.parse` returns it — i.e. with
     * every schema default MATERIALIZED, not the raw stored JSON. In particular
     * `authRequired` is a boolean here even when the author omitted it (the
     * schema defaults it to `true`), so a consumer never has to reason about
     * "absent" and cannot accidentally read a missing security default as
     * permissive. Implementations MUST parse before returning, and MUST skip
     * (loudly) any stored item that fails to parse rather than returning a
     * half-valid shape.
     */
    endpoint: ApiEndpoint;

    /**
     * Path parameters extracted from the request path.
     *
     * **Always `{}` in 17.x.** `ApiEndpointSchema.path` is a frozen vocabulary
     * (ADR-0121) that defines NO template syntax — neither `:param` nor
     * `{param}` — and this contract deliberately does not invent one: a syntax
     * that exists only inside an implementation is a hidden dialect, which is
     * exactly the failure mode Prime Directive #12 forbids. The member is
     * declared now so that adding path templates later is an additive change to
     * the vocabulary rather than a breaking change to this contract.
     */
    params: Record<string, string>;
}

export interface IMetadataService {
    // ==========================================
    // Core CRUD Operations
    // ==========================================

    /**
     * Register/save a metadata item by type.
     *
     * Announces the write to `subscribe(type, …)` watchers unless
     * `options.notify === false` — see {@link MetadataWriteOptions.notify}
     * before silencing it.
     *
     * @param type - Metadata type (e.g. 'object', 'view', 'flow')
     * @param name - Item name/identifier (snake_case)
     * @param data - The metadata definition to register
     * @param options - Write options; `{ notify: false }` suppresses the watcher event
     */
    register(type: string, name: string, data: unknown, options?: MetadataWriteOptions): Promise<void>;

    /**
     * Register a metadata item in memory only — never persisted, never
     * announced to `subscribe(type, …)` watchers.
     *
     * [#4251] Declared from the evidenced binding: `MetadataManager`
     * implements it (`packages/metadata/src/metadata-manager.ts`) as the
     * boot-time seeding primitive for source-control-owned artefacts that must
     * be *listable* without leaking into the runtime DB store (`origin:'code'`
     * datasources, ADR-0015 Addendum), and DefaultDatasourcePlugin calls it to
     * surface the primary DB in Setup → Datasources (#3827). Optional: the
     * in-memory registry is `MetadataManager`'s split, not something every
     * occupant of the `metadata` slot must carry.
     *
     * @param type - Metadata type (e.g. 'datasource')
     * @param name - Item name/identifier (snake_case)
     * @param data - The metadata definition to register
     */
    registerInMemory?(type: string, name: string, data: unknown): void;

    /**
     * Get a metadata item by type and name
     *
     * `undefined` is AMBIGUOUS by construction — it means "not found" *and*
     * "every loader that could hold it failed". Prefer {@link getDiagnosed}
     * wherever the difference could change a decision (#5840).
     *
     * @param type - Metadata type
     * @param name - Item name/identifier
     * @returns The metadata definition, or undefined if not found
     */
    get(type: string, name: string): Promise<unknown | undefined>;

    /**
     * Get a metadata item, and say whether the answer can be trusted as
     * complete. Same distinction {@link loadDiagnosed} draws, on the read that
     * consults the in-memory registry first (ADR-0110 D3).
     *
     * [#5840] Declared because the verdict was already being computed and then
     * discarded: `MetadataManager` defines `get` as
     * `(await getDiagnosed(…)).data`, so a MISS and an OUTAGE arrive at every
     * consumer as the same `undefined`. A caller deciding whether something is
     * ABSENT must check `degraded` — treating a degraded read as an absence is
     * how an outage becomes an authorization answer, or a positive claim about
     * what an author declared.
     *
     * Callers of `get` cannot substitute `loadDiagnosed`: that one walks only
     * the loaders, so it would skip the in-memory registry and resolve
     * different items.
     *
     * Optional: implementations that predate it simply cannot report the
     * distinction, and a consumer that probes for it must keep reading `get`
     * when it is absent.
     */
    getDiagnosed?(
        type: string,
        name: string,
    ): Promise<{ data: unknown | undefined; degraded: boolean; errors: string[] }>;

    /**
     * List all metadata items of a given type
     * @param type - Metadata type
     * @returns Array of metadata definitions
     */
    list(type: string): Promise<unknown[]>;

    /**
     * Unregister/remove a metadata item by type and name.
     *
     * Announces the removal to `subscribe(type, …)` watchers as a `deleted`
     * event unless `options.notify === false` — see
     * {@link MetadataWriteOptions.notify} before silencing it.
     *
     * @param type - Metadata type
     * @param name - Item name/identifier
     * @param options - Write options; `{ notify: false }` suppresses the watcher event
     */
    unregister(type: string, name: string, options?: MetadataWriteOptions): Promise<void>;

    /**
     * Check if a metadata item exists
     * @param type - Metadata type
     * @param name - Item name/identifier
     * @returns True if the item exists
     */
    exists(type: string, name: string): Promise<boolean>;

    /**
     * List all names of metadata items of a given type
     * @param type - Metadata type
     * @returns Array of item names
     */
    listNames(type: string): Promise<string[]>;

    /**
     * Convenience: get an object definition by name.
     * Equivalent to `get('object', name)` — the same relationship the optional
     * members of this family declare ({@link getView}, {@link getDashboard}).
     * Every implementation this repo ships resolves the pair through one
     * lookup: `MetadataManager.getObject` delegates to its own `get`;
     * `createMemoryMetadata` reads the same `object` map from both; and
     * `MetadataFacade.getObject` calls `SchemaRegistry.getObject`, which is
     * also what `SchemaRegistry.getItem('object', …)` — and therefore the
     * facade's own `get` — special-cases to, so both members hand back the
     * identical object.
     *
     * What that lookup ANSWERS is the **runtime-effective** object: the object
     * as the engine runs it, not the document its author wrote. On a
     * `SchemaRegistry`-backed host the difference is material. The answer is
     * the owning package's definition after the registry's materialization
     * seam has run — system-column injection, primary-title designation,
     * protection/provenance stamping — with every `extend` contribution from
     * other packages merged in (`registerObject` → `resolveObject`). An object
     * authored with one field comes back carrying the audit and ownership
     * columns, `organization_id` on a multi-tenant host, a resolved
     * `nameField`, and the extenders' fields. On a plain-store host
     * (`MetadataManager`, `createMemoryMetadata`) there is no contribution
     * layer to fold, so the effective object and the stored item coincide.
     *
     * Read the answer as the effective object in **both** cases. A consumer
     * that needs the raw stored document — provenance, diffing an authored file
     * against what is installed, round-tripping an edit — must not take this
     * for one, and `get('object', name)` is not the escape hatch either: on a
     * registry-backed host the per-package contributions are reachable only
     * through `SchemaRegistry` itself, never through this contract.
     *
     * `undefined` carries the same ambiguity {@link get} documents — prefer
     * {@link getDiagnosed} wherever "absent" and "could not be read" would lead
     * to different decisions (#5840).
     *
     * [#6505] Written down because the silence was being paid for: #6055
     * declined to swap this resolver for `getDiagnosed('object', name)` and
     * bought a second read on the miss path instead, rather than presume an
     * equivalence the contract never made (Prime Directive #12). The
     * effective-over-stored half is the contract-layer statement of the fork
     * #6562 rules on for the HTTP meta read surface.
     *
     * @param name - Object name (snake_case)
     * @returns The runtime-effective object definition, or undefined if not found
     */
    getObject(name: string): Promise<unknown | undefined>;

    /**
     * Convenience: list all object definitions
     * @returns Array of object definitions
     */
    listObjects(): Promise<unknown[]>;

    // ==========================================
    // Convenience: UI Metadata
    // ==========================================

    /**
     * Convenience: get a view definition by name
     * Equivalent to get('view', name)
     */
    getView?(name: string): Promise<unknown | undefined>;

    /**
     * Convenience: list view definitions, optionally filtered by object
     */
    listViews?(object?: string): Promise<unknown[]>;

    /**
     * Convenience: get a dashboard definition by name
     * Equivalent to get('dashboard', name)
     */
    getDashboard?(name: string): Promise<unknown | undefined>;

    /**
     * Convenience: list all dashboard definitions
     */
    listDashboards?(): Promise<unknown[]>;

    // ==========================================
    // Package Management
    // ==========================================

    /**
     * Unregister all metadata items from a specific package
     * @param packageName - The package name whose items should be removed
     */
    unregisterPackage?(packageName: string): Promise<void>;

    /**
     * Publish an entire package:
     * 1. Validate all draft items (dependency check)
     * 2. Snapshot all items in the package
     * 3. Increment package version
     * 4. Set all items state → active
     * @param packageId - The package ID to publish
     * @param options - Publish options
     * @returns Publish result with version and item count
     */
    publishPackage?(packageId: string, options?: {
        changeNote?: string;
        publishedBy?: string;
        validate?: boolean;
    }): Promise<PackagePublishResult>;

    /**
     * Revert entire package to last published state.
     * Restores all metadata definitions from their published snapshots.
     * @param packageId - The package ID to revert
     */
    revertPackage?(packageId: string): Promise<void>;

    /**
     * Get the published version of any metadata item (for runtime serving).
     * Returns published_definition if exists, else current definition.
     * @param type - Metadata type
     * @param name - Item name/identifier
     * @returns The published definition, or current definition if never published
     */
    getPublished?(type: string, name: string): Promise<unknown | undefined>;

    // ==========================================
    // Query / Search
    // ==========================================

    /**
     * Query metadata items with filtering, sorting, and pagination.
     * Supports advanced search across all metadata types.
     * @param query - Query parameters
     * @returns Paginated query result
     */
    query?(query: MetadataQuery): Promise<MetadataQueryResult>;

    // ==========================================
    // Bulk Operations
    // ==========================================

    /**
     * Register multiple metadata items in a single batch.
     * More efficient than individual register calls.
     *
     * [#4251] `options` also carries {@link MetadataWriteOptions} — the
     * implementation has always intersected it in (`notify` is destructured on
     * the first line of `MetadataManager.bulkRegister`), but the contract
     * declared only the bulk knobs, so a caller typed to the contract could
     * not reach the write options at all. Same shape as the `IDataEngine`
     * read-methods gap: the erasures this issue sweeps are sometimes the
     * contract's own doing.
     * @param items - Array of { type, name, data } to register
     * @param options - Bulk operation knobs plus the standard write options
     * @returns Bulk operation result with success/failure counts
     */
    bulkRegister?(items: Array<{ type: string; name: string; data: unknown }>, options?: { continueOnError?: boolean; validate?: boolean } & MetadataWriteOptions): Promise<MetadataBulkResult>;

    /**
     * Unregister multiple metadata items in a single batch.
     *
     * [#4251] `options` declared from the implementation's signature —
     * `bulkRegister` beside it always had an options parameter while this one
     * had none, and `MetadataManager.bulkUnregister` accepts it.
     * @param items - Array of { type, name } to unregister
     * @param options - Standard write options
     * @returns Bulk operation result
     */
    bulkUnregister?(items: Array<{ type: string; name: string }>, options?: MetadataWriteOptions): Promise<MetadataBulkResult>;

    // ==========================================
    // Overlay / Customization Management
    // ==========================================

    /**
     * Get the active overlay for a metadata item.
     * Returns the customization delta applied on top of the base definition.
     * @param type - Metadata type
     * @param name - Item name
     * @param scope - Overlay scope ('platform' or 'user')
     * @returns The overlay, or undefined if no customization exists
     */
    getOverlay?(type: string, name: string, scope?: 'platform' | 'user'): Promise<MetadataOverlay | undefined>;

    /**
     * Save/update an overlay for a metadata item.
     * @param overlay - The overlay to save
     */
    saveOverlay?(overlay: MetadataOverlay): Promise<void>;

    /**
     * Remove an overlay, reverting to the base definition.
     * @param type - Metadata type
     * @param name - Item name
     * @param scope - Overlay scope
     */
    removeOverlay?(type: string, name: string, scope?: 'platform' | 'user'): Promise<void>;

    /**
     * Get the effective (merged) metadata after applying all overlays.
     * Resolution order: system ← merge(platform) ← merge(user)
     * @param type - Metadata type
     * @param name - Item name
     * @param context - Optional auth context for user-scoped overlay resolution
     * @returns The effective metadata with all overlays applied
     */
    getEffective?(type: string, name: string, context?: {
        userId?: string;
        tenantId?: string;
        positions?: string[];
        permissions?: string[];
    }): Promise<unknown | undefined>;

    // ==========================================
    // Watch / Subscribe
    // ==========================================

    /**
     * Watch for metadata changes.
     * @param type - Metadata type to watch (or '*' for all types)
     * @param callback - Callback invoked when metadata changes
     * @returns A handle to unsubscribe
     */
    watch?(type: string, callback: MetadataWatchCallback): MetadataWatchHandle;

    /**
     * Subscribe to LOADER-level change events of a type, unsubscribing by
     * calling the returned function.
     *
     * NOT {@link watch} with a different return shape: the two carry different
     * events. `watch` reports registration-level transitions
     * (`registered`/`updated`/`unregistered`); `subscribe` relays the loader
     * pipeline's {@link MetadataWatchEvent} (`added`/`changed`/`deleted`, with
     * path and file stats) — the granularity ObjectQLPlugin's metadata bridge
     * re-syncs runtime-authored hooks/actions from. (The first draft of this
     * member reused `watch`'s callback type; `MetadataManager implements
     * IMetadataService` rejected it — the check working exactly as intended.)
     *
     * [#4251 B3] Declared from the implementation and its one cross-package
     * caller, probed with `typeof … === 'function'`. Optional like `watch`:
     * the in-memory fallback need not provide it, and the probe is the
     * degraded path.
     */
    subscribe?(type: string, callback: (event: MetadataWatchEvent) => void | Promise<void>): () => void;

    /**
     * Load EVERY item of a type across all loaders — the bulk read the
     * ObjectQLPlugin bridge boots from (hooks, actions), where {@link list}
     * serves the registry index.
     *
     * [#4251 B3] Same evidence as {@link subscribe}: implemented by
     * `MetadataManager.loadMany` since the bridge existed, reached through the
     * slot only via `any`. `options` is the manager's load-options bag,
     * engine-local in shape — declared `Record<string, unknown>` here; the one
     * caller passes nothing.
     */
    loadMany?<T = unknown>(type: string, options?: Record<string, unknown>): Promise<T[]>;

    // ==========================================
    // Import / Export
    // ==========================================

    /**
     * Export metadata as a portable bundle.
     * @param options - Export options (types, namespaces, format)
     * @returns Serialized metadata bundle
     */
    exportMetadata?(options?: MetadataExportOptions): Promise<unknown>;

    /**
     * Import metadata from a portable bundle.
     * @param data - The metadata bundle to import
     * @param options - Import options (conflict resolution, validation)
     * @returns Import result with success/failure counts
     */
    importMetadata?(data: unknown, options?: MetadataImportOptions): Promise<MetadataImportResult>;

    // ==========================================
    // Validation
    // ==========================================

    /**
     * Validate a metadata item against its type schema.
     * @param type - Metadata type
     * @param data - The metadata payload to validate
     * @returns Validation result with errors and warnings
     */
    validate?(type: string, data: unknown): Promise<MetadataValidationResult>;

    // ==========================================
    // Type Registry
    // ==========================================

    /**
     * Get all registered metadata types.
     * Includes both built-in types and custom types registered by plugins.
     * @returns Array of type identifiers
     */
    getRegisteredTypes?(): Promise<string[]>;

    /**
     * Get detailed information about a metadata type.
     * @param type - Metadata type identifier
     * @returns Type info, or undefined if not registered
     */
    getTypeInfo?(type: string): Promise<MetadataTypeInfo | undefined>;

    // ==========================================
    // Dependency Tracking
    // ==========================================

    /**
     * Get metadata items that this item depends on.
     * @param type - Metadata type
     * @param name - Item name
     * @returns Array of dependencies
     */
    getDependencies?(type: string, name: string): Promise<MetadataDependency[]>;

    /**
     * Get metadata items that depend on this item.
     * Used for impact analysis before deletion.
     * @param type - Metadata type
     * @param name - Item name
     * @returns Array of dependent items
     */
    getDependents?(type: string, name: string): Promise<MetadataDependency[]>;

    // ==========================================
    // API Endpoint Resolution
    // ==========================================

    /**
     * Resolve a request's `method`+`path` to the declared `api` metadata item
     * that owns it, or `undefined` when nothing declares it.
     *
     * This is the lookup the HTTP dispatcher performs between "no built-in
     * domain claimed this path" and "answer a semantic 404" — the seam that
     * makes a declared {@link ApiEndpoint} reachable at all.
     *
     * ## Contract (#5040 §2)
     *
     * - **Scope is the instance.** There is no environment parameter: callers
     *   already resolve the `metadata` service for the environment they are
     *   serving, exactly as every other metadata read in this contract does.
     *   Adding an env parameter here would create a second scoping mechanism.
     * - **Matching dimensions.** `method` is compared case-insensitively (a
     *   request's verb normalized to upper case); `path` is compared as a
     *   WHOLE STRING, exactly, after trimming a trailing slash. 17.x performs
     *   no percent-decoding, no Unicode normalization and no case folding of
     *   the path — the raw string is the key. See
     *   {@link ApiEndpointMatch.params} for why no template syntax exists.
     * - **The answer is parsed, never raw.** See
     *   {@link ApiEndpointMatch.endpoint}.
     * - **Absence is a miss, not an error.** `undefined` means "no declaration
     *   owns this route"; an implementation that cannot read its store must
     *   throw rather than report a miss, because a miss becomes a 404 and an
     *   outage must not masquerade as one (same distinction as
     *   {@link loadDiagnosed}).
     *
     * [#5040 E1] Optional, and probed by consumers with
     * `typeof svc.matchEndpoint === 'function'` — the same convention as
     * {@link watch} / {@link subscribe}. An occupant of the `metadata` slot that
     * carries no endpoint index simply omits it, and the dispatcher falls
     * through to its existing not-found answer.
     *
     * @param query - The request coordinates to resolve (`path`, `method`)
     * @returns The owning endpoint plus its path params, or `undefined` on a miss
     */
    matchEndpoint?(query: { path: string; method: string }): Promise<ApiEndpointMatch | undefined>;

    // ==========================================
    // Version History & Rollback
    // ==========================================

    /**
     * Get version history for a metadata item.
     * Returns a timeline of all changes made to the item.
     * @param type - Metadata type
     * @param name - Item name
     * @param options - Query options (limit, offset, filters)
     * @returns History query result with version records
     */
    getHistory?(type: string, name: string, options?: MetadataHistoryQueryOptions): Promise<MetadataHistoryQueryResult>;

    /**
     * Rollback a metadata item to a specific version.
     * Restores the metadata definition from the history snapshot.
     * @param type - Metadata type
     * @param name - Item name
     * @param version - Target version to rollback to
     * @param options - Rollback options
     * @returns The restored metadata definition
     */
    rollback?(type: string, name: string, version: number, options?: {
        changeNote?: string;
        recordedBy?: string;
    }): Promise<unknown>;

    /**
     * Compare two versions of a metadata item.
     * Returns a diff showing what changed between versions.
     * @param type - Metadata type
     * @param name - Item name
     * @param version1 - First version (older)
     * @param version2 - Second version (newer)
     * @returns Diff result with changes
     */
    diff?(type: string, name: string, version1: number, version2: number): Promise<MetadataDiffResult>;

    /**
     * Load one metadata item through the registered loaders, or `null`.
     *
     * [#4127 batch 4] Declared alongside {@link loadDiagnosed}, which the same
     * call site reaches for first. `null` here is AMBIGUOUS by construction —
     * `MetadataManager` defines this as `(await loadDiagnosed(…)).data`, so a
     * miss and a total loader outage are the same answer. Prefer
     * `loadDiagnosed` wherever the difference could change a decision.
     */
    load?<T = unknown>(
        type: string,
        name: string,
        options?: Record<string, unknown>,
    ): Promise<T | null>;

    /**
     * Load one metadata item, and say whether the answer can be trusted as
     * complete. A MISS and an OUTAGE are different facts with opposite security
     * meanings — a loader that throws is warn-logged and skipped, so a plain
     * lookup cannot tell "this action does not exist" from "the store holding
     * it is down" (ADR-0110 D3).
     *
     * `degraded` is true when at least one loader failed, with their messages
     * in `errors`. A caller deciding whether something is ABSENT must check it:
     * treating a degraded read as an absence is how an outage becomes an
     * authorization answer.
     *
     * [#4127 batch 4] Implemented by `MetadataManager` — which defines plain
     * `load` as `(await loadDiagnosed(…)).data` — and reached by the action
     * resolver through `any`. Declared so the callers that need the
     * distinction can see that it exists.
     */
    loadDiagnosed?<T = unknown>(
        type: string,
        name: string,
        options?: Record<string, unknown>,
    ): Promise<{ data: T | null; degraded: boolean; errors: string[] }>;
}
