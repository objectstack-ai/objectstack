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
 * └──────────────────────┘
 * ```
 */

import type { MetadataQuery, MetadataQueryResult, MetadataValidationResult, MetadataBulkResult, MetadataDependency } from '../kernel/metadata-plugin.zod';
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
 * Metadata export options
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
 * Metadata import options
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
     * Get a metadata item by type and name
     * @param type - Metadata type
     * @param name - Item name/identifier
     * @returns The metadata definition, or undefined if not found
     */
    get(type: string, name: string): Promise<unknown | undefined>;

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
     * Convenience: get an object definition by name
     * @param name - Object name (snake_case)
     * @returns The object definition, or undefined if not found
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
     * @param items - Array of { type, name, data } to register
     * @param options - Bulk operation options
     * @returns Bulk operation result with success/failure counts
     */
    bulkRegister?(items: Array<{ type: string; name: string; data: unknown }>, options?: { continueOnError?: boolean; validate?: boolean }): Promise<MetadataBulkResult>;

    /**
     * Unregister multiple metadata items in a single batch.
     * @param items - Array of { type, name } to unregister
     * @returns Bulk operation result
     */
    bulkUnregister?(items: Array<{ type: string; name: string }>): Promise<MetadataBulkResult>;

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
}
