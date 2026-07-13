// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { QueryAST, SortNode, AggregationNode, isFilterAST } from '@objectstack/spec/data';
import {
  BatchUpdateRequest,
  BatchUpdateResponse,
  UpdateManyRequest,
  DeleteManyRequest,
  BatchOptions,
  MetadataCacheRequest,
  MetadataCacheResponse,
  StandardErrorCode,
  ErrorCategory,
  GetDiscoveryResponse,
  GetMetaTypesResponse,
  GetMetaItemsResponse,
  LoginRequest,
  SessionResponse,
  GetPresignedUrlRequest,
  PresignedUrlResponse,
  CompleteUploadRequest,
  FileUploadResponse,
  InitiateChunkedUploadRequest,
  InitiateChunkedUploadResponse,
  UploadChunkResponse,
  CompleteChunkedUploadRequest,
  CompleteChunkedUploadResponse,
  UploadProgress,
  CheckPermissionRequest,
  CheckPermissionResponse,
  GetObjectPermissionsResponse,
  GetEffectivePermissionsResponse,
  RealtimeConnectRequest,
  RealtimeConnectResponse,
  RealtimeSubscribeRequest,
  RealtimeSubscribeResponse,
  SetPresenceRequest,
  GetPresenceResponse,
  GetWorkflowConfigResponse,
  GetWorkflowStateResponse,
  WorkflowTransitionRequest,
  WorkflowTransitionResponse,
  ListViewsResponse,
  GetViewResponse,
  CreateViewRequest,
  CreateViewResponse,
  UpdateViewRequest,
  UpdateViewResponse,
  DeleteViewResponse,
  RegisterDeviceRequest,
  RegisterDeviceResponse,
  UnregisterDeviceResponse,
  GetNotificationPreferencesResponse,
  UpdateNotificationPreferencesRequest,
  UpdateNotificationPreferencesResponse,
  ListNotificationsResponse,
  MarkNotificationsReadResponse,
  MarkAllNotificationsReadResponse,
  AiNlqRequest,
  AiNlqResponse,
  AiSuggestRequest,
  AiSuggestResponse,
  AiInsightsRequest,
  AiInsightsResponse,
  GetLocalesResponse,
  GetTranslationsResponse,
  GetFieldLabelsResponse,
  RegisterRequest,
  GetFeedResponse,
  CreateFeedItemResponse,
  UpdateFeedItemResponse,
  DeleteFeedItemResponse,
  AddReactionResponse,
  RemoveReactionResponse,
  PinFeedItemResponse,
  UnpinFeedItemResponse,
  StarFeedItemResponse,
  UnstarFeedItemResponse,
  SearchFeedResponse,
  GetChangelogResponse,
  SubscribeResponse,
  UnsubscribeResponse,
  WellKnownCapabilities,
  ApiRoutes,
  ImportRequest,
  ImportResponse,
  CreateImportJobRequest,
  CreateImportJobResponse,
  ImportJobProgress,
  ImportJobResults,
  ImportJobSummary,
  ListImportJobsRequest,
  ListImportJobsResponse,
  UndoImportJobResponse,
} from '@objectstack/spec/api';
import type {
  ApprovalRequestRow,
  ApprovalActionRow,
  ApprovalStatus,
  ApprovalDecisionResult,
} from '@objectstack/spec/contracts';
import { Logger, createLogger } from '@objectstack/core/logger';
import { RealtimeAPI } from './realtime-api';

/**
 * Route types that the client can resolve.
 * Covers all keys from `ApiRoutes` (the discovery schema) plus
 * client-specific virtual routes (`views`, `permissions`).
 */
export type ApiRouteType = keyof ApiRoutes | 'views' | 'permissions';

export interface ClientConfig {
  baseUrl: string;
  token?: string;
  /**
   * Custom fetch implementation (e.g. node-fetch or for Next.js caching)
   */
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /**
   * Logger instance for debugging
   */
  logger?: Logger;
  /**
   * Enable debug logging
   */
  debug?: boolean;
  /**
   * Active project id (UUID of `sys_environment`). When present, the
   * client injects an `X-Environment-Id` header on every request so the
   * server's tenant router can resolve the physical data-plane database.
   *
   * @see docs/adr/0002-project-database-isolation.md
   */
  environmentId?: string;
  /**
   * Active UI locale (BCP-47, e.g. `'zh-CN'`). When set, the client sends
   * it as an `Accept-Language` header on every request so the server
   * resolves metadata translations (object/field labels, view headers,
   * action text) for the *in-app* language rather than the browser default.
   *
   * Apps should keep this in sync with their language switcher via
   * {@link ObjectStackClient.setLocale} so switching language re-fetches
   * localized metadata without a page refresh (issue #1319).
   */
  locale?: string;
}

/**
 * Discovery Result
 * Re-export from @objectstack/spec/api for convenience
 */
export type DiscoveryResult = GetDiscoveryResponse;

/**
 * @deprecated Use `data.query()` with standard QueryAST parameters instead.
 * This interface uses legacy parameter names (filter/sort/top/skip) that
 * require translation to QueryAST. Prefer QueryAST fields directly:
 *   - filter → where
 *   - select → fields
 *   - sort → orderBy
 *   - skip → offset
 *   - top → limit
 */
export interface QueryOptions {
  select?: string[]; // Simplified Selection
  /** @canonical Preferred filter parameter (singular). */
  filter?: Record<string, any> | unknown[]; // Map or AST
  /** @deprecated Use `filter` (singular). Kept for backward compatibility. */
  filters?: Record<string, any> | unknown[]; // Map or AST
  sort?: string | string[] | SortNode[]; // 'name' or ['-created_at'] or AST
  top?: number;
  skip?: number;
  // Advanced features
  aggregations?: AggregationNode[];
  groupBy?: string[];
}

/**
 * Canonical query options using Spec protocol field names.
 * This is the recommended interface for `data.find()` queries.
 *
 *  Canonical field mapping (QueryAST-aligned):
 *   - `where`   — filter conditions (replaces legacy `filter`/`filters`)
 *   - `fields`  — field selection  (replaces legacy `select`)
 *   - `orderBy` — sort definition  (replaces legacy `sort`)
 *   - `limit`   — max records      (replaces legacy `top`)
 *   - `offset`  — skip records     (replaces legacy `skip`)
 *   - `expand`  — relation loading (replaces legacy `populate`)
 */
export interface QueryOptionsV2 {
  /** Filter conditions (WHERE clause). Accepts MongoDB-style $op object or FilterCondition AST. */
  where?: Record<string, any> | unknown[];
  /** Fields to retrieve (SELECT clause). */
  fields?: string[];
  /** Sort definition (ORDER BY clause). */
  orderBy?: string | string[] | SortNode[];
  /** Maximum number of records to return (LIMIT). */
  limit?: number;
  /** Number of records to skip (OFFSET). */
  offset?: number;
  /** Relations to expand (JOIN / eager-load). */
  expand?: Record<string, any> | string[];
  /** Aggregation functions. */
  aggregations?: AggregationNode[];
  /** Group by fields. */
  groupBy?: string[];
}

export interface PaginatedResult<T = any> {
  /** Spec-compliant: array of matching records */
  records: T[];
  /** Total number of matching records (if requested) */
  total?: number;
  /** The object name */
  object?: string;
  /** Whether more records are available */
  hasMore?: boolean;
}

/** Spec: GetDataResponseSchema */
export interface GetDataResult<T = any> {
  object: string;
  id: string;
  record: T;
}

/** Spec: CreateDataResponseSchema */
export interface CreateDataResult<T = any> {
  object: string;
  id: string;
  record: T;
}

/** Spec: UpdateDataResponseSchema */
export interface UpdateDataResult<T = any> {
  object: string;
  id: string;
  record: T;
}

/** Spec: DeleteDataResponseSchema */
export interface DeleteDataResult {
  object: string;
  id: string;
  deleted: boolean;
}

export interface StandardError {
  code: StandardErrorCode;
  message: string;
  category: ErrorCategory;
  httpStatus: number;
  retryable: boolean;
  details?: Record<string, any>;
}

export class ObjectStackClient {
  private baseUrl: string;
  private token?: string;
  private environmentId?: string;
  private locale?: string;
  private fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  private discoveryInfo?: DiscoveryResult;
  private logger: Logger;
  private realtimeAPI: RealtimeAPI;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.token = config.token;
    this.environmentId = config.environmentId;
    this.locale = config.locale;
    this.fetchImpl = config.fetch || globalThis.fetch.bind(globalThis);

    // Initialize logger
    this.logger = config.logger || createLogger({
      level: config.debug ? 'debug' : 'info',
      format: 'pretty'
    });

    // Initialize realtime API
    this.realtimeAPI = new RealtimeAPI(this.baseUrl, this.token);

    this.logger.debug('ObjectStack client created', { baseUrl: this.baseUrl });
  }

  /**
   * Initialize the client by discovering server capabilities.
   */
  async connect() {
    this.logger.debug('Connecting to ObjectStack server', { baseUrl: this.baseUrl });

    try {
      let data: DiscoveryResult | undefined;

      // 1. Try Protocol-standard Discovery Path /api/v1/discovery (primary)
      try {
        const discoveryUrl = `${this.baseUrl}/api/v1/discovery`;
        this.logger.debug('Probing protocol-standard discovery endpoint', { url: discoveryUrl });
        const res = await this.fetchImpl(discoveryUrl);
        if (res.ok) {
          const body = await res.json();
          data = body.data || body;
          this.logger.debug('Discovered via /api/v1/discovery');
        }
      } catch (e) {
        this.logger.debug('Protocol-standard discovery probe failed', { error: (e as Error).message });
      }

      // 2. Fallback to Standard Discovery (.well-known)
      if (!data) {
        let wellKnownUrl: string;
        try {
          // If baseUrl is absolute, get origin
          const url = new URL(this.baseUrl);
          wellKnownUrl = `${url.origin}/.well-known/objectstack`;
        } catch {
          // If baseUrl is relative, use absolute path from root
          wellKnownUrl = '/.well-known/objectstack';
        }

        this.logger.debug('Falling back to .well-known discovery', { url: wellKnownUrl });
        const res = await this.fetchImpl(wellKnownUrl);
        if (!res.ok) {
           throw new Error(`Failed to connect to ${wellKnownUrl}: ${res.statusText}`);
        }
        const body = await res.json();
        data = body.data || body;
      }

      if (!data) {
         throw new Error('Connection failed: No discovery data returned');
      }

      this.discoveryInfo = data;

      this.logger.info('Connected to ObjectStack server', {
        version: data.version,
        apiName: data.apiName,
        services: data.services
      });

      return data as DiscoveryResult;
    } catch (e) {
      this.logger.error('Failed to connect to ObjectStack server', e as Error, { baseUrl: this.baseUrl });
      throw e;
    }
  }

  /**
   * Well-known capability flags discovered from the server.
   * Returns undefined if the client has not yet connected or the server
   * did not include capabilities in its discovery response.
   *
   * The server may return capabilities in hierarchical format
   * `{ key: { enabled: boolean } }` or flat boolean format `{ key: boolean }`.
   * This getter normalizes both to flat `WellKnownCapabilities`.
   */
  get capabilities(): WellKnownCapabilities | undefined {
    const raw = this.discoveryInfo?.capabilities;
    if (!raw) return undefined;
    // Normalize: hierarchical { enabled: boolean } → flat boolean
    const result: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(raw)) {
      result[key] = typeof value === 'object' && value !== null ? !!(value as any).enabled : !!value;
    }
    return result as unknown as WellKnownCapabilities;
  }

  /**
   * Metadata Operations
   */
  meta = {
    /**
     * Get all available metadata types
     * Returns types like 'object', 'plugin', 'view', etc.
     */
    getTypes: async (): Promise<GetMetaTypesResponse> => {
        const route = this.getRoute('metadata');
        const res = await this.fetch(`${this.baseUrl}${route}`);
        return this.unwrapResponse<GetMetaTypesResponse>(res);
    },

    /**
     * Get all items of a specific metadata type
     * @param type - Metadata type name (e.g., 'object', 'plugin')
     * @param options - Optional filters (e.g., packageId to scope by package)
     */
    getItems: async (type: string, options?: { packageId?: string }): Promise<GetMetaItemsResponse> => {
        const route = this.getRoute('metadata');
        const params = new URLSearchParams();
        if (options?.packageId) params.set('package', options.packageId);
        const qs = params.toString();
        const url = `${this.baseUrl}${route}/${type}${qs ? `?${qs}` : ''}`;
        const res = await this.fetch(url);
        return this.unwrapResponse<GetMetaItemsResponse>(res);
    },

    /**
     * Get a specific metadata item by type and name
     * @param type - Metadata type (e.g., 'object', 'plugin')
     * @param name - Item name (snake_case identifier)
     * @param options - Optional filters (e.g., packageId to scope by package)
     */
    getItem: async (type: string, name: string, options?: { packageId?: string }) => {
        const route = this.getRoute('metadata');
        const params = new URLSearchParams();
        if (options?.packageId) params.set('package', options.packageId);
        const qs = params.toString();
        const url = `${this.baseUrl}${route}/${type}/${name}${qs ? `?${qs}` : ''}`;
        const res = await this.fetch(url);
        return this.unwrapResponse(res);
    },

    /**
     * Save a metadata item
     * @param type - Metadata type (e.g., 'object', 'plugin')
     * @param name - Item name
     * @param item - The metadata content to save
     */
    saveItem: async (type: string, name: string, item: any) => {
        const route = this.getRoute('metadata');
        const res = await this.fetch(`${this.baseUrl}${route}/${type}/${name}`, {
            method: 'PUT',
            body: JSON.stringify(item)
        });
        return this.unwrapResponse(res);
    },

    /**
     * Delete a metadata item
     * @param type - Metadata type (e.g., 'object', 'plugin')
     * @param name - Item name (snake_case identifier)
     */
    deleteItem: async (type: string, name: string): Promise<{ type: string; name: string; deleted: boolean }> => {
        const route = this.getRoute('metadata');
        const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(type)}/${encodeURIComponent(name)}`, {
            method: 'DELETE',
        });
        return this.unwrapResponse(res);
    },

    /**
     * Get the durable change-log for a specific metadata item.
     * Returns events recorded in `sys_metadata_history` for every
     * overlay put/delete, ordered by `event_seq` ascending. Non-overlay
     * metadata types return an empty list.
     */
    getHistory: async (
        type: string,
        name: string,
        options?: { sinceSeq?: number; limit?: number },
    ): Promise<{ events: Array<{
        seq: number;
        op: string;
        ref: { org?: string; type: string; name: string };
        hash: string | null;
        parentHash: string | null;
        actor: string;
        message?: string;
        ts: string;
        source: string;
    }> }> => {
        const route = this.getRoute('metadata');
        const params = new URLSearchParams();
        if (options?.sinceSeq !== undefined) params.set('sinceSeq', String(options.sinceSeq));
        if (options?.limit !== undefined) params.set('limit', String(options.limit));
        const qs = params.toString();
        const url = `${this.baseUrl}${route}/${encodeURIComponent(type)}/${encodeURIComponent(name)}/history${qs ? `?${qs}` : ''}`;
        const res = await this.fetch(url);
        return this.unwrapResponse(res);
    },
    
    /**
     * Get object metadata with cache support
     * Supports ETag-based conditional requests for efficient caching
     */
    getCached: async (name: string, cacheOptions?: MetadataCacheRequest): Promise<MetadataCacheResponse> => {
        const route = this.getRoute('metadata');
        const headers: Record<string, string> = {};
        
        if (cacheOptions?.ifNoneMatch) {
          headers['If-None-Match'] = cacheOptions.ifNoneMatch;
        }
        if (cacheOptions?.ifModifiedSince) {
          headers['If-Modified-Since'] = cacheOptions.ifModifiedSince;
        }
        
        const res = await this.fetch(`${this.baseUrl}${route}/object/${name}`, {
          headers
        });
        
        // Check for 304 Not Modified
        if (res.status === 304) {
          return {
            notModified: true,
            etag: cacheOptions?.ifNoneMatch ? { 
              value: cacheOptions.ifNoneMatch.replace(/^W\/|"/g, ''),
              weak: cacheOptions.ifNoneMatch.startsWith('W/')
            } : undefined
          };
        }
        
        const data = await res.json();
        const etag = res.headers.get('ETag');
        const lastModified = res.headers.get('Last-Modified');
        
        return {
          data,
          etag: etag ? { 
            value: etag.replace(/^W\/|"/g, ''), 
            weak: etag.startsWith('W/') 
          } : undefined,
          lastModified: lastModified || undefined,
          notModified: false
        };
    },
    
    getView: async (object: string, type: 'list' | 'form' = 'list') => {
        const route = this.getRoute('ui');
        const res = await this.fetch(`${this.baseUrl}${route}/view/${object}?type=${type}`);
        return this.unwrapResponse(res);
    }
  };

  /**
   * Analytics Services
   */
  analytics = {
    query: async (payload: any) => {
      const route = this.getRoute('analytics');
      const res = await this.fetch(`${this.baseUrl}${route}/query`, {
         method: 'POST',
         body: JSON.stringify(payload)
      });
      return res.json();
    },
    meta: async (cube: string) => {
        const route = this.getRoute('analytics');
        const res = await this.fetch(`${this.baseUrl}${route}/meta/${cube}`);
        return res.json();
    },
    explain: async (payload: any) => {
        const route = this.getRoute('analytics');
        const res = await this.fetch(`${this.baseUrl}${route}/explain`, {
            method: 'POST',
            body: JSON.stringify(payload)
         });
         return res.json();
    }
  };

  /**
   * Package Management Services
   * 
   * Manages the lifecycle of installed packages.
   * A package (ManifestSchema) is the unit of installation.
   * An app (AppSchema) is a UI navigation definition within a package.
   * A package may contain 0, 1, or many apps, or be a pure functionality plugin.
   * 
   * Endpoints:
   * - GET    /packages               → list installed packages
   * - GET    /packages/:id           → get package details  
   * - POST   /packages               → install a package
   * - DELETE  /packages/:id           → uninstall a package
   * - PATCH  /packages/:id/enable    → enable a package
   * - PATCH  /packages/:id/disable   → disable a package
   */
  packages = {
    /**
     * List all installed packages with optional filters.
     */
    list: async (filters?: { status?: string; type?: string; enabled?: boolean }) => {
        const route = this.getRoute('packages');
        const params = new URLSearchParams();
        if (filters?.status) params.set('status', filters.status);
        if (filters?.type) params.set('type', filters.type);
        if (filters?.enabled !== undefined) params.set('enabled', String(filters.enabled));
        const qs = params.toString();
        const url = `${this.baseUrl}${route}${qs ? '?' + qs : ''}`;
        const res = await this.fetch(url);
        return this.unwrapResponse<{ packages: any[]; total: number }>(res);
    },

    /**
     * Get a specific installed package by its ID (reverse domain identifier).
     */
    get: async (id: string) => {
        const route = this.getRoute('packages');
        const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(id)}`);
        return this.unwrapResponse<{ package: any }>(res);
    },

    /**
     * Install a new package from its manifest.
     */
    install: async (manifest: any, options?: { settings?: Record<string, any>; enableOnInstall?: boolean }) => {
        const route = this.getRoute('packages');
        const res = await this.fetch(`${this.baseUrl}${route}`, {
            method: 'POST',
            body: JSON.stringify({
                manifest,
                settings: options?.settings,
                enableOnInstall: options?.enableOnInstall,
            }),
        });
        return this.unwrapResponse<{ package: any; message?: string }>(res);
    },

    /**
     * Uninstall a package by its ID.
     */
    uninstall: async (id: string) => {
        const route = this.getRoute('packages');
        const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(id)}`, {
            method: 'DELETE',
        });
        return this.unwrapResponse<{ id: string; success: boolean; message?: string }>(res);
    },

    /**
     * Enable a disabled package.
     */
    enable: async (id: string) => {
        const route = this.getRoute('packages');
        const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(id)}/enable`, {
            method: 'PATCH',
        });
        return this.unwrapResponse<{ package: any; message?: string }>(res);
    },

    /**
     * Disable an installed package.
     */
    disable: async (id: string) => {
        const route = this.getRoute('packages');
        const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(id)}/disable`, {
            method: 'PATCH',
        });
        return this.unwrapResponse<{ package: any; message?: string }>(res);
    },
  };

  /**
   * Environment Management Services
   *
   * Environments are the v4.1+ isolation primitive — each project owns a
   * physically separate data-plane database. All Studio-level switching goes
   * through this API.
   *
   * Endpoints:
   * - GET    /api/v1/cloud/environments            → list environments
   * - GET    /api/v1/cloud/environments/:id        → get one (with database info)
   * - POST   /api/v1/cloud/environments            → provision a new project
   * - PATCH  /api/v1/cloud/environments/:id        → update (displayName, plan, status, …)
   * - POST   /api/v1/cloud/environments/:id/activate → set as session's active project
   * - POST   /api/v1/cloud/environments/:id/credentials/rotate → rotate credential
   *
   * @see docs/adr/0002-project-database-isolation.md
   */
  projects = {
    /**
     * List environments visible to the current session. Optionally filter
     * by organization (control-plane query — not routed through a data-plane DB).
     */
    list: async (filters?: { organization_id?: string; env_type?: string; status?: string }) => {
      const params = new URLSearchParams();
      if (filters?.organization_id) params.set('organizationId', filters.organization_id);
      if (filters?.env_type) params.set('envType', filters.env_type);
      if (filters?.status) params.set('status', filters.status);
      const qs = params.toString();
      const url = `${this.baseUrl}/api/v1/cloud/environments${qs ? '?' + qs : ''}`;
      const res = await this.fetch(url);
      return this.unwrapResponse<{ projects: any[]; total: number }>(res);
    },

    /**
     * Get a single project (joined with its database and membership row).
     */
    get: async (id: string) => {
      const res = await this.fetch(`${this.baseUrl}/api/v1/cloud/environments/${encodeURIComponent(id)}`);
      return this.unwrapResponse<{
        project: any;
        database?: any;
        credential?: any;
        membership?: any;
        organization?: any;
      }>(res);
    },

    /**
     * Provision a new project. Delegates to
     * `ProjectProvisioningService.provisionProject` on the server.
     */
    create: async (req: {
      organization_id: string;
      slug?: string;
      display_name: string;
      env_type?: string;
      project_type?: string;
      plan?: string;
      region?: string;
      driver?: string;
      is_default?: boolean;
      is_system?: boolean;
      storage_limit_mb?: number;
      clone_from_environment_id?: string;
      template_id?: string;
      metadata?: Record<string, unknown>;
    }) => {
      const res = await this.fetch(`${this.baseUrl}/api/v1/cloud/environments`, {
        method: 'POST',
        body: JSON.stringify(req),
      });
      return this.unwrapResponse<{ project: any; database: any }>(res);
    },

    /**
     * Update a project (display_name, plan, status, is_default, metadata).
     */
    update: async (id: string, patch: Record<string, unknown>) => {
      const res = await this.fetch(`${this.baseUrl}/api/v1/cloud/environments/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      return this.unwrapResponse<{ project: any }>(res);
    },

    /**
     * Cascade-delete a project: cleans up credential/member/package_installation
     * rows, releases the physical database via the provisioning adapter, and
     * removes the `sys_environment` row. Default projects require `force: true`.
     */
    delete: async (id: string, opts?: { force?: boolean }) => {
      const qs = opts?.force ? '?force=1' : '';
      const res = await this.fetch(
        `${this.baseUrl}/api/v1/cloud/environments/${encodeURIComponent(id)}${qs}`,
        { method: 'DELETE' },
      );
      return this.unwrapResponse<{ deleted: boolean; environmentId: string; warnings: string[] }>(res);
    },

    /**
     * Activate this project for the current session. The server writes
     * `active_environment_id` on the better-auth session; subsequent requests
     * are routed to this project's database.
     */
    activate: async (id: string) => {
      const res = await this.fetch(`${this.baseUrl}/api/v1/cloud/environments/${encodeURIComponent(id)}/activate`, {
        method: 'POST',
      });
      return this.unwrapResponse<{ project: any; sessionUpdated: boolean }>(res);
    },

    /**
     * Rotate the active database credential for this project.
     */
    rotateCredential: async (id: string, plaintext: string) => {
      const res = await this.fetch(`${this.baseUrl}/api/v1/cloud/environments/${encodeURIComponent(id)}/credentials/rotate`, {
        method: 'POST',
        body: JSON.stringify({ plaintext }),
      });
      return this.unwrapResponse<{ credential: any }>(res);
    },

    /**
     * Update the hostname bound to this project. Validates format and
     * uniqueness server-side; invalidates the dispatcher's routing cache.
     */
    updateHostname: async (id: string, hostname: string) => {
      const res = await this.fetch(`${this.baseUrl}/api/v1/cloud/environments/${encodeURIComponent(id)}/hostname`, {
        method: 'POST',
        body: JSON.stringify({ hostname }),
      });
      return this.unwrapResponse<{ project: any }>(res);
    },

    /**
     * Update the visibility of this project ('private' | 'public').
     * `private` (default) hides the project from /pub/v1 enumeration but
     * still allows anonymous artifact downloads when the URL includes an
     * exact `?commit=<id>` (share-by-link). `public` lists the project and
     * freely exposes all revisions.
     */
    updateVisibility: async (id: string, visibility: 'private' | 'public') => {
      const res = await this.fetch(`${this.baseUrl}/api/v1/cloud/environments/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ visibility }),
      });
      return this.unwrapResponse<{ project: any }>(res);
    },

    /**
     * List published artifact revisions for a project. Each revision has
     * an immutable commitId (content-addressable) and storage_key.
     * Optional `branch` filter narrows to a single logical branch
     * (default branch `main` also matches rows with NULL `branch`).
     */
    listRevisions: async (id: string, opts?: { limit?: number; cursor?: string; branch?: string }) => {
      const params = new URLSearchParams();
      if (opts?.limit) params.set('limit', String(opts.limit));
      if (opts?.cursor) params.set('cursor', opts.cursor);
      if (opts?.branch) params.set('branch', opts.branch);
      const qs = params.toString();
      const res = await this.fetch(
        `${this.baseUrl}/api/v1/cloud/environments/${encodeURIComponent(id)}/revisions${qs ? `?${qs}` : ''}`,
      );
      return this.unwrapResponse<{
        items: Array<{
          commitId: string;
          checksum: string;
          storageKey: string;
          sizeBytes: number;
          builtAt: string;
          publishedAt: string;
          publishedBy: string | null;
          note: string | null;
          isCurrent: boolean;
          branch: string;
          isBranchHead: boolean;
        }>;
        nextCursor: string | null;
        branch: string | null;
      }>(res);
    },

    /**
     * List logical branches for a project. Each branch has a head commit
     * (latest published revision on that branch) and a count of revisions.
     * Branches without a head row (e.g. all rows demoted) are omitted.
     */
    listBranches: async (id: string) => {
      const res = await this.fetch(
        `${this.baseUrl}/api/v1/cloud/environments/${encodeURIComponent(id)}/branches`,
      );
      return this.unwrapResponse<{
        environmentId: string;
        branches: Array<{
          branch: string;
          headCommitId: string;
          headRevisionId: string;
          revisionCount: number;
          headPublishedAt: string | null;
          headNote: string | null;
          isCurrent: boolean;
        }>;
      }>(res);
    },

    /**
     * Rename a branch. Updates every revision row in `from` to `to`.
     * 409 if `to` already has rows.
     */
    renameBranch: async (id: string, from: string, to: string) => {
      const res = await this.fetch(
        `${this.baseUrl}/api/v1/cloud/environments/${encodeURIComponent(id)}/branches/${encodeURIComponent(from)}/rename`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ newName: to }),
        },
      );
      return this.unwrapResponse<{ environmentId: string; from: string; to: string; renamed: number }>(res);
    },

    /**
     * Delete (demote) a branch. Soft-removal — clears `is_branch_head` on
     * every row in this branch; the revisions themselves remain. The
     * `main` branch and any branch carrying the active revision cannot be
     * deleted.
     */
    deleteBranch: async (id: string, name: string) => {
      const res = await this.fetch(
        `${this.baseUrl}/api/v1/cloud/environments/${encodeURIComponent(id)}/branches/${encodeURIComponent(name)}`,
        { method: 'DELETE' },
      );
      return this.unwrapResponse<{ environmentId: string; branch: string; demoted: number; totalRevisions: number }>(res);
    },

    /**
     * Retry provisioning for a project stuck in `failed` (or
     * `provisioning`) state. The server re-runs the driver handshake; on
     * success the project flips to `active`, on failure it stays
     * `failed` with `metadata.provisioningError` updated.
     */
    retryProvisioning: async (id: string) => {
      const res = await this.fetch(`${this.baseUrl}/api/v1/cloud/environments/${encodeURIComponent(id)}/retry`, {
        method: 'POST',
      });
      return this.unwrapResponse<{ project: any }>(res);
    },

    /**
     * List ObjectQL drivers registered on the server. Useful for populating a
     * driver selector when provisioning a new project (memory / turso /
     * future sql drivers). Returned `name` is the short alias (e.g. `memory`,
     * `turso`); `driverId` is the full FQN (e.g. `com.objectstack.driver.memory`).
     */
    listDrivers: async () => {
      const res = await this.fetch(`${this.baseUrl}/api/v1/cloud/drivers`);
      return this.unwrapResponse<{ drivers: Array<{ name: string; driverId: string }>; total: number }>(res);
    },

    /**
     * List available project templates. Templates are seeded into the project
     * database once at provisioning time when `template_id` is supplied.
     */
    listTemplates: async () => {
      const res = await this.fetch(`${this.baseUrl}/api/v1/cloud/templates`);
      return this.unwrapResponse<{ templates: Array<{ id: string; label: string; description: string; category?: string }>; total: number }>(res);
    },

    /**
     * Per-project package installation management (Power Apps "solution" model).
     * Install records are stored in the environment's own database.
     */
    packages: {
      /** List all packages installed in a specific project. */
      list: async (envId: string) => {
        const res = await this.fetch(`${this.baseUrl}/api/v1/cloud/environments/${encodeURIComponent(envId)}/packages`);
        return this.unwrapResponse<{ packages: any[]; total: number }>(res);
      },

      /** Install a package into the project. */
      install: async (envId: string, body: {
        packageId: string;
        version?: string;
        settings?: Record<string, unknown>;
        enableOnInstall?: boolean;
      }) => {
        const res = await this.fetch(`${this.baseUrl}/api/v1/cloud/environments/${encodeURIComponent(envId)}/packages`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        return this.unwrapResponse<{ package: any }>(res);
      },

      /** Get a single installation record. */
      get: async (envId: string, pkgId: string) => {
        const res = await this.fetch(`${this.baseUrl}/api/v1/cloud/environments/${encodeURIComponent(envId)}/packages/${encodeURIComponent(pkgId)}`);
        return this.unwrapResponse<{ package: any }>(res);
      },

      /** Enable a previously disabled package. */
      enable: async (envId: string, pkgId: string) => {
        const res = await this.fetch(`${this.baseUrl}/api/v1/cloud/environments/${encodeURIComponent(envId)}/packages/${encodeURIComponent(pkgId)}/enable`, {
          method: 'PATCH',
        });
        return this.unwrapResponse<{ package: any }>(res);
      },

      /** Disable an installed package (metadata will not be loaded). */
      disable: async (envId: string, pkgId: string) => {
        const res = await this.fetch(`${this.baseUrl}/api/v1/cloud/environments/${encodeURIComponent(envId)}/packages/${encodeURIComponent(pkgId)}/disable`, {
          method: 'PATCH',
        });
        return this.unwrapResponse<{ package: any }>(res);
      },

      /** Uninstall a package from the project. Forbidden for scope=platform packages. */
      uninstall: async (envId: string, pkgId: string) => {
        const res = await this.fetch(`${this.baseUrl}/api/v1/cloud/environments/${encodeURIComponent(envId)}/packages/${encodeURIComponent(pkgId)}`, {
          method: 'DELETE',
        });
        return this.unwrapResponse<{ id: string; success: boolean }>(res);
      },

      /** Upgrade an installed package to a newer version. */
      upgrade: async (envId: string, pkgId: string, targetVersion?: string) => {
        const res = await this.fetch(`${this.baseUrl}/api/v1/cloud/environments/${encodeURIComponent(envId)}/packages/${encodeURIComponent(pkgId)}/upgrade`, {
          method: 'POST',
          body: JSON.stringify({ targetVersion }),
        });
        return this.unwrapResponse<{ package: any }>(res);
      },
    },
  };

  /**
   * Project-scoped client factory.
   *
   * Returns a thin wrapper around the data / meta / packages namespaces that
   * prefixes every request with `/api/v1/environments/:environmentId/...`. Use this
   * when the server has `enableProjectScoping: true` in its REST API config.
   *
   * Backward compatibility: `client.data.*`, `client.meta.*`, and
   * `client.packages.*` continue to work unchanged; they hit unscoped routes
   * and rely on hostname / `X-Environment-Id` header / session resolution.
   *
   * @example
   * ```ts
   * const scoped = client.project('00000000-0000-0000-0000-000000000001');
   * const tasks = await scoped.data.find('task', { top: 10 });
   * const objects = await scoped.meta.getItems('object');
   * ```
   */
  project(environmentId: string): ScopedProjectClient {
    if (!environmentId) {
      throw new Error('[ObjectStack] project(id): environmentId is required');
    }
    return new ScopedProjectClient(this, environmentId);
  }

  // ── Internal accessors exposed to ScopedProjectClient ────────────────
  // The scoped client lives in the same module so using module-level access
  // works; TypeScript requires these to be accessible, so we expose them via
  // small protected getters that keep the public surface unchanged.
  /** @internal */
  _baseUrl(): string { return this.baseUrl; }
  /** @internal */
  _fetch(url: string, init?: RequestInit): Promise<Response> {
    return this.fetch(url, init);
  }
  /** @internal */
  _unwrap<T>(res: Response): Promise<T> { return this.unwrapResponse<T>(res); }
  /** @internal */
  _isFilterAST(v: unknown): boolean { return this.isFilterAST(v); }

  /**
   * Organization Services
   *
   * Thin wrapper around better-auth's organization plugin endpoints, which
   * are mounted under `/api/v1/auth/organization/**`. Used by the Studio
   * OrganizationSwitcher and the /orgs management routes.
   */
  organizations = {
    /**
     * List organizations the current user belongs to.
     * GET /api/v1/auth/organization/list
     */
    list: async () => {
      const route = this.getRoute('auth');
      const res = await this.fetch(`${this.baseUrl}${route}/organization/list`);
      const data = await res.json();
      // better-auth returns the array directly, sometimes wrapped in { data }.
      const orgs = Array.isArray(data) ? data : (data?.data ?? []);
      return { organizations: orgs as Array<{ id: string; name: string; slug?: string; logo?: string; metadata?: any }> };
    },

    /**
     * Create a new organization.
     * POST /api/v1/auth/organization/create
     */
    create: async (req: { name: string; slug?: string; logo?: string; metadata?: Record<string, unknown> }) => {
      const route = this.getRoute('auth');
      const res = await this.fetch(`${this.baseUrl}${route}/organization/create`, {
        method: 'POST',
        body: JSON.stringify(req),
      });
      return res.json();
    },

    /**
     * Update an existing organization.
     * POST /api/v1/auth/organization/update
     *
     * better-auth requires the caller to be an owner/admin (server-side
     * enforcement); the body shape is `{ organizationId, data: {...} }`.
     */
    update: async (
      organizationId: string,
      data: { name?: string; slug?: string; logo?: string; metadata?: Record<string, unknown> },
    ) => {
      const route = this.getRoute('auth');
      const res = await this.fetch(`${this.baseUrl}${route}/organization/update`, {
        method: 'POST',
        body: JSON.stringify({ organizationId, data }),
      });
      return res.json();
    },

    /**
     * Set the active organization on the current session. The server writes
     * `activeOrganizationId` on the better-auth session, which downstream
     * handlers (e.g. `EnvironmentProvisioningService`) consult.
     *
     * POST /api/v1/auth/organization/set-active
     */
    setActive: async (organizationId: string) => {
      const route = this.getRoute('auth');
      const res = await this.fetch(`${this.baseUrl}${route}/organization/set-active`, {
        method: 'POST',
        body: JSON.stringify({ organizationId }),
      });
      return res.json();
    },

    /**
     * Get full organization detail (members, invitations, teams).
     * GET /api/v1/auth/organization/get-full-organization?organizationId=...
     */
    get: async (organizationId: string) => {
      const route = this.getRoute('auth');
      const res = await this.fetch(
        `${this.baseUrl}${route}/organization/get-full-organization?organizationId=${encodeURIComponent(organizationId)}`,
      );
      return res.json();
    },

    /**
     * List members of an organization.
     */
    listMembers: async (organizationId: string) => {
      const route = this.getRoute('auth');
      const res = await this.fetch(
        `${this.baseUrl}${route}/organization/list-members?organizationId=${encodeURIComponent(organizationId)}`,
      );
      return res.json();
    },

    /**
     * Invite a user to the organization.
     */
    invite: async (req: { email: string; role?: string; organizationId?: string }) => {
      const route = this.getRoute('auth');
      const res = await this.fetch(`${this.baseUrl}${route}/organization/invite-member`, {
        method: 'POST',
        body: JSON.stringify(req),
      });
      return res.json();
    },

    /**
     * Leave the given organization.
     */
    leave: async (organizationId: string) => {
      const route = this.getRoute('auth');
      const res = await this.fetch(`${this.baseUrl}${route}/organization/leave`, {
        method: 'POST',
        body: JSON.stringify({ organizationId }),
      });
      return res.json();
    },

    /**
     * Delete an organization via better-auth's organization plugin.
     *
     * POST /api/v1/auth/organization/delete
     *
     * better-auth removes the organization row, all members, and all
     * pending invitations. Project teardown (per-project DBs, etc.) is
     * handled server-side by hooks attached to the organization plugin.
     */
    delete: async (organizationId: string) => {
      const route = this.getRoute('auth');
      const res = await this.fetch(`${this.baseUrl}${route}/organization/delete`, {
        method: 'POST',
        body: JSON.stringify({ organizationId }),
      });
      return res.json();
    },

    /**
     * Remove a member from an organization.
     *
     * better-auth: POST /organization/remove-member
     * Body: `{ memberIdOrEmail, organizationId? }` — note the parameter is the
     * **member id** (the row id from `member` table) or the user's email; it
     * is *not* the bare `userId`. Server enforces owner/admin permission.
     */
    removeMember: async (
      organizationId: string,
      params: { memberIdOrEmail: string },
    ) => {
      const route = this.getRoute('auth');
      const res = await this.fetch(`${this.baseUrl}${route}/organization/remove-member`, {
        method: 'POST',
        body: JSON.stringify({ memberIdOrEmail: params.memberIdOrEmail, organizationId }),
      });
      return res.json();
    },

    /**
     * Change a member's role in an organization (owner/admin only).
     *
     * better-auth: POST /organization/update-member-role
     * Body: `{ memberId, role, organizationId? }`. The `memberId` is the
     * `member` table row id (not user id). `role` is one of the configured
     * organisation roles (default: `owner | admin | member`).
     */
    updateMemberRole: async (
      organizationId: string,
      params: { memberId: string; role: string },
    ) => {
      const route = this.getRoute('auth');
      const res = await this.fetch(`${this.baseUrl}${route}/organization/update-member-role`, {
        method: 'POST',
        body: JSON.stringify({ memberId: params.memberId, role: params.role, organizationId }),
      });
      return res.json();
    },

    /**
     * Look up the calling user's membership row in the given organisation.
     * Useful for permission checks on the client without having to scan the
     * full member list.
     *
     * better-auth: GET /organization/get-active-member?organizationId=…
     */
    getActiveMember: async (organizationId: string) => {
      const route = this.getRoute('auth');
      const res = await this.fetch(
        `${this.baseUrl}${route}/organization/get-active-member?organizationId=${encodeURIComponent(organizationId)}`,
      );
      return res.json();
    },

    /**
     * Invitation lifecycle — wraps better-auth's organization-plugin
     * invitation endpoints. Always go through here instead of writing to
     * `sys_invitation` via the data API: the better-auth writers handle
     * status transitions, expiry, dedupe, and the `sendInvitationEmail`
     * side-effect that the auth-manager wires up.
     */
    invitations: {
      /**
       * List pending/accepted/canceled invitations for an organization.
       * Requires owner/admin role on that org.
       *
       * better-auth: GET /organization/list-invitations?organizationId=…
       */
      list: async (organizationId: string) => {
        const route = this.getRoute('auth');
        const res = await this.fetch(
          `${this.baseUrl}${route}/organization/list-invitations?organizationId=${encodeURIComponent(organizationId)}`,
        );
        const data = await res.json();
        const invitations = Array.isArray(data) ? data : (data?.data ?? data?.invitations ?? []);
        return { invitations: invitations as Array<{
          id: string;
          email: string;
          role: string;
          status: 'pending' | 'accepted' | 'rejected' | 'canceled';
          organizationId: string;
          inviterId: string;
          expiresAt: string;
          teamId?: string | null;
        }> };
      },

      /**
       * List the **current user's** incoming invitations across every
       * organisation. Used by the per-user "Invitations" inbox page.
       *
       * better-auth: GET /organization/list-user-invitations
       */
      listMine: async () => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/organization/list-user-invitations`);
        const data = await res.json();
        const invitations = Array.isArray(data) ? data : (data?.data ?? data?.invitations ?? []);
        return { invitations: invitations as Array<{
          id: string;
          email: string;
          role: string;
          status: string;
          organizationId: string;
          inviterId: string;
          expiresAt: string;
        }> };
      },

      /** better-auth: POST /organization/cancel-invitation */
      cancel: async (invitationId: string) => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/organization/cancel-invitation`, {
          method: 'POST',
          body: JSON.stringify({ invitationId }),
        });
        return res.json();
      },

      /** better-auth: POST /organization/accept-invitation */
      accept: async (invitationId: string) => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/organization/accept-invitation`, {
          method: 'POST',
          body: JSON.stringify({ invitationId }),
        });
        return res.json();
      },

      /** better-auth: POST /organization/reject-invitation */
      reject: async (invitationId: string) => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/organization/reject-invitation`, {
          method: 'POST',
          body: JSON.stringify({ invitationId }),
        });
        return res.json();
      },

      /**
       * "Resend" an invitation. better-auth has no first-class resend
       * endpoint, so we implement it as cancel-then-invite: cancel the old
       * row (so its status flips to `canceled` and audit hooks fire), then
       * issue a fresh invite. The new invite re-runs `sendInvitationEmail`
       * on the server, so the recipient gets a brand-new accept URL.
       *
       * If `cancel()` fails (e.g. invite already accepted) the error is
       * re-thrown without re-inviting.
       */
      resend: async (
        invitation: { id?: string; email: string; role?: string; organizationId: string; teamId?: string | null },
      ) => {
        if (invitation.id) {
          try {
            await this.organizations.invitations.cancel(invitation.id);
          } catch {
            // Best-effort: ignore "already canceled / accepted" so the
            // re-invite still goes out.
          }
        }
        return this.organizations.invite({
          email: invitation.email,
          role: invitation.role ?? 'member',
          organizationId: invitation.organizationId,
        });
      },
    },

    /**
     * Team management — only available when the organisation plugin is
     * configured with `teams: { enabled: true }` on the server. Calls return
     * a 4xx if teams aren't enabled; UI should hide the section in that case.
     */
    teams: {
      /** better-auth: GET /organization/list-teams?organizationId=… */
      list: async (organizationId: string) => {
        const route = this.getRoute('auth');
        const res = await this.fetch(
          `${this.baseUrl}${route}/organization/list-teams?organizationId=${encodeURIComponent(organizationId)}`,
        );
        const data = await res.json();
        const teams = Array.isArray(data) ? data : (data?.data ?? data?.teams ?? []);
        return { teams: teams as Array<{ id: string; name: string; organizationId: string; createdAt?: string }> };
      },

      /** better-auth: POST /organization/create-team */
      create: async (req: { name: string; organizationId: string }) => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/organization/create-team`, {
          method: 'POST',
          body: JSON.stringify(req),
        });
        return res.json();
      },

      /** better-auth: POST /organization/update-team */
      update: async (params: { teamId: string; data: { name?: string } }) => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/organization/update-team`, {
          method: 'POST',
          body: JSON.stringify(params),
        });
        return res.json();
      },

      /** better-auth: POST /organization/remove-team */
      delete: async (params: { teamId: string; organizationId?: string }) => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/organization/remove-team`, {
          method: 'POST',
          body: JSON.stringify(params),
        });
        return res.json();
      },

      /** better-auth: GET /organization/list-team-members?teamId=… */
      listMembers: async (teamId: string) => {
        const route = this.getRoute('auth');
        const res = await this.fetch(
          `${this.baseUrl}${route}/organization/list-team-members?teamId=${encodeURIComponent(teamId)}`,
        );
        const data = await res.json();
        const members = Array.isArray(data) ? data : (data?.data ?? data?.members ?? []);
        return { members: members as Array<{ id: string; teamId: string; userId: string }> };
      },

      /** better-auth: POST /organization/add-team-member */
      addMember: async (params: { teamId: string; userId: string }) => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/organization/add-team-member`, {
          method: 'POST',
          body: JSON.stringify(params),
        });
        return res.json();
      },

      /** better-auth: POST /organization/remove-team-member */
      removeMember: async (params: { teamId: string; userId: string }) => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/organization/remove-team-member`, {
          method: 'POST',
          body: JSON.stringify(params),
        });
        return res.json();
      },
    },
  };

  /**
   * OAuth / OpenID Connect Provider — admin endpoints exposed by
   * `@better-auth/oauth-provider` (when enabled on the server). Lets users
   * register their own OAuth client applications, list them, and revoke them.
   *
   * All endpoints are mounted under the auth route, e.g. `/api/v1/auth/oauth2/*`.
   */
  oauth = {
    applications: {
      /**
       * Register a new OAuth client application.
       * POST /api/v1/auth/oauth2/create-client (authenticated)
       *
       * Returns the freshly-issued `client_id` and `client_secret`.
       * The secret is only returned at creation time — store it securely.
       */
      register: async (req: {
        client_name?: string;
        name?: string;
        redirect_uris: string[];
        token_endpoint_auth_method?: 'none' | 'client_secret_basic' | 'client_secret_post';
        grant_types?: string[];
        response_types?: string[];
        client_uri?: string;
        logo_uri?: string;
        scope?: string;
        scopes?: string[];
        contacts?: string[];
        tos_uri?: string;
        policy_uri?: string;
        metadata?: Record<string, unknown>;
      }) => {
        const route = this.getRoute('auth');
        // The new oauth-provider package exposes `/oauth2/create-client`
        // (authenticated dynamic registration). The legacy `/oauth2/register`
        // endpoint is now disabled by default for security and only
        // available when the server explicitly opts in via the
        // `allowUnauthenticatedClientRegistration` option.
        const res = await this.fetch(`${this.baseUrl}${route}/oauth2/create-client`, {
          method: 'POST',
          body: JSON.stringify(req),
        });
        return res.json();
      },

      /**
       * Get a single OAuth application by its `client_id`.
       * GET /api/v1/auth/oauth2/get-client?client_id=...
       */
      get: async (clientId: string) => {
        const route = this.getRoute('auth');
        const res = await this.fetch(
          `${this.baseUrl}${route}/oauth2/get-client?client_id=${encodeURIComponent(clientId)}`,
        );
        return res.json();
      },

      /**
       * Get a single OAuth application's public fields (no auth required
       * once the user has signed in). Used by the consent screen.
       * GET /api/v1/auth/oauth2/public-client?client_id=...
       */
      getPublic: async (clientId: string) => {
        const route = this.getRoute('auth');
        const res = await this.fetch(
          `${this.baseUrl}${route}/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`,
        );
        return res.json();
      },

      /**
       * List OAuth applications visible to the current user.
       *
       * Uses `@better-auth/oauth-provider`'s `/oauth2/get-clients` endpoint
       * which returns clients owned by the current user (and their
       * organization, if applicable).
       */
      list: async () => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/oauth2/get-clients`);
        const data = await res.json();
        const items = Array.isArray(data) ? data : data?.clients ?? data?.data ?? [];
        return { applications: items as Array<Record<string, any>> };
      },

      /**
       * Delete an OAuth application by its `client_id`.
       * POST /api/v1/auth/oauth2/delete-client
       *
       * Tokens and consents referencing the client cascade-delete via the
       * better-auth schema's `onDelete: cascade` foreign keys.
       */
      delete: async (clientId: string) => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/oauth2/delete-client`, {
          method: 'POST',
          body: JSON.stringify({ client_id: clientId }),
        });
        return res.json();
      },
    },

    /**
     * Submit the user's decision to a pending consent request.
     * POST /api/v1/auth/oauth2/consent
     *
     * Called by the consent screen after the user accepts or denies. The
     * `oauth_query` is the raw query string of the consent page URL — it
     * carries the signed authorization request that the consent endpoint
     * verifies before issuing the authorization code.
     */
    consent: async (req: { accept: boolean; scope?: string; oauth_query?: string }) => {
      const route = this.getRoute('auth');
      const res = await this.fetch(`${this.baseUrl}${route}/oauth2/consent`, {
        method: 'POST',
        body: JSON.stringify(req),
      });
      return res.json();
    },
  };

  /**
   * Update the active project id used for subsequent requests.
   * Pass `undefined` to clear (falls back to the session default).
   */
  setProjectId(environmentId: string | undefined): void {
    this.environmentId = environmentId;
    this.logger.debug('Active project changed', { environmentId });
  }

  /**
   * Current active project id (if set).
   */
  getProjectId(): string | undefined {
    return this.environmentId;
  }

  /**
   * Update the active UI locale used for subsequent requests. Apps should
   * call this from their language switcher so server-translated metadata
   * (object/field labels, view headers, action text) follows the in-app
   * language without a page refresh. Pass `undefined` to clear and fall
   * back to the browser's `Accept-Language` (issue #1319).
   */
  setLocale(locale: string | undefined): void {
    this.locale = locale;
    this.logger.debug('Active locale changed', { locale });
  }

  /**
   * Current active UI locale (if set).
   */
  getLocale(): string | undefined {
    return this.locale;
  }

  /**
   * Authentication Services
   */
  auth = {
    /**
     * Get authentication configuration
     * Returns available auth providers and features
     */
    getConfig: async () => {
      const route = this.getRoute('auth');
      const res = await this.fetch(`${this.baseUrl}${route}/config`);
      return this.unwrapResponse(res);
    },

    /**
     * Login with email and password
     * Uses better-auth endpoint: POST /sign-in/email
     */
    login: async (request: LoginRequest): Promise<SessionResponse> => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/sign-in/email`, {
            method: 'POST',
            headers: { Origin: this.baseUrl },
            body: JSON.stringify(request)
        });
        const raw = await res.json().catch(() => ({}));
        if (!res.ok) {
            // better-auth signals errors via non-2xx status with `{ code, message }`.
            // Throw so callers can `try/catch` (e.g. detect EMAIL_NOT_VERIFIED and
            // redirect to the resend-verification page) instead of silently
            // receiving a normalized-looking response with no token.
            const message = raw?.message || raw?.error?.message || `Login failed (HTTP ${res.status})`;
            const err = new Error(message) as Error & { code?: string; status?: number };
            if (raw?.code) err.code = raw.code;
            err.status = res.status;
            throw err;
        }
        // Normalize: better-auth returns `{ token, user }` at top level,
        // but our SessionResponse shape wraps them in `data`.
        const data = raw && (raw.data ?? (raw.token || raw.user ? { token: raw.token, user: raw.user } : undefined));
        const normalized = data ? { ...raw, data } : raw;
        // Auto-set token if present in response
        if (normalized.data?.token) {
            this.token = normalized.data.token;
        }
        return normalized;
    },
    
    /**
     * Logout current user
     * Uses better-auth endpoint: POST /sign-out
     */
    logout: async () => {
        const route = this.getRoute('auth');
        await this.fetch(`${this.baseUrl}${route}/sign-out`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: this.baseUrl },
            body: '{}',
        });
        this.token = undefined;
    },

    /**
     * Get current user session
     * Uses better-auth endpoint: GET /get-session
     */
    me: async (): Promise<SessionResponse> => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/get-session`, {
            headers: { Origin: this.baseUrl },
        });
        return res.json();
    },

    /**
     * Register a new user account
     * Uses better-auth endpoint: POST /sign-up/email
     */
    register: async (request: RegisterRequest): Promise<SessionResponse> => {
      const route = this.getRoute('auth');
      const res = await this.fetch(`${this.baseUrl}${route}/sign-up/email`, {
        method: 'POST',
        headers: { Origin: this.baseUrl },
        body: JSON.stringify(request)
      });
      const raw = await res.json();
      const data = raw && (raw.data ?? (raw.token || raw.user ? { token: raw.token, user: raw.user } : undefined));
      const normalized = data ? { ...raw, data } : raw;
      if (normalized.data?.token) {
        this.token = normalized.data.token;
      }
      return normalized;
    },

    /**
     * Initiate OAuth sign-in via a social or OIDC provider.
     *
     * - Social providers (Google, GitHub, etc.): calls POST /sign-in/social with `{ provider }`.
     * - OIDC/enterprise providers: calls POST /sign-in/oauth2 with `{ providerId }`.
     *
     * After the provider callback better-auth sets the session cookie and redirects to `callbackURL`.
     *
     * The default `callbackURL` is the CURRENT page (`window.location.href`),
     * not a hard-coded `/login`: the SDK cannot know the app's mount path (the
     * Console lives under `/_console`, others differ), so returning the user to
     * where they started is the only base-path-correct default. This mirrors
     * `linkSocial`. Pass an explicit `callbackURL` to land somewhere else.
     */
    signInWithProvider: async (
      provider: string,
      opts?: { callbackURL?: string; errorCallbackURL?: string; type?: 'social' | 'oidc' },
    ): Promise<void> => {
      if (typeof window === 'undefined') {
        throw new Error('signInWithProvider requires a browser environment');
      }
      const route = this.getRoute('auth');
      const callbackURL = opts?.callbackURL ?? window.location.href;
      const isOidc = opts?.type === 'oidc';
      const endpoint = isOidc ? '/sign-in/oauth2' : '/sign-in/social';
      const body: Record<string, string> = isOidc
        ? { providerId: provider, callbackURL }
        : { provider, callbackURL };
      if (opts?.errorCallbackURL) body.errorCallbackURL = opts.errorCallbackURL;
      const res = await this.fetch(`${this.baseUrl}${route}${endpoint}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      const redirectUrl = data?.url ?? data?.data?.url;
      if (redirectUrl) {
        window.location.assign(redirectUrl);
      } else {
        throw new Error(`signInWithProvider: no redirect URL returned for provider "${provider}"`);
      }
    },

    /**
     * Refresh an authentication token
     * Note: better-auth handles token refresh automatically via /get-session
     * @param _refreshToken - Not used (better-auth handles refresh automatically)
     */
    refreshToken: async (_refreshToken: string): Promise<SessionResponse> => {
      const route = this.getRoute('auth');
      // better-auth doesn't have a separate refresh endpoint
      // Session refresh is handled automatically when calling /get-session
      const res = await this.fetch(`${this.baseUrl}${route}/get-session`, {
        method: 'GET'
      });
      const data = await res.json();
      if (data.data?.token) {
        this.token = data.data.token;
      }
      return data;
    },

    /**
     * Probe the framework-only `/auth/bootstrap-status` endpoint to determine
     * whether the very first owner has been provisioned. The Account portal's
     * `/setup` route uses this to decide whether to render the bootstrap form
     * or bounce the user straight to `/login`.
     */
    bootstrapStatus: async (): Promise<{ hasOwner: boolean }> => {
      const route = this.getRoute('auth');
      const res = await this.fetch(`${this.baseUrl}${route}/bootstrap-status`);
      const data = await res.json();
      // Endpoint may or may not be wrapped in `{ data }`.
      const payload = (data?.data ?? data) as { hasOwner?: boolean };
      return { hasOwner: !!payload?.hasOwner };
    },

    /**
     * Update the current user's profile.
     *
     * better-auth: POST /update-user — accepts `{ name?, image?, ... }`
     * (any custom user fields configured on the server). Returns the
     * updated user.
     */
    updateUser: async (data: { name?: string; image?: string | null; [key: string]: unknown }) => {
      const route = this.getRoute('auth');
      const res = await this.fetch(`${this.baseUrl}${route}/update-user`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return res.json();
    },

    /**
     * Change the current user's password (email/password accounts only).
     *
     * better-auth: POST /change-password.
     * Set `revokeOtherSessions: true` to invalidate every other session
     * after the change.
     */
    changePassword: async (req: {
      currentPassword: string;
      newPassword: string;
      revokeOtherSessions?: boolean;
    }) => {
      const route = this.getRoute('auth');
      const res = await this.fetch(`${this.baseUrl}${route}/change-password`, {
        method: 'POST',
        body: JSON.stringify(req),
      });
      return res.json();
    },

    /**
     * Begin a change-email flow. better-auth sends a verification mail to
     * the new address; the change only takes effect after the user clicks
     * the link.
     *
     * better-auth: POST /change-email — `{ newEmail, callbackURL? }`.
     */
    changeEmail: async (req: { newEmail: string; callbackURL?: string }) => {
      const route = this.getRoute('auth');
      const res = await this.fetch(`${this.baseUrl}${route}/change-email`, {
        method: 'POST',
        body: JSON.stringify(req),
      });
      return res.json();
    },

    /**
     * Re-send the email-verification link to the current user (or any
     * address when called as an admin). better-auth: POST /send-verification-email.
     */
    sendVerificationEmail: async (req: { email: string; callbackURL?: string }) => {
      const route = this.getRoute('auth');
      const res = await this.fetch(`${this.baseUrl}${route}/send-verification-email`, {
        method: 'POST',
        body: JSON.stringify(req),
      });
      return res.json();
    },

    /**
     * Verify an email-verification token (the link target).
     *
     * better-auth: GET /verify-email?token=…&callbackURL=…
     */
    verifyEmail: async (params: { token: string; callbackURL?: string }) => {
      const route = this.getRoute('auth');
      const url = new URL(`${this.baseUrl}${route}/verify-email`);
      url.searchParams.set('token', params.token);
      if (params.callbackURL) url.searchParams.set('callbackURL', params.callbackURL);
      const res = await this.fetch(url.toString());
      return res.json();
    },

    /**
     * Permanently delete the current user. better-auth supports two flows:
     *
     *   1. With a fresh-session password challenge: POST `{ password }`.
     *   2. With an emailed deletion-confirmation token: POST `{ token }`,
     *      typically following an out-of-band confirmation step.
     *
     * Server policy decides which is required; pass whichever you have.
     */
    deleteUser: async (req: { password?: string; token?: string; callbackURL?: string }) => {
      const route = this.getRoute('auth');
      const res = await this.fetch(`${this.baseUrl}${route}/delete-user`, {
        method: 'POST',
        body: JSON.stringify(req),
      });
      // Local cleanup mirrors logout(): drop cached bearer token so the next
      // call doesn't try to use a credential for a now-deleted user.
      this.token = undefined;
      return res.json();
    },

    /**
     * Active-session management. Wraps better-auth's session endpoints so
     * the Account portal's `/account/sessions` page can list every device
     * the user is signed in from and revoke them individually or in bulk.
     */
    sessions: {
      /** better-auth: GET /list-sessions — returns the current user's sessions. */
      list: async () => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/list-sessions`);
        const data = await res.json();
        const sessions = Array.isArray(data) ? data : (data?.data ?? data?.sessions ?? []);
        return { sessions: sessions as Array<{
          id: string;
          token: string;
          userId: string;
          userAgent?: string;
          ipAddress?: string;
          createdAt: string;
          expiresAt: string;
        }> };
      },

      /** better-auth: POST /revoke-session — revoke a single session by token. */
      revoke: async (token: string) => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/revoke-session`, {
          method: 'POST',
          body: JSON.stringify({ token }),
        });
        return res.json();
      },

      /** better-auth: POST /revoke-other-sessions — keep current, kill the rest. */
      revokeOthers: async () => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/revoke-other-sessions`, {
          method: 'POST',
          body: '{}',
        });
        return res.json();
      },

      /** better-auth: POST /revoke-sessions — kill every session for this user. */
      revokeAll: async () => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/revoke-sessions`, {
          method: 'POST',
          body: '{}',
        });
        // Local cleanup — current session is gone too.
        this.token = undefined;
        return res.json();
      },
    },

    /**
     * Two-factor authentication (TOTP + backup codes). Requires the
     * `twoFactor` plugin to be enabled on the server (see
     * `plugin-auth` config). Endpoints live under `/two-factor/*`.
     */
    twoFactor: {
      /**
       * Start enrolment. Server returns a TOTP URI (`otpauth://...`) which
       * the UI renders as a QR code; the user then calls `verifyTotp` to
       * confirm and finish enabling.
       */
      enable: async (req: { password: string }): Promise<{ totpURI?: string; backupCodes?: string[] }> => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/two-factor/enable`, {
          method: 'POST',
          body: JSON.stringify(req),
        });
        const data = await res.json();
        return (data?.data ?? data) as { totpURI?: string; backupCodes?: string[] };
      },

      /**
       * Confirm a TOTP code — used to finalise enrolment after `enable()`
       * or to step up an existing 2FA-enabled session. `trustDevice` (when
       * supported by the server config) suppresses the 2FA challenge on
       * this browser for the configured trust period.
       */
      verifyTotp: async (req: { code: string; trustDevice?: boolean }) => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/two-factor/verify-totp`, {
          method: 'POST',
          body: JSON.stringify(req),
        });
        return res.json();
      },

      /** Disable 2FA for the current user. Requires the password again. */
      disable: async (req: { password: string }) => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/two-factor/disable`, {
          method: 'POST',
          body: JSON.stringify(req),
        });
        return res.json();
      },

      /**
       * Issue a fresh set of backup codes (invalidating any previous set).
       * Display them once — the server only stores hashes.
       */
      generateBackupCodes: async (req: { password: string }): Promise<{ backupCodes: string[] }> => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/two-factor/generate-backup-codes`, {
          method: 'POST',
          body: JSON.stringify(req),
        });
        const data = await res.json();
        return (data?.data ?? data) as { backupCodes: string[] };
      },

      /**
       * Verify a 2FA backup code in lieu of a TOTP. Useful as a recovery
       * affordance when the user has lost their authenticator app.
       */
      verifyBackupCode: async (req: { code: string }) => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/two-factor/verify-backup-code`, {
          method: 'POST',
          body: JSON.stringify(req),
        });
        return res.json();
      },
    },

    /**
     * Linked credentials — i.e. the rows in better-auth's `account` table
     * (one per provider × user). Lets the user see and unlink their social
     * / OIDC connections from the Account portal.
     */
    accounts: {
      /** better-auth: GET /list-accounts */
      list: async () => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/list-accounts`);
        const data = await res.json();
        const accounts = Array.isArray(data) ? data : (data?.data ?? data?.accounts ?? []);
        return { accounts: accounts as Array<{
          id: string;
          providerId: string;
          accountId: string;
          createdAt?: string;
          updatedAt?: string;
        }> };
      },

      /**
       * Unlink a provider connection.
       * better-auth: POST /unlink-account — `{ providerId, accountId? }`.
       * `accountId` is required when the user has more than one account
       * for the same provider.
       */
      unlink: async (req: { providerId: string; accountId?: string }) => {
        const route = this.getRoute('auth');
        const res = await this.fetch(`${this.baseUrl}${route}/unlink-account`, {
          method: 'POST',
          body: JSON.stringify(req),
        });
        return res.json();
      },

      /**
       * Link an additional social provider to the current user.
       * better-auth: POST /link-social — `{ provider, callbackURL }`. The
       * server returns a redirect URL; the caller should `window.location`
       * to it (mirroring `signInWithProvider`).
       */
      linkSocial: async (req: { provider: string; callbackURL?: string }): Promise<{ url?: string }> => {
        const route = this.getRoute('auth');
        const callbackURL = req.callbackURL
          ?? (typeof window !== 'undefined' ? window.location.href : undefined);
        const res = await this.fetch(`${this.baseUrl}${route}/link-social`, {
          method: 'POST',
          body: JSON.stringify({ provider: req.provider, callbackURL }),
        });
        const data = await res.json();
        return (data?.data ?? data) as { url?: string };
      },
    },
  };

  /**
   * Storage Services
   */
  storage = {
    upload: async (file: any, scope: string = 'user'): Promise<FileUploadResponse> => {
        // 1. Get Presigned URL
        const presignedReq: GetPresignedUrlRequest = {
            filename: file.name,
            mimeType: file.type,
            size: file.size,
            scope
        };
        
        const route = this.getRoute('storage');
        const presignedRes = await this.fetch(`${this.baseUrl}${route}/upload/presigned`, {
            method: 'POST',
            body: JSON.stringify(presignedReq)
        });
        const { data: presigned } = await presignedRes.json() as { data: PresignedUrlResponse['data'] };

        // 2. Upload to Cloud directly (Bypass API Middleware to avoid Auth headers if using S3)
        // Use fetchImpl directly
        const uploadRes = await this.fetchImpl(presigned.uploadUrl, {
            method: presigned.method,
            headers: presigned.headers,
            body: file
        });

        if (!uploadRes.ok) {
            throw new Error(`Storage Upload Failed: ${uploadRes.statusText}`);
        }

        // 3. Complete Upload
        const completeReq: CompleteUploadRequest = {
            fileId: presigned.fileId
        };
        const completeRes = await this.fetch(`${this.baseUrl}${route}/upload/complete`, {
            method: 'POST',
            body: JSON.stringify(completeReq)
        });
        
        return completeRes.json();
    },
    
    getDownloadUrl: async (fileId: string): Promise<string> => {
        const route = this.getRoute('storage');
        const res = await this.fetch(`${this.baseUrl}${route}/files/${fileId}/url`);
        const data = await res.json();
        return data.url;
    },

    /**
     * Get a presigned URL for direct-to-cloud upload
     */
    getPresignedUrl: async (req: GetPresignedUrlRequest): Promise<PresignedUrlResponse> => {
        const route = this.getRoute('storage');
        const res = await this.fetch(`${this.baseUrl}${route}/upload/presigned`, {
            method: 'POST',
            body: JSON.stringify(req)
        });
        return res.json();
    },

    /**
     * Initiate a chunked (multipart) upload session
     */
    initChunkedUpload: async (req: InitiateChunkedUploadRequest): Promise<InitiateChunkedUploadResponse> => {
        const route = this.getRoute('storage');
        const res = await this.fetch(`${this.baseUrl}${route}/upload/chunked`, {
            method: 'POST',
            body: JSON.stringify(req)
        });
        return res.json();
    },

    /**
     * Upload a single chunk/part of a multipart upload
     */
    uploadPart: async (uploadId: string, chunkIndex: number, resumeToken: string, data: Blob | Buffer): Promise<UploadChunkResponse> => {
        const route = this.getRoute('storage');
        const res = await this.fetch(`${this.baseUrl}${route}/upload/chunked/${uploadId}/chunk/${chunkIndex}`, {
            method: 'PUT',
            headers: { 'x-resume-token': resumeToken },
            body: data as any
        });
        return res.json();
    },

    /**
     * Complete a chunked upload by assembling all parts
     */
    completeChunkedUpload: async (req: CompleteChunkedUploadRequest): Promise<CompleteChunkedUploadResponse> => {
        const route = this.getRoute('storage');
        const res = await this.fetch(`${this.baseUrl}${route}/upload/chunked/${req.uploadId}/complete`, {
            method: 'POST',
            body: JSON.stringify(req)
        });
        return res.json();
    },

    /**
     * Resume an interrupted chunked upload.
     * Fetches current progress, then uploads remaining chunks and completes.
     */
    resumeUpload: async (uploadId: string, file: Blob | ArrayBuffer, chunkSize: number, resumeToken: string): Promise<CompleteChunkedUploadResponse> => {
        const route = this.getRoute('storage');

        // 1. Get current progress
        const progressRes = await this.fetch(`${this.baseUrl}${route}/upload/chunked/${uploadId}/progress`);
        const progress = await progressRes.json() as UploadProgress;

        const { totalChunks, uploadedChunks } = progress.data;
        const parts: Array<{ chunkIndex: number; eTag: string }> = [];

        // 2. Upload remaining chunks
        const fileBuffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
        for (let i = uploadedChunks; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, fileBuffer.byteLength);
            const chunk = new Blob([fileBuffer.slice(start, end)]);

            const chunkRes = await this.storage.uploadPart(uploadId, i, resumeToken, chunk);
            parts.push({ chunkIndex: i, eTag: chunkRes.data.eTag });
        }

        // 3. Complete
        return this.storage.completeChunkedUpload({ uploadId, parts });
    },
  };

  /**
   * Automation Services
   */
  automation = {
      /**
       * Trigger a named automation flow (legacy endpoint)
       */
      trigger: async (triggerName: string, payload: any) => {
          const route = this.getRoute('automation');
          const res = await this.fetch(`${this.baseUrl}${route}/trigger/${triggerName}`, {
              method: 'POST',
              body: JSON.stringify(payload)
          });
          return res.json();
      },

      /**
       * List all registered automation flows
       */
      list: async (): Promise<{ flows: string[]; total: number; hasMore: boolean }> => {
          const route = this.getRoute('automation');
          const res = await this.fetch(`${this.baseUrl}${route}`);
          return this.unwrapResponse(res);
      },

      /**
       * Get a flow definition by name
       */
      get: async (name: string): Promise<any> => {
          const route = this.getRoute('automation');
          const res = await this.fetch(`${this.baseUrl}${route}/${name}`);
          return this.unwrapResponse(res);
      },

      /**
       * Create (register) a new flow
       */
      create: async (name: string, definition: any): Promise<any> => {
          const route = this.getRoute('automation');
          const res = await this.fetch(`${this.baseUrl}${route}`, {
              method: 'POST',
              body: JSON.stringify({ name, ...definition }),
          });
          return this.unwrapResponse(res);
      },

      /**
       * Update an existing flow
       */
      update: async (name: string, definition: any): Promise<any> => {
          const route = this.getRoute('automation');
          const res = await this.fetch(`${this.baseUrl}${route}/${name}`, {
              method: 'PUT',
              body: JSON.stringify({ definition }),
          });
          return this.unwrapResponse(res);
      },

      /**
       * Delete (unregister) a flow
       */
      delete: async (name: string): Promise<{ name: string; deleted: boolean }> => {
          const route = this.getRoute('automation');
          const res = await this.fetch(`${this.baseUrl}${route}/${name}`, {
              method: 'DELETE',
          });
          return this.unwrapResponse(res);
      },

      /**
       * Enable or disable a flow
       */
      toggle: async (name: string, enabled: boolean): Promise<{ name: string; enabled: boolean }> => {
          const route = this.getRoute('automation');
          const res = await this.fetch(`${this.baseUrl}${route}/${name}/toggle`, {
              method: 'POST',
              body: JSON.stringify({ enabled }),
          });
          return this.unwrapResponse(res);
      },

      /**
       * Execution run history
       */
      runs: {
          /**
           * List execution runs for a flow
           */
          list: async (flowName: string, options?: { limit?: number; cursor?: string }): Promise<{ runs: any[]; hasMore: boolean }> => {
              const route = this.getRoute('automation');
              const params = new URLSearchParams();
              if (options?.limit) params.set('limit', String(options.limit));
              if (options?.cursor) params.set('cursor', options.cursor);
              const qs = params.toString();
              const res = await this.fetch(`${this.baseUrl}${route}/${flowName}/runs${qs ? `?${qs}` : ''}`);
              return this.unwrapResponse(res);
          },

          /**
           * Get a single execution run
           */
          get: async (flowName: string, runId: string): Promise<any> => {
              const route = this.getRoute('automation');
              const res = await this.fetch(`${this.baseUrl}${route}/${flowName}/runs/${runId}`);
              return this.unwrapResponse(res);
          },
      },

      /**
       * Flat aliases mirroring the ScopedProjectClient.automation surface so
       * Studio (and other consumers) can use the same call shape regardless of
       * whether they hold a scoped or unscoped client.
       */
      /** Alias for `automation.get` — fetch a flow definition by name. */
      getFlow: async <T = any>(name: string): Promise<T> => {
          const route = this.getRoute('automation');
          const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(name)}`);
          return this.unwrapResponse(res) as Promise<T>;
      },
      /** Execute (trigger) a flow with an execution context. */
      execute: async <T = any>(name: string, ctx?: Record<string, any>): Promise<T> => {
          const route = this.getRoute('automation');
          const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(name)}/trigger`, {
              method: 'POST',
              body: JSON.stringify(ctx ?? {}),
          });
          return this.unwrapResponse(res) as Promise<T>;
      },
      /** Alias for `automation.runs.list`. */
      listRuns: async <T = any>(
          flowName: string,
          opts?: { limit?: number; cursor?: string },
      ): Promise<T> => {
          const route = this.getRoute('automation');
          const params = new URLSearchParams();
          if (opts?.limit != null) params.set('limit', String(opts.limit));
          if (opts?.cursor) params.set('cursor', opts.cursor);
          const qs = params.toString();
          const res = await this.fetch(
              `${this.baseUrl}${route}/${encodeURIComponent(flowName)}/runs${qs ? `?${qs}` : ''}`,
          );
          return this.unwrapResponse(res) as Promise<T>;
      },
      /** Alias for `automation.runs.get`. */
      getRun: async <T = any>(flowName: string, runId: string): Promise<T> => {
          const route = this.getRoute('automation');
          const res = await this.fetch(
              `${this.baseUrl}${route}/${encodeURIComponent(flowName)}/runs/${encodeURIComponent(runId)}`,
          );
          return this.unwrapResponse(res) as Promise<T>;
      },
  };

  /**
   * Event Subscription API
   * Provides real-time event subscriptions for metadata and data changes
   */
  get events() {
    return this.realtimeAPI;
  }

  /**
   * Permissions Services
   */
  permissions = {
    /**
     * Check if current user has permission for an action on an object
     */
    check: async (request: CheckPermissionRequest): Promise<CheckPermissionResponse> => {
      const route = this.getRoute('permissions');
      const params = new URLSearchParams({ object: request.object, action: request.action });
      if (request.recordId !== undefined) params.set('recordId', request.recordId);
      if (request.field !== undefined) params.set('field', request.field);
      const res = await this.fetch(`${this.baseUrl}${route}/check?${params.toString()}`);
      return this.unwrapResponse<CheckPermissionResponse>(res);
    },

    /**
     * Get all permissions for a specific object
     */
    getObjectPermissions: async (object: string): Promise<GetObjectPermissionsResponse> => {
      const route = this.getRoute('permissions');
      const res = await this.fetch(`${this.baseUrl}${route}/objects/${encodeURIComponent(object)}`);
      return this.unwrapResponse<GetObjectPermissionsResponse>(res);
    },

    /**
     * Get effective permissions for the current user
     */
    getEffectivePermissions: async (): Promise<GetEffectivePermissionsResponse> => {
      const route = this.getRoute('permissions');
      const res = await this.fetch(`${this.baseUrl}${route}/effective`);
      return this.unwrapResponse<GetEffectivePermissionsResponse>(res);
    }
  };

  /**
   * Realtime Services
   */
  realtime = {
    /**
     * Establish a realtime connection
     */
    connect: async (request?: RealtimeConnectRequest): Promise<RealtimeConnectResponse> => {
      const route = this.getRoute('realtime');
      const res = await this.fetch(`${this.baseUrl}${route}/connect`, {
        method: 'POST',
        body: JSON.stringify(request || {})
      });
      return this.unwrapResponse<RealtimeConnectResponse>(res);
    },

    /**
     * Disconnect from realtime services
     */
    disconnect: async (): Promise<void> => {
      const route = this.getRoute('realtime');
      await this.fetch(`${this.baseUrl}${route}/disconnect`, {
        method: 'POST'
      });
    },

    /**
     * Subscribe to a channel
     */
    subscribe: async (request: RealtimeSubscribeRequest): Promise<RealtimeSubscribeResponse> => {
      const route = this.getRoute('realtime');
      const res = await this.fetch(`${this.baseUrl}${route}/subscribe`, {
        method: 'POST',
        body: JSON.stringify(request)
      });
      return this.unwrapResponse<RealtimeSubscribeResponse>(res);
    },

    /**
     * Unsubscribe from a channel
     */
    unsubscribe: async (subscriptionId: string): Promise<void> => {
      const route = this.getRoute('realtime');
      await this.fetch(`${this.baseUrl}${route}/unsubscribe`, {
        method: 'POST',
        body: JSON.stringify({ subscriptionId })
      });
    },

    /**
     * Set presence state on a channel
     */
    setPresence: async (channel: string, state: SetPresenceRequest['state']): Promise<void> => {
      const route = this.getRoute('realtime');
      await this.fetch(`${this.baseUrl}${route}/presence`, {
        method: 'PUT',
        body: JSON.stringify({ channel, state })
      });
    },

    /**
     * Get presence information for a channel
     */
    getPresence: async (channel: string): Promise<GetPresenceResponse> => {
      const route = this.getRoute('realtime');
      const res = await this.fetch(`${this.baseUrl}${route}/presence/${encodeURIComponent(channel)}`);
      return this.unwrapResponse<GetPresenceResponse>(res);
    }
  };

  /**
   * Workflow Services
   */
  workflow = {
    /**
     * Get workflow configuration for an object
     */
    getConfig: async (object: string): Promise<GetWorkflowConfigResponse> => {
      const route = this.getRoute('workflow');
      const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(object)}/config`);
      return this.unwrapResponse<GetWorkflowConfigResponse>(res);
    },

    /**
     * Get current workflow state for a record
     */
    getState: async (object: string, recordId: string): Promise<GetWorkflowStateResponse> => {
      const route = this.getRoute('workflow');
      const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}/state`);
      return this.unwrapResponse<GetWorkflowStateResponse>(res);
    },

    /**
     * Execute a workflow state transition
     */
    transition: async (request: WorkflowTransitionRequest): Promise<WorkflowTransitionResponse> => {
      const route = this.getRoute('workflow');
      const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(request.object)}/${encodeURIComponent(request.recordId)}/transition`, {
        method: 'POST',
        body: JSON.stringify({
          transition: request.transition,
          comment: request.comment,
          data: request.data
        })
      });
      return this.unwrapResponse<WorkflowTransitionResponse>(res);
    }
    // ADR-0019: approve/reject are no longer workflow operations. Approval is a
    // flow node — see the `approvals` namespace below for recording decisions.
  };

  /**
   * Approval Services (ADR-0019)
   *
   * Approval is a first-class flow node, not a workflow step: a flow's
   * Approval node opens a request and suspends the run; recording a decision
   * here finalises the request and resumes the owning flow down the matching
   * `approve` / `reject` edge. This namespace drives the "my approvals" inbox
   * and the decision API exposed under `/api/v1/approvals`.
   */
  approvals = {
    /**
     * List approval requests ("my approvals" inbox). Filter by status, target
     * object / record, the user expected to act next, or the submitter.
     */
    listRequests: async (filter?: {
      object?: string;
      recordId?: string;
      status?: ApprovalStatus | ApprovalStatus[];
      approverId?: string | string[];
      submitterId?: string;
    }): Promise<ApprovalRequestRow[]> => {
      const route = this.getRoute('approvals');
      const params = new URLSearchParams();
      if (filter?.object) params.set('object', filter.object);
      if (filter?.recordId) params.set('recordId', filter.recordId);
      if (filter?.status) {
        params.set('status', Array.isArray(filter.status) ? filter.status.join(',') : filter.status);
      }
      if (filter?.approverId) {
        params.set('approverId', Array.isArray(filter.approverId) ? filter.approverId.join(',') : filter.approverId);
      }
      if (filter?.submitterId) params.set('submitterId', filter.submitterId);
      const qs = params.toString();
      const res = await this.fetch(`${this.baseUrl}${route}/requests${qs ? `?${qs}` : ''}`);
      const body = await this.unwrapResponse<{ data?: ApprovalRequestRow[] } | ApprovalRequestRow[]>(res);
      return Array.isArray(body) ? body : (body?.data ?? []);
    },

    /**
     * Get a single approval request by id.
     */
    getRequest: async (requestId: string): Promise<ApprovalRequestRow> => {
      const route = this.getRoute('approvals');
      const res = await this.fetch(`${this.baseUrl}${route}/requests/${encodeURIComponent(requestId)}`);
      return this.unwrapResponse<ApprovalRequestRow>(res);
    },

    /**
     * Record an approve decision on a request. Finalises the request when the
     * node's behaviour is satisfied and resumes the owning flow run.
     */
    approve: async (requestId: string, decision?: { actorId?: string; comment?: string }): Promise<ApprovalDecisionResult> => {
      const route = this.getRoute('approvals');
      const res = await this.fetch(`${this.baseUrl}${route}/requests/${encodeURIComponent(requestId)}/approve`, {
        method: 'POST',
        body: JSON.stringify({ actorId: decision?.actorId, comment: decision?.comment })
      });
      return this.unwrapResponse<ApprovalDecisionResult>(res);
    },

    /**
     * Record a reject decision on a request. Resumes the owning flow run down
     * the `reject` edge.
     */
    reject: async (requestId: string, decision?: { actorId?: string; comment?: string }): Promise<ApprovalDecisionResult> => {
      const route = this.getRoute('approvals');
      const res = await this.fetch(`${this.baseUrl}${route}/requests/${encodeURIComponent(requestId)}/reject`, {
        method: 'POST',
        body: JSON.stringify({ actorId: decision?.actorId, comment: decision?.comment })
      });
      return this.unwrapResponse<ApprovalDecisionResult>(res);
    },

    /**
     * Audit trail (the immutable action log) for an approval request.
     */
    listActions: async (requestId: string): Promise<ApprovalActionRow[]> => {
      const route = this.getRoute('approvals');
      const res = await this.fetch(`${this.baseUrl}${route}/requests/${encodeURIComponent(requestId)}/actions`);
      const body = await this.unwrapResponse<{ data?: ApprovalActionRow[] } | ApprovalActionRow[]>(res);
      return Array.isArray(body) ? body : (body?.data ?? []);
    }
  };

  /**
   * Views CRUD Services
   */
  views = {
    /**
     * List views for an object
     */
    list: async (object: string, type?: 'list' | 'form'): Promise<ListViewsResponse> => {
      const route = this.getRoute('views');
      const params = new URLSearchParams();
      if (type) params.set('type', type);
      const qs = params.toString();
      const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(object)}${qs ? `?${qs}` : ''}`);
      return this.unwrapResponse<ListViewsResponse>(res);
    },

    /**
     * Get a specific view
     */
    get: async (object: string, viewId: string): Promise<GetViewResponse> => {
      const route = this.getRoute('views');
      const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(object)}/${encodeURIComponent(viewId)}`);
      return this.unwrapResponse<GetViewResponse>(res);
    },

    /**
     * Create a new view
     */
    create: async (object: string, data: CreateViewRequest['data']): Promise<CreateViewResponse> => {
      const route = this.getRoute('views');
      const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(object)}`, {
        method: 'POST',
        body: JSON.stringify({ object, data })
      });
      return this.unwrapResponse<CreateViewResponse>(res);
    },

    /**
     * Update an existing view
     */
    update: async (object: string, viewId: string, data: UpdateViewRequest['data']): Promise<UpdateViewResponse> => {
      const route = this.getRoute('views');
      const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(object)}/${encodeURIComponent(viewId)}`, {
        method: 'PUT',
        body: JSON.stringify({ object, viewId, data })
      });
      return this.unwrapResponse<UpdateViewResponse>(res);
    },

    /**
     * Delete a view
     */
    delete: async (object: string, viewId: string): Promise<DeleteViewResponse> => {
      const route = this.getRoute('views');
      const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(object)}/${encodeURIComponent(viewId)}`, {
        method: 'DELETE'
      });
      return this.unwrapResponse<DeleteViewResponse>(res);
    }
  };

  /**
   * Notification Services
   */
  notifications = {
    /**
     * Register a device for push notifications
     */
    registerDevice: async (request: RegisterDeviceRequest): Promise<RegisterDeviceResponse> => {
      const route = this.getRoute('notifications');
      const res = await this.fetch(`${this.baseUrl}${route}/devices`, {
        method: 'POST',
        body: JSON.stringify(request)
      });
      return this.unwrapResponse<RegisterDeviceResponse>(res);
    },

    /**
     * Unregister a device from push notifications
     */
    unregisterDevice: async (deviceId: string): Promise<UnregisterDeviceResponse> => {
      const route = this.getRoute('notifications');
      const res = await this.fetch(`${this.baseUrl}${route}/devices/${encodeURIComponent(deviceId)}`, {
        method: 'DELETE'
      });
      return this.unwrapResponse<UnregisterDeviceResponse>(res);
    },

    /**
     * Get notification preferences for the current user
     */
    getPreferences: async (): Promise<GetNotificationPreferencesResponse> => {
      const route = this.getRoute('notifications');
      const res = await this.fetch(`${this.baseUrl}${route}/preferences`);
      return this.unwrapResponse<GetNotificationPreferencesResponse>(res);
    },

    /**
     * Update notification preferences
     */
    updatePreferences: async (preferences: UpdateNotificationPreferencesRequest['preferences']): Promise<UpdateNotificationPreferencesResponse> => {
      const route = this.getRoute('notifications');
      const res = await this.fetch(`${this.baseUrl}${route}/preferences`, {
        method: 'PUT',
        body: JSON.stringify({ preferences })
      });
      return this.unwrapResponse<UpdateNotificationPreferencesResponse>(res);
    },

    /**
     * List notifications for the current user
     */
    list: async (options?: { read?: boolean; type?: string; limit?: number; cursor?: string }): Promise<ListNotificationsResponse> => {
      const route = this.getRoute('notifications');
      const params = new URLSearchParams();
      if (options?.read !== undefined) params.set('read', String(options.read));
      if (options?.type) params.set('type', options.type);
      if (options?.limit) params.set('limit', String(options.limit));
      if (options?.cursor) params.set('cursor', options.cursor);
      const qs = params.toString();
      const res = await this.fetch(`${this.baseUrl}${route}${qs ? `?${qs}` : ''}`);
      return this.unwrapResponse<ListNotificationsResponse>(res);
    },

    /**
     * Mark specific notifications as read
     */
    markRead: async (ids: string[]): Promise<MarkNotificationsReadResponse> => {
      const route = this.getRoute('notifications');
      const res = await this.fetch(`${this.baseUrl}${route}/read`, {
        method: 'POST',
        body: JSON.stringify({ ids })
      });
      return this.unwrapResponse<MarkNotificationsReadResponse>(res);
    },

    /**
     * Mark all notifications as read
     */
    markAllRead: async (): Promise<MarkAllNotificationsReadResponse> => {
      const route = this.getRoute('notifications');
      const res = await this.fetch(`${this.baseUrl}${route}/read/all`, {
        method: 'POST'
      });
      return this.unwrapResponse<MarkAllNotificationsReadResponse>(res);
    }
  };

  /**
   * AI Services
   */
  ai = {
    /**
     * Natural language query — converts natural language to structured query
     */
    nlq: async (request: AiNlqRequest): Promise<AiNlqResponse> => {
      const route = this.getRoute('ai');
      const res = await this.fetch(`${this.baseUrl}${route}/nlq`, {
        method: 'POST',
        body: JSON.stringify(request)
      });
      return this.unwrapResponse<AiNlqResponse>(res);
    },

    // AI chat method removed — use Vercel AI SDK `useChat()` / `@ai-sdk/react` directly.

    /**
     * AI-powered field value suggestions
     */
    suggest: async (request: AiSuggestRequest): Promise<AiSuggestResponse> => {
      const route = this.getRoute('ai');
      const res = await this.fetch(`${this.baseUrl}${route}/suggest`, {
        method: 'POST',
        body: JSON.stringify(request)
      });
      return this.unwrapResponse<AiSuggestResponse>(res);
    },

    /**
     * AI-powered data insights
     */
    insights: async (request: AiInsightsRequest): Promise<AiInsightsResponse> => {
      const route = this.getRoute('ai');
      const res = await this.fetch(`${this.baseUrl}${route}/insights`, {
        method: 'POST',
        body: JSON.stringify(request)
      });
      return this.unwrapResponse<AiInsightsResponse>(res);
    }
  };

  /**
   * Internationalization Services
   */
  i18n = {
    /**
     * Get available locales
     */
    getLocales: async (): Promise<GetLocalesResponse> => {
      const route = this.getRoute('i18n');
      const res = await this.fetch(`${this.baseUrl}${route}/locales`);
      return this.unwrapResponse<GetLocalesResponse>(res);
    },

    /**
     * Get translations for a locale
     */
    getTranslations: async (locale: string, options?: { namespace?: string; keys?: string[] }): Promise<GetTranslationsResponse> => {
      const route = this.getRoute('i18n');
      const params = new URLSearchParams();
      params.set('locale', locale);
      if (options?.namespace) params.set('namespace', options.namespace);
      if (options?.keys) params.set('keys', options.keys.join(','));
      const res = await this.fetch(`${this.baseUrl}${route}/translations?${params.toString()}`);
      return this.unwrapResponse<GetTranslationsResponse>(res);
    },

    /**
     * Get translated field labels for an object
     */
    getFieldLabels: async (object: string, locale: string): Promise<GetFieldLabelsResponse> => {
      const route = this.getRoute('i18n');
      const res = await this.fetch(`${this.baseUrl}${route}/labels/${encodeURIComponent(object)}?locale=${encodeURIComponent(locale)}`);
      return this.unwrapResponse<GetFieldLabelsResponse>(res);
    }
  };

  /**
   * Feed / Chatter Services
   *
   * Provides access to the activity timeline (comments, field changes, tasks),
   * emoji reactions, pin/star, search, changelog, and record subscriptions.
   * Base path: /api/data/{object}/{recordId}/feed
   */
  feed = {
    /**
     * List feed items for a record
     */
    list: async (object: string, recordId: string, options?: { type?: string; limit?: number; cursor?: string }): Promise<GetFeedResponse> => {
      const route = this.getRoute('data');
      const params = new URLSearchParams();
      if (options?.type) params.set('type', options.type);
      if (options?.limit) params.set('limit', String(options.limit));
      if (options?.cursor) params.set('cursor', options.cursor);
      const qs = params.toString();
      const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}/feed${qs ? `?${qs}` : ''}`);
      return this.unwrapResponse<GetFeedResponse>(res);
    },

    /**
     * Create a new feed item (comment, note, task, etc.)
     */
    create: async (object: string, recordId: string, data: { type: string; body?: string; mentions?: any[]; parentId?: string; visibility?: string }): Promise<CreateFeedItemResponse> => {
      const route = this.getRoute('data');
      const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}/feed`, {
        method: 'POST',
        body: JSON.stringify(data)
      });
      return this.unwrapResponse<CreateFeedItemResponse>(res);
    },

    /**
     * Update an existing feed item
     */
    update: async (object: string, recordId: string, feedId: string, data: { body?: string; mentions?: any[]; visibility?: string }): Promise<UpdateFeedItemResponse> => {
      const route = this.getRoute('data');
      const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}/feed/${encodeURIComponent(feedId)}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
      return this.unwrapResponse<UpdateFeedItemResponse>(res);
    },

    /**
     * Delete a feed item
     */
    delete: async (object: string, recordId: string, feedId: string): Promise<DeleteFeedItemResponse> => {
      const route = this.getRoute('data');
      const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}/feed/${encodeURIComponent(feedId)}`, {
        method: 'DELETE'
      });
      return this.unwrapResponse<DeleteFeedItemResponse>(res);
    },

    /**
     * Add an emoji reaction to a feed item
     */
    addReaction: async (object: string, recordId: string, feedId: string, emoji: string): Promise<AddReactionResponse> => {
      const route = this.getRoute('data');
      const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}/feed/${encodeURIComponent(feedId)}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ emoji })
      });
      return this.unwrapResponse<AddReactionResponse>(res);
    },

    /**
     * Remove an emoji reaction from a feed item
     */
    removeReaction: async (object: string, recordId: string, feedId: string, emoji: string): Promise<RemoveReactionResponse> => {
      const route = this.getRoute('data');
      const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}/feed/${encodeURIComponent(feedId)}/reactions/${encodeURIComponent(emoji)}`, {
        method: 'DELETE'
      });
      return this.unwrapResponse<RemoveReactionResponse>(res);
    },

    /**
     * Pin a feed item to the top of the timeline
     */
    pin: async (object: string, recordId: string, feedId: string): Promise<PinFeedItemResponse> => {
      const route = this.getRoute('data');
      const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}/feed/${encodeURIComponent(feedId)}/pin`, {
        method: 'POST'
      });
      return this.unwrapResponse<PinFeedItemResponse>(res);
    },

    /**
     * Unpin a feed item
     */
    unpin: async (object: string, recordId: string, feedId: string): Promise<UnpinFeedItemResponse> => {
      const route = this.getRoute('data');
      const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}/feed/${encodeURIComponent(feedId)}/pin`, {
        method: 'DELETE'
      });
      return this.unwrapResponse<UnpinFeedItemResponse>(res);
    },

    /**
     * Star (bookmark) a feed item
     */
    star: async (object: string, recordId: string, feedId: string): Promise<StarFeedItemResponse> => {
      const route = this.getRoute('data');
      const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}/feed/${encodeURIComponent(feedId)}/star`, {
        method: 'POST'
      });
      return this.unwrapResponse<StarFeedItemResponse>(res);
    },

    /**
     * Unstar a feed item
     */
    unstar: async (object: string, recordId: string, feedId: string): Promise<UnstarFeedItemResponse> => {
      const route = this.getRoute('data');
      const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}/feed/${encodeURIComponent(feedId)}/star`, {
        method: 'DELETE'
      });
      return this.unwrapResponse<UnstarFeedItemResponse>(res);
    },

    /**
     * Search feed items
     */
    search: async (object: string, recordId: string, query: string, options?: { type?: string; actorId?: string; dateFrom?: string; dateTo?: string; limit?: number; cursor?: string }): Promise<SearchFeedResponse> => {
      const route = this.getRoute('data');
      const params = new URLSearchParams();
      params.set('query', query);
      if (options?.type) params.set('type', options.type);
      if (options?.actorId) params.set('actorId', options.actorId);
      if (options?.dateFrom) params.set('dateFrom', options.dateFrom);
      if (options?.dateTo) params.set('dateTo', options.dateTo);
      if (options?.limit) params.set('limit', String(options.limit));
      if (options?.cursor) params.set('cursor', options.cursor);
      const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}/feed/search?${params.toString()}`);
      return this.unwrapResponse<SearchFeedResponse>(res);
    },

    /**
     * Get field-level changelog for a record
     */
    getChangelog: async (object: string, recordId: string, options?: { field?: string; actorId?: string; dateFrom?: string; dateTo?: string; limit?: number; cursor?: string }): Promise<GetChangelogResponse> => {
      const route = this.getRoute('data');
      const params = new URLSearchParams();
      if (options?.field) params.set('field', options.field);
      if (options?.actorId) params.set('actorId', options.actorId);
      if (options?.dateFrom) params.set('dateFrom', options.dateFrom);
      if (options?.dateTo) params.set('dateTo', options.dateTo);
      if (options?.limit) params.set('limit', String(options.limit));
      if (options?.cursor) params.set('cursor', options.cursor);
      const qs = params.toString();
      const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}/changelog${qs ? `?${qs}` : ''}`);
      return this.unwrapResponse<GetChangelogResponse>(res);
    },

    /**
     * Subscribe to record notifications
     */
    subscribe: async (object: string, recordId: string, options?: { events?: string[]; channels?: string[] }): Promise<SubscribeResponse> => {
      const route = this.getRoute('data');
      const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}/subscribe`, {
        method: 'POST',
        body: JSON.stringify(options || {})
      });
      return this.unwrapResponse<SubscribeResponse>(res);
    },

    /**
     * Unsubscribe from record notifications
     */
    unsubscribe: async (object: string, recordId: string): Promise<UnsubscribeResponse> => {
      const route = this.getRoute('data');
      const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}/subscribe`, {
        method: 'DELETE'
      });
      return this.unwrapResponse<UnsubscribeResponse>(res);
    },
  };

  /**
   * Data Operations
   */
  data = {
    /**
     * Advanced Query using ObjectStack Query Protocol
     * Supports both simplified options and full AST
     */
    query: async <T = any>(object: string, query: Partial<QueryAST>): Promise<PaginatedResult<T>> => {
      const route = this.getRoute('data');
      // POST for complex query to avoid URL length limits and allow clean JSON AST
      // Convention: POST /api/v1/data/:object/query
      const res = await this.fetch(`${this.baseUrl}${route}/${object}/query`, {
        method: 'POST',
        body: JSON.stringify(query)
      });
      return this.unwrapResponse<PaginatedResult<T>>(res);
    },

    /**
     * @deprecated Use `data.query()` with standard QueryAST parameters instead.
     * This method uses legacy parameter names. Internally adapts to HTTP GET params.
     */
    find: async <T = any>(object: string, options: QueryOptions | QueryOptionsV2 = {}): Promise<PaginatedResult<T>> => {
        const route = this.getRoute('data');
        const queryParams = new URLSearchParams();

        // ── Normalize V2 canonical options → HTTP transport params ───
        // Detect V2 options by presence of canonical-only keys.
        const v2 = options as QueryOptionsV2;
        const normalizedOptions: QueryOptions = {} as QueryOptions;
        if ('where' in options || 'fields' in options || 'orderBy' in options || 'offset' in options) {
            // V2 canonical options detected — map to legacy HTTP transport keys
            if (v2.where) normalizedOptions.filter = v2.where as any;
            if (v2.fields) normalizedOptions.select = v2.fields;
            if (v2.orderBy) normalizedOptions.sort = v2.orderBy as any;
            if (v2.limit != null) normalizedOptions.top = v2.limit;
            if (v2.offset != null) normalizedOptions.skip = v2.offset;
            if (v2.aggregations) normalizedOptions.aggregations = v2.aggregations;
            if (v2.groupBy) normalizedOptions.groupBy = v2.groupBy;
        } else {
            // Legacy QueryOptions — pass through as-is
            Object.assign(normalizedOptions, options);
        }

        // 1. Handle Pagination
        if (normalizedOptions.top) queryParams.set('top', normalizedOptions.top.toString());
        if (normalizedOptions.skip) queryParams.set('skip', normalizedOptions.skip.toString());

        // 2. Handle Sort
        if (normalizedOptions.sort) {
            // Check if it's AST 
            if (Array.isArray(normalizedOptions.sort) && typeof normalizedOptions.sort[0] === 'object') {
                 queryParams.set('sort', JSON.stringify(normalizedOptions.sort));
            } else {
                 const sortVal = Array.isArray(normalizedOptions.sort) ? normalizedOptions.sort.join(',') : normalizedOptions.sort;
                 queryParams.set('sort', sortVal as string);
            }
        }
        
        // 3. Handle Select
        if (normalizedOptions.select) {
            queryParams.set('select', normalizedOptions.select.join(','));
        }

        // 4. Handle Filters (Simple vs AST)
        // Canonical HTTP param name: `filter` (singular). `filters` (plural) is accepted
        // for backward compatibility but `filter` is the standard going forward.
        const filterValue = normalizedOptions.filter ?? normalizedOptions.filters;
        if (filterValue) {
             // Detect AST filter format vs simple key-value map. AST filters use an array structure
             // with [field, operator, value] or [logicOp, ...nodes] shape (see isFilterAST from spec).
             // For complex filter expressions, use .query() which builds a proper QueryAST.
             if (this.isFilterAST(filterValue) || Array.isArray(filterValue)) {
                 // AST or any array → serialize as JSON in `filter` param
                 queryParams.set('filter', JSON.stringify(filterValue));
             } else if (typeof filterValue === 'object' && filterValue !== null) {
                 // Plain key-value map → append each as individual query params
                 Object.entries(filterValue as Record<string, unknown>).forEach(([k, v]) => {
                     if (v !== undefined && v !== null) {
                        queryParams.append(k, String(v));
                     }
                 });
             }
        }
        
        // 5. Handle Aggregations & GroupBy (Pass through as JSON if present)
        if (normalizedOptions.aggregations) {
            queryParams.set('aggregations', JSON.stringify(normalizedOptions.aggregations));
        }
        if (normalizedOptions.groupBy) {
             queryParams.set('groupBy', normalizedOptions.groupBy.join(','));
        }

        const res = await this.fetch(`${this.baseUrl}${route}/${object}?${queryParams.toString()}`);
        return this.unwrapResponse<PaginatedResult<T>>(res);
    },

    get: async <T = any>(object: string, id: string): Promise<GetDataResult<T>> => {
        const route = this.getRoute('data');
        const res = await this.fetch(`${this.baseUrl}${route}/${object}/${id}`);
        return this.unwrapResponse<GetDataResult<T>>(res);
    },

    create: async <T = any>(object: string, data: Partial<T>): Promise<CreateDataResult<T>> => {
        const route = this.getRoute('data');
        const res = await this.fetch(`${this.baseUrl}${route}/${object}`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
        return this.unwrapResponse<CreateDataResult<T>>(res);
    },

    createMany: async <T = any>(object: string, data: Partial<T>[]): Promise<T[]> => {
        const route = this.getRoute('data');
        const res = await this.fetch(`${this.baseUrl}${route}/${object}/createMany`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
        return this.unwrapResponse<T[]>(res);
    },

    /**
     * Bulk-import rows (CSV text or JSON row objects) into an object.
     *
     * The server coerces each cell to its storage value using the object's field
     * metadata (booleans, numbers, dates→ISO, select label→code, lookup name→id),
     * so callers send raw spreadsheet values plus an optional column `mapping`.
     * `writeMode` selects insert / update / upsert (the latter two need
     * `matchFields`); `dryRun` validates + previews without persisting. The
     * response carries per-row outcomes for an import report.
     */
    import: async (object: string, request: ImportRequest): Promise<ImportResponse> => {
        const route = this.getRoute('data');
        const res = await this.fetch(`${this.baseUrl}${route}/${object}/import`, {
            method: 'POST',
            body: JSON.stringify(request),
        });
        return this.unwrapResponse<ImportResponse>(res);
    },

    /**
     * Import-job namespace — the asynchronous counterpart to {@link import} for
     * large files (up to 50,000 rows). `createImportJob` posts the whole payload
     * once and returns immediately with a `jobId`; a server worker processes the
     * batch in the background. Poll {@link getImportJobProgress} for live
     * counters, {@link getImportJobResults} for the capped per-row report, and
     * {@link listImportJobs} for history. {@link cancelImportJob} stops a
     * pending/running job cooperatively.
     *
     * These routes require a server new enough to expose them — older servers
     * return 404, which surfaces here as a rejected promise. Callers that want
     * graceful degradation should feature-detect (e.g. try the job, fall back
     * to the synchronous {@link import} on 404).
     */
    createImportJob: async (object: string, request: CreateImportJobRequest): Promise<CreateImportJobResponse> => {
        const route = this.getRoute('data');
        const res = await this.fetch(`${this.baseUrl}${route}/${object}/import/jobs`, {
            method: 'POST',
            body: JSON.stringify(request),
        });
        return this.unwrapResponse<CreateImportJobResponse>(res);
    },

    getImportJobProgress: async (jobId: string): Promise<ImportJobProgress> => {
        const route = this.getRoute('data');
        const res = await this.fetch(`${this.baseUrl}${route}/import/jobs/${encodeURIComponent(jobId)}`);
        return this.unwrapResponse<ImportJobProgress>(res);
    },

    getImportJobResults: async (jobId: string): Promise<ImportJobResults> => {
        const route = this.getRoute('data');
        const res = await this.fetch(`${this.baseUrl}${route}/import/jobs/${encodeURIComponent(jobId)}/results`);
        return this.unwrapResponse<ImportJobResults>(res);
    },

    listImportJobs: async (query: Partial<ListImportJobsRequest> = {}): Promise<ImportJobSummary[]> => {
        const route = this.getRoute('data');
        const qs = new URLSearchParams();
        if (query.object) qs.set('object', query.object);
        if (query.status) qs.set('status', query.status);
        if (query.limit != null) qs.set('limit', String(query.limit));
        if (query.offset != null) qs.set('offset', String(query.offset));
        const suffix = qs.toString() ? `?${qs.toString()}` : '';
        const res = await this.fetch(`${this.baseUrl}${route}/import/jobs${suffix}`);
        const body = await this.unwrapResponse<ListImportJobsResponse>(res);
        return body.jobs;
    },

    cancelImportJob: async (jobId: string): Promise<{ success: boolean }> => {
        const route = this.getRoute('data');
        const res = await this.fetch(`${this.baseUrl}${route}/import/jobs/${encodeURIComponent(jobId)}/cancel`, {
            method: 'POST',
        });
        return this.unwrapResponse<{ success: boolean }>(res);
    },

    /**
     * Logically roll back a finished import: delete the records it created and
     * restore the fields it updated to their pre-import values. Only jobs that
     * captured an undo log (small, non-dry-run, not yet reverted) are undoable —
     * others return 422. See {@link ImportJobProgress.undoable}.
     */
    undoImportJob: async (jobId: string): Promise<UndoImportJobResponse> => {
        const route = this.getRoute('data');
        const res = await this.fetch(`${this.baseUrl}${route}/import/jobs/${encodeURIComponent(jobId)}/undo`, {
            method: 'POST',
        });
        return this.unwrapResponse<UndoImportJobResponse>(res);
    },

    update: async <T = any>(
        object: string,
        id: string,
        data: Partial<T>,
        opts?: { ifMatch?: string },
    ): Promise<UpdateDataResult<T>> => {
        const route = this.getRoute('data');
        const headers: Record<string, string> = {};
        // Optimistic Concurrency Control: when the caller passes
        // `opts.ifMatch` (typically the `updated_at` value they read), we
        // forward it as a standard `If-Match` header. The server returns
        // `409 CONCURRENT_UPDATE` if the record has been modified since.
        // See packages/objectql/src/protocol.ts ConcurrentUpdateError.
        if (opts?.ifMatch) headers['If-Match'] = String(opts.ifMatch);
        const res = await this.fetch(`${this.baseUrl}${route}/${object}/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            ...(Object.keys(headers).length ? { headers } : {}),
        });
        return this.unwrapResponse<UpdateDataResult<T>>(res);
    },

    /**
     * Batch update multiple records
     * Uses the new BatchUpdateRequest schema with full control over options
     */
    batch: async (object: string, request: BatchUpdateRequest): Promise<BatchUpdateResponse> => {
        const route = this.getRoute('data');
        const res = await this.fetch(`${this.baseUrl}${route}/${object}/batch`, {
            method: 'POST',
            body: JSON.stringify(request)
        });
        return this.unwrapResponse<BatchUpdateResponse>(res);
    },

    /**
     * Update multiple records (simplified batch update)
     * Convenience method for batch updates without full BatchUpdateRequest
     */
    updateMany: async <T = any>(
      object: string, 
      records: Array<{ id: string; data: Partial<T> }>,
      options?: BatchOptions
    ): Promise<BatchUpdateResponse> => {
        const route = this.getRoute('data');
        const request: UpdateManyRequest = {
          records,
          options
        };
        const res = await this.fetch(`${this.baseUrl}${route}/${object}/updateMany`, {
            method: 'POST',
            body: JSON.stringify(request)
        });
        return this.unwrapResponse<BatchUpdateResponse>(res);
    },

    delete: async (
        object: string,
        id: string,
        opts?: { ifMatch?: string },
    ): Promise<DeleteDataResult> => {
        const route = this.getRoute('data');
        const headers: Record<string, string> = {};
        // OCC: same opt-in protocol as `update`. See note there.
        if (opts?.ifMatch) headers['If-Match'] = String(opts.ifMatch);
        const res = await this.fetch(`${this.baseUrl}${route}/${object}/${id}`, {
            method: 'DELETE',
            ...(Object.keys(headers).length ? { headers } : {}),
        });
        return this.unwrapResponse<DeleteDataResult>(res);
    },

    /**
     * Delete multiple records by IDs
     */
    deleteMany: async(object: string, ids: string[], options?: BatchOptions): Promise<BatchUpdateResponse> => {
        const route = this.getRoute('data');
        const request: DeleteManyRequest = {
          ids,
          options
        };
        const res = await this.fetch(`${this.baseUrl}${route}/${object}/deleteMany`, {
             method: 'POST',
             body: JSON.stringify(request)
        });
        return this.unwrapResponse<BatchUpdateResponse>(res);
    }
  };



  /**
   * Private Helpers
   */

  private isFilterAST(filter: any): boolean {
    // Delegate to the spec-exported structural validator instead of naive Array.isArray.
    // This checks for valid AST shapes: [field, op, val], [logic, ...nodes], or [[cond], ...].
    return isFilterAST(filter);
  }

  /**
   * Unwrap the standard REST API response envelope.
   * The HTTP layer wraps responses as `{ success: boolean, data: T, meta? }`
   * (see BaseResponseSchema in contract.zod.ts).
   * This method strips the envelope and returns the inner `data` payload
   * so callers receive the spec-level type (e.g. GetMetaTypesResponse).
   */
  private async unwrapResponse<T>(res: Response): Promise<T> {
    const body = await res.json();
    // If the body has a `success` flag it's a BaseResponse envelope
    if (body && typeof body.success === 'boolean' && 'data' in body) {
      return body.data as T;
    }
    // Already unwrapped or non-standard
    return body as T;
  }

  private async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    this.logger.debug('HTTP request', { 
      method: options.method || 'GET',
      url,
      hasBody: !!options.body
    });
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`;
    }

    if (this.environmentId) {
        headers['X-Environment-Id'] = this.environmentId;
    }

    // Carry the in-app locale so the server resolves metadata translations
    // for the chosen UI language. Don't clobber a caller-supplied header
    // (case-insensitive check — `headers` is spread from options above).
    if (this.locale && !Object.keys(headers).some((h) => h.toLowerCase() === 'accept-language')) {
        headers['Accept-Language'] = this.locale;
    }

    const res = await this.fetchImpl(url, { ...options, headers });
    
    this.logger.debug('HTTP response', { 
      method: options.method || 'GET',
      url,
      status: res.status,
      ok: res.ok
    });
    
    if (!res.ok) {
        let errorBody: any;
        try {
            errorBody = await res.json();
        } catch {
            errorBody = { message: res.statusText };
        }
        
        this.logger.error('HTTP request failed', undefined, { 
          method: options.method || 'GET',
          url,
          status: res.status,
          error: errorBody
        });
        
        // Create a standardized error if the response includes error details.
        //
        // Server may shape the body as any of:
        //   { message: '...' }
        //   { error: { code, message } }
        //   { error: 'CODE: human readable' }       ← plain-string variant (e.g. RECORD_LOCKED)
        //   { error: '...' , code: '...' }
        // Without the plain-string branch we'd silently fall back to
        // `res.statusText` ("Bad Request") and hide the actual reason from
        // callers — which made debugging things like the approval lock
        // ("RECORD_LOCKED: …") needlessly painful.
        const errorMessage =
          errorBody?.message
          ?? errorBody?.error?.message
          ?? (typeof errorBody?.error === 'string' ? errorBody.error : undefined)
          ?? res.statusText;
        const errorCode = errorBody?.code || errorBody?.error?.code;
        const error = new Error(`[ObjectStack] ${errorCode ? `${errorCode}: ` : ''}${errorMessage}`) as any;
        
        // Attach error details for programmatic access
        error.code = errorCode;
        error.category = errorBody?.category;
        error.httpStatus = res.status;
        error.retryable = errorBody?.retryable;
        error.details = errorBody?.details || errorBody;
        
        throw error;
    }
    
    return res;
  }

  /**
   * Get the conventional route path for a given API endpoint type
   * ObjectStack uses standard conventions: /api/v1/data, /api/v1/meta, /api/v1/ui
   */
  private getRoute(type: ApiRouteType): string {
    // 1. Use discovered routes if available (only for ApiRoutes keys, not client-specific keys)
    const routes = this.discoveryInfo?.routes;
    if (routes) {
        const key = type as keyof ApiRoutes;
        const discovered = routes[key];
        if (discovered) return discovered;
    }

    // 2. Fallback to conventions (covers all ApiRoutes keys + client-specific virtual routes)
    const routeMap: Record<ApiRouteType, string> = {
      data: '/api/v1/data',
      metadata: '/api/v1/meta',
      discovery: '/api/v1/discovery',
      ui: '/api/v1/ui',
      auth: '/api/v1/auth',
      analytics: '/api/v1/analytics',
      storage: '/api/v1/storage',
      automation: '/api/v1/automation',
      packages: '/api/v1/packages',
      permissions: '/api/v1/permissions',
      realtime: '/api/v1/realtime',
      workflow: '/api/v1/workflow',
      approvals: '/api/v1/approvals',
      views: '/api/v1/ui/views',
      notifications: '/api/v1/notifications',
      ai: '/api/v1/ai',
      i18n: '/api/v1/i18n',
      feed: '/api/v1/feed',
      graphql: '/graphql',
    };
    
    return routeMap[type] || `/api/v1/${type}`;
  }
}

/**
 * Project-scoped sub-client.
 *
 * Wraps an {@link ObjectStackClient} and prefixes every request with
 * `/api/v1/environments/:environmentId/...` so a single client instance can talk to
 * multiple projects without mutating global state.
 *
 * The scoped client exposes the same shape as the `data`, `meta`, `batch`,
 * and `packages` namespaces on `ObjectStackClient` — only the URL prefix
 * differs. The server-side dual-mode route registration (see
 * `packages/rest/src/rest-server.ts`) accepts both shapes when
 * `projectResolution` is `'auto'` or `'optional'`.
 */
export class ScopedProjectClient {
  private readonly parent: ObjectStackClient;
  private readonly environmentId: string;

  constructor(parent: ObjectStackClient, environmentId: string) {
    this.parent = parent;
    this.environmentId = environmentId;
  }

  /** The environmentId this client is scoped to. */
  getProjectId(): string { return this.environmentId; }

  /** Prefix segment inserted between the baseUrl and the resource path. */
  private scope(): string { return `/api/v1/environments/${encodeURIComponent(this.environmentId)}`; }

  private url(suffix: string): string {
    return `${this.parent._baseUrl()}${this.scope()}${suffix}`;
  }

  /**
   * Metadata operations scoped to this project.
   */
  meta = {
    getTypes: async (): Promise<GetMetaTypesResponse> => {
      const res = await this.parent._fetch(this.url('/meta'));
      return this.parent._unwrap<GetMetaTypesResponse>(res);
    },
    getItems: async (type: string, options?: { packageId?: string }): Promise<GetMetaItemsResponse> => {
      const params = new URLSearchParams();
      if (options?.packageId) params.set('package', options.packageId);
      const qs = params.toString();
      const res = await this.parent._fetch(this.url(`/meta/${type}${qs ? `?${qs}` : ''}`));
      return this.parent._unwrap<GetMetaItemsResponse>(res);
    },
    getItem: async (type: string, name: string, options?: { packageId?: string }) => {
      const params = new URLSearchParams();
      if (options?.packageId) params.set('package', options.packageId);
      const qs = params.toString();
      const res = await this.parent._fetch(this.url(`/meta/${type}/${name}${qs ? `?${qs}` : ''}`));
      return this.parent._unwrap(res);
    },
    saveItem: async (type: string, name: string, item: any) => {
      const res = await this.parent._fetch(this.url(`/meta/${type}/${name}`), {
        method: 'PUT',
        body: JSON.stringify(item),
      });
      return this.parent._unwrap(res);
    },
    deleteItem: async (type: string, name: string): Promise<{ type: string; name: string; deleted: boolean }> => {
      const res = await this.parent._fetch(this.url(`/meta/${encodeURIComponent(type)}/${encodeURIComponent(name)}`), {
        method: 'DELETE',
      });
      return this.parent._unwrap(res);
    },
    getHistory: async (
      type: string,
      name: string,
      options?: { sinceSeq?: number; limit?: number },
    ) => {
      const params = new URLSearchParams();
      if (options?.sinceSeq !== undefined) params.set('sinceSeq', String(options.sinceSeq));
      if (options?.limit !== undefined) params.set('limit', String(options.limit));
      const qs = params.toString();
      const res = await this.parent._fetch(
        this.url(`/meta/${encodeURIComponent(type)}/${encodeURIComponent(name)}/history${qs ? `?${qs}` : ''}`),
      );
      return this.parent._unwrap(res);
    },
  };

  /**
   * Data operations scoped to this project.
   *
   * Mirrors the query / find / get / create / update / delete / batch
   * surface on {@link ObjectStackClient}. URL construction differs only
   * in the prefix — query parameter serialization is identical.
   */
  data = {
    query: async <T = any>(object: string, query: Partial<QueryAST>): Promise<PaginatedResult<T>> => {
      const res = await this.parent._fetch(this.url(`/data/${object}/query`), {
        method: 'POST',
        body: JSON.stringify(query),
      });
      return this.parent._unwrap<PaginatedResult<T>>(res);
    },
    find: async <T = any>(object: string, options: QueryOptions | QueryOptionsV2 = {}): Promise<PaginatedResult<T>> => {
      const queryParams = new URLSearchParams();

      const v2 = options as QueryOptionsV2;
      const normalizedOptions: QueryOptions = {} as QueryOptions;
      if ('where' in options || 'fields' in options || 'orderBy' in options || 'offset' in options) {
        if (v2.where) normalizedOptions.filter = v2.where as any;
        if (v2.fields) normalizedOptions.select = v2.fields;
        if (v2.orderBy) normalizedOptions.sort = v2.orderBy as any;
        if (v2.limit != null) normalizedOptions.top = v2.limit;
        if (v2.offset != null) normalizedOptions.skip = v2.offset;
        if (v2.aggregations) normalizedOptions.aggregations = v2.aggregations;
        if (v2.groupBy) normalizedOptions.groupBy = v2.groupBy;
      } else {
        Object.assign(normalizedOptions, options);
      }

      if (normalizedOptions.top) queryParams.set('top', normalizedOptions.top.toString());
      if (normalizedOptions.skip) queryParams.set('skip', normalizedOptions.skip.toString());
      if (normalizedOptions.sort) {
        if (Array.isArray(normalizedOptions.sort) && typeof normalizedOptions.sort[0] === 'object') {
          queryParams.set('sort', JSON.stringify(normalizedOptions.sort));
        } else {
          const sortVal = Array.isArray(normalizedOptions.sort) ? normalizedOptions.sort.join(',') : normalizedOptions.sort;
          queryParams.set('sort', sortVal as string);
        }
      }
      if (normalizedOptions.select) {
        queryParams.set('select', normalizedOptions.select.join(','));
      }
      const filterValue = normalizedOptions.filter ?? normalizedOptions.filters;
      if (filterValue) {
        if (this.parent._isFilterAST(filterValue) || Array.isArray(filterValue)) {
          queryParams.set('filter', JSON.stringify(filterValue));
        } else if (typeof filterValue === 'object' && filterValue !== null) {
          Object.entries(filterValue as Record<string, unknown>).forEach(([k, v]) => {
            if (v !== undefined && v !== null) {
              queryParams.append(k, String(v));
            }
          });
        }
      }
      if (normalizedOptions.aggregations) {
        queryParams.set('aggregations', JSON.stringify(normalizedOptions.aggregations));
      }
      if (normalizedOptions.groupBy) {
        queryParams.set('groupBy', normalizedOptions.groupBy.join(','));
      }

      const qs = queryParams.toString();
      const res = await this.parent._fetch(this.url(`/data/${object}${qs ? `?${qs}` : ''}`));
      return this.parent._unwrap<PaginatedResult<T>>(res);
    },
    get: async <T = any>(object: string, id: string): Promise<GetDataResult<T>> => {
      const res = await this.parent._fetch(this.url(`/data/${object}/${id}`));
      return this.parent._unwrap<GetDataResult<T>>(res);
    },
    create: async <T = any>(object: string, data: Partial<T>): Promise<CreateDataResult<T>> => {
      const res = await this.parent._fetch(this.url(`/data/${object}`), {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return this.parent._unwrap<CreateDataResult<T>>(res);
    },
    createMany: async <T = any>(object: string, data: Partial<T>[]): Promise<T[]> => {
      const res = await this.parent._fetch(this.url(`/data/${object}/createMany`), {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return this.parent._unwrap<T[]>(res);
    },
    /**
     * Bulk-import rows (CSV text or JSON row objects) into an object. The server
     * coerces each cell to its storage value from field metadata (booleans,
     * numbers, dates→ISO, select label→code, lookup name→id); callers send raw
     * values plus an optional column `mapping`. `writeMode` selects
     * insert/update/upsert (update/upsert need `matchFields`); `dryRun`
     * validates + previews without persisting.
     */
    import: async (object: string, request: ImportRequest): Promise<ImportResponse> => {
      const res = await this.parent._fetch(this.url(`/data/${object}/import`), {
        method: 'POST',
        body: JSON.stringify(request),
      });
      return this.parent._unwrap<ImportResponse>(res);
    },
    /**
     * Asynchronous import jobs (scoped) — see the top-level `data.createImportJob`
     * for semantics. Large payloads are posted once; a server worker processes
     * them in the background while callers poll progress / results / history.
     */
    createImportJob: async (object: string, request: CreateImportJobRequest): Promise<CreateImportJobResponse> => {
      const res = await this.parent._fetch(this.url(`/data/${object}/import/jobs`), {
        method: 'POST',
        body: JSON.stringify(request),
      });
      return this.parent._unwrap<CreateImportJobResponse>(res);
    },
    getImportJobProgress: async (jobId: string): Promise<ImportJobProgress> => {
      const res = await this.parent._fetch(this.url(`/data/import/jobs/${encodeURIComponent(jobId)}`));
      return this.parent._unwrap<ImportJobProgress>(res);
    },
    getImportJobResults: async (jobId: string): Promise<ImportJobResults> => {
      const res = await this.parent._fetch(this.url(`/data/import/jobs/${encodeURIComponent(jobId)}/results`));
      return this.parent._unwrap<ImportJobResults>(res);
    },
    listImportJobs: async (query: Partial<ListImportJobsRequest> = {}): Promise<ImportJobSummary[]> => {
      const qs = new URLSearchParams();
      if (query.object) qs.set('object', query.object);
      if (query.status) qs.set('status', query.status);
      if (query.limit != null) qs.set('limit', String(query.limit));
      if (query.offset != null) qs.set('offset', String(query.offset));
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      const res = await this.parent._fetch(this.url(`/data/import/jobs${suffix}`));
      const body = await this.parent._unwrap<ListImportJobsResponse>(res);
      return body.jobs;
    },
    cancelImportJob: async (jobId: string): Promise<{ success: boolean }> => {
      const res = await this.parent._fetch(this.url(`/data/import/jobs/${encodeURIComponent(jobId)}/cancel`), {
        method: 'POST',
      });
      return this.parent._unwrap<{ success: boolean }>(res);
    },
    undoImportJob: async (jobId: string): Promise<UndoImportJobResponse> => {
      const res = await this.parent._fetch(this.url(`/data/import/jobs/${encodeURIComponent(jobId)}/undo`), {
        method: 'POST',
      });
      return this.parent._unwrap<UndoImportJobResponse>(res);
    },
    update: async <T = any>(object: string, id: string, data: Partial<T>): Promise<UpdateDataResult<T>> => {
      const res = await this.parent._fetch(this.url(`/data/${object}/${id}`), {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
      return this.parent._unwrap<UpdateDataResult<T>>(res);
    },
    batch: async (object: string, request: BatchUpdateRequest): Promise<BatchUpdateResponse> => {
      const res = await this.parent._fetch(this.url(`/data/${object}/batch`), {
        method: 'POST',
        body: JSON.stringify(request),
      });
      return this.parent._unwrap<BatchUpdateResponse>(res);
    },
    updateMany: async <T = any>(
      object: string,
      records: Array<{ id: string; data: Partial<T> }>,
      options?: BatchOptions,
    ): Promise<BatchUpdateResponse> => {
      const request: UpdateManyRequest = { records, options };
      const res = await this.parent._fetch(this.url(`/data/${object}/updateMany`), {
        method: 'POST',
        body: JSON.stringify(request),
      });
      return this.parent._unwrap<BatchUpdateResponse>(res);
    },
    delete: async (object: string, id: string): Promise<DeleteDataResult> => {
      const res = await this.parent._fetch(this.url(`/data/${object}/${id}`), {
        method: 'DELETE',
      });
      return this.parent._unwrap<DeleteDataResult>(res);
    },
    deleteMany: async (object: string, ids: string[], options?: BatchOptions): Promise<BatchUpdateResponse> => {
      const request: DeleteManyRequest = { ids, options };
      const res = await this.parent._fetch(this.url(`/data/${object}/deleteMany`), {
        method: 'POST',
        body: JSON.stringify(request),
      });
      return this.parent._unwrap<BatchUpdateResponse>(res);
    },
  };

  /**
   * Package management scoped to this project.
   * Only the read-path is exposed here — publish / delete remain on the
   * global `client.packages` namespace for now, pending dedicated per-project
   * package tests.
   */
  packages = {
    list: async (): Promise<{ packages: any[]; total: number }> => {
      const res = await this.parent._fetch(this.url('/packages'));
      return this.parent._unwrap<{ packages: any[]; total: number }>(res);
    },
    get: async (id: string, version?: string) => {
      const qs = version ? `?version=${encodeURIComponent(version)}` : '';
      const res = await this.parent._fetch(this.url(`/packages/${encodeURIComponent(id)}${qs}`));
      return this.parent._unwrap<{ package: any }>(res);
    },
  };

  /**
   * Automation (Flow) operations scoped to this project.
   *
   * Thin wrapper around the dispatcher's automation routes, mounted under
   * `/api/v1/environments/:environmentId/automation/...`. Surface mirrors the methods
   * needed by Studio's Flow viewer: read flow definition, execute (trigger),
   * list runs, fetch a single run.
   */
  automation = {
    /** Fetch a flow definition by name. */
    getFlow: async <T = any>(name: string): Promise<T> => {
      const res = await this.parent._fetch(this.url(`/automation/${encodeURIComponent(name)}`));
      return this.parent._unwrap<T>(res);
    },
    /**
     * Execute (trigger) a flow by name. The request body is forwarded as the
     * automation execution context (e.g. `{ params, trigger }`).
     */
    execute: async <T = any>(name: string, ctx?: Record<string, any>): Promise<T> => {
      const res = await this.parent._fetch(this.url(`/automation/${encodeURIComponent(name)}/trigger`), {
        method: 'POST',
        body: JSON.stringify(ctx ?? {}),
      });
      return this.parent._unwrap<T>(res);
    },
    /** List recent runs for a flow. */
    listRuns: async <T = any>(
      flowName: string,
      opts?: { limit?: number; cursor?: string },
    ): Promise<T> => {
      const params = new URLSearchParams();
      if (opts?.limit != null) params.set('limit', String(opts.limit));
      if (opts?.cursor) params.set('cursor', opts.cursor);
      const qs = params.toString();
      const res = await this.parent._fetch(
        this.url(`/automation/${encodeURIComponent(flowName)}/runs${qs ? `?${qs}` : ''}`),
      );
      return this.parent._unwrap<T>(res);
    },
    /** Fetch a single run (with step log) for a flow. */
    getRun: async <T = any>(flowName: string, runId: string): Promise<T> => {
      const res = await this.parent._fetch(
        this.url(`/automation/${encodeURIComponent(flowName)}/runs/${encodeURIComponent(runId)}`),
      );
      return this.parent._unwrap<T>(res);
    },
  };
}

// Re-export type-safe query builder
export { QueryBuilder, FilterBuilder, createQuery, createFilter } from './query-builder';

// Re-export realtime API types
export { RealtimeAPI, RealtimeSubscriptionFilter, RealtimeEventHandler } from './realtime-api';

// Re-export commonly used types from @objectstack/spec/api for convenience
export type {
  BatchUpdateRequest,
  BatchUpdateResponse,
  UpdateManyRequest,
  DeleteManyRequest,
  BatchOptions,
  BatchRecord,
  BatchOperationResult,
  MetadataCacheRequest,
  MetadataCacheResponse,
  StandardErrorCode,
  ErrorCategory,
  GetDiscoveryResponse,
  GetMetaTypesResponse,
  GetMetaItemsResponse,
  CheckPermissionRequest,
  CheckPermissionResponse,
  GetObjectPermissionsResponse,
  GetEffectivePermissionsResponse,
  RealtimeConnectRequest,
  RealtimeConnectResponse,
  RealtimeSubscribeRequest,
  RealtimeSubscribeResponse,
  GetPresenceResponse,
  GetWorkflowConfigResponse,
  GetWorkflowStateResponse,
  WorkflowTransitionRequest,
  WorkflowTransitionResponse,
  ListViewsResponse,
  GetViewResponse,
  CreateViewResponse,
  UpdateViewResponse,
  DeleteViewResponse,
  RegisterDeviceRequest,
  RegisterDeviceResponse,
  ListNotificationsResponse,
  AiNlqRequest,
  AiNlqResponse,
  AiSuggestRequest,
  AiSuggestResponse,
  AiInsightsRequest,
  AiInsightsResponse,
  GetLocalesResponse,
  GetTranslationsResponse,
  GetFieldLabelsResponse,
  RegisterRequest,
  RefreshTokenRequest,
  GetFeedResponse,
  CreateFeedItemResponse,
  UpdateFeedItemResponse,
  DeleteFeedItemResponse,
  AddReactionResponse,
  RemoveReactionResponse,
  PinFeedItemResponse,
  UnpinFeedItemResponse,
  StarFeedItemResponse,
  UnstarFeedItemResponse,
  SearchFeedResponse,
  GetChangelogResponse,
  SubscribeResponse,
  UnsubscribeResponse,
  WellKnownCapabilities,
  GetAuthConfigResponse,
  AuthProviderInfo,
  EmailPasswordConfigPublic,
  AuthFeaturesConfig,
  CreateImportJobRequest,
  CreateImportJobResponse,
  ImportJobProgress,
  ImportJobResults,
  ImportJobSummary,
  ListImportJobsRequest,
  ListImportJobsResponse,
  UndoImportJobResponse,
} from '@objectstack/spec/api';

// Approval runtime types (ADR-0019) — surfaced so SDK consumers can type the
// `client.approvals` namespace without reaching into `@objectstack/spec`.
export type {
  ApprovalRequestRow,
  ApprovalActionRow,
  ApprovalStatus,
  ApprovalDecisionInput,
  ApprovalDecisionResult,
} from '@objectstack/spec/contracts';
