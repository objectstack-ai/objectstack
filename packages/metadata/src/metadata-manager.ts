// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata Manager
 * 
 * Main orchestrator for metadata loading, saving, and persistence.
 * Implements the IMetadataService contract from @objectstack/spec.
 * Browser-compatible (Pure).
 */

import type {
  MetadataManagerConfig,
  MetadataLoadOptions,
  MetadataSaveOptions,
  MetadataSaveResult,
  MetadataWatchEvent,
  MetadataFormat,
  PackagePublishResult,
  MetadataHistoryQueryOptions,
  MetadataHistoryQueryResult,
  MetadataDiffResult,
} from '@objectstack/spec/system';
import type {
  IMetadataService,
  MetadataWatchCallback,
  MetadataWatchHandle,
  MetadataExportOptions,
  MetadataImportOptions,
  MetadataImportResult,
  MetadataTypeInfo,
  IRealtimeService,
  RealtimeEventPayload,
} from '@objectstack/spec/contracts';
import type {
  MetadataQuery,
  MetadataQueryResult,
  MetadataValidationResult,
  MetadataBulkResult,
  MetadataDependency,
  MetadataTypeRegistryEntry,
} from '@objectstack/spec/kernel';
import type { MetadataOverlay } from '@objectstack/spec/kernel';
import { createLogger, type Logger } from '@objectstack/core';
import { JSONSerializer } from './serializers/json-serializer.js';
import { YAMLSerializer } from './serializers/yaml-serializer.js';
import { TypeScriptSerializer } from './serializers/typescript-serializer.js';
import type { MetadataSerializer } from './serializers/serializer-interface.js';
import type { IDataDriver, IDataEngine } from '@objectstack/spec/contracts';
import type { MetadataLoader } from './loaders/loader-interface.js';
import { DatabaseLoader } from './loaders/database-loader.js';
import { generateSimpleDiff, generateDiffSummary } from './utils/metadata-history-utils.js';

/**
 * Watch callback function (legacy)
 */
export type WatchCallback = (event: MetadataWatchEvent) => void | Promise<void>;

export interface MetadataManagerOptions extends MetadataManagerConfig {
  loaders?: MetadataLoader[];
  /** Optional IDataDriver instance. When provided alongside config.datasource, auto-configures DatabaseLoader. */
  driver?: IDataDriver;
}

/**
 * Main metadata manager class.
 * Implements IMetadataService contract for unified metadata management.
 */
export class MetadataManager implements IMetadataService {
  private loaders: Map<string, MetadataLoader> = new Map();
  // Protected so subclasses can access serializers if needed
  protected serializers: Map<MetadataFormat, MetadataSerializer>;
  protected logger: Logger;
  protected watchCallbacks = new Map<string, Set<WatchCallback>>();
  protected config: MetadataManagerOptions;

  // In-memory metadata registry: type -> name -> data
  private registry = new Map<string, Map<string, unknown>>();

  // Overlay storage: "type:name:scope" -> MetadataOverlay
  private overlays = new Map<string, MetadataOverlay>();

  // Type registry for metadata type info
  private typeRegistry: MetadataTypeRegistryEntry[] = [];

  // Dependency tracking: "type:name" -> dependencies
  private dependencies = new Map<string, MetadataDependency[]>();

  // Short-lived cache for list() results. Built primarily to break the
  // deadlock that occurs when security/permission middleware calls
  // `list('permission')` from inside a user-initiated DB transaction: the
  // DatabaseLoader's `engine.find('sys_metadata', ...)` would then try to
  // acquire a fresh knex connection while the transaction is still holding
  // SQLite's single connection — knex waits the full `acquireConnectionTimeout`
  // (60s) before returning []. The cache absorbs the repeated lookups so the
  // loader is only hit once per TTL window.
  //
  // Invalidated on every `register()` / `unregister()` to keep CRUD writes
  // visible to subsequent reads.
  private listCache = new Map<string, { ts: number; items: unknown[] }>();
  private static readonly LIST_CACHE_TTL_MS = 30_000;

  // Realtime service for event publishing
  private realtimeService?: IRealtimeService;

  constructor(config: MetadataManagerOptions) {
    this.config = config;
    this.logger = createLogger({ level: 'info', format: 'pretty' });

    // Initialize serializers
    this.serializers = new Map();
    const formats = config.formats || ['typescript', 'json', 'yaml'];

    if (formats.includes('json')) {
      this.serializers.set('json', new JSONSerializer());
    }
    if (formats.includes('yaml')) {
      this.serializers.set('yaml', new YAMLSerializer());
    }
    if (formats.includes('typescript')) {
      this.serializers.set('typescript', new TypeScriptSerializer('typescript'));
    }
    if (formats.includes('javascript')) {
      this.serializers.set('javascript', new TypeScriptSerializer('javascript'));
    }

    // Initialize Loaders
    if (config.loaders && config.loaders.length > 0) {
      config.loaders.forEach(loader => this.registerLoader(loader));
    }

    // Auto-configure DatabaseLoader when datasource + driver are provided
    if (config.datasource && config.driver) {
      this.setDatabaseDriver(config.driver);
    }
    // Note: No default loader in base class. Subclasses (NodeMetadataManager) or caller must provide one.
  }

  /**
   * Set the type registry for metadata type discovery.
   */
  setTypeRegistry(entries: MetadataTypeRegistryEntry[]): void {
    this.typeRegistry = entries;
  }

  /**
   * Configure and register a DatabaseLoader for database-backed metadata persistence.
   * Can be called at any time to enable database storage (e.g. after kernel resolves the driver).
   *
   * @param driver - An IDataDriver instance for database operations
   * @param organizationId - Organization ID for multi-tenant isolation
   * @param projectId - Project ID (undefined = platform-global)
   */
  setDatabaseDriver(driver: IDataDriver, organizationId?: string, projectId?: string): void {
    if (projectId !== undefined) {
      this.logger.info('Project kernel — skipping DatabaseLoader for sys_metadata (control-plane only)', {
        organizationId,
        projectId,
      });
      return;
    }
    const tableName = this.config.tableName ?? 'sys_metadata';
    const dbLoader = new DatabaseLoader({
      driver,
      tableName,
      organizationId,
      projectId,
      cache: this.config.cache?.databaseLoader,
    });
    this.registerLoader(dbLoader);
    this.logger.info('DatabaseLoader configured', { datasource: this.config.datasource, tableName });
  }

  /**
   * Configure and register a DatabaseLoader backed by an IDataEngine (ObjectQL).
   * The engine handles datasource routing automatically — sys_metadata will
   * be routed to the correct driver via the standard namespace mapping.
   * No manual driver resolution needed.
   *
   * @param engine - An IDataEngine instance (typically the ObjectQL service)
   * @param organizationId - Organization ID for multi-tenant isolation
   * @param projectId - Project ID (undefined = platform-global)
   */
  setDataEngine(engine: IDataEngine, organizationId?: string, projectId?: string): void {
    if (projectId !== undefined) {
      this.logger.info('Project kernel — skipping DatabaseLoader for sys_metadata (control-plane only)', {
        organizationId,
        projectId,
      });
      return;
    }
    const tableName = this.config.tableName ?? 'sys_metadata';
    const dbLoader = new DatabaseLoader({
      engine,
      tableName,
      organizationId,
      projectId,
      cache: this.config.cache?.databaseLoader,
    });
    this.registerLoader(dbLoader);
    this.logger.info('DatabaseLoader configured via DataEngine', { tableName });
  }

  /**
   * Set the realtime service for publishing metadata change events.
   * Should be called after kernel resolves the realtime service.
   *
   * @param service - An IRealtimeService instance for event publishing
   */
  setRealtimeService(service: IRealtimeService): void {
    this.realtimeService = service;
    this.logger.info('RealtimeService configured for metadata events');
  }

  /**
   * Register a new metadata loader (data source)
   */
  registerLoader(loader: MetadataLoader) {
    this.loaders.set(loader.contract.name, loader);
    this.logger.info(`Registered metadata loader: ${loader.contract.name} (${loader.contract.protocol})`);
  }

  // ==========================================
  // IMetadataService — Core CRUD Operations
  // ==========================================

  /**
   * Register/save a metadata item by type
   * Stores in-memory registry and persists to database-backed loaders only.
   * FilesystemLoader (protocol 'file:') is read-only for static metadata and
   * should not be written to during runtime registration.
   */
  async register(type: string, name: string, data: unknown): Promise<void> {
    // Persistence write gate: when `persistence.writable` is explicitly false
    // we treat register() as read-only. Default `true` (or omitted) preserves
    // historical behavior.
    if (this.config.persistence?.writable === false) {
      const msg = `MetadataManager is read-only (persistence.writable=false); refusing to register ${type}/${name}`;
      if (this.config.validation?.throwOnError) {
        throw new Error(msg);
      }
      this.logger.warn(msg);
      return;
    }

    if (!this.registry.has(type)) {
      this.registry.set(type, new Map());
    }
    this.registry.get(type)!.set(name, data);
    this.invalidateListCache(type);

    // Persist only to database-backed loaders that declare write capability.
    // FilesystemLoader is read-only at runtime — writing to it can crash in
    // read-only environments (e.g. serverless, containerized deployments).
    for (const loader of this.loaders.values()) {
      if (loader.save && loader.contract.protocol === 'datasource:' && loader.contract.capabilities.write) {
        await loader.save(type, name, data);
      }
    }

    // Publish metadata.{type}.created event to realtime service
    if (this.realtimeService) {
      const event: RealtimeEventPayload = {
        type: `metadata.${type}.created`,
        object: type,
        payload: {
          metadataType: type,
          name,
          definition: data,
          packageId: (data as any)?.packageId,
        },
        timestamp: new Date().toISOString(),
      };

      try {
        await this.realtimeService.publish(event);
        this.logger.debug(`Published metadata.${type}.created event`, { name });
      } catch (error) {
        this.logger.warn(`Failed to publish metadata event`, { type, name, error });
      }
    }
  }

  /**
   * Get a metadata item by type and name.
   * Checks in-memory registry first, then falls back to loaders.
   */
  async get(type: string, name: string): Promise<unknown | undefined> {
    // Check in-memory registry first
    const typeStore = this.registry.get(type);
    if (typeStore?.has(name)) {
      return typeStore.get(name);
    }

    // Fallback to loaders
    const result = await this.load(type, name);
    return result ?? undefined;
  }

  /**
   * List all metadata items of a given type
   */
  async list(type: string): Promise<unknown[]> {
    // Short-TTL cache: see field comment on `listCache`. Skip when called
    // from tests / hot reloads that rely on always-fresh reads — we only
    // cache positive (non-empty) hits or repeated hits with a stable miss
    // signature.
    const cached = this.listCache.get(type);
    if (cached && Date.now() - cached.ts < MetadataManager.LIST_CACHE_TTL_MS) {
      return cached.items;
    }

    const items = new Map<string, unknown>();

    // From in-memory registry
    const typeStore = this.registry.get(type);
    if (typeStore) {
      for (const [name, data] of typeStore) {
        items.set(name, data);
      }
    }

    // From loaders (deduplicate)
    for (const loader of this.loaders.values()) {
      try {
        const loaderItems = await loader.loadMany(type);
        for (const item of loaderItems) {
          const itemAny = item as any;
          if (itemAny && typeof itemAny.name === 'string' && !items.has(itemAny.name)) {
            items.set(itemAny.name, item);
          }
        }
      } catch (e) {
        this.logger.warn(`Loader ${loader.contract.name} failed to loadMany ${type}`, { error: e });
      }
    }

    const result = Array.from(items.values());
    this.cacheListResult(type, result);
    return result;
  }
  private cacheListResult(type: string, items: unknown[]): void {
    this.listCache.set(type, { ts: Date.now(), items });
  }

  /** Internal helper: drop the cached `list()` result for a type. */
  private invalidateListCache(type: string): void {
    this.listCache.delete(type);
  }

  /**
   * Unregister/remove a metadata item by type and name.
   * Deletes from database-backed loaders only (same rationale as register()).
   */
  async unregister(type: string, name: string): Promise<void> {
    // Remove from in-memory registry
    const typeStore = this.registry.get(type);
    if (typeStore) {
      typeStore.delete(name);
      if (typeStore.size === 0) {
        this.registry.delete(type);
      }
    }
    this.invalidateListCache(type);

    // Delete only from database-backed loaders that declare write capability
    for (const loader of this.loaders.values()) {
      if (loader.contract.protocol !== 'datasource:' || !loader.contract.capabilities.write) continue;
      if (typeof (loader as any).delete === 'function') {
        try {
          await (loader as any).delete(type, name);
        } catch (error) {
          this.logger.warn(`Failed to delete ${type}/${name} from loader ${loader.contract.name}`, { error });
        }
      }
    }

    // Publish metadata.{type}.deleted event to realtime service
    if (this.realtimeService) {
      const event: RealtimeEventPayload = {
        type: `metadata.${type}.deleted`,
        object: type,
        payload: {
          metadataType: type,
          name,
        },
        timestamp: new Date().toISOString(),
      };

      try {
        await this.realtimeService.publish(event);
        this.logger.debug(`Published metadata.${type}.deleted event`, { name });
      } catch (error) {
        this.logger.warn(`Failed to publish metadata event`, { type, name, error });
      }
    }
  }

  /**
   * Check if a metadata item exists
   */
  async exists(type: string, name: string): Promise<boolean> {
    // Check in-memory registry
    if (this.registry.get(type)?.has(name)) {
      return true;
    }

    // Check loaders
    for (const loader of this.loaders.values()) {
      if (await loader.exists(type, name)) {
        return true;
      }
    }
    return false;
  }

  /**
   * List all names of metadata items of a given type
   */
  async listNames(type: string): Promise<string[]> {
    const names = new Set<string>();

    // From in-memory registry
    const typeStore = this.registry.get(type);
    if (typeStore) {
      for (const name of typeStore.keys()) {
        names.add(name);
      }
    }

    // From loaders
    for (const loader of this.loaders.values()) {
      const result = await loader.list(type);
      result.forEach(item => names.add(item));
    }

    return Array.from(names);
  }

  /**
   * Convenience: get an object definition by name
   */
  async getObject(name: string): Promise<unknown | undefined> {
    return this.get('object', name);
  }

  /**
   * Convenience: list all object definitions
   */
  async listObjects(): Promise<unknown[]> {
    return this.list('object');
  }

  // ==========================================
  // Convenience: UI Metadata
  // ==========================================

  /**
   * Convenience: get a view definition by name
   */
  async getView(name: string): Promise<unknown | undefined> {
    return this.get('view', name);
  }

  /**
   * Convenience: list view definitions, optionally filtered by object
   */
  async listViews(object?: string): Promise<unknown[]> {
    const views = await this.list('view');
    if (object) {
      return views.filter((v: any) => v?.object === object);
    }
    return views;
  }

  /**
   * Convenience: get a dashboard definition by name
   */
  async getDashboard(name: string): Promise<unknown | undefined> {
    return this.get('dashboard', name);
  }

  /**
   * Convenience: list all dashboard definitions
   */
  async listDashboards(): Promise<unknown[]> {
    return this.list('dashboard');
  }

  // ==========================================
  // Package Management
  // ==========================================

  /**
   * Unregister all metadata items from a specific package
   */
  async unregisterPackage(packageName: string): Promise<void> {
    // Collect all items to delete (type and name pairs)
    const itemsToDelete: Array<{ type: string; name: string }> = [];

    for (const [type, typeStore] of this.registry) {
      for (const [name, data] of typeStore) {
        const meta = data as any;
        if (meta?.packageId === packageName || meta?.package === packageName) {
          itemsToDelete.push({ type, name });
        }
      }
    }

    // Delete each item using unregister() to ensure deletion from both registry and loaders
    for (const { type, name } of itemsToDelete) {
      await this.unregister(type, name);
    }
  }

  /**
   * Publish an entire package:
   * 1. Validate all draft items
   * 2. Snapshot all items in the package (publishedDefinition = clone(metadata))
   * 3. Increment version
   * 4. Set all items state → active
   */
  async publishPackage(packageId: string, options?: {
    changeNote?: string;
    publishedBy?: string;
    validate?: boolean;
  }): Promise<PackagePublishResult> {
    const now = new Date().toISOString();
    const shouldValidate = options?.validate !== false;
    const publishedBy = options?.publishedBy;

    // Collect all items belonging to this package
    const packageItems: Array<{ type: string; name: string; data: any }> = [];
    for (const [type, typeStore] of this.registry) {
      for (const [name, data] of typeStore) {
        const meta = data as any;
        if (meta?.packageId === packageId || meta?.package === packageId) {
          packageItems.push({ type, name, data: meta });
        }
      }
    }

    if (packageItems.length === 0) {
      return {
        success: false,
        packageId,
        version: 0,
        publishedAt: now,
        itemsPublished: 0,
        validationErrors: [{ type: '', name: '', message: `No metadata items found for package '${packageId}'` }],
      };
    }

    // Validation pass
    if (shouldValidate) {
      const validationErrors: Array<{ type: string; name: string; message: string }> = [];

      // Schema validation
      for (const item of packageItems) {
        const result = await this.validate(item.type, item.data);
        if (!result.valid && result.errors) {
          for (const err of result.errors) {
            validationErrors.push({
              type: item.type,
              name: item.name,
              message: err.message,
            });
          }
        }
      }

      // Dependency validation: referenced items must be in the same package or already published
      const packageItemKeys = new Set(packageItems.map(i => `${i.type}:${i.name}`));
      for (const item of packageItems) {
        const deps = await this.getDependencies(item.type, item.name);
        for (const dep of deps) {
          const depKey = `${dep.targetType}:${dep.targetName}`;
          // Skip if the dependency is within this package
          if (packageItemKeys.has(depKey)) continue;
          // Check if the dependency exists and has been published
          const depItem = await this.get(dep.targetType, dep.targetName);
          if (!depItem) {
            validationErrors.push({
              type: item.type,
              name: item.name,
              message: `Dependency '${dep.targetType}:${dep.targetName}' not found`,
            });
          } else {
            const depMeta = depItem as any;
            if (depMeta.publishedDefinition === undefined && depMeta.state !== 'active') {
              validationErrors.push({
                type: item.type,
                name: item.name,
                message: `Dependency '${dep.targetType}:${dep.targetName}' is not published`,
              });
            }
          }
        }
      }

      if (validationErrors.length > 0) {
        return {
          success: false,
          packageId,
          version: 0,
          publishedAt: now,
          itemsPublished: 0,
          validationErrors,
        };
      }
    }

    // Determine the next version by finding the max current version across items
    let maxVersion = 0;
    for (const item of packageItems) {
      const v = typeof item.data.version === 'number' ? item.data.version : 0;
      if (v > maxVersion) maxVersion = v;
    }
    const newVersion = maxVersion + 1;

    // Snapshot and update all items
    for (const item of packageItems) {
      const updated = {
        ...item.data,
        publishedDefinition: structuredClone(item.data.metadata ?? item.data),
        publishedAt: now,
        publishedBy: publishedBy ?? item.data.publishedBy,
        version: newVersion,
        state: 'active',
      };
      await this.register(item.type, item.name, updated);
    }

    return {
      success: true,
      packageId,
      version: newVersion,
      publishedAt: now,
      itemsPublished: packageItems.length,
    };
  }

  /**
   * Revert entire package to last published state.
   * Restores all metadata definitions from their published snapshots.
   */
  async revertPackage(packageId: string): Promise<void> {
    const packageItems: Array<{ type: string; name: string; data: any }> = [];
    for (const [type, typeStore] of this.registry) {
      for (const [name, data] of typeStore) {
        const meta = data as any;
        if (meta?.packageId === packageId || meta?.package === packageId) {
          packageItems.push({ type, name, data: meta });
        }
      }
    }

    if (packageItems.length === 0) {
      throw new Error(`No metadata items found for package '${packageId}'`);
    }

    // Check that at least one item has a published snapshot
    const hasPublished = packageItems.some(item => item.data.publishedDefinition !== undefined);
    if (!hasPublished) {
      throw new Error(`Package '${packageId}' has never been published`);
    }

    for (const item of packageItems) {
      if (item.data.publishedDefinition !== undefined) {
        const reverted = {
          ...item.data,
          metadata: structuredClone(item.data.publishedDefinition),
          state: 'active',
        };
        await this.register(item.type, item.name, reverted);
      }
    }
  }

  /**
   * Get the published version of any metadata item (for runtime serving).
   * Returns publishedDefinition if exists, else current definition.
   */
  async getPublished(type: string, name: string): Promise<unknown | undefined> {
    const item = await this.get(type, name);
    if (!item) return undefined;

    const meta = item as any;
    if (meta.publishedDefinition !== undefined) {
      return meta.publishedDefinition;
    }

    // Fall back to current definition (metadata field or the item itself)
    return meta.metadata ?? item;
  }

  // ==========================================
  // Query / Search
  // ==========================================

  /**
   * Query metadata items with filtering, sorting, and pagination
   */
  async query(query: MetadataQuery): Promise<MetadataQueryResult> {
    const { types, search, page = 1, pageSize = 50, sortBy = 'name', sortOrder = 'asc' } = query;

    // Collect all items
    const allItems: Array<{
      type: string;
      name: string;
      namespace?: string;
      label?: string;
      scope?: 'system' | 'platform' | 'user';
      state?: 'draft' | 'active' | 'archived' | 'deprecated';
      packageId?: string;
      updatedAt?: string;
    }> = [];

    // Determine which types to scan
    const targetTypes = types && types.length > 0
      ? types
      : Array.from(this.registry.keys());

    for (const type of targetTypes) {
      const items = await this.list(type);
      for (const item of items) {
        const meta = item as any;
        allItems.push({
          type,
          name: meta?.name ?? '',
          namespace: meta?.namespace,
          label: meta?.label,
          scope: meta?.scope,
          state: meta?.state,
          packageId: meta?.packageId,
          updatedAt: meta?.updatedAt,
        });
      }
    }

    // Apply search filter
    let filtered = allItems;
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(item =>
        item.name.toLowerCase().includes(searchLower) ||
        (item.label && item.label.toLowerCase().includes(searchLower))
      );
    }

    // Apply scope filter
    if (query.scope) {
      filtered = filtered.filter(item => item.scope === query.scope);
    }

    // Apply state filter
    if (query.state) {
      filtered = filtered.filter(item => item.state === query.state);
    }

    // Apply namespace filter
    if (query.namespaces && query.namespaces.length > 0) {
      filtered = filtered.filter(item => item.namespace && query.namespaces!.includes(item.namespace));
    }

    // Apply packageId filter
    if (query.packageId) {
      filtered = filtered.filter(item => item.packageId === query.packageId);
    }

    // Apply tags filter
    if (query.tags && query.tags.length > 0) {
      filtered = filtered.filter(item => {
        const meta = item as any;
        return meta?.tags && query.tags!.some((t: string) => meta.tags.includes(t));
      });
    }

    // Sort
    filtered.sort((a, b) => {
      const aVal = (a as any)[sortBy] ?? '';
      const bVal = (b as any)[sortBy] ?? '';
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortOrder === 'desc' ? -cmp : cmp;
    });

    // Paginate
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const paged = filtered.slice(start, start + pageSize);

    return {
      items: paged,
      total,
      page,
      pageSize,
    };
  }

  // ==========================================
  // Bulk Operations
  // ==========================================

  /**
   * Register multiple metadata items in a single batch
   */
  async bulkRegister(
    items: Array<{ type: string; name: string; data: unknown }>,
    options?: { continueOnError?: boolean; validate?: boolean }
  ): Promise<MetadataBulkResult> {
    const { continueOnError = false } = options ?? {};
    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ type: string; name: string; error: string }> = [];

    for (const item of items) {
      try {
        await this.register(item.type, item.name, item.data);
        succeeded++;
      } catch (e) {
        failed++;
        errors.push({
          type: item.type,
          name: item.name,
          error: e instanceof Error ? e.message : String(e),
        });
        if (!continueOnError) break;
      }
    }

    return {
      total: items.length,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Unregister multiple metadata items in a single batch
   */
  async bulkUnregister(items: Array<{ type: string; name: string }>): Promise<MetadataBulkResult> {
    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ type: string; name: string; error: string }> = [];

    for (const item of items) {
      try {
        await this.unregister(item.type, item.name);
        succeeded++;
      } catch (e) {
        failed++;
        errors.push({
          type: item.type,
          name: item.name,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return {
      total: items.length,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  // ==========================================
  // Overlay / Customization Management
  // ==========================================

  private overlayKey(type: string, name: string, scope: string = 'platform'): string {
    return `${encodeURIComponent(type)}:${encodeURIComponent(name)}:${scope}`;
  }

  /**
   * Get the active overlay for a metadata item
   */
  async getOverlay(type: string, name: string, scope?: 'platform' | 'user'): Promise<MetadataOverlay | undefined> {
    return this.overlays.get(this.overlayKey(type, name, scope ?? 'platform'));
  }

  /**
   * Save/update an overlay for a metadata item
   */
  async saveOverlay(overlay: MetadataOverlay): Promise<void> {
    // Overlay write gate — independent from base writability so deployments
    // can freeze Studio overlays while still permitting base register().
    if (this.config.persistence?.overlayWritable === false) {
      const msg = `MetadataManager overlays are read-only (persistence.overlayWritable=false); refusing to save overlay for ${overlay.baseType}/${overlay.baseName}`;
      if (this.config.validation?.throwOnError) {
        throw new Error(msg);
      }
      this.logger.warn(msg);
      return;
    }
    const key = this.overlayKey(overlay.baseType, overlay.baseName, overlay.scope);
    this.overlays.set(key, overlay);
  }

  /**
   * Remove an overlay, reverting to the base definition
   */
  async removeOverlay(type: string, name: string, scope?: 'platform' | 'user'): Promise<void> {
    this.overlays.delete(this.overlayKey(type, name, scope ?? 'platform'));
  }

  /**
   * Get the effective (merged) metadata after applying all overlays.
   * Resolution order: system ← merge(platform) ← merge(user)
   */
  async getEffective(type: string, name: string, context?: {
    userId?: string;
    tenantId?: string;
    roles?: string[];
    permissions?: string[];
  }): Promise<unknown | undefined> {
    const base = await this.get(type, name);
    if (!base) return undefined;

    let effective = { ...(base as Record<string, unknown>) };

    // Apply platform overlay
    const platformOverlay = await this.getOverlay(type, name, 'platform');
    if (platformOverlay?.active && platformOverlay.patch) {
      effective = { ...effective, ...platformOverlay.patch };
    }

    // Apply user overlay (scoped to specific user if context provided)
    if (context?.userId) {
      // Try user-specific key first, then fall back to generic user overlay.
      // The owner check below ensures we never apply another user's overlay.
      const userOverlayKey = this.overlayKey(type, name, 'user') + `:${context.userId}`;
      const userOverlay = this.overlays.get(userOverlayKey) 
        ?? await this.getOverlay(type, name, 'user');
      if (userOverlay?.active && userOverlay.patch) {
        // Apply if: overlay has no owner (generic user-level), or owner matches current user
        if (!userOverlay.owner || userOverlay.owner === context.userId) {
          effective = { ...effective, ...userOverlay.patch };
        }
      }
    } else {
      // No user context — only apply user overlays without an owner restriction
      // (owner-scoped overlays require a userId to resolve)
      const userOverlay = await this.getOverlay(type, name, 'user');
      if (userOverlay?.active && userOverlay.patch && !userOverlay.owner) {
        effective = { ...effective, ...userOverlay.patch };
      }
    }

    return effective;
  }

  // ==========================================
  // Watch / Subscribe (IMetadataService)
  // ==========================================

  /**
   * Watch for metadata changes (IMetadataService contract).
   * Returns a handle for unsubscribing.
   */
  watchService(type: string, callback: MetadataWatchCallback): MetadataWatchHandle {
    const wrappedCallback: WatchCallback = (event) => {
      const mappedType = event.type === 'added' ? 'registered'
        : event.type === 'deleted' ? 'unregistered'
        : 'updated';
      callback({
        type: mappedType,
        metadataType: event.metadataType ?? type,
        name: event.name ?? '',
        data: event.data,
      });
    };
    this.addWatchCallback(type, wrappedCallback);
    return {
      unsubscribe: () => this.removeWatchCallback(type, wrappedCallback),
    };
  }

  /**
   * Subscribe to raw metadata watch events for a given type.
   *
   * Unlike `watchService` (which maps to the IMetadataService contract and
   * drops fields like `path`/`timestamp`), this returns the raw
   * `MetadataWatchEvent` produced by the underlying watcher — useful for
   * developer-facing tooling such as the HMR SSE endpoint that wants the
   * source file path and original timestamp.
   *
   * @returns An unsubscribe function.
   */
  subscribe(type: string, callback: WatchCallback): () => void {
    this.addWatchCallback(type, callback);
    return () => this.removeWatchCallback(type, callback);
  }

  // ==========================================
  // Import / Export
  // ==========================================

  /**
   * Export metadata as a portable bundle
   */
  async exportMetadata(options?: MetadataExportOptions): Promise<unknown> {
    const bundle: Record<string, unknown[]> = {};
    const targetTypes = options?.types ?? Array.from(this.registry.keys());

    for (const type of targetTypes) {
      const items = await this.list(type);
      if (items.length > 0) {
        bundle[type] = items;
      }
    }

    return bundle;
  }

  /**
   * Import metadata from a portable bundle
   */
  async importMetadata(data: unknown, options?: MetadataImportOptions): Promise<MetadataImportResult> {
    const {
      conflictResolution = 'skip',
      validate: _validate = true,
      dryRun = false,
    } = options ?? {};

    const bundle = data as Record<string, unknown[]>;
    let total = 0;
    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ type: string; name: string; error: string }> = [];

    for (const [type, items] of Object.entries(bundle)) {
      if (!Array.isArray(items)) continue;

      for (const item of items) {
        total++;
        const meta = item as any;
        const name = meta?.name;

        if (!name) {
          failed++;
          errors.push({ type, name: '(unknown)', error: 'Item missing name field' });
          continue;
        }

        try {
          const itemExists = await this.exists(type, name);

          if (itemExists && conflictResolution === 'skip') {
            skipped++;
            continue;
          }

          if (!dryRun) {
            if (itemExists && conflictResolution === 'merge') {
              const existing = await this.get(type, name);
              const merged = { ...(existing as any), ...(item as any) };
              await this.register(type, name, merged);
            } else {
              await this.register(type, name, item);
            }
          }
          imported++;
        } catch (e) {
          failed++;
          errors.push({
            type,
            name,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    return {
      total,
      imported,
      skipped,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  // ==========================================
  // Validation
  // ==========================================

  /**
   * Validate a metadata item against its type schema.
   * Returns validation result with errors and warnings.
   */
  async validate(_type: string, data: unknown): Promise<MetadataValidationResult> {
    // Basic structural validation
    if (data === null || data === undefined) {
      return {
        valid: false,
        errors: [{ path: '', message: 'Metadata data cannot be null or undefined' }],
      };
    }

    if (typeof data !== 'object') {
      return {
        valid: false,
        errors: [{ path: '', message: 'Metadata data must be an object' }],
      };
    }

    const meta = data as any;
    const warnings: Array<{ path: string; message: string }> = [];

    if (!meta.name) {
      return {
        valid: false,
        errors: [{ path: 'name', message: 'Metadata item must have a name field' }],
      };
    }

    if (!meta.label) {
      warnings.push({ path: 'label', message: 'Missing label field (recommended)' });
    }

    return { valid: true, warnings: warnings.length > 0 ? warnings : undefined };
  }

  // ==========================================
  // Type Registry
  // ==========================================

  /**
   * Get all registered metadata types
   */
  async getRegisteredTypes(): Promise<string[]> {
    const types = new Set<string>();

    // From type registry
    for (const entry of this.typeRegistry) {
      types.add(entry.type);
    }

    // From in-memory registry (custom types)
    for (const type of this.registry.keys()) {
      types.add(type);
    }

    return Array.from(types);
  }

  /**
   * Get detailed information about a metadata type
   */
  async getTypeInfo(type: string): Promise<MetadataTypeInfo | undefined> {
    const entry = this.typeRegistry.find(e => e.type === type);
    if (!entry) return undefined;

    return {
      type: entry.type,
      label: entry.label,
      description: entry.description,
      filePatterns: entry.filePatterns,
      supportsOverlay: entry.supportsOverlay,
      domain: entry.domain,
    };
  }

  // ==========================================
  // Dependency Tracking
  // ==========================================

  /**
   * Get metadata items that this item depends on
   */
  async getDependencies(type: string, name: string): Promise<MetadataDependency[]> {
    return this.dependencies.get(`${encodeURIComponent(type)}:${encodeURIComponent(name)}`) ?? [];
  }

  /**
   * Get metadata items that depend on this item
   */
  async getDependents(type: string, name: string): Promise<MetadataDependency[]> {
    const dependents: MetadataDependency[] = [];
    for (const deps of this.dependencies.values()) {
      for (const dep of deps) {
        if (dep.targetType === type && dep.targetName === name) {
          dependents.push(dep);
        }
      }
    }
    return dependents;
  }

  /**
   * Register a dependency between two metadata items.
   * Used internally to track cross-references.
   * Duplicate dependencies (same source, target, and kind) are ignored.
   */
  addDependency(dep: MetadataDependency): void {
    const key = `${encodeURIComponent(dep.sourceType)}:${encodeURIComponent(dep.sourceName)}`;
    if (!this.dependencies.has(key)) {
      this.dependencies.set(key, []);
    }
    const existing = this.dependencies.get(key)!;
    const isDuplicate = existing.some(
      d => d.targetType === dep.targetType && d.targetName === dep.targetName && d.kind === dep.kind
    );
    if (!isDuplicate) {
      existing.push(dep);
    }
  }

  // ==========================================
  // Legacy Loader API (backward compatible)
  // ==========================================

  /**
   * Load a single metadata item from loaders.
   * Iterates through registered loaders until found.
   */
  async load<T = any>(
    type: string,
    name: string,
    options?: MetadataLoadOptions
  ): Promise<T | null> {
    for (const loader of this.loaders.values()) {
        try {
            const result = await loader.load(type, name, options);
            if (result.data) {
                return result.data as T;
            }
        } catch (e) {
            this.logger.warn(`Loader ${loader.contract.name} failed to load ${type}:${name}`, { error: e });
        }
    }
    return null;
  }

  /**
   * Load multiple metadata items from loaders.
   * Aggregates results from all loaders.
   */
  async loadMany<T = any>(
    type: string,
    options?: MetadataLoadOptions
  ): Promise<T[]> {
    const results: T[] = [];

    for (const loader of this.loaders.values()) {
        try {
            const items = await loader.loadMany<T>(type, options);
            for (const item of items) {
                const itemAny = item as any;
                if (itemAny && typeof itemAny.name === 'string') {
                    const exists = results.some((r: any) => r && r.name === itemAny.name);
                    if (exists) continue;
                }
                results.push(item);
            }
        } catch (e) {
           this.logger.warn(`Loader ${loader.contract.name} failed to loadMany ${type}`, { error: e });
        }
    }
    return results;
  }

  /**
   * Save metadata item to a loader
   */
  async save<T = any>(
    type: string,
    name: string,
    data: T,
    options?: MetadataSaveOptions
  ): Promise<MetadataSaveResult> {
    const targetLoader = (options as any)?.loader;

    let loader: MetadataLoader | undefined;
    
    if (targetLoader) {
      loader = this.loaders.get(targetLoader);
      if (!loader) {
        throw new Error(`Loader not found: ${targetLoader}`);
      }
    } else {
      for (const l of this.loaders.values()) {
          if (!l.save) continue;
          try {
            if (await l.exists(type, name)) {
                loader = l;
                this.logger.info(`Updating existing metadata in loader: ${l.contract.name}`);
                break;
            }
          } catch (e) {
            // Ignore existence check errors
          }
      }

      if (!loader) {
        const fsLoader = this.loaders.get('filesystem');
        if (fsLoader && fsLoader.save) {
           loader = fsLoader;
        }
      }

      if (!loader) {
        for (const l of this.loaders.values()) {
          if (l.save) {
            loader = l;
            break;
          }
        }
      }
    }

    if (!loader) {
      throw new Error(`No loader available for saving type: ${type}`);
    }

    if (!loader.save) {
      throw new Error(`Loader '${loader.contract?.name}' does not support saving`);
    }

    return loader.save(type, name, data, options);
  }

  /**
   * Register a watch callback for metadata changes
   */
  protected addWatchCallback(type: string, callback: WatchCallback): void {
    if (!this.watchCallbacks.has(type)) {
      this.watchCallbacks.set(type, new Set());
    }
    this.watchCallbacks.get(type)!.add(callback);
  }

  /**
   * Remove a watch callback for metadata changes
   */
  protected removeWatchCallback(type: string, callback: WatchCallback): void {
    const callbacks = this.watchCallbacks.get(type);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.watchCallbacks.delete(type);
      }
    }
  }

  /**
   * Stop all watching
   */
  async stopWatching(): Promise<void> {
    // Override in subclass
  }

  protected notifyWatchers(type: string, event: MetadataWatchEvent) {
    const callbacks = this.watchCallbacks.get(type);
    if (!callbacks) return;

    for (const callback of callbacks) {
      try {
        void callback(event);
      } catch (error) {
        this.logger.error('Watch callback error', undefined, {
          type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // ==========================================
  // Version History & Rollback
  // ==========================================

  /**
   * Get the database loader for history operations.
   * Returns undefined if no database loader is configured.
   */
  private getDatabaseLoader(): DatabaseLoader | undefined {
    const dbLoader = this.loaders.get('database');
    if (dbLoader && dbLoader instanceof DatabaseLoader) {
      return dbLoader;
    }
    return undefined;
  }

  /**
   * Get version history for a metadata item.
   * Returns a timeline of all changes made to the item.
   */
  async getHistory(
    type: string,
    name: string,
    options?: MetadataHistoryQueryOptions
  ): Promise<MetadataHistoryQueryResult> {
    const dbLoader = this.getDatabaseLoader();
    if (!dbLoader) {
      throw new Error('History tracking requires a database loader to be configured');
    }

    return dbLoader.queryHistory(type, name, {
      operationType: options?.operationType,
      since: options?.since,
      until: options?.until,
      limit: options?.limit,
      offset: options?.offset,
      includeMetadata: options?.includeMetadata,
    });
  }

  /**
   * Rollback a metadata item to a specific version.
   * Restores the metadata definition from the history snapshot.
   */
  async rollback(
    type: string,
    name: string,
    version: number,
    options?: {
      changeNote?: string;
      recordedBy?: string;
    }
  ): Promise<unknown> {
    const dbLoader = this.getDatabaseLoader();
    if (!dbLoader) {
      throw new Error('Rollback requires a database loader to be configured');
    }

    // Fetch the target version snapshot directly from the history table
    const targetVersion = await dbLoader.getHistoryRecord(type, name, version);

    if (!targetVersion) {
      throw new Error(`Version ${version} not found in history for ${type}/${name}`);
    }

    if (!targetVersion.metadata) {
      throw new Error(`Version ${version} metadata snapshot not available`);
    }

    // Restore the metadata using the dedicated rollback path so that a single
    // 'revert' history entry is written (instead of a conflicting 'update' entry)
    const restoredMetadata = targetVersion.metadata;
    await dbLoader.registerRollback(
      type,
      name,
      restoredMetadata,
      version,
      options?.changeNote,
      options?.recordedBy
    );

    // Update in-memory registry with the restored metadata
    if (!this.registry.has(type)) {
      this.registry.set(type, new Map());
    }
    this.registry.get(type)!.set(name, restoredMetadata);

    return restoredMetadata;
  }

  /**
   * Compare two versions of a metadata item.
   * Returns a diff showing what changed between versions.
   */
  async diff(
    type: string,
    name: string,
    version1: number,
    version2: number
  ): Promise<MetadataDiffResult> {
    const dbLoader = this.getDatabaseLoader();
    if (!dbLoader) {
      throw new Error('Diff requires a database loader to be configured');
    }

    // Fetch the two version snapshots directly from the history table
    const v1 = await dbLoader.getHistoryRecord(type, name, version1);
    const v2 = await dbLoader.getHistoryRecord(type, name, version2);

    if (!v1) {
      throw new Error(`Version ${version1} not found in history for ${type}/${name}`);
    }

    if (!v2) {
      throw new Error(`Version ${version2} not found in history for ${type}/${name}`);
    }

    if (!v1.metadata || !v2.metadata) {
      throw new Error('Version metadata snapshots not available');
    }

    // Generate diff
    const patch = generateSimpleDiff(v1.metadata, v2.metadata);
    const identical = patch.length === 0;
    const summary = generateDiffSummary(patch);

    return {
      type,
      name,
      version1,
      version2,
      checksum1: v1.checksum,
      checksum2: v2.checksum,
      identical,
      patch,
      summary,
    };
  }
}

