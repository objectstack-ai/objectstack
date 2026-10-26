/**
 * ObjectUI — ApiDataSource
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A DataSource adapter over raw HTTP, built in code from an
 * `ApiDataSourceConfig` (e.g. the console's approvals inbox). It is not a
 * `ViewData` mode: the view-level `provider: 'api'` is retired in
 * `@objectstack/spec` (objectstack#23082), and `resolveDataSource` builds no
 * `ApiDataSource` (objectui#12325).
 */

import type {
  DataSource,
  BatchTransactionOperation,
  QueryParams,
  QueryResult,
  HttpRequest,
  HttpMethod,
  AggregateParams,
  AggregateResult,
} from '@object-ui/types';
import { emulateBatchTransaction } from './batchTransaction.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ApiDataSourceConfig {
  /** HttpRequest config for read operations (find, findOne) */
  read?: HttpRequest;
  /** HttpRequest config for write operations (create, update, delete) */
  write?: HttpRequest;
  /** Custom fetch implementation (defaults to globalThis.fetch) */
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** Default headers applied to all requests */
  defaultHeaders?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a full URL with query params */
function buildUrl(
  base: string,
  pathSuffix?: string,
  queryParams?: Record<string, unknown>,
): string {
  let url = base;
  if (pathSuffix) {
    url = url.replace(/\/+$/, '') + '/' + pathSuffix.replace(/^\/+/, '');
  }

  if (queryParams && Object.keys(queryParams).length > 0) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined && value !== null) {
        search.set(key, String(value));
      }
    }
    const qs = search.toString();
    if (qs) {
      url += (url.includes('?') ? '&' : '?') + qs;
    }
  }

  return url;
}

/** Convert QueryParams to flat query string params */
function queryParamsToRecord(params?: QueryParams): Record<string, unknown> {
  if (!params) return {};

  const out: Record<string, unknown> = {};

  if (params.$select?.length) {
    out.$select = params.$select.join(',');
  }
  if (params.$filter && Object.keys(params.$filter).length > 0) {
    out.$filter = JSON.stringify(params.$filter);
  }
  if (params.$orderby) {
    if (typeof params.$orderby === 'string') {
      // Already an OData order clause ('name asc', 'a asc,b desc'). It MUST be
      // passed through verbatim: the `Object.entries` branch below would walk a
      // string index-by-index and emit `0 n,1 a,2 m,…`, which the server dutifully
      // sorts by — columns that don't exist — and the whole page comes back empty
      // (objectstack#3821). Callers that build the clause by hand (ObjectGrid's
      // schema `sort`, RecipientPickerField) hit exactly that.
      out.$orderby = params.$orderby;
    } else if (Array.isArray(params.$orderby)) {
      if (typeof params.$orderby[0] === 'string') {
        out.$orderby = (params.$orderby as string[]).join(',');
      } else {
        out.$orderby = (params.$orderby as Array<{ field: string; order?: string }>)
          .map((s) => `${s.field} ${s.order || 'asc'}`)
          .join(',');
      }
    } else {
      out.$orderby = Object.entries(params.$orderby)
        .map(([field, order]) => `${field} ${order}`)
        .join(',');
    }
  }
  if (params.$skip !== undefined) out.$skip = params.$skip;
  if (params.$top !== undefined) out.$top = params.$top;
  if (params.$expand?.length) out.$expand = params.$expand.join(',');
  if (params.$search) out.$search = params.$search;
  if (params.$count) out.$count = 'true';

  return out;
}

/** Merge two header objects, giving priority to the second */
function mergeHeaders(
  base?: Record<string, string>,
  override?: Record<string, string>,
): Record<string, string> {
  return { ...base, ...override };
}

// ---------------------------------------------------------------------------
// ApiDataSource
// ---------------------------------------------------------------------------

/**
 * ApiDataSource — a DataSource adapter for raw HTTP APIs.
 *
 * Constructed in code — never resolved from a `ViewData` block (see the file
 * header). The read and write HttpRequest configs define the endpoints; all
 * CRUD methods map onto HTTP verbs.
 *
 * Read operations use the `read` config, write operations use the `write` config.
 * Both fall back to each other when one is not provided.
 *
 * @example
 * ```ts
 * const ds = new ApiDataSource({
 *   read:  { url: '/api/contacts', method: 'GET' },
 *   write: { url: '/api/contacts', method: 'POST' },
 * });
 *
 * const result = await ds.find('contacts', { $top: 10 });
 * ```
 */
export class ApiDataSource<T = any> implements DataSource<T> {
  private readConfig: HttpRequest | undefined;
  private writeConfig: HttpRequest | undefined;
  private fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  private defaultHeaders: Record<string, string>;

  constructor(config: ApiDataSourceConfig) {
    this.readConfig = config.read;
    this.writeConfig = config.write;
    this.fetchFn = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.defaultHeaders = config.defaultHeaders ?? {};
  }

  // -----------------------------------------------------------------------
  // Internal request executor
  // -----------------------------------------------------------------------

  private async request<R = any>(
    base: HttpRequest | undefined,
    options: {
      pathSuffix?: string;
      method?: HttpMethod;
      queryParams?: Record<string, unknown>;
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ): Promise<R> {
    if (!base) {
      throw new Error(
        'ApiDataSource: No HTTP configuration provided for this operation. ' +
          'Ensure the ApiDataSourceConfig has read/write configs.',
      );
    }

    const method = options.method ?? base.method ?? 'GET';

    // Merge query params: base.params + extra queryParams
    const allQuery = {
      ...(base.params as Record<string, unknown> | undefined),
      ...options.queryParams,
    };

    const url = buildUrl(base.url, options.pathSuffix, allQuery);

    const headers = mergeHeaders(
      mergeHeaders(this.defaultHeaders, base.headers),
      options.headers,
    );

    const init: RequestInit = {
      method,
      headers,
    };

    // Attach body for non-GET methods
    if (options.body !== undefined && method !== 'GET') {
      if (
        options.body instanceof FormData ||
        options.body instanceof Blob
      ) {
        init.body = options.body as FormData | Blob;
      } else if (typeof options.body === 'string') {
        init.body = options.body;
        if (!headers['Content-Type']) {
          headers['Content-Type'] = 'text/plain';
        }
      } else {
        init.body = JSON.stringify(options.body);
        if (!headers['Content-Type']) {
          headers['Content-Type'] = 'application/json';
        }
      }
    }

    const response = await this.fetchFn(url, init);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `ApiDataSource: HTTP ${response.status} ${response.statusText} — ${text}`,
      );
    }

    // Try to parse as JSON; fall back to empty object
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return response.json();
    }

    // Non-JSON response — return text wrapped in an object
    const text = await response.text();
    return text as unknown as R;
  }

  // -----------------------------------------------------------------------
  // DataSource interface
  // -----------------------------------------------------------------------

  async find(_resource: string, params?: QueryParams): Promise<QueryResult<T>> {
    const queryParams = queryParamsToRecord(params);
    const raw = await this.request<any>(this.readConfig, {
      method: 'GET',
      queryParams,
    });

    // Normalize: the API might return an array, an object with `data`, or a QueryResult
    return this.normalizeQueryResult(raw);
  }

  async findOne(_resource: string, id: string | number, params?: QueryParams): Promise<T | null> {
    try {
      const queryParams = queryParamsToRecord(params);
      const raw = await this.request<T>(this.readConfig, {
        pathSuffix: String(id),
        method: 'GET',
        queryParams,
      });
      return raw ?? null;
    } catch (err) {
      // `null` is "not found", and only a 404 says that. Every other failure
      // (a refusal, a 5xx, a transport error) rejects, as `ObjectStackAdapter`
      // does, so a record page can tell "no access" and "could not load" from
      // "not found" (objectui#11902, objectui#12032). The status is read from
      // the message `request` above composes ("ApiDataSource: HTTP 404 …").
      if (err instanceof Error && /^ApiDataSource: HTTP 404\b/.test(err.message)) {
        return null;
      }
      throw err;
    }
  }

  async create(_resource: string, data: Partial<T>): Promise<T> {
    const config = this.writeConfig ?? this.readConfig;
    return this.request<T>(config, {
      method: 'POST',
      body: data,
    });
  }

  async update(
    _resource: string,
    id: string | number,
    data: Partial<T>,
    opts?: { ifMatch?: string },
  ): Promise<T> {
    const config = this.writeConfig ?? this.readConfig;
    return this.request<T>(config, {
      pathSuffix: String(id),
      method: 'PATCH',
      body: data,
      ...(opts?.ifMatch
        ? { headers: { 'If-Match': String(opts.ifMatch) } }
        : {}),
    });
  }

  async delete(
    _resource: string,
    id: string | number,
    opts?: { ifMatch?: string },
  ): Promise<boolean> {
    const config = this.writeConfig ?? this.readConfig;
    try {
      await this.request(config, {
        pathSuffix: String(id),
        method: 'DELETE',
        ...(opts?.ifMatch
          ? { headers: { 'If-Match': String(opts.ifMatch) } }
          : {}),
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Client-side (non-atomic) cross-object batch — a generic REST endpoint has
   * no transactional batch primitive, so this delegates to the shared
   * emulation (sequential writes + `$ref` resolution + best-effort
   * compensation). Adapters fronting a server that DOES offer an atomic batch
   * should override this to issue a single request.
   */
  batchTransaction(
    operations: BatchTransactionOperation[],
  ): Promise<{ results: any[] }> {
    return emulateBatchTransaction(this, operations);
  }

  async getObjectSchema(_objectName: string): Promise<any> {
    // Generic API endpoints typically don't expose schema metadata.
    // Return a minimal stub so schema-dependent components don't crash.
    return { name: _objectName, fields: {} };
  }

  async getView(_objectName: string, _viewId: string): Promise<any | null> {
    return null;
  }

  async getApp(_appId: string): Promise<any | null> {
    return null;
  }

  async aggregate(_resource: string, params: AggregateParams): Promise<AggregateResult[]> {
    const queryParams: Record<string, unknown> = {
      field: params.field,
      function: params.function,
      groupBy: params.groupBy,
    };
    if (params.filter) {
      queryParams.filter = typeof params.filter === 'string'
        ? params.filter
        : JSON.stringify(params.filter);
    }

    const raw = await this.request<any>(this.readConfig, {
      pathSuffix: 'aggregate',
      method: 'GET',
      queryParams,
    });

    // Normalize: the API might return an array or an object with data/results
    if (Array.isArray(raw)) return raw;
    if (raw?.data && Array.isArray(raw.data)) return raw.data;
    if (raw?.results && Array.isArray(raw.results)) return raw.results;
    return [];
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Normalize various API response shapes into a QueryResult.
   *
   * Supported shapes:
   * - `T[]`                      → wrap in QueryResult
   * - `{ data: T[] }`            → extract data
   * - `{ items: T[] }`           → extract items
   * - `{ results: T[] }`         → extract results
   * - `{ records: T[] }`         → extract records (Salesforce-style)
   * - `{ value: T[] }`           → extract value (OData-style)
   * - Full QueryResult (has data + totalCount) → return as-is
   */
  private normalizeQueryResult(raw: any): QueryResult<T> {
    if (Array.isArray(raw)) {
      return { data: raw, total: raw.length };
    }

    if (raw && typeof raw === 'object') {
      // Already a QueryResult
      if (Array.isArray(raw.data) && ('total' in raw || 'totalCount' in raw)) {
        return {
          data: raw.data,
          total: raw.total ?? raw.totalCount ?? raw.data.length,
          hasMore: raw.hasMore,
          cursor: raw.cursor,
        };
      }

      // Common envelope patterns
      for (const key of ['data', 'items', 'results', 'records', 'value']) {
        if (Array.isArray(raw[key])) {
          return {
            data: raw[key],
            total: raw.total ?? raw.totalCount ?? raw.count ?? raw[key].length,
            hasMore: raw.hasMore ?? raw.hasNextPage,
          };
        }
      }

      // Single-object response — wrap as array
      return { data: [raw as T], total: 1 };
    }

    return { data: [], total: 0 };
  }
}
