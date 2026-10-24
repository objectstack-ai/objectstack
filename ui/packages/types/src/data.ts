/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Data Source Types
 * 
 * Type definitions for data fetching and management.
 * These interfaces define the universal adapter pattern for data access.
 * 
 * @module data
 * @packageDocumentation
 */

// Spec-owned names are bound here, not re-declared (objectstack#4115). Each of
// these already carried a doc comment claiming it mirrored the spec; the import
// is what makes the claim true, and what makes a spec change break the build
// instead of drifting quietly.
import type {
  ImportJobStatus,
  ImportRowResult,
  ImportWriteMode,
  UndoImportJobResponse,
} from '@objectstack/spec/api';
import type { EngineAggregateOptions, FilterArray } from '@objectstack/spec/data';
import type { ValidationError } from '@objectstack/spec/kernel';
import type { ListViewGroupHeaderRow } from '@objectstack/spec/ui';

export type { ImportJobStatus, ImportWriteMode, ValidationError };

/**
 * Query parameters for data fetching.
 * Follows OData/REST conventions for universal compatibility.
 *
 * The key set is CLOSED: the nine `$`-prefixed members below are the whole
 * contract. Every reader in this repository reads members of this set and
 * nothing outside it — `convertQueryParams` and `rawFindWithPopulate`
 * (`@object-ui/data-objectstack`), `queryParamsToRecord` (`@object-ui/core`'s
 * `ApiDataSource`) and `ValueDataSource.find` — so a key outside the set
 * reaches no branch and is dropped on the floor. The type refuses it instead
 * (objectui#7497).
 *
 * Until objectui#7497 this interface also carried a `[key: string]: any`
 * index signature described as "additional custom parameters". Nothing ever
 * read one: a census of every `find` / `findOne` call site and every
 * `QueryParams` literal across the packages, apps, examples, e2e and scripts
 * trees found zero non-`$` keys, and every adapter above reads only declared
 * members. What the signature DID do was make a misspelling compile —
 * `{ filter }` for `$filter`, `{ limit }` for `$top`, `{ options: { $top } }`
 * — and a published guide taught a test built on exactly that, which could
 * never pass (objectui#4734, #5458, #7497). Declared = enforced: the type now
 * says what the readers do, and `tsc` is the first gate a typo meets.
 *
 * ⛔ Do not reopen this with an index signature, a catch-all `extra` bag, or a
 * `$`-prefixed template-literal key. No reader consumes such a key, so each of
 * those is a declared-but-unenforced surface — the same defect in another
 * spelling. A genuinely new query option is a named member here PLUS the
 * branch in each reader that honours it, in the same change.
 */
export interface QueryParams {
  /**
   * Fields to select (projection)
   * @example ['id', 'name', 'email']
   */
  $select?: string[];

  /**
   * Filter expression, in either of the two forms the data sources accept:
   * the MongoDB-style field-keyed record, or a `FilterArray` — the spec-owned
   * ObjectQL AST sugar (`@objectstack/spec/data`).
   *
   * Both forms are normal here, and the array form is not an edge case: the
   * repo's own canonical sink `mergeFilterNodes` / `toFilterNode`
   * (`@object-ui/core`'s `filter-converter.ts`) returns AST nodes, and its two
   * standing producers — `plugin-list`'s `buildEffectiveFilter` (grid and
   * export) and `plugin-view`'s `ObjectView` (calendar / kanban / gallery /
   * timeline) — have fed arrays through this slot all along.
   *
   * ⛔ Do not add a "tolerant conversion" in a consumer to cope with the array
   * path. The array IS legal input; a consumer that needs one shape lowers
   * through the shared sink rather than widening itself to tolerate the
   * producer.
   *
   * The authoritative acceptable set is the one `translateFilterToAST`
   * (`@object-ui/data-objectstack`'s `index.ts`) enumerates — five input
   * shapes, of which the array forms below are three. Read it there rather than
   * trusting a second list here; a partial restatement is exactly how two
   * operator vocabularies drifted apart before.
   *
   * Note the declaration does not *narrow* anything: `Record<string, any>`
   * already structurally accepts arrays (they satisfy its string index), so the
   * union documents the shapes that were always accepted rather than admitting
   * new ones. It is the description that was wrong, not the runtime.
   *
   * @example { age: { $gt: 18 }, status: 'active' }
   * @example ['status', '=', 'active']
   * @example ['and', ['age', '>=', 18], ['status', '=', 'active']]
   * @example [['stage', '=', 'won'], ['amount', '>', 1000]]
   */
  $filter?: Record<string, any> | FilterArray;

  /**
   * Sort order
   * Can be an OData clause string 'field asc, other desc', a Map { field: 'asc' },
   * an Array of strings ['field', '-field'], or an Array of sort objects.
   * @example 'name asc'
   * @example { createdAt: 'desc', name: 'asc' }
   * @example ['name', '-createdAt']
   */
  $orderby?: string | Record<string, 'asc' | 'desc'> | string[] | Array<{ field: string; order?: 'asc' | 'desc' }>;

  /**
   * Number of records to skip (for pagination)
   */
  $skip?: number;

  /**
   * Maximum number of records to return
   */
  $top?: number;

  /**
   * Related entities to expand/include
   * @example ['author', 'comments']
   */
  $expand?: string[];

  /**
   * Search query (full-text search)
   */
  $search?: string;

  /**
   * Optional override of which fields `$search` matches (ADR-0061).
   * The server intersects this with the object's allowed searchable set and
   * ignores anything outside it — it can only *narrow*, never widen, the
   * server-resolved default (`object.searchableFields`). Omit to let the server
   * resolve fields from metadata (the normal case).
   */
  $searchFields?: string[];

  /**
   * Total count of records (for pagination)
   */
  $count?: boolean;
}

/**
 * Query result with pagination metadata
 */
export interface QueryResult<T = any> {
  /**
   * Result data array
   */
  data: T[];

  /**
   * Total number of records (if requested)
   */
  total?: number;

  /**
   * Current page number (1-indexed)
   */
  page?: number;

  /**
   * Page size
   */
  pageSize?: number;

  /**
   * Whether there are more records
   */
  hasMore?: boolean;

  /**
   * Cursor for cursor-based pagination
   */
  cursor?: string;

  /**
   * Additional metadata
   */
  metadata?: Record<string, any>;
}

/**
 * Result of a file upload operation.
 */
export interface FileUploadResult {
  /** Server-assigned unique ID for the uploaded file */
  id: string;
  /** Original filename */
  filename: string;
  /** MIME type of the uploaded file */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Public URL to access the file */
  url: string;
  /** Thumbnail URL (for images) */
  thumbnailUrl?: string;
  /** Additional server-side metadata */
  metadata?: Record<string, unknown>;
}

/**
 * A `{ $ref: n }` placeholder inside a {@link BatchTransactionOperation}'s
 * `data`. Resolves to the id created by operation `n` (which must appear
 * earlier in the same batch) — used to link a child to a parent created in
 * the same transaction (master-detail create).
 */
export interface BatchRef {
  $ref: number;
}

/**
 * One operation in a cross-object transactional batch. Field names match the
 * server contract of `POST /api/v1/batch` (objectstack-ai/objectstack#1604 /
 * ADR-0034 item 4).
 *
 * Distinct from the driver-level `BatchOperation` in `data-protocol.ts`
 * (which speaks `type`/`table`) — this is the DataSource-level, object-aware
 * shape consumed by {@link DataSource.batchTransaction}.
 */
export interface BatchTransactionOperation {
  /** Target object/table name. */
  object: string;
  /** Operation to perform — defaults to `'create'` when omitted. */
  action?: 'create' | 'update' | 'delete';
  /** Target record id — required for `update` and `delete`. */
  id?: string;
  /**
   * Write payload for `create`/`update`. A value may be a
   * `{ $ref: <earlier op index> }` placeholder (see {@link BatchRef}).
   */
  data?: Record<string, any>;
}

/**
 * Universal data source interface.
 * This is the core abstraction that makes Object UI backend-agnostic.
 * 
 * Implementations can connect to:
 * - REST APIs
 * - GraphQL endpoints
 * - ObjectQL servers
 * - Firebase/Supabase
 * - Local arrays/JSON
 * - Any data source
 * 
 * @template T - The data type
 * 
 * @example
 * ```typescript
 * class RestDataSource implements DataSource<User> {
 *   async find(resource, params) {
 *     const response = await fetch(`/api/${resource}?${buildQuery(params)}`);
 *     return response.json();
 *   }
 *   // ... other methods
 * }
 * ```
 */
/**
 * A single record hit returned by the platform's global search endpoint
 * (`GET /api/v1/search`). The backend's registered search service ranks these
 * across every searchable object the caller can see, so the returned ordering
 * is authoritative (best match first).
 */
export interface GlobalSearchHit {
  /** Object/table the record belongs to (e.g. `crm_account`). */
  object: string;
  /** Stable record identifier. */
  id: string;
  /** Server-resolved display title for the record, when provided. */
  title?: string;
  /** Optional highlighted/context snippet describing why it matched. */
  snippet?: string;
  /** The (partial) record payload, when the server includes it. */
  record?: Record<string, any>;
}

/**
 * Result of a {@link DataSource.searchAll} call — the query echoed back plus
 * the ranked cross-object hits.
 */
export interface GlobalSearchResult {
  /** The query string the server actually ran. */
  query: string;
  /** Ranked record hits across all searchable objects. */
  hits: GlobalSearchHit[];
}

/**
 * Outcome of a {@link DataSource.deleteView} delete against ONE of a view's two
 * homes — the pending draft, or the published overlay (objectui#4479).
 */
export interface ViewHomeDeleteOutcome {
  /**
   * True when this home held a row and the server removed it. False is the
   * "there was nothing here" answer, which is a success, not a failure: the
   * framework reports a missing home as a 200 carrying `reset:false`.
   */
  removed: boolean;
  /** The server receipt's `reset` flag, when it sent one. */
  reset?: boolean;
  /** The server receipt's human-readable message, when it sent one. */
  message?: string;
}

/**
 * Receipt for {@link DataSource.deleteView} (objectui#4479, moved here by
 * objectui#4564).
 *
 * The per-home fields are ADDITIVE over the original `{ deleted: boolean }`:
 * a caller that only reads `deleted` is unaffected, and one that needs to tell
 * "draft gone, overlay left" from "both gone" now can.
 *
 * Declared HERE rather than in the adapter that first returned it, because the
 * dependency runs `@object-ui/data-objectstack` -> `@object-ui/types` and never
 * the other way. While the shape lived downstream, the interface could only
 * declare the narrow `{ deleted: boolean }`, and a consumer reaching an adapter
 * THROUGH `DataSource` was handed a type that had already discarded the
 * per-home outcomes — the adapter's wider return being assignable to the
 * narrower declaration is what kept that silent (objectui#4564).
 */
export interface DeleteViewResult {
  /**
   * True only when no home is left serving the view AND at least one home
   * actually held a row. A view that existed in neither home answers `false`
   * — the same answer that shape has always given.
   */
  deleted: boolean;
  /** Outcome against the pending draft (`?state=draft`). */
  draft?: ViewHomeDeleteOutcome;
  /** Outcome against the published overlay. */
  published?: ViewHomeDeleteOutcome;
}

/**
 * The backend-agnostic data contract every adapter implements.
 *
 * ## One rule for record ids: a record id is a `string`
 *
 * An id parameter on this interface is a `string`, never `string | number`,
 * because `@objectstack/spec` declares every record door as `z.string()`. An
 * adapter for a backend whose primary keys are numeric converts at its OWN
 * boundary, in one typed place, rather than widening this contract for every
 * caller. **All five doors say it**, and there is ⛔ no exception to go
 * looking for: a reader who meets one method has learned the rule for all of
 * them. `update` narrowed at objectui#9333; `delete`, `bulkUpdate` and
 * `bulkDelete` at objectui#9712; `findOne` — the last door, and the only one
 * with call sites to pay for — at objectui#9511.
 *
 * ## Why `findOne` cost more than the other four
 *
 * Kept because the SHAPE of the cost is the reusable part, not the repair.
 * `delete`, `bulkUpdate` and `bulkDelete` had ZERO in-tree call sites to
 * change. `findOne`'s readers are AUTHORABLE metadata keys, so narrowing it
 * narrowed an accept set that authors write by hand:
 *
 * - `ObjectFormSchema.recordId`, `DetailViewSchema.resourceId` and
 *   `DetailSchema.resourceId` each moved on BOTH published faces — the
 *   TypeScript declaration and the hand-written zod mirror. A declaration
 *   alone would not have been enough: it does not run at parse time, so the
 *   mirror is the only face that can refuse an authored number.
 * - `DrawerForm`, `ModalForm`, `SplitForm`, `TabbedForm` and `WizardForm`
 *   followed on their own TypeScript-only faces, which carry no zod mirror and
 *   no registered node type. They had to move together with the key above:
 *   `ObjectForm` BUILDS all five of those schemas from its own (authorable)
 *   `ObjectFormSchema`, so narrowing one without the others only relocates the
 *   refusal onto the hand-off site.
 *
 * ⇒ an author who wrote `resourceId: 42` is refused AT PARSE with the quoted
 * form prescribed in the message; ⛔ nothing converts it silently, in either
 * direction. Ruled as one rule with no exception — director batch #195 item 1,
 * letter A on objectui#9511, standing on batch #136 item 5 letter B.
 *
 * ⚠️ Narrowing a parameter here does NOT reach implementors — TypeScript
 * compares method parameters bivariantly, so an adapter that still declares
 * `string | number` continues to satisfy this interface. The rule binds
 * CALLERS; adapters are asked to honour it, not forced to by the checker.
 */
export interface DataSource<T = any> {
  /**
   * Fetch multiple records.
   *
   * @param resource - Resource name (e.g., 'users', 'posts')
   * @param params - Query parameters
   * @returns Promise resolving to query result
   */
  find(resource: string, params?: QueryParams): Promise<QueryResult<T>>;

  /**
   * Full-text search across every object the caller can see, in a single
   * round-trip. Backed by the platform's global search endpoint
   * (`GET /api/v1/search?q=`), which is served by the registered search
   * service (e.g. the pinyin full-text plugin) and ranks hits across objects.
   *
   * This is intentionally distinct from `find(resource, { $search })`, which
   * runs a *per-object* metadata-driven search: the global endpoint consults
   * the search index and can surface records the per-object path misses. Global
   * affordances — the ⌘K command palette, the search page — should prefer this
   * and fall back to a per-object `find` fanout only when it is absent.
   *
   * Optional: adapters without a global search endpoint may omit it.
   *
   * @param query - Raw search term (the adapter trims/encodes it).
   * @param options - Optional caps: `limit` (max total hits) and `objects`
   *   (restrict the search to a whitelist of object names).
   * @returns Ranked hits across objects.
   */
  searchAll?(
    query: string,
    options?: { limit?: number; objects?: string[] },
  ): Promise<GlobalSearchResult>;

  /**
   * Fetch a single record by ID.
   *
   * @param resource - Resource name
   * @param id - Record identifier. A `string`, per the one record-id rule on
   *   {@link DataSource} — the last door to adopt it (objectui#9511). A
   *   backend whose primary keys are numeric converts at its own adapter
   *   boundary, ⛔ not here and ⛔ not at each caller.
   * @param params - Additional query parameters
   * @returns Promise resolving to the record or null
   */
  findOne(resource: string, id: string, params?: QueryParams): Promise<T | null>;

  /**
   * Create a new record.
   * 
   * @param resource - Resource name
   * @param data - Record data
   * @returns Promise resolving to the created record
   */
  create(resource: string, data: Partial<T>): Promise<T>;

  /**
   * Update an existing record.
   *
   * @param resource - Resource name
   * @param id - Record identifier. A `string`, as `@objectstack/spec` declares
   *   every record door; an adapter for a backend whose primary keys are
   *   numeric maps at its own boundary rather than widening this contract for
   *   every caller (objectui#9333).
   * @param data - Updated data (partial)
   * @param opts - Optional write options. Pass `opts.ifMatch` to enable
   *   Optimistic Concurrency Control: the implementation forwards the
   *   token (typically the `updated_at` value the caller previously read)
   *   to the server. On a mismatch the adapter rejects with a
   *   `ConcurrentUpdateError` (HTTP 409) so the UI can surface a
   *   conflict-resolution flow. Adapters that don't support OCC may
   *   ignore the option.
   * @returns Promise resolving to the updated record
   */
  update(
    resource: string,
    id: string,
    data: Partial<T>,
    opts?: { ifMatch?: string },
  ): Promise<T>;

  /**
   * Delete a record.
   *
   * @param resource - Resource name
   * @param id - Record identifier. A `string` — see the record-id rule on
   *   {@link DataSource} (objectui#9511).
   * @param opts - Optional write options — see {@link update} for `ifMatch`.
   * @returns Promise resolving to true if successful
   */
  delete(
    resource: string,
    id: string,
    opts?: { ifMatch?: string },
  ): Promise<boolean>;

  /**
   * Execute a bulk operation (optional).
   * 
   * @param resource - Resource name
   * @param operation - Operation type
   * @param data - Bulk data
   * @returns Promise resolving to operation result
   */
  bulk?(resource: string, operation: 'create' | 'update' | 'delete', data: Partial<T>[]): Promise<T[]>;

  /**
   * Apply the **same** patch to many records in a single round-trip.
   *
   * This is the "Slack mark-all-as-read" / "Linear archive selection"
   * pattern: one logical operation, N targets, identical body. Adapters
   * that support a server-side bulk-update primitive should issue one
   * HTTP request; adapters without bulk support may fall back to a
   * sequential per-id loop (callers should not assume atomicity).
   *
   * Returns the count of successfully updated rows. Per-row failures
   * (e.g. RLS-rejected, validation errors) are tolerated when the
   * adapter supports it; total errors throw.
   *
   * @param resource - Object/table name
   * @param ids - Target record ids. Each a `string` — see the record-id rule
   *   on {@link DataSource} (objectui#9511).
   * @param patch - Field updates applied uniformly to every id
   * @returns Number of rows reported as updated by the server
   */
  bulkUpdate?(
    resource: string,
    ids: ReadonlyArray<string>,
    patch: Partial<T>,
  ): Promise<number>;

  /**
   * Bulk delete multiple records by id in a single server call.
   *
   * Symmetric counterpart to `bulkUpdate` — collapses a "delete N rows"
   * intent into 1 HTTP request. Adapters that support a server-side
   * delete primitive should issue one DELETE call; adapters without
   * bulk support may fall back to a sequential per-id loop (callers
   * should not assume atomicity).
   *
   * Returns the count of successfully deleted rows. Per-row failures
   * (e.g. RLS-rejected, foreign-key constraint) are tolerated when the
   * adapter supports it; total errors throw.
   *
   * @param resource - Object/table name
   * @param ids - Target record ids. Each a `string` — see the record-id rule
   *   on {@link DataSource} (objectui#9511).
   * @returns Number of rows reported as deleted by the server
   */
  bulkDelete?(
    resource: string,
    ids: ReadonlyArray<string>,
  ): Promise<number>;

  /**
   * Atomically persist an ordered set of cross-object operations (optional).
   *
   * Contract: **either every operation commits or none do**. `results` is
   * index-aligned with `operations` — a create/update echoes the written
   * record, a delete echoes `true`. A field value inside an op's `data` may
   * be a `{ $ref: <earlier op index> }` placeholder (see {@link BatchRef})
   * that resolves to the id produced by that earlier operation, so a child
   * row can reference a parent created in the SAME batch (master-detail).
   *
   * Backends with a transactional batch endpoint should issue one server
   * call (true atomicity). Adapters WITHOUT server-side atomicity must still
   * implement this method by emulating it client-side with best-effort
   * compensation — see `emulateBatchTransaction` in `@object-ui/core`.
   * Callers may therefore assume this method always saves, but only a
   * server-backed implementation is genuinely atomic.
   *
   * @param operations - Ordered cross-object operations
   * @returns `{ results }` index-aligned with `operations`
   */
  batchTransaction?(
    operations: BatchTransactionOperation[],
  ): Promise<{ results: any[] }>;

  /**
   * Cancel (recall) the active pending approval request for a record.
   * Returns the recalled request id and final status. Throws when no
   * pending request exists or when the caller is not the submitter.
   *
   * Optional — adapters that don't speak to an approvals service can omit it.
   */
  cancelPendingApproval?(
    objectName: string,
    recordId: string,
  ): Promise<{ requestId: string; status: string }>;

  /**
   * Get object schema/metadata.
   * Used by ObjectQL-aware components to auto-generate UI from object metadata.
   * Required for all DataSource implementations to support schema-aware components.
   * 
   * @param objectName - Object name
   * @returns Promise resolving to the object schema
   */
  getObjectSchema(objectName: string): Promise<any>;

  /**
   * List the platform's registered objects (lightweight `{ name, label }`
   * headers) for object-picker widgets — e.g. a sharing rule's `object-ref`
   * field. Backed by the metadata-registry list endpoint, so it includes both
   * code- and DB-defined objects. Optional: adapters that can't enumerate
   * objects may omit it, and callers should fall back gracefully (e.g. query
   * the metadata object) when it is absent.
   */
  getObjects?(): Promise<Array<{ name: string; label?: string }>>;

  /**
   * List the items one metadata registry type declares (lightweight
   * `{ name, label }` headers) for a record-form field that names a registry
   * item by name (objectui#7611): the `position-ref` and `permission-ref`
   * field widgets. Backed by the registry's list route for that type,
   * `GET /api/v1/meta/:type`, so it answers the declared items and the
   * environment-authored ones alike (ADR-0131 D3).
   *
   * An empty array means "the registry declares no item of this type" and is
   * AUTHORITATIVE, so a failure MUST reject, never resolve `[]`: the widget
   * renders a failed load as a failure, and an empty list as an empty
   * catalog. That is the contract {@link getObjects} does not keep, which is
   * why this is a separate member and not a generalisation of it.
   *
   * Optional: an adapter that cannot enumerate a registry omits it, and the
   * widget then takes a typed name.
   *
   * @param type - The registry type (`position`, `permission`)
   * @throws on transport, permission or envelope failure — do NOT resolve `[]`
   */
  listMetadataItems?(type: string): Promise<Array<{ name: string; label?: string }>>;

  /**
   * Get a view definition for an object.
   * Used by view components to render server-defined UI configurations.
   * Optional — implementations may return null to fall back to static config.
   * 
   * @param objectName - Object name
   * @param viewId - View identifier (e.g., 'all', 'active', 'my_records')
   * @returns Promise resolving to the view definition or null
   */
  getView?(objectName: string, viewId: string): Promise<any | null>;

  /**
   * Batch-fetch all persisted view overrides for an object in one call.
   *
   * Optional companion to {@link getView} that returns a `{viewName: override}`
   * map instead of fetching each view individually. Adapters should implement
   * this when the underlying transport can enumerate the view namespace in one
   * request. When not implemented, callers fall back to per-view
   * {@link getView}.
   *
   * TWO CONTRACT TERMS, and they are not the same value (objectui#3774):
   *
   * - The map MUST be keyed by the SAME view identity the view writes
   *   ({@link createView}, {@link updateView}) persist under and {@link getView}
   *   reads back by. An implementation that enumerates a different key space
   *   than the one it writes to answers `{}` forever, and every saved
   *   preference reads back as "didn't save".
   * - An empty map means "no overrides exist" and is AUTHORITATIVE — callers
   *   may trust it and skip the per-view reads. A failure MUST therefore
   *   REJECT, never resolve to `{}`: swallowing it into an empty map is
   *   indistinguishable from the authoritative answer, which silently disables
   *   the caller's per-view fallback instead of triggering it.
   *
   * @param objectName - Object name (e.g. 'lead')
   * @returns Promise resolving to a map of view name → override config
   * @throws on transport/permission failure — do NOT resolve `{}` instead
   */
  listViewOverrides?(objectName: string): Promise<Record<string, any>>;

  /**
   * List user-created overlay views for an object (ADR-0005 metadata
   * customization overlay). Returns view specs (not physical sys_view
   * records). Implementations route to
   * `GET /api/v1/meta/view` and filter client-side by `data.object`.
   *
   * `options.previewDrafts` (ADR-0037): when true, read the draft-overlaid
   * world — pending drafts win by name and draft-only views surface (tagged
   * `_draft`) — so a view just created via "Add View" is visible before it is
   * published. Omitted/false reads published views only.
   */
  listViews?(objectName: string, options?: { previewDrafts?: boolean }): Promise<any[]>;

  /**
   * Create a new overlay view. The view's `name` field is the stable
   * identifier; if omitted, a unique snake_case name is generated.
   * Routes to `PUT /api/v1/meta/view/:name`.
   */
  createView?(objectName: string, spec: Record<string, any>): Promise<Record<string, any> | void>;

  /**
   * Apply a partial update to an overlay view (read-merge-write because
   * overlay rows store the full view document). Routes to
   * `PUT /api/v1/meta/view/:name`.
   */
  updateView?(objectName: string, viewName: string, partial: Record<string, any>): Promise<Record<string, any> | void>;

  /**
   * Delete an overlay view. Routes to `DELETE /api/v1/meta/view/:name`,
   * which resets to the artifact default if one exists or removes the
   * overlay entirely if it was a user-created view.
   *
   * A view has TWO homes — the pending per-item draft (`?state=draft`) and the
   * published overlay — and "remove this view" is satisfied only when neither
   * is left serving it (objectui#4479). The receipt is
   * {@link DeleteViewResult}: `deleted` is the unchanged single-bit answer, and
   * the optional per-home outcomes let a caller tell a partial result ("draft
   * gone, overlay left") from a complete one instead of having it rounded up.
   * Implementations that address only one home report the other absent.
   */
  deleteView?(objectName: string, viewName: string): Promise<DeleteViewResult>;


  /**
   * Get an application definition by name or ID.
   * Used by app shells to render server-defined navigation, branding, and layout.
   * Optional — implementations may return null to fall back to static config.
   * 
   * @param appId - Application identifier
   * @returns Promise resolving to the app definition or null
   */
  getApp?(appId: string): Promise<any | null>;

  /**
   * Get a page definition by name or ID.
   * Used by page renderers to fetch server-defined page layouts.
   * Optional — implementations may return null to fall back to static config.
   *
   * @param pageId - Page identifier (e.g., 'home', 'settings', 'onboarding')
   * @returns Promise resolving to the page definition or null
   */
  getPage?(pageId: string): Promise<any | null>;

  /**
   * Upload a single file to a resource.
   * Optional — only supported by data sources with file storage integration.
   *
   * @param resource - Resource name
   * @param file - File or Blob to upload
   * @param options - Upload options (recordId, fieldName, metadata)
   * @returns Promise resolving to the upload result
   */
  uploadFile?(
    resource: string,
    file: File | Blob,
    options?: {
      recordId?: string;
      fieldName?: string;
      metadata?: Record<string, unknown>;
      onProgress?: (percent: number) => void;
    },
  ): Promise<FileUploadResult>;

  /**
   * Upload multiple files to a resource.
   * Optional — only supported by data sources with file storage integration.
   *
   * @param resource - Resource name
   * @param files - Array of Files or Blobs to upload
   * @param options - Upload options
   * @returns Promise resolving to array of upload results
   */
  uploadFiles?(
    resource: string,
    files: (File | Blob)[],
    options?: {
      recordId?: string;
      fieldName?: string;
      metadata?: Record<string, unknown>;
      onProgress?: (percent: number) => void;
    },
  ): Promise<FileUploadResult[]>;

  /**
   * Perform server-side aggregation on a resource.
   * Used by chart widgets to offload grouping/aggregation to the backend,
   * avoiding large data downloads.
   * Optional — when not implemented, chart components will fall back to
   * fetching all records via `find()` and aggregating client-side.
   *
   * @param resource - Resource name (e.g., 'opportunity')
   * @param params - Aggregation parameters (field, function, groupBy, filter)
   * @returns Promise resolving to aggregated results
   */
  aggregate?(resource: string, params: AggregateParams): Promise<AggregateResult[]>;

  /**
   * Answer a grouped list view's GROUP HEADER query (objectui#7189).
   *
   * `query` is what `compileListViewGroupQuery` (`@objectstack/spec/ui`)
   * compiles a grouped view into — an `EngineAggregateOptions` whose `groupBy`
   * is the grouping fields in nesting order and whose `aggregations` carry the
   * group count plus any per-group summary. The answer is one header row per
   * group, every grouped field under its own name holding the RAW stored value
   * (`null` for the empty group) and the group's TOTAL row count under
   * `count`. Those numbers are properties of the query, not of any fetched
   * page: that is the whole contract, and it is what lets a grouped grid show
   * every group with its true size and page the rows inside each one.
   *
   * Optional, and presence is the capability: a grid only asks a data source
   * that declares this member. A source that cannot answer it must leave it
   * undeclared rather than approximate it — a grouped grid that fetches its
   * own rows over such a source refuses grouping, naming this member, and
   * fetches no rows (objectui#10881). Rows a host hands in whole are still
   * grouped where they are.
   *
   * The same query with NO `groupBy` asks for the whole filtered set as ONE
   * header row: a flat grid whose rows are one page of more reads its column
   * footer's figures off that row, so they describe the rows the grid's count
   * counts rather than the page on screen (objectui#12081). A source that
   * answers grouped queries only may refuse it; the footer then says its
   * figure is the page's.
   *
   * ⛔ Not a second spelling of {@link aggregate}: that member takes the
   * analytics-shaped {@link AggregateParams} (one field, one function, one
   * `groupBy`) and may degrade to a client-side reduction; this one takes the
   * compiled header query verbatim and never degrades.
   *
   * @param resource - Object name
   * @param query - The compiled header query (`EngineAggregateOptions`)
   * @returns One header row per group, as the platform answers it
   */
  queryGroupHeaders?(resource: string, query: EngineAggregateOptions): Promise<ListViewGroupHeaderRow[]>;

  /**
   * Subscribe to mutation events.
   * When implemented, data-bound views (ListView, ObjectView) can auto-refresh
   * after any create/update/delete operation on relevant resources.
   *
   * @param callback - Invoked after each successful mutation
   * @returns Unsubscribe function to remove the listener
   *
   * @example
   * ```typescript
   * const unsub = dataSource.onMutation?.((event) => {
   *   if (event.resource === 'contacts') {
   *     refreshList();
   *   }
   * });
   * // later…
   * unsub?.();
   * ```
   */
  onMutation?(callback: (event: DataSourceMutationEvent<T>) => void): () => void;

  /**
   * Synchronously download a server-streamed export of a resource.
   *
   * It resolves directly to the exported file as a `Blob`: the server streams
   * matching rows in the chosen
   * format (`csv` / `json` / `xlsx`), applies type-aware value formatting
   * (lookup → name, select → label, boolean → 是/否, dates formatted) and
   * enforces object / field / row permissions. Suited to interactive
   * "click Export → file downloads" flows up to the server's row cap (tens of
   * thousands of rows), with no client-side buffering of the full dataset
   * during generation.
   *
   * Optional — when not implemented, callers fall back to the client-side
   * export path (csv / json only, raw values, no type-aware formatting).
   *
   * @param resource - Resource name (e.g., 'account', 'opportunity')
   * @param request - Export request (format, fields, filter, sort, limit, …)
   * @returns Promise resolving to the exported file as a Blob.
   */
  exportDownload?(
    resource: string,
    request: ExportDownloadRequest,
  ): Promise<Blob>;

  /**
   * Bulk-import rows into an object in a single server call.
   *
   * Callers send **raw** spreadsheet values (CSV text or JSON row objects) plus
   * an optional `mapping` from source column → target field. The server coerces
   * every cell to its storage value from the object's field metadata (booleans,
   * numbers, dates→ISO, select label→code, lookup name→id), so the client does
   * NOT pre-convert special values. `writeMode` selects insert / update /
   * upsert (the latter two require `matchFields`); `dryRun` validates + previews
   * without persisting. The result carries per-row outcomes for an import
   * report + failed-row re-export.
   *
   * Optional — adapters without a server-side `/import` primitive may omit this
   * (the wizard falls back to a per-row `create` loop).
   *
   * @param resource - Object/table name
   * @param request - Import payload + options (see {@link ImportRequestOptions})
   * @returns Promise resolving to the aggregate + per-row import result
   */
  importRecords?(
    resource: string,
    request: ImportRequestOptions,
  ): Promise<ImportRecordsResult>;

  /**
   * Download the server's import template for a resource: the spreadsheet a
   * user fills in and uploads back through {@link importRecords}.
   *
   * The server owns the template (objectui#9600). It lists only the columns an
   * import can write for this caller, marks the required ones, and adds
   * dropdowns and fill-in instructions. A client-built copy would be a second
   * definition of those column rules. It resolves to the file (an xlsx
   * workbook) as a `Blob`; the caller triggers the browser download.
   *
   * The server judges this request like the import itself. The object must be
   * open for import, else it answers 405. The caller must be allowed to create
   * records of it, else it answers 403. Offer the template only to a user who
   * can create records of the object.
   *
   * The template's labels and dropdown values are written in the request's
   * locale, and the import accepts a translated label only in its own request's
   * locale. So an adapter sends this request in the same locale its
   * {@link importRecords} request uses.
   *
   * Optional, and there is no client-side fallback: when it is absent, no
   * template is offered. Feature-detect with
   * `typeof dataSource.downloadImportTemplate === 'function'`.
   *
   * @param resource - Object/table name
   * @returns Promise resolving to the template file as a Blob.
   */
  downloadImportTemplate?(resource: string): Promise<Blob>;

  /**
   * Initiate an **asynchronous** import job — the large-file counterpart to
   * {@link importRecords}. The whole payload is posted once; the server persists
   * a job, returns immediately with a `jobId`, and processes rows in the
   * background (up to its row ceiling, typically 50,000). Callers poll
   * {@link getImportJobProgress} for live counters and
   * {@link getImportJobResults} for the capped per-row report.
   *
   * Optional — adapters whose backend lacks async import jobs omit this (the
   * wizard then keeps every file on the synchronous {@link importRecords} path).
   * Feature-detect with `typeof dataSource.createImportJob === 'function'`.
   *
   * @param resource - Object/table name
   * @param request - Same payload shape as {@link importRecords}
   * @returns Promise resolving to job tracking info ({ jobId, status, total, … })
   */
  createImportJob?(
    resource: string,
    request: ImportRequestOptions,
  ): Promise<CreateImportJobResult>;

  /**
   * Poll the progress of a previously-created import job.
   * Optional — required only if {@link createImportJob} is implemented.
   *
   * @param jobId - The job identifier returned by {@link createImportJob}.
   * @returns Promise resolving to current counters / terminal status.
   */
  getImportJobProgress?(jobId: string): Promise<ImportJobProgressInfo>;

  /**
   * Fetch the per-row results of an import job (server-capped; failures first).
   * Optional — required only if {@link createImportJob} is implemented.
   *
   * @param jobId - The job identifier.
   * @returns Progress fields plus `results` and a `resultsTruncated` flag.
   */
  getImportJobResults?(jobId: string): Promise<ImportJobResultsInfo>;

  /**
   * List recent import jobs (history), newest first.
   * Optional — implementations without a history endpoint omit this.
   *
   * @param options - Optional filters (object, status) + pagination.
   */
  listImportJobs?(options?: ListImportJobsOptions): Promise<ImportJobSummaryInfo[]>;

  /**
   * Cancel a pending/running import job (cooperative — the worker stops at its
   * next progress boundary). Optional; the UI hides Cancel when omitted.
   *
   * @param jobId - The job identifier to cancel.
   */
  cancelImportJob?(jobId: string): Promise<void>;

  /**
   * Logically roll back a finished import job: delete the records it created
   * and restore the records it updated to their pre-import field values.
   * Optional — only jobs the server captured an undo log for are undoable
   * (see {@link ImportJobProgressInfo.undoable}). The UI hides Undo when this
   * is omitted or the job reports `undoable: false`.
   *
   * @param jobId - The job identifier to undo.
   * @returns Counts of deleted / restored / failed reversal operations, and
   *   one `failures` entry per row the undo did not revert.
   */
  undoImportJob?(jobId: string): Promise<ImportJobUndoResult>;
}

/**
 * The lifecycle state of one client connection: a data adapter's link to its
 * server, or a realtime socket. `@object-ui/data-objectstack`'s adapter reports
 * it through `getConnectionState()` / `onConnectionStateChange`, and
 * `@object-ui/collaboration`'s `useRealtimeSubscription` returns it as
 * `connectionState`. Both packages re-export this one declaration under the
 * same name.
 *
 * Declared here once (objectui#6349, batch 10). Those two packages each used to
 * declare the same five states, and neither depends on the other, so the one
 * authority sits in this package, which both already depend on.
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/**
 * How each incoming import row is committed against existing data. Imported from
 * `@objectstack/spec/api` at the top of this module.
 * - `insert` — always create a new record (default; ignores `matchFields`)
 * - `update` — update the record matched by `matchFields`; skip when none match
 * - `upsert` — update when matched, else create
 */

/**
 * A single source-column → target-field mapping with optional per-column
 * transform metadata. Mirrors the server's `FieldMappingEntry`.
 */
export interface ImportFieldMappingEntry {
  sourceField: string;
  targetField: string;
  transform?: 'none' | 'uppercase' | 'lowercase' | 'trim' | 'date_format' | 'lookup';
  defaultValue?: unknown;
  required?: boolean;
}

/**
 * Options + payload for {@link DataSource.importRecords}. Mirrors the server's
 * `ImportRequest` (`POST /api/v1/data/:object/import`).
 */
export interface ImportRequestOptions {
  /** Payload shape — inferred from `csv`/`rows` when omitted. */
  format?: 'csv' | 'json';
  /** CSV text (when `format = 'csv'`). */
  csv?: string;
  /** Row objects (when `format = 'json'`). */
  rows?: Array<Record<string, unknown>>;
  /** Source column → target field mapping (compact record or entry array). */
  mapping?: Record<string, string> | ImportFieldMappingEntry[];
  /**
   * Name of a registered `mapping` metadata artifact (objectstack-ai/objectstack#2611). When
   * set, the server resolves the mapping by name and applies its
   * fieldMapping pipeline (rename + transforms, strict projection); mutually
   * exclusive with the inline `mapping` rename above.
   */
  mappingName?: string;
  /** Validate + coerce every row without persisting. @default false */
  dryRun?: boolean;
  /** insert / update / upsert semantics. @default 'insert' */
  writeMode?: ImportWriteMode;
  /** Fields that identify an existing record (required for update/upsert). */
  matchFields?: string[];
  /** Fire triggers/hooks for each imported row (off by default for bulk). */
  runAutomations?: boolean;
  /** Import as established historical facts. Skips the `state_machine` rule so
   *  mid-lifecycle rows (already-closed tickets, closed_won deals) aren't rejected
   *  by `initialStates` (objectstack-ai/objectstack#3479), AND preserves the original audit timeline:
   *  a supplied `updated_at`/`updated_by` and business `readonly` fields are kept
   *  instead of stamped-now / stripped (objectstack-ai/objectstack#3493). @default false */
  treatAsHistorical?: boolean;
  /** Trim leading/trailing whitespace from string cells. @default true */
  trimWhitespace?: boolean;
  /** Strings treated as null/blank besides the empty string. */
  nullValues?: string[];
  /** Keep unmatched select values instead of failing the row. @default false */
  createMissingOptions?: boolean;
  /** Skip rows whose `matchFields` are blank. @default false */
  skipBlankMatchKey?: boolean;
}

/**
 * Outcome of one imported row — the server's own `ImportRowResult`, re-exported
 * by reference (objectstack#4115) rather than mirrored.
 *
 * The mirror it replaces declared `action` optional while the route's schema
 * makes it required, so the import report's outcome column was typed as
 * possibly-absent for a value that is always sent.
 */
export type { ImportRowResult } from '@objectstack/spec/api';

/**
 * Aggregate summary + per-row results from {@link DataSource.importRecords}.
 * Mirrors the server's `ImportResponse`.
 */
export interface ImportRecordsResult {
  object: string;
  dryRun: boolean;
  writeMode: ImportWriteMode;
  total: number;
  ok: number;
  errors: number;
  created: number;
  updated: number;
  skipped: number;
  results: ImportRowResult[];
}

/**
 * Lifecycle status of an asynchronous import job. Imported from
 * `@objectstack/spec/api` at the top of this module.
 */

/**
 * Result of {@link DataSource.createImportJob}. `jobId` is the polling key.
 * Mirrors the server's `CreateImportJobResponse`.
 */
export interface CreateImportJobResult {
  /** Server-assigned job identifier. */
  jobId: string;
  /** Object the job imports into. */
  object: string;
  /** Initial status (usually 'pending'). */
  status: ImportJobStatus;
  /** Total rows accepted for processing. */
  total: number;
  /** ISO-8601 creation timestamp. */
  createdAt?: string;
}

/**
 * Live progress of an import job, returned by
 * {@link DataSource.getImportJobProgress}. Mirrors the server's
 * `ImportJobProgress`.
 */
export interface ImportJobProgressInfo {
  jobId: string;
  object: string;
  status: ImportJobStatus;
  dryRun?: boolean;
  writeMode?: ImportWriteMode;
  /** Total rows in the job. */
  total: number;
  /** Rows processed so far. */
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  /** 0–100 completion. */
  percentComplete: number;
  /** Whether this job can still be logically rolled back (see {@link DataSource.undoImportJob}). */
  undoable?: boolean;
  /** ISO-8601 timestamp of when the job was undone / rolled back. */
  revertedAt?: string;
  /** Failure detail when `status === 'failed'`. */
  error?: string;
  /** ISO-8601 start timestamp. */
  startedAt?: string;
  /** ISO-8601 completion timestamp. */
  completedAt?: string;
  /** ISO-8601 creation timestamp. */
  createdAt?: string;
}

/**
 * Import-job progress plus the capped per-row report, returned by
 * {@link DataSource.getImportJobResults}. Mirrors the server's
 * `ImportJobResults`.
 */
export interface ImportJobResultsInfo extends ImportJobProgressInfo {
  /** Per-row outcomes (server-capped; failures first). */
  results: ImportRowResult[];
  /** True when `results` omits rows because the cap was exceeded. */
  resultsTruncated: boolean;
}

/**
 * One row in the import-job history list, returned by
 * {@link DataSource.listImportJobs}. Mirrors the server's `ImportJobSummary`.
 */
export interface ImportJobSummaryInfo {
  jobId: string;
  object: string;
  status: ImportJobStatus;
  total: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  createdAt?: string;
  completedAt?: string;
  /** Whether this job can still be logically rolled back. */
  undoable?: boolean;
  /** ISO-8601 timestamp of when the job was undone / rolled back. */
  revertedAt?: string;
}

/**
 * Outcome of {@link DataSource.undoImportJob} — a logical rollback. Bound to
 * the server's `UndoImportJobResponse` by reference (objectui#13015): the
 * hand-written copy it replaces lacked `failures`, so the wizard never read
 * the rows a partial undo left unreverted. `success` is false when any row is
 * listed in `failures`; the job then stays undoable for exactly those rows.
 */
export type ImportJobUndoResult = UndoImportJobResponse;

/**
 * Filters + pagination for {@link DataSource.listImportJobs}.
 */
export interface ListImportJobsOptions {
  /** Only jobs importing into this object. */
  object?: string;
  /** Only jobs in this status. */
  status?: ImportJobStatus;
  /** Page size (server clamps; default 50). */
  limit?: number;
  /** Offset for pagination. */
  offset?: number;
}

/**
 * Request payload for `DataSource.exportDownload` (synchronous streamed export).
 *
 * Mirrors the active list view: pass the same `filter` / `search` / `sort` the
 * list is showing so the exported file matches what the user sees.
 *
 * `search` was missing until objectstack#4230, and the omission was not
 * visible: exporting a searched list quietly produced the UNSEARCHED superset —
 * more rows than the screen showed, in a file that looks authoritative. A
 * caller that mirrors only `filter` still has that bug.
 */
export interface ExportDownloadRequest {
  /** Output file format. Defaults to 'csv'. */
  format?: 'csv' | 'json' | 'xlsx';
  /** Subset of fields to include (defaults to all readable columns). */
  fields?: string[];
  /** Server-side filter (engine-specific shape, often the active view filter). */
  filter?: unknown;
  /**
   * Full-text term, same semantics as the list read's `$search`. Composes with
   * `filter` server-side rather than replacing it. Requires a server with
   * objectstack#4230; older servers ignore it (and export the wider set).
   */
  search?: string;
  /** Optional override for which fields `search` scans (ADR-0061). */
  searchFields?: string[];
  /** Sort instructions; multiple keys allowed, order preserved. */
  sort?: Array<{ field: string; direction?: 'asc' | 'desc' }>;
  /** Hard cap on records exported (server enforces its own ceiling too). */
  limit?: number;
  /** Whether to write a header row (csv / xlsx). Default true. */
  includeHeaders?: boolean;
}

/**
 * Describes a mutation that occurred on a DataSource.
 * Emitted by `DataSource.onMutation` subscribers after create/update/delete.
 */
export interface DataSourceMutationEvent<T = any> {
  /** The type of mutation that occurred */
  type: 'create' | 'update' | 'delete';
  /** The resource (object) name that was mutated */
  resource: string;
  /** The affected record (present for create/update) */
  record?: T;
  /**
   * The ID of the affected record (present for update/delete). A string, per
   * the one record-id rule stated on {@link DataSource} (objectui#9511,
   * objectui#10078): an adapter whose backend keys are numeric converts at its
   * own boundary before it emits, so no subscriber has to.
   */
  id?: string;
}

/**
 * Parameters for server-side aggregation.
 * Describes how to group and aggregate data on the backend.
 */
export interface AggregateParams {
  /** Field to aggregate (e.g., 'amount') */
  field: string;
  /** Aggregation function (e.g., 'sum', 'count', 'avg', 'min', 'max') */
  function: string;
  /** Field to group by (e.g., 'stage') */
  groupBy: string;
  /** Optional filter to apply before aggregation */
  filter?: any;
}

/**
 * Result of a server-side aggregation.
 * Each entry represents one group with the aggregated value.
 */
export interface AggregateResult {
  [key: string]: any;
}

/**
 * Data scope context for managing data state.
 * Provides reactive data management within the UI.
 */
export interface DataScope {
  /**
   * Data source instance
   */
  dataSource?: DataSource;

  /**
   * Current data
   */
  data?: any;

  /**
   * Loading state
   */
  loading?: boolean;

  /**
   * Error state
   */
  error?: Error | string | null;

  /**
   * Refresh data
   */
  refresh?: () => Promise<void>;

  /**
   * Set data
   */
  setData?: (data: any) => void;
}

/**
 * Data context for component trees.
 * Allows components to access and share data.
 */
export interface DataContext {
  /**
   * Named data scopes
   */
  scopes: Record<string, DataScope>;

  /**
   * Register a data scope
   */
  registerScope: (name: string, scope: DataScope) => void;

  /**
   * Get a data scope by name
   */
  getScope: (name: string) => DataScope | undefined;

  /**
   * Remove a data scope
   */
  removeScope: (name: string) => void;
}

/**
 * Data binding configuration.
 * Defines how a component's data is sourced and updated.
 */
export interface DataBinding {
  /**
   * Data source name
   */
  source?: string;

  /**
   * Resource name
   */
  resource?: string;

  /**
   * Query parameters
   */
  params?: QueryParams;

  /**
   * Transform function for data
   */
  transform?: (data: any) => any;

  /**
   * Auto-refresh interval (ms)
   */
  refreshInterval?: number;

  /**
   * Cache data
   */
  cache?: boolean;

  /**
   * Cache TTL (ms)
   */
  cacheTTL?: number;
}

/**
 * Validation error — imported from `@objectstack/spec/kernel` at the top of this
 * module.
 */

/**
 * API error response
 */
export interface APIError {
  /**
   * Error message
   */
  message: string;

  /**
   * HTTP status code
   */
  status?: number;

  /**
   * Error code
   */
  code?: string;

  /**
   * Validation errors
   */
  errors?: ValidationError[];

  /**
   * Additional error data
   */
  data?: any;
}
