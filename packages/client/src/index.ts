// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { QueryAST, SortNode, AggregationNode, isFilterAST, type DroppedFieldsEvent } from '@objectstack/spec/data';
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
  GetMetaItemResponse,
  SaveMetaItemResponse,
  PublishMetaItemResponse,
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
  ListNotificationsResponse,
  MarkNotificationsReadResponse,
  MarkAllNotificationsReadResponse,
  // The AI wire types (#3718). `Ai{Nlq,Suggest,Insights}{Request,Response}`
  // used to be here; they typed three endpoints nothing has ever mounted and
  // went with the methods that called them. These type the routes that exist.
  AiMessage,
  AiChatRequest,
  AiChatResponse,
  AiStreamChunk,
  AiCompleteRequest,
  AiModelsResponse,
  AiConversation,
  CreateAiConversationRequest,
  ListAiConversationsRequest,
  ListAiConversationsResponse,
  UpdateAiConversationRequest,
  AiAgentSummary,
  AiAgentsResponse,
  AiAgentChatRequest,
  AiPendingAction,
  ListAiPendingActionsRequest,
  ListAiPendingActionsResponse,
  ApproveAiPendingActionResponse,
  RejectAiPendingActionResponse,
  GetLocalesResponse,
  GetTranslationsResponse,
  GetFieldLabelsResponse,
  RegisterRequest,
  WellKnownCapabilities,
  // [#5672] A VALUE, not a type: the capability vocabulary's key list, so the
  // getter below enumerates the spec's keys instead of the server's.
  WELL_KNOWN_CAPABILITY_KEYS,
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
  CrossObjectBatchOperation,
  CrossObjectBatchRequest,
  CrossObjectBatchResponse,
} from '@objectstack/spec/api';
import type {
  ApprovalRequestRow,
  ApprovalActionRow,
  ApprovalStatus,
  ApprovalDecisionResult,
} from '@objectstack/spec/contracts';
import type { ExecutionStatus } from '@objectstack/spec/automation';
import type { InvitationStatus } from '@objectstack/spec/identity';
import { Logger, createLogger } from '@objectstack/core/logger';
import { RealtimeAPI } from './realtime-api';

/**
 * Route types that the client can resolve.
 * Covers all keys from `ApiRoutes` (the discovery schema). The former
 * client-only virtual routes (`views`, `permissions`) were removed in #3612 —
 * no server surface ever mounted them.
 */
export type ApiRouteType = keyof ApiRoutes;

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
 * This is the vocabulary `data.find()` still accepts — `find` itself
 * carries `@deprecated`; new code should call `data.query()` instead.
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

/**
 * [#6322] A key that exists on {@link QueryOptionsV2} and on NO spelling of the
 * legacy {@link QueryOptions} — computed by the type system, not restated by
 * hand. Presence of any one of them is what tells `data.find()` the caller
 * wrote canonical vocabulary.
 *
 * `aggregations` / `groupBy` are excluded automatically because both options
 * types declare them: shared vocabulary cannot discriminate between the two.
 */
type QueryOptionsV2OnlyKey = Exclude<keyof QueryOptionsV2, keyof QueryOptions>;

/**
 * Every canonical-only key, exhaustively.
 *
 * WHY A `Record<QueryOptionsV2OnlyKey, true>` AND NOT AN ARRAY OF STRINGS.
 * `data.find()` used to sniff the branch with a hand-written inline condition
 * (`'where' in options || 'fields' in options || 'orderBy' in options ||
 * 'offset' in options`), duplicated verbatim in both `find` copies. A
 * hand-written list is a second, independent statement of what
 * `QueryOptionsV2` declares, and it had already fallen behind that declaration
 * TWICE:
 *
 *   - `limit` was never in it, so `find('task', { limit: 20 })` — the most
 *     natural canonical spelling of "first 20" — fell to the legacy branch,
 *     which reads only `top`/`skip`/`sort`/`select`/`filter`/`filters`/
 *     `aggregations`/`groupBy`. Nothing there reads `limit`, so the value was
 *     dropped between the call and the wire: HTTP 200, server default page
 *     size, no warning. Its pagination twin `offset` WAS in the list, so one
 *     interface shipped two pagination keys with opposite behaviour.
 *   - `expand` was never in it either (see {@link canonicalExpandParam}).
 *
 * Appending the missing key would have been the third round of the same
 * mistake. This shape cannot fall behind: TypeScript rejects the object if a
 * canonical-only key is MISSING and rejects it if a key that is not
 * canonical-only is present, so the next key added to `QueryOptionsV2` is a
 * compile error here until it is listed — and both `find` copies pick it up
 * from this one definition on the same commit.
 */
const QUERY_OPTIONS_V2_ONLY_KEYS: Record<QueryOptionsV2OnlyKey, true> = {
  where: true,
  fields: true,
  orderBy: true,
  limit: true,
  offset: true,
  expand: true,
};

/**
 * Does this options bag speak canonical {@link QueryOptionsV2} vocabulary?
 *
 * ONE definition read by both `data.find()` implementations
 * (`ObjectStackClient` and `ScopedProjectClient`), which are two faces of one
 * wire contract and were byte-identical copies of the old inline condition.
 */
function isCanonicalQueryOptions(options: QueryOptions | QueryOptionsV2): options is QueryOptionsV2 {
  return Object.keys(QUERY_OPTIONS_V2_ONLY_KEYS).some((key) => key in options);
}

/**
 * `QueryOptionsV2.expand` → the `?expand=` transport spelling, or `undefined`
 * when there is nothing to expand.
 *
 * THE ACCEPTED SPELLING, verified against the server rather than invented:
 * `HttpFindQueryParamsSchema` (packages/spec/src/api/protocol.zod.ts) declares
 * `expand` on the GET list route as a "Comma-separated list of
 * lookup/master_detail field names to expand", and the protocol normalizer
 * (packages/metadata-protocol/src/protocol.ts, `findData`) splits that string
 * on commas and folds each name into `{ [name]: { object: name } }` before the
 * engine batch-loads it. So a comma-joined name list is not one encoding among
 * several — it is the only shape this route reads.
 *
 * Until #6322 `expand` was declared on `QueryOptionsV2`, documented as the
 * replacement for a legacy `populate` that `QueryOptions` never had, and mapped
 * on NEITHER branch: not one character of it reached the wire.
 *
 * WHY A NESTED PER-RELATION QUERY IS REFUSED RATHER THAN TRIMMED. The `Record`
 * form's KEYS are relation names — exactly what the server derives from the
 * comma list, so they map losslessly. Its VALUES are nested QueryASTs, and a
 * query string has no spelling for them: trimming them away would deliver a
 * wider read than the caller asked for and say nothing, which is the same
 * silent-drop defect this function exists to close (and the one the engine
 * itself refused inside `expand` in #4371). `data.query()` carries a QueryAST
 * body and is where nested expand detail belongs.
 */
function canonicalExpandParam(expand: QueryOptionsV2['expand']): string | undefined {
  if (expand == null) return undefined;

  let names: string[];
  if (Array.isArray(expand)) {
    names = expand.map((name) => String(name).trim()).filter(Boolean);
  } else if (typeof expand === 'object') {
    for (const [relation, nested] of Object.entries(expand)) {
      const nestedKeys = nested != null && typeof nested === 'object' && !Array.isArray(nested)
        ? Object.keys(nested as Record<string, unknown>)
        : [];
      if (nestedKeys.length > 0) {
        throw new Error(
          `data.find(): expand['${relation}'] carries a nested query (${nestedKeys.slice().sort().join(', ')}), `
          + 'but the list route accepts only `expand=<comma-separated relation names>` — a nested per-relation '
          + 'query has no transport spelling on a GET, so it would be dropped rather than applied. '
          + 'Pass relation names only, or use data.query() with a QueryAST `expand` for nested detail.',
        );
      }
    }
    names = Object.keys(expand).map((name) => name.trim()).filter(Boolean);
  } else {
    return undefined;
  }

  return names.length > 0 ? names.join(',') : undefined;
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
  /**
   * [#3431/#3455] Caller-supplied fields the server LEGALLY stripped before the
   * record was written — e.g. a non-system create cannot seed a static `readonly`
   * column (#3043), so those keys are dropped and the field re-derives its default.
   * Present only when ≥1 field was dropped; the create still succeeded. REST also
   * mirrors this in the `X-ObjectStack-Dropped-Fields` response header.
   */
  droppedFields?: DroppedFieldsEvent[];
}

/** Spec: UpdateDataResponseSchema */
export interface UpdateDataResult<T = any> {
  object: string;
  id: string;
  record: T;
  /**
   * [#3431/#3455] Caller-supplied fields the server LEGALLY stripped from the
   * write before persisting — static `readonly` (#2948) or a TRUE `readonlyWhen`
   * predicate (#3042). Present only when ≥1 field was dropped; the update still
   * succeeded. REST also mirrors this in the `X-ObjectStack-Dropped-Fields` header.
   */
  droppedFields?: DroppedFieldsEvent[];
}

/**
 * Spec: DeleteDataResponseSchema
 *
 * [#5638] The success flag is `success`, matching the schema this comment
 * names (`packages/spec/src/api/protocol.zod.ts`). It was declared `deleted`
 * — a key no schema has ever declared and no server path has ever returned on
 * `/data/:object/:id`, so `r.deleted` compiled and read `undefined` at
 * runtime. Both `delete` surfaces below are pure `unwrapResponse` / `_unwrap`
 * passthroughs: this interface is a claim about the server's body, never a
 * rewrite of it, so the claim has to be the schema's.
 */
export interface DeleteDataResult {
  object: string;
  id: string;
  success: boolean;
}

export interface StandardError {
  code: StandardErrorCode;
  message: string;
  category: ErrorCategory;
  httpStatus: number;
  retryable: boolean;
  details?: Record<string, any>;
}

/**
 * Parse an SSE response body into the JSON frames it carries.
 *
 * Used by `ai.chatStream` (#3718). Both AI streaming routes write one JSON
 * object per `data:` line and terminate with `data: [DONE]`, so this reads
 * line-by-line rather than splitting on the `\n\n` frame separator: the
 * encoder also emits a few single-`\n` `g:`-prefixed lines (the legacy Data
 * Stream Protocol form for reasoning deltas) that a frame-split would glue
 * onto the next event. Non-`data:` lines are skipped, as is a `data:` payload
 * that is not JSON — a malformed frame mid-stream must not destroy the frames
 * around it.
 *
 * A module-level function, not a client method: the SDK's URL-conformance
 * sweep enumerates every callable on the client and demands each one either
 * issue a request or carry an explicit non-HTTP reason. A parser is neither.
 */
async function* parseEventStream(res: Response): AsyncIterable<AiStreamChunk> {
  const body = res.body as (ReadableStream<Uint8Array> & AsyncIterable<Uint8Array>) | null | undefined;
  if (!body) {
    throw new Error('Streaming response carried no body — this runtime\'s fetch does not expose `Response.body`');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  const emit = function* (chunk: string): Generator<AiStreamChunk> {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;      // blank separators, `g:` reasoning frames
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        yield JSON.parse(payload) as AiStreamChunk;
      } catch {
        // A frame the server did not finish writing, or a non-JSON payload.
      }
    }
  };

  // `getReader()` in the browser and modern Node; async iteration for the
  // Node-stream bodies older fetch polyfills hand back.
  if (typeof body.getReader === 'function') {
    const reader = body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        yield* emit(decoder.decode(value, { stream: true }));
      }
    } finally {
      reader.releaseLock?.();
    }
  } else {
    for await (const value of body) {
      yield* emit(decoder.decode(value as Uint8Array, { stream: true }));
    }
  }

  yield* emit(decoder.decode());
}

/** Best human-readable text for an action failure, whatever shape carried it. */
function actionErrorMessage(e: any): string {
  if (typeof e === 'string' && e) return e;
  if (typeof e?.message === 'string' && e.message) return e.message;
  return 'Action failed';
}

/**
 * Fold a 2xx `POST /api/v1/actions/...` body into the `{ success, data?,
 * error? }` shape `client.actions.invoke` has always returned.
 *
 * `payload` is what `unwrapResponse` produced. On a #3962 server a 2xx means
 * the action ran and returned, and `payload` IS the handler's return value —
 * every failure (rejection 400, dispatch 404/403/503, crash 500) arrives as a
 * non-2xx, `fetch` throws on it, and `invoke` catches. This surface does not
 * throw either way.
 *
 * Servers older than #3962 answered a 2xx with the legacy INNER envelope —
 * `{success: true, data}` on success, `{success: false, error, code?,
 * fields?}` when the handler rejected. A current SDK still has to talk to
 * them, so that shape is detected NARROWLY (a `boolean` `success` and no keys
 * beyond the envelope's own) and unwrapped; anything else passes through as
 * the handler's data. The residual ambiguity — a handler whose own return
 * value is exactly envelope-shaped — is unavoidable while both servers exist
 * and resolves once the fleet is on #3962.
 */
function normalizeActionResult<T>(payload: any): { success: boolean; data?: T; error?: string } {
  const ENVELOPE_KEYS = new Set(['success', 'data', 'error', 'code', 'fields']);
  const legacy =
    payload && typeof payload === 'object' && !Array.isArray(payload)
    && typeof payload.success === 'boolean'
    && Object.keys(payload).every((k) => ENVELOPE_KEYS.has(k));
  if (legacy) {
    return payload.success === false
      ? { success: false, error: actionErrorMessage(payload.error) }
      : { success: true, data: payload.data as T };
  }
  return { success: true, data: payload as T };
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
   *
   * Returns `undefined` only when the client has not connected (or the server
   * returned no `capabilities` block at all). Otherwise **every** flag in the
   * vocabulary is present and boolean — see below.
   *
   * The server may return capabilities in hierarchical format
   * `{ key: { enabled: boolean } }` or flat boolean format `{ key: boolean }`.
   * This getter normalizes both to flat `WellKnownCapabilities`.
   *
   * ## [#5672] The type used to lie; now it does not
   *
   * This getter copied whatever keys the server happened to send and then
   * ASSERTED the result was a `WellKnownCapabilities`
   * (`result as unknown as WellKnownCapabilities`). The two discovery
   * producers filled disjoint key sets, so against a dispatcher-served host
   * `client.capabilities.transactionalBatch` was statically `boolean` and
   * actually `undefined` — as were `comments`, `cron`, `export` and
   * `chunkedUpload`. Every consumer that trusted the type got `undefined`
   * where it had been promised a boolean.
   *
   * The fix is not a wider return type: it is to stop copying the server's key
   * set. This iterates {@link WELL_KNOWN_CAPABILITY_KEYS} — the vocabulary
   * derived from `WellKnownCapabilitiesSchema` itself — so the returned object
   * has exactly the declared keys, all boolean, BY CONSTRUCTION. The assertion
   * is gone because there is nothing left to assert. Add a key to the spec and
   * this getter reports it with no edit here.
   *
   * Two deliberate reading rules:
   *
   * * **A key the server omits reads `false`**, matching the wire contract's
   *   own rule (ruling A: an undelivered capability is `enabled: false`). Since
   *   protocol 18 every conforming producer sends every key, so this only
   *   applies to a server that predates the vocabulary — and for a capability
   *   flag, "assume absent" is the fail-closed direction: a consumer skips the
   *   feature instead of calling an endpoint that may not exist.
   * * **Only a real `true` counts.** A non-boolean (`"yes"`, `1`) is off-spec
   *   on a machine-readable surface, and coercing it would fossilise a second
   *   dialect in the consumer — exactly the tolerance Prime Directive #12
   *   forbids. It reads `false` and the producer's conformance gate is the
   *   place that says so out loud.
   */
  get capabilities(): WellKnownCapabilities | undefined {
    const raw = this.discoveryInfo?.capabilities;
    if (!raw) return undefined;
    const source = raw as Record<string, unknown>;
    // Seeded empty and filled from the vocabulary's own key list, which is why
    // the result really is a complete `WellKnownCapabilities` when the loop ends.
    const flags = {} as WellKnownCapabilities;
    for (const key of WELL_KNOWN_CAPABILITY_KEYS) {
      const value = source[key];
      flags[key] = typeof value === 'object' && value !== null
        ? (value as { enabled?: unknown }).enabled === true
        : value === true;
    }
    return flags;
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
     *
     * Answers the spec's `GetMetaItemResponseSchema` envelope: the metadata
     * document lives under `item`, NOT spread at the top level. Naming that
     * type here is honest only because #5563 converged every serving path on
     * it — the cached path (the default one) used to answer the bare document,
     * so before that convergence no annotation could describe both (#5545).
     */
    getItem: async (type: string, name: string, options?: { packageId?: string }): Promise<GetMetaItemResponse> => {
        const route = this.getRoute('metadata');
        const params = new URLSearchParams();
        if (options?.packageId) params.set('package', options.packageId);
        const qs = params.toString();
        const url = `${this.baseUrl}${route}/${type}/${name}${qs ? `?${qs}` : ''}`;
        const res = await this.fetch(url);
        return this.unwrapResponse<GetMetaItemResponse>(res);
    },

    /**
     * Save a metadata item
     * @param type - Metadata type (e.g., 'object', 'plugin')
     * @param name - Item name
     * @param item - The metadata content to save
     *
     * The resolved `version` is the ADR-0008 optimistic-concurrency token:
     * echo it back as the `If-Match` request header on the next write to the
     * same item and a concurrent edit is reported as 409 `metadata_conflict`
     * instead of silently overwriting. It is nameable here only because
     * `SaveMetaItemResponseSchema` declares the full body since #5745 — the
     * declaration used to stop at `{ success, message }`, and annotating
     * against that subset would have hidden the OCC carrier (#5545).
     */
    saveItem: async (type: string, name: string, item: any): Promise<SaveMetaItemResponse> => {
        const route = this.getRoute('metadata');
        const res = await this.fetch(`${this.baseUrl}${route}/${type}/${name}`, {
            method: 'PUT',
            body: JSON.stringify(item)
        });
        return this.unwrapResponse<SaveMetaItemResponse>(res);
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
        // Path-param dialect (#3611): both surfaces accept it — the dispatcher
        // /ui domain takes /view/:object/:type?, and the REST server mounts
        // ONLY /ui/view/:object/:type. The old ?type= query dialect matched
        // nothing on REST, so it 404'd wherever REST is the serving surface
        // (e.g. project-scoped bases).
        const res = await this.fetch(
            `${this.baseUrl}${route}/view/${encodeURIComponent(object)}/${type}`,
        );
        return this.unwrapResponse(res);
    },

    /* [#3563 PR-5] The three meta routes that had no SDK expression. */

    /**
     * ADR-0033: the published version of a metadata item. Compound names are
     * passed through unencoded (e.g. `getPublished('lead', 'views/all_leads')`),
     * matching how `getItem` addresses sub-resources.
     */
    getPublished: async (type: string, name: string) => {
        const route = this.getRoute('metadata');
        const res = await this.fetch(`${this.baseUrl}${route}/${type}/${name}/published`);
        return this.unwrapResponse<any>(res);
    },

    /**
     * ADR-0033: pending drafts — metadata authored (e.g. by an AI) but not
     * yet published, which the active-only item lists hide.
     */
    listDrafts: async (opts?: { packageId?: string; type?: string }) => {
        const route = this.getRoute('metadata');
        const params = new URLSearchParams();
        if (opts?.packageId) params.set('packageId', opts.packageId);
        if (opts?.type) params.set('type', opts.type);
        const qs = params.toString();
        const res = await this.fetch(`${this.baseUrl}${route}/_drafts${qs ? `?${qs}` : ''}`);
        return this.unwrapResponse<any>(res);
    },

    /**
     * ADR-0087: rewrite stored `sys_metadata` rows into today's canonical
     * shape — the server-side form of `os migrate meta --stored` (#4327),
     * for operators who cannot reach the deployment's database from a shell.
     *
     * **Preview by default.** Without `apply: true` this reports what it
     * would do and writes nothing; the report is the same
     * `StoredMigrationReport` the CLI renders (`scanned` / `canonical` /
     * `pending` / `rewritten` / `skipped` / `failed`, plus a `rows` list of
     * everything that is not already canonical).
     *
     * Requires the `manage_metadata` capability (403 otherwise) — it rewrites
     * every eligible row in the deployment, not one item.
     */
    migrateStored: async (opts?: { apply?: boolean; types?: string[] }) => {
        const route = this.getRoute('metadata');
        const res = await this.fetch(`${this.baseUrl}${route}/_migrate-stored`, {
            method: 'POST',
            body: JSON.stringify({
                ...(opts?.apply === true ? { apply: true } : {}),
                ...(opts?.types && opts.types.length > 0 ? { types: opts.types } : {}),
            }),
        });
        return this.unwrapResponse<any>(res);
    },

    /**
     * ADR-0020 D3.3 FSM introspection: the legal next states for `field`
     * from state `from`, per the object's `state_machine` validation rule.
     * `next` is `null` when no FSM governs the field (or `from` is omitted),
     * `[]` for a declared dead-end state.
     */
    getLegalNextStates: async (object: string, field: string, from?: string) => {
        const route = this.getRoute('metadata');
        const qs = from !== undefined ? `?from=${encodeURIComponent(from)}` : '';
        const res = await this.fetch(
            `${this.baseUrl}${route}/objects/${encodeURIComponent(object)}/state/${encodeURIComponent(field)}${qs}`,
        );
        return this.unwrapResponse<{ object: string; field: string; from: string | null; next: string[] | null }>(res);
    },

    /**
     * Cross-type spec-validation sweep: every metadata entry that fails its
     * registered Zod schema. Powers governance dashboards and doctor-style
     * checks. 501s on kernels without `getMetaDiagnostics`.
     */
    getDiagnostics: async (opts?: { type?: string; severity?: 'error' | 'warning'; packageId?: string }) => {
        const route = this.getRoute('metadata');
        const params = new URLSearchParams();
        if (opts?.type) params.set('type', opts.type);
        if (opts?.severity) params.set('severity', opts.severity);
        if (opts?.packageId) params.set('package', opts.packageId);
        const qs = params.toString();
        const res = await this.fetch(`${this.baseUrl}${route}/diagnostics${qs ? `?${qs}` : ''}`);
        return this.unwrapResponse<any>(res);
    },

    /**
     * Reverse references: metadata items that reference `type`/`name`.
     * `{ references: [] }` on kernels without reference tracking.
     */
    getReferences: async (type: string, name: string) => {
        const route = this.getRoute('metadata');
        const res = await this.fetch(`${this.baseUrl}${route}/${type}/${name}/references`);
        return this.unwrapResponse<any>(res);
    },

    /**
     * ADR-0046 §6: resolve a book spine against the docs that exist now.
     * An unknown name is treated as a package id (implicit per-package book).
     */
    getBookTree: async (name: string, opts?: { packageId?: string }) => {
        const route = this.getRoute('metadata');
        const qs = opts?.packageId ? `?package=${encodeURIComponent(opts.packageId)}` : '';
        const res = await this.fetch(`${this.baseUrl}${route}/book/${encodeURIComponent(name)}/tree${qs}`);
        return this.unwrapResponse<any>(res);
    },

    /**
     * ADR-0010 §3.6 protection-audit trail for a metadata item: recent
     * save/publish/rollback/delete/reset attempts, allowed and denied.
     * `{ events: [] }` where the audit table is not provisioned.
     */
    getAudit: async (type: string, name: string, opts?: { limit?: number }) => {
        const route = this.getRoute('metadata');
        const qs = opts?.limit !== undefined ? `?limit=${opts.limit}` : '';
        const res = await this.fetch(`${this.baseUrl}${route}/${type}/${name}/audit${qs}`);
        return this.unwrapResponse<any>(res);
    },

    /**
     * ADR-0033: promote a single item's pending draft overlay to live —
     * the per-item flow beside `packages.publishDrafts`' package-scoped one.
     * 404 [no_draft] when there is nothing to publish. Compound names pass
     * through unencoded, like `getItem`.
     *
     * The resolved `version` is the ADR-0008 optimistic-concurrency token, the
     * same carrier `saveItem` returns and with the same job: echo it back as
     * `If-Match` on the next write to the item. It is nameable here only since
     * #7294, which declared `PublishMetaItemResponseSchema` — this method
     * resolved to `any` before that, because the publish door had no
     * declaration at all for a return type to point at.
     *
     * The three `*Applied` receipts are each present only when their side
     * effect ran, and each reports its own `success`: a 200 here means the
     * draft was promoted, NOT that a seed load or a data-plane projection
     * caught up.
     */
    publishItem: async (
        type: string,
        name: string,
        opts?: { message?: string },
    ): Promise<PublishMetaItemResponse> => {
        const route = this.getRoute('metadata');
        const res = await this.fetch(`${this.baseUrl}${route}/${type}/${name}/publish`, {
            method: 'POST',
            body: JSON.stringify(opts?.message ? { message: opts.message } : {}),
        });
        return this.unwrapResponse<PublishMetaItemResponse>(res);
    },

    /**
     * Restore the body at history version `toVersion` as the new live row.
     */
    rollbackItem: async (type: string, name: string, toVersion: number, opts?: { message?: string }) => {
        const route = this.getRoute('metadata');
        const res = await this.fetch(`${this.baseUrl}${route}/${type}/${name}/rollback`, {
            method: 'POST',
            body: JSON.stringify({ toVersion, ...(opts?.message ? { message: opts.message } : {}) }),
        });
        return this.unwrapResponse<any>(res);
    },

    /**
     * Structural diff between two history versions (`from`/`to`); omit both
     * for previous-vs-current.
     */
    diffItem: async (type: string, name: string, opts?: { from?: number; to?: number }) => {
        const route = this.getRoute('metadata');
        const params = new URLSearchParams();
        if (opts?.from !== undefined) params.set('from', String(opts.from));
        if (opts?.to !== undefined) params.set('to', String(opts.to));
        const qs = params.toString();
        const res = await this.fetch(`${this.baseUrl}${route}/${type}/${name}/diff${qs ? `?${qs}` : ''}`);
        return this.unwrapResponse<any>(res);
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
    /**
     * Cube metadata listing. Pass `cube` to filter to a single cube
     * (`?cube=` — [#3584] the dispatcher shape; the old `/meta/:cube` path
     * segment was served by nothing and 404ed everywhere).
     */
    meta: async (cube?: string) => {
        const route = this.getRoute('analytics');
        const qs = cube ? `?cube=${encodeURIComponent(cube)}` : '';
        const res = await this.fetch(`${this.baseUrl}${route}/meta${qs}`);
        return res.json();
    },
    /**
     * Dry-run a query to its generated SQL (`POST /analytics/sql` — [#3584]
     * the dispatcher route; the old `/explain` route name was served by
     * nothing and 404ed everywhere).
     */
    explain: async (payload: any) => {
        const route = this.getRoute('analytics');
        const res = await this.fetch(`${this.baseUrl}${route}/sql`, {
            method: 'POST',
            body: JSON.stringify(payload)
         });
         return res.json();
    },
    /**
     * ADR-0021 semantic-layer dataset query — the REST dialect
     * (`POST /analytics/dataset/query`), distinct from `query`'s dispatcher
     * dialect. Provide `dataset` (inline definition, Studio preview) or
     * `datasetName` (saved), plus `selection.measures`; `previewDrafts`
     * runs over draft-overlaid definitions (ADR-0037 P3). (#3587 gap closure)
     */
    queryDataset: async (payload: {
        dataset?: any;
        datasetName?: string;
        selection: { measures: string[]; [k: string]: any };
        previewDrafts?: boolean;
    }) => {
        const route = this.getRoute('analytics');
        const res = await this.fetch(`${this.baseUrl}${route}/dataset/query`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        return res.json();
    }
  };

  /**
   * Transactional email (M11.B1) — `IEmailService` behind the REST surface.
   * 501s cleanly on deployments without an email provider. (#3587 gap closure)
   */
  email = {
    /**
     * Send a message. Returns the service outcome verbatim — branch on
     * `status` (`sent` / `queued` / `failed`); the route answers 200 for all
     * three so failures carry their diagnostic body. `sentBy` defaults
     * server-side to the authenticated user.
     */
    send: async (message: {
        to: string | Array<string | { name?: string; address: string }>;
        subject: string;
        text?: string;
        html?: string;
        from?: any;
        cc?: any;
        bcc?: any;
        replyTo?: any;
        sentBy?: string;
        [k: string]: any;
    }): Promise<any> => {
        // [#6714] The base comes from `getRoute('email')`: a connected client
        // follows the server's advertised `routes.email` (the REST discovery
        // endpoint projects it from its recorded route registrations — the
        // mount follows `apiPath`, so the old hard-coded `/api/v1` was a live
        // 404 on any `apiPath` deployment); an unconnected client — or one
        // talking to a server that advertises no `email` key — falls back to
        // the `/api/v1/email` convention, byte-identical to the old hardcode.
        const route = this.getRoute('email');
        const res = await this.fetch(`${this.baseUrl}${route}/send`, {
            method: 'POST',
            body: JSON.stringify(message),
        });
        return this.unwrapResponse<any>(res);
    },
  };

  /**
   * External-datasource federation admin (ADR-0015 Addendum) — the
   * direct-mount routes `@objectstack/rest` registers for browsing a remote
   * catalog and importing tables as federated objects. 503
   * [external_service_unavailable] without the `external-datasource`
   * service. (#3587 gap closure)
   *
   * [#6633] The family base comes from `getRoute('datasources')`: a connected
   * client follows the server's advertised `routes.datasources` (the REST
   * discovery endpoint derives it from its recorded mounts, ADR-0076 D12);
   * an unconnected client — or one talking to a server that advertises no
   * `datasources` key — falls back to the `/api/v1/datasources` convention,
   * byte-identical to the pre-#6633 hardcode.
   */
  datasources = {
    external: {
        /** List remote tables on a datasource, optionally by `schema`. */
        listTables: async (name: string, opts?: { schema?: string }): Promise<any> => {
            const qs = opts?.schema ? `?schema=${encodeURIComponent(opts.schema)}` : '';
            const route = this.getRoute('datasources');
            const res = await this.fetch(
                `${this.baseUrl}${route}/${encodeURIComponent(name)}/external/tables${qs}`,
            );
            return this.unwrapResponse<any>(res);
        },

        /** Generate an Object draft (structured + `*.object.ts` source) from a remote table. */
        draft: async (name: string, remoteTable: string, opts?: Record<string, any>): Promise<any> => {
            const route = this.getRoute('datasources');
            const res = await this.fetch(
                `${this.baseUrl}${route}/${encodeURIComponent(name)}/external/tables/${encodeURIComponent(remoteTable)}/draft`,
                { method: 'POST', body: JSON.stringify(opts ?? {}) },
            );
            return this.unwrapResponse<any>(res);
        },

        /**
         * Import a remote table as a live federated object ("Import as
         * Object"). 400 [external_import_error] when refused.
         */
        import: async (name: string, remoteTable: string, opts?: Record<string, any>): Promise<any> => {
            const route = this.getRoute('datasources');
            const res = await this.fetch(
                `${this.baseUrl}${route}/${encodeURIComponent(name)}/external/tables/${encodeURIComponent(remoteTable)}/import`,
                { method: 'POST', body: JSON.stringify(opts ?? {}) },
            );
            return this.unwrapResponse<any>(res);
        },

        /** Refresh and return the cached remote-catalog snapshot. */
        refreshCatalog: async (name: string): Promise<any> => {
            const route = this.getRoute('datasources');
            const res = await this.fetch(
                `${this.baseUrl}${route}/${encodeURIComponent(name)}/external/refresh-catalog`,
                { method: 'POST', body: JSON.stringify({}) },
            );
            return this.unwrapResponse<any>(res);
        },

        /** Validate this datasource's federated objects against the remote schema. */
        validate: async (name: string): Promise<any> => {
            const route = this.getRoute('datasources');
            const res = await this.fetch(
                `${this.baseUrl}${route}/${encodeURIComponent(name)}/external/validate`,
                { method: 'POST', body: JSON.stringify({}) },
            );
            return this.unwrapResponse<any>(res);
        },
    },
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
     *
     * By default the server rejects a manifest whose `id` is already
     * installed with **409 Conflict** (duplicate-id guard) instead of
     * silently overwriting the existing package. Intentional upgrade /
     * re-install flows opt back in with `overwrite: true`.
     */
    install: async (
        manifest: any,
        options?: { settings?: Record<string, any>; enableOnInstall?: boolean; overwrite?: boolean },
    ) => {
        const route = this.getRoute('packages');
        const res = await this.fetch(`${this.baseUrl}${route}`, {
            method: 'POST',
            body: JSON.stringify({
                manifest,
                settings: options?.settings,
                enableOnInstall: options?.enableOnInstall,
                ...(options?.overwrite !== undefined ? { overwrite: options.overwrite } : {}),
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

    /* [#3563 PR-4] Lifecycle beyond install/enable — these eleven routes
     * existed server-side (ADR-0033 drafts, ADR-0067 commits, ADR-0070
     * portability) with no SDK expression; Studio reached them via raw
     * fetch. Shapes mirror `domains/packages.ts` exactly. */

    /**
     * Edit a package's manifest (partial: name / description / version).
     * Identity (`id` / `scope` / `type`) and lifecycle state are not editable
     * here; the server rejects an empty patch and non-semantic versions.
     */
    update: async (id: string, patch: { name?: string; description?: string; version?: string }) => {
        const route = this.getRoute('packages');
        const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify(patch),
        });
        return this.unwrapResponse<any>(res);
    },

    /** Publish the package's metadata snapshot. */
    publish: async (id: string, opts?: Record<string, unknown>) => {
        const route = this.getRoute('packages');
        const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(id)}/publish`, {
            method: 'POST',
            body: JSON.stringify(opts ?? {}),
        });
        return this.unwrapResponse<any>(res);
    },

    /**
     * ADR-0033 "publish whole app": promote every pending draft bound to the
     * package to active in one shot. Published `seed` drafts also materialize
     * their rows (reported under `seedApplied`).
     */
    publishDrafts: async (id: string, opts?: { actor?: string }) => {
        const route = this.getRoute('packages');
        const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(id)}/publish-drafts`, {
            method: 'POST',
            body: JSON.stringify(opts ?? {}),
        });
        return this.unwrapResponse<any>(res);
    },

    /** ADR-0033: drop every pending draft bound to the package. */
    discardDrafts: async (id: string, opts?: { actor?: string }) => {
        const route = this.getRoute('packages');
        const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(id)}/discard-drafts`, {
            method: 'POST',
            body: JSON.stringify(opts ?? {}),
        });
        return this.unwrapResponse<any>(res);
    },

    /** ADR-0067: the package's commit timeline (newest-first). */
    listCommits: async (id: string) => {
        const route = this.getRoute('packages');
        const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(id)}/commits`);
        return this.unwrapResponse<{ commits: any[] }>(res);
    },

    /** ADR-0067: revert ONE commit (the revert is itself a commit). */
    revertCommit: async (id: string, commitId: string, opts?: { actor?: string }) => {
        const route = this.getRoute('packages');
        const res = await this.fetch(
            `${this.baseUrl}${route}/${encodeURIComponent(id)}/commits/${encodeURIComponent(commitId)}/revert`,
            { method: 'POST', body: JSON.stringify(opts ?? {}) },
        );
        return this.unwrapResponse<any>(res);
    },

    /** ADR-0067: roll back through all commits newer than `commitId`. */
    rollback: async (id: string, commitId: string, opts?: { actor?: string }) => {
        const route = this.getRoute('packages');
        const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(id)}/rollback`, {
            method: 'POST',
            body: JSON.stringify({ commitId, ...(opts ?? {}) }),
        });
        return this.unwrapResponse<any>(res);
    },

    /** Revert the package to its last published state. */
    revert: async (id: string) => {
        const route = this.getRoute('packages');
        const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(id)}/revert`, {
            method: 'POST',
        });
        return this.unwrapResponse<{ success: boolean }>(res);
    },

    /**
     * ADR-0070: assemble the package's portable manifest (offline export) —
     * the same shape `marketplace-install-local` consumes.
     */
    export: async (id: string) => {
        const route = this.getRoute('packages');
        const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(id)}/export`);
        return this.unwrapResponse<any>(res);
    },

    /** ADR-0070 D5: bulk-rebind package-less (orphaned) metadata into this base. */
    adoptOrphans: async (id: string, opts?: { actor?: string }) => {
        const route = this.getRoute('packages');
        const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(id)}/adopt-orphans`, {
            method: 'POST',
            body: JSON.stringify(opts ?? {}),
        });
        return this.unwrapResponse<any>(res);
    },

    /**
     * ADR-0070 D4: clone this base into a NEW writable package,
     * re-namespacing objects and rewriting references.
     * `targetPackageId` is required (the server 400s without it).
     */
    duplicate: async (
        id: string,
        targetPackageId: string,
        opts?: { targetName?: string; targetNamespace?: string; actor?: string },
    ) => {
        const route = this.getRoute('packages');
        const res = await this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(id)}/duplicate`, {
            method: 'POST',
            body: JSON.stringify({ targetPackageId, ...(opts ?? {}) }),
        });
        return this.unwrapResponse<any>(res);
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
     *
     * No `template_id`: it was removed in #3731 because no control plane has
     * ever read it — the `blank`/`crm`/`todo` registry it addressed died with
     * the `apps/server` templates route, and `sys_environment` has no such
     * column, so the field was accepted, transmitted, and dropped. Starter
     * content is installed from the App Marketplace (`sys_package` with
     * `is_starter = true`), which `projects.packages.install` already does.
     * Its listing counterpart went the same way in #3702.
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

    // The former `listTemplates` was removed in #3702 — it built
    // `GET /api/v1/cloud/templates`, which nothing mounts in this repo or in
    // `cloud` (the string occurred exactly once in each: at the call itself),
    // so every invocation was a 404. Templates are a DATA concept — the
    // `sys_package_templates` view over `sys_package` (`is_starter = true`) —
    // never a route; `cloud`'s ledger pins that absence deliberately. It comes
    // back when a route exists to back it, with an `sdk` ledger row proving so.

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
   * @internal The unscoped API base this client's server actually serves,
   * derived from the advertised routes (#6714 face 3).
   *
   * There is no discovery key that carries the raw API base itself, and the
   * `scoping` block carries posture only (`enabled` / `resolution` / `scoped`
   * / `environmentId` — no path), so the one derivable source is
   * `routes.data`: the REST discovery endpoint advertises it as
   * `{realBase}{dataPrefix}` with `dataPrefix` defaulting to `/data`. This
   * derivation strips that conventional suffix; when the deployment customises
   * `dataPrefix` away from `/data` the derivation declines and the caller
   * falls back to the `/api/v1` convention — exactly today's behavior, so the
   * change is strictly "follow the advertised base when it is derivable".
   *
   * When the discovery response was served from the environment-scoped mount
   * (`scoping.scoped`), `routes.data` is `{base}/environments/{id}/data`; the
   * scope segment must come off so the returned base is the UNSCOPED one (the
   * scoped client re-appends its own environment id, which need not be the one
   * discovery resolved). `scoping.environmentId` names that segment when the
   * server resolved one — but rest advertises it as `req.params?.environmentId`,
   * so a host that did not populate the route param answers `scoped: true` with
   * NO id and a `routes.data` still carrying the literal `:environmentId`. That
   * case strips one trailing `/environments/{segment}` on the strength of
   * `scoped` alone, which is sound because a scoped response's base ends with
   * that segment by construction. If NEITHER shape is present the advertised
   * base is not one this derivation understands, so it declines rather than
   * return a base of unknown shape — handing back a still-scoped base would make
   * `scope()` build a doubled `/environments/…/environments/…` URL, i.e.
   * strictly WORSE than the hardcode this replaces. Declining is always
   * byte-identical to today.
   */
  _apiBase(): string {
    const data = this.discoveryInfo?.routes?.data;
    if (typeof data === 'string' && data.endsWith('/data')) {
      let base = data.slice(0, -'/data'.length);
      const scoping = this.discoveryInfo?.scoping;
      if (scoping?.scoped) {
        const advertised = typeof scoping.environmentId === 'string' && scoping.environmentId
          ? `/environments/${scoping.environmentId}`
          : undefined;
        if (advertised && base.endsWith(advertised)) {
          base = base.slice(0, -advertised.length);
        } else {
          const stripped = base.replace(/\/environments\/[^/]+$/, '');
          if (stripped === base) return '/api/v1';
          base = stripped;
        }
      }
      if (base) return base;
    }
    return '/api/v1';
  }

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
       * List pending/accepted/rejected/expired/canceled invitations for an
       * organization. Requires owner/admin role on that org.
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
        // [#7781] `status` is `InvitationStatus` (from `@objectstack/spec/identity`)
        // rather than a hand-copied literal — the SDK previously restated the
        // vocabulary and drifted from it (missing `expired`). Derived from the
        // spec union, so a future value reaches here by construction; see
        // `invitation-status-vocabulary.test.ts` for the pin.
        return { invitations: invitations as Array<{
          id: string;
          email: string;
          role: string;
          status: InvitationStatus;
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
        // [#7781] Was a bare `string` — inconsistent with `list()` above and
        // just as untethered from the spec vocabulary. Same derivation as
        // `list()`.
        return { invitations: invitations as Array<{
          id: string;
          email: string;
          role: string;
          status: InvitationStatus;
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
          /** Authority that vouched for `providerAccountId` — an OIDC issuer, or `local:…`. */
          issuer: string;
          /** The user's id at the provider — better-auth 1.7 renamed this from `accountId`. */
          providerAccountId: string;
          createdAt?: string;
          updatedAt?: string;
        }> };
      },

      /**
       * Unlink a provider connection.
       * better-auth: POST /unlink-account — `{ accountId }`, where `accountId`
       * is the account ROW id (the `id` from `accounts.list()`), NOT the user's
       * id at the provider. 1.7 narrowed the body from the old
       * `{ providerId, accountId? }` pair; the row id implies the provider.
       */
      unlink: async (req: { accountId: string }) => {
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

        // Surface the opaque sys_file id so the caller can store it in a file
        // field (ADR-0104 D3). The server now returns it; fall back to the
        // presigned id for an older server that does not.
        const completeJson = (await completeRes.json()) as FileUploadResponse;
        if (completeJson?.data && completeJson.data.fileId == null) {
            completeJson.data.fileId = presigned.fileId;
        }
        return completeJson;
    },
    
    /**
     * Resolve a committed file to a short-lived signed download URL.
     *
     * Read through `unwrapResponse` rather than off the raw body: the route
     * answers the declared `{ success: true, data: { url } }` envelope as of
     * #3689, and this SDK ships as its own npm package against servers it was
     * not built with. `unwrapResponse` strips the envelope when it is there
     * and hands back the body untouched when it is not, so a client on either
     * side of that server upgrade resolves the same URL. That is the SDK's one
     * standard envelope seam — every other enveloped method already goes
     * through it — not a fallback grown for this route.
     */
    getDownloadUrl: async (fileId: string): Promise<string> => {
        const route = this.getRoute('storage');
        const res = await this.fetch(`${this.baseUrl}${route}/files/${fileId}/url`);
        const { url } = await this.unwrapResponse<{ url: string }>(res);
        return url;
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
     *
     * Throws before uploading anything when the progress poll reports the
     * session as `expired` — an `Error` carrying `code`
     * `'UPLOAD_SESSION_EXPIRED'` and `httpStatus` 410, the same pair the server
     * answers a chunk PUT against a dead session with (#7870).
     */
    resumeUpload: async (uploadId: string, file: Blob | ArrayBuffer, chunkSize: number, resumeToken: string): Promise<CompleteChunkedUploadResponse> => {
        const route = this.getRoute('storage');

        // 1. Get current progress
        const progressRes = await this.fetch(`${this.baseUrl}${route}/upload/chunked/${uploadId}/progress`);
        const progress = await progressRes.json() as UploadProgress;

        const { totalChunks, uploadedChunks, status, expiresAt } = progress.data;

        // [#7870] A session past its own `expires_at` is durably stamped
        // `expired` by the server (#7667), and THIS poll is where it says so —
        // `status` is a declared member of `UploadProgressSchema`, populated on
        // every progress read. Before this check the value was fetched and
        // dropped: resume walked straight into the chunk loop and learned the
        // session was dead from the 410 `UPLOAD_SESSION_EXPIRED` its first
        // chunk PUT came back with. Honest, but it spent a whole chunk upload
        // to rediscover something the response already in hand had told it.
        //
        // The code and status deliberately MIRROR that 410 rather than naming a
        // new condition: `UPLOAD_SESSION_EXPIRED` is the registered code the
        // server answers this exact case with (error-code-ledger.zod.ts), so a
        // caller's existing `err.code === 'UPLOAD_SESSION_EXPIRED'` branch
        // fires identically whether the expiry was caught here or by the
        // server. Same error shape as the `fetch` wrapper builds for a real
        // non-2xx (message + `code`/`httpStatus`/`details`) — this is an
        // earlier detection of one condition, not a second one.
        //
        // Compared with `=== 'expired'`, never truthiness: the other declared
        // statuses (`in_progress`, `completing`, `completed`, `failed`) all
        // proceed exactly as before — `failed` and wider status handling are
        // deliberately out of scope — and an absent `status` from a server or
        // fixture that omits it cannot misfire the short-circuit.
        if (status === 'expired') {
            const expiredError = new Error(
                `Upload session ${uploadId} expired${expiresAt ? ` at ${expiresAt}` : ''}`
                + '; start a new chunked upload',
            ) as Error & { code: string; httpStatus: number; details: Record<string, any> };
            expiredError.code = 'UPLOAD_SESSION_EXPIRED';
            expiredError.httpStatus = 410;
            expiredError.details = { uploadId, expiresAt };
            throw expiredError;
        }

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
      /* [#3563 PR-5] The three descriptor/status routes that had no SDK
       * expression — they back the Studio designer's pickers and badges. */

      /**
       * ADR-0018: registered action-node descriptors, optionally filtered by
       * `paradigm` / `source` / `category`. Empty registry → `{ actions: [], total: 0 }`.
       */
      listActions: async (opts?: { paradigm?: string; source?: string; category?: string }): Promise<{ actions: any[]; total: number }> => {
          const route = this.getRoute('automation');
          const params = new URLSearchParams();
          if (opts?.paradigm) params.set('paradigm', opts.paradigm);
          if (opts?.source) params.set('source', opts.source);
          if (opts?.category) params.set('category', opts.category);
          const qs = params.toString();
          const res = await this.fetch(`${this.baseUrl}${route}/actions${qs ? `?${qs}` : ''}`);
          return this.unwrapResponse(res);
      },

      /**
       * ADR-0022: registered connector descriptors (populated by connector
       * plugins), optionally filtered by `type`.
       */
      listConnectors: async (opts?: { type?: string }): Promise<{ connectors: any[]; total: number }> => {
          const route = this.getRoute('automation');
          const qs = opts?.type ? `?type=${encodeURIComponent(opts.type)}` : '';
          const res = await this.fetch(`${this.baseUrl}${route}/connectors${qs}`);
          return this.unwrapResponse(res);
      },

      /**
       * Runtime enable/bound state for every flow — engine state, not
       * persisted metadata (backs the Studio's Automations status badges).
       */
      getRuntimeStatus: async (): Promise<{ flows: Array<{ name: string; enabled: boolean; bound: boolean }>; total: number }> => {
          const route = this.getRoute('automation');
          const res = await this.fetch(`${this.baseUrl}${route}/_status`);
          return this.unwrapResponse(res);
      },

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
          opts?: { limit?: number; cursor?: string; status?: ExecutionStatus },
      ): Promise<T> => {
          const route = this.getRoute('automation');
          const params = new URLSearchParams();
          if (opts?.limit != null) params.set('limit', String(opts.limit));
          if (opts?.cursor) params.set('cursor', opts.cursor);
          // [#7359] The route's declared `status` filter, now that the boundary
          // honours it instead of dropping it. Until this card the typed client
          // could not send it at all — which is why nothing had tripped over the
          // server-side gap.
          if (opts?.status) params.set('status', opts.status);
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
      /**
       * Resume a run suspended at a `screen` (or `wait`) node — the
       * screen-flow runtime's second half (ADR-0019 durable pause).
       *
       * `execute()` returns `{ status: 'paused', runId, screen }` when a flow
       * reaches a screen node; the collected values go back through here as
       * `inputs` (applied as bare flow variables). The result is either the
       * NEXT `{ status: 'paused', screen }` of a multi-step wizard or the
       * terminal `AutomationResult`. Without this method a paused run can only
       * be finished by hand-rolling the HTTP call (#3528).
       *
       * **Not the door for an approval (#3801).** A run parked on an
       * `approval` node — directly, or as the child of a `subflow` pause — is
       * resumable only through the approvals API
       * ({@link ObjectStackClient.approvals}: `approve` / `reject` / `recall`),
       * which authorizes the decision and records it first. This call answers
       * **403** for one and changes nothing.
       *
       * **BREAKING since #8684 — a failed run REJECTS instead of resolving.**
       * A run that resumed and then failed used to come back as a resolved
       * `{ success: false, error, summary }`, riding HTTP 200, so a caller that
       * did not open the inner envelope read a failed run as a successful one.
       * The route now answers **400** `FLOW_FAILED` (inheriting #3962's ruling
       * for `/actions`), and every non-2xx throws out of this SDK's `fetch`
       * layer before any unwrapping — so this promise now **rejects**:
       *
       * ```ts
       * try { await client.automation.resume(flow, runId, { inputs }); }
       * catch (err: any) {
       *   err.code;                    // 'FLOW_FAILED'
       *   err.httpStatus;              // 400
       *   err.message;                 // the node failure, verbatim
       *   err.details?.errorMessage;   // the flow author's `errorMessage`
       *   err.details?.summary;        // per-node accounting of the failed run
       * }
       * ```
       *
       * A **stale** suspension (the flow deregistered, or the node edited away
       * under a live pause) rejects with **404** rather than 400: nothing ran,
       * and the pause is gone for good. The refusals that leave the suspension
       * intact keep their own codes and stay retryable — `INVALID_SIGNAL` /
       * `INVALID_SCREEN_INPUT` (400), `RESUME_IN_PROGRESS` (409),
       * `STORE_UNAVAILABLE` (503).
       */
      resume: async <T = any>(
          flowName: string,
          runId: string,
          signal?: {
              /** Screen input values, applied as bare flow variables. */
              inputs?: Record<string, unknown>;
              /** Node output, namespaced under the suspended node's id. */
              output?: Record<string, unknown>;
              /** Out-edge to follow (e.g. an approval's `approve` / `reject`). */
              branchLabel?: string;
          },
      ): Promise<T> => {
          const route = this.getRoute('automation');
          const res = await this.fetch(
              `${this.baseUrl}${route}/${encodeURIComponent(flowName)}/runs/${encodeURIComponent(runId)}/resume`,
              { method: 'POST', body: JSON.stringify(signal ?? {}) },
          );
          return this.unwrapResponse(res) as Promise<T>;
      },
      /**
       * Fetch the screen a paused run is waiting on — lets a client that did
       * not launch the run (a reload, a different tab, an inbox) render the
       * pending step before calling {@link resume}.
       */
      getScreen: async <T = any>(flowName: string, runId: string): Promise<T> => {
          const route = this.getRoute('automation');
          const res = await this.fetch(
              `${this.baseUrl}${route}/${encodeURIComponent(flowName)}/runs/${encodeURIComponent(runId)}/screen`,
          );
          return this.unwrapResponse(res) as Promise<T>;
      },
  };

  /**
   * Server-registered Actions (#3563 gap closure)
   *
   * Dispatches named action handlers registered server-side via
   * `engine.registerAction(objectName, actionName, handler)`. Until this
   * surface existed, `POST /api/v1/actions/...` was entirely unreachable from
   * the SDK — every console hand-rolled `fetch` for it (the largest functional
   * hole found by the #3563 route audit).
   *
   * The path is fixed (`/api/v1/actions`), not discovery-routed: `actions` is
   * not part of `ApiRoutesSchema`, so `getRoute()` cannot resolve it — same
   * precedent as the `projects` surface's `/api/v1/cloud`.
   *
   * The dispatcher accepts the record id either in the URL or in the body;
   * this client always sends it in the body (`{ recordId, params }`), which
   * both server shapes honor.
   *
   * Result shape is `{ success, data | error }` and this surface does NOT
   * throw — a failed business action is a toast, not a crash.
   *
   * Since #3962 every failure speaks HTTP: 400 rejection (with `code` /
   * `fields` in `error.details`), 404 unregistered, 403 denied, 503
   * unavailable, 500 crash. `fetch` throws on any non-2xx, so `invoke`
   * catches and folds it into this result instead of propagating. On success,
   * `data` is the handler's return value directly (single wrap); the legacy
   * double-wrapped 200s of pre-#3962 servers are still recognised and folded.
   */
  actions = {
      /**
       * Invoke a server-registered action on an object.
       * Falls back to the server's object-less ('global') handler when no
       * object-specific handler is registered.
       */
      invoke: async <T = any>(
          objectName: string,
          actionName: string,
          opts?: { recordId?: string; params?: Record<string, unknown> },
      ): Promise<{ success: boolean; data?: T; error?: string }> => {
          try {
              const res = await this.fetch(
                  `${this.baseUrl}/api/v1/actions/${encodeURIComponent(objectName)}/${encodeURIComponent(actionName)}`,
                  {
                      method: 'POST',
                      body: JSON.stringify({ recordId: opts?.recordId, params: opts?.params ?? {} }),
                  },
              );
              return normalizeActionResult<T>(await this.unwrapResponse<any>(res));
          } catch (err: any) {
              // [#3913] `fetch` throws on every non-2xx, and a DISPATCH
              // failure is a non-2xx now (404 unregistered / 403 denied / 400
              // wrong type / 503 unavailable) — but this surface's contract is
              // to report, not throw, so it must not start propagating on the
              // routes that just gained a status. `fetch` has already lifted
              // the server's human-readable message onto `err.message` (with
              // `err.code` / `err.httpStatus` kept for programmatic use), so
              // the toast text is unchanged.
              return { success: false, error: actionErrorMessage(err) };
          }
      },

      /**
       * Invoke a global (object-less) action — the server's
       * `POST /actions/global/:action` shape, dispatched to the `'global'`
       * handler-registry key.
       */
      invokeGlobal: async <T = any>(
          actionName: string,
          opts?: { recordId?: string; params?: Record<string, unknown> },
      ): Promise<{ success: boolean; data?: T; error?: string }> => {
          return this.actions.invoke<T>('global', actionName, opts);
      },
  };

  /**
   * API Keys (#3563 gap closure)
   *
   * `POST /api/v1/keys` mints a `sys_api_key` for the CALLER — `user_id` is
   * pinned server-side and never read from the body, and the raw secret is
   * returned exactly once (only its hash is stored; it is never
   * re-displayable). Until this surface existed the SDK had no way to create
   * an API key at all. Fixed path — `keys` is not in `ApiRoutesSchema`
   * (same precedent as `actions` / `projects`).
   */
  keys = {
      /**
       * Mint an API key. Returns `{ id, name, prefix, key, expires_at? }` —
       * `key` is the raw secret, shown ONCE; store it immediately.
       * `expiresAt` accepts an ISO string or epoch (ms or s); the server
       * rejects past dates.
       */
      create: async (opts?: {
          name?: string;
          expiresAt?: string | number;
      }): Promise<{ id: string; name: string; prefix: string; key: string; expires_at?: string }> => {
          const res = await this.fetch(`${this.baseUrl}/api/v1/keys`, {
              method: 'POST',
              body: JSON.stringify({
                  ...(opts?.name != null ? { name: opts.name } : {}),
                  ...(opts?.expiresAt != null ? { expires_at: opts.expiresAt } : {}),
              }),
          });
          return this.unwrapResponse(res);
      },
  };

  /**
   * Share Links (#3563 gap closure)
   *
   * Authenticated management of record share links (`sys_share_link`).
   * The public consumption routes (`GET /share-links/:token/resolve`,
   * `GET /share-links/:token/messages`) are browser-facing token URLs and
   * deliberately stay out of the SDK. Listing is server-constrained to links
   * the CALLER created — a guessed recordId can never enumerate another
   * user's tokens. Fixed path — `share-links` is not in `ApiRoutesSchema`.
   */
  shareLinks = {
      /** Create a share link for a record. Returns the link row (incl. `token`). */
      create: async (
          object: string,
          recordId: string,
          opts?: {
              permission?: string;
              audience?: string;
              expiresAt?: string | null;
              emailAllowlist?: string[];
              password?: string;
              redactFields?: string[];
              label?: string;
          },
      ): Promise<any> => {
          const res = await this.fetch(`${this.baseUrl}/api/v1/share-links`, {
              method: 'POST',
              body: JSON.stringify({ object, recordId, ...(opts ?? {}) }),
          });
          return this.unwrapResponse(res);
      },

      /** List the caller's own share links, optionally filtered. */
      list: async (opts?: {
          object?: string;
          recordId?: string;
          includeRevoked?: boolean;
      }): Promise<any[]> => {
          const params = new URLSearchParams();
          if (opts?.object) params.set('object', opts.object);
          if (opts?.recordId) params.set('recordId', opts.recordId);
          if (opts?.includeRevoked) params.set('includeRevoked', 'true');
          const qs = params.toString();
          const res = await this.fetch(`${this.baseUrl}/api/v1/share-links${qs ? `?${qs}` : ''}`);
          return this.unwrapResponse(res);
      },

      /** Revoke a share link by id or token. */
      revoke: async (idOrToken: string): Promise<{ ok: boolean }> => {
          const res = await this.fetch(
              `${this.baseUrl}/api/v1/share-links/${encodeURIComponent(idOrToken)}`,
              { method: 'DELETE' },
          );
          return this.unwrapResponse(res);
      },
  };

  /**
   * Security Admin (#3563 gap closure)
   *
   * ADR-0090 D5/D9 suggested audience bindings: a package's
   * `isDefault: true` permission set is an install-time SUGGESTION to bind
   * it to the `everyone` position; these calls let an admin see and resolve
   * those suggestions. Anonymous callers are denied unconditionally
   * server-side, and confirm/dismiss run under the audience-anchor +
   * delegated-admin gates with the caller's own context. Fixed path —
   * `security` is not in `ApiRoutesSchema`.
   */
  security = {
      /**
       * ADR-0090 D6 access explanation: why a principal can (or cannot)
       * perform `operation` on `object` — the same code paths enforcement
       * runs, so the report is explained by construction. Explaining ANOTHER
       * user requires `manage_users` (403 otherwise); `recordId` narrows to
       * one concrete row (ADR-0095). `recordIds` is the batch form of the
       * same record-grained question (ADR-0095 / #8326): 1–200 ids answered
       * in one round trip, `decision.records[i]` answering `recordIds[i]`;
       * mutually exclusive with `recordId` — the server refuses a request
       * carrying both, or an empty/over-200 array, with a 400
       * (`ExplainRequestSchema` in `@objectstack/spec` is the authority;
       * this method forwards the body verbatim and does not itself
       * validate it). Sent via the POST transport; the GET query form is
       * the same contract. (#3587 gap closure)
       */
      explain: async (request: {
          object: string;
          operation?: 'read' | 'create' | 'update' | 'delete' | 'transfer' | 'restore' | 'purge';
          userId?: string;
          recordId?: string;
          recordIds?: string[];
      }): Promise<any> => {
          const res = await this.fetch(`${this.baseUrl}/api/v1/security/explain`, {
              method: 'POST',
              body: JSON.stringify(request),
          });
          return this.unwrapResponse<any>(res);
      },

      /**
       * ADR-0090 D12 / ADR-0105 D8 — what the CALLER may delegate: the
       * business units they may place people into (`placeableBusinessUnitIds`)
       * and the positions they may assign (`assignablePositions`), plus the
       * `adminScope`s those derive from.
       *
       * Shaped for a picker: a scoped-invitation form narrows its options with
       * this rather than offering the whole tree and letting the user find the
       * boundary by being refused. It NARROWS — the server-side gate still
       * decides. Strictly self-scoped (no target-user parameter), so it
       * discloses nothing beyond the caller's own authority; a tenant admin
       * comes back `isTenantAdmin: true` with everything enumerated.
       */
      describeDelegableScope: async (): Promise<any> => {
          const res = await this.fetch(`${this.baseUrl}/api/v1/security/my-delegable-scope`);
          return this.unwrapResponse<any>(res);
      },

      suggestedBindings: {
          /** List suggestions, optionally by `status` / `packageId` (reconciles first). */
          list: async (opts?: { status?: string; packageId?: string }): Promise<any> => {
              const params = new URLSearchParams();
              if (opts?.status) params.set('status', opts.status);
              if (opts?.packageId) params.set('packageId', opts.packageId);
              const qs = params.toString();
              const res = await this.fetch(
                  `${this.baseUrl}/api/v1/security/suggested-bindings${qs ? `?${qs}` : ''}`,
              );
              return this.unwrapResponse(res);
          },

          /** Confirm a suggestion — creates the anchor binding. */
          confirm: async (id: string): Promise<any> => {
              const res = await this.fetch(
                  `${this.baseUrl}/api/v1/security/suggested-bindings/${encodeURIComponent(id)}/confirm`,
                  { method: 'POST' },
              );
              return this.unwrapResponse(res);
          },

          /** Dismiss (decline) a suggestion. */
          dismiss: async (id: string): Promise<any> => {
              const res = await this.fetch(
                  `${this.baseUrl}/api/v1/security/suggested-bindings/${encodeURIComponent(id)}/dismiss`,
                  { method: 'POST' },
              );
              return this.unwrapResponse(res);
          },
      },
  };

  /**
   * Event Subscription API
   * Provides real-time event subscriptions for metadata and data changes
   */
  get events() {
    return this.realtimeAPI;
  }

  // The former `permissions`, `realtime`, and `workflow` namespaces were
  // removed in #3612: every method targeted a route no server surface mounts
  // (each family was underwritten only by an unconsumed spec DEFAULT_*_ROUTES
  // table), so every call was a guaranteed 404. Server-backed state-machine
  // reads live under `meta.getLegalNextStates`; approval decisions are the
  // `approvals` namespace (ADR-0019); realtime events are the local `events`
  // buffer until a real HTTP/WS session protocol exists.

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
    approve: async (requestId: string, decision?: { actorId?: string; comment?: string; attachments?: string[] }): Promise<ApprovalDecisionResult> => {
      const route = this.getRoute('approvals');
      const res = await this.fetch(`${this.baseUrl}${route}/requests/${encodeURIComponent(requestId)}/approve`, {
        method: 'POST',
        body: JSON.stringify({ actorId: decision?.actorId, comment: decision?.comment, attachments: decision?.attachments })
      });
      return this.unwrapResponse<ApprovalDecisionResult>(res);
    },

    /**
     * Record a reject decision on a request. Resumes the owning flow run down
     * the `reject` edge.
     */
    reject: async (requestId: string, decision?: { actorId?: string; comment?: string; attachments?: string[] }): Promise<ApprovalDecisionResult> => {
      const route = this.getRoute('approvals');
      const res = await this.fetch(`${this.baseUrl}${route}/requests/${encodeURIComponent(requestId)}/reject`, {
        method: 'POST',
        body: JSON.stringify({ actorId: decision?.actorId, comment: decision?.comment, attachments: decision?.attachments })
      });
      return this.unwrapResponse<ApprovalDecisionResult>(res);
    },

    /**
     * Hand a pending-approver slot to someone else (#1322 M2 — self-service
     * task delegation). `to` is the new approver; `from` defaults to the
     * caller. Records a `reassign` audit action and notifies the new approver.
     * (Standing out-of-office delegation is CRUD on `sys_approval_delegation`
     * via the generic data API, so it needs no dedicated helper here.)
     */
    reassign: async (
      requestId: string,
      input: { to: string; from?: string; actorId?: string; comment?: string },
    ): Promise<{ request: ApprovalRequestRow }> => {
      const route = this.getRoute('approvals');
      const res = await this.fetch(`${this.baseUrl}${route}/requests/${encodeURIComponent(requestId)}/reassign`, {
        method: 'POST',
        body: JSON.stringify({ to: input.to, from: input.from, actorId: input.actorId, comment: input.comment })
      });
      return this.unwrapResponse<{ request: ApprovalRequestRow }>(res);
    },

    /**
     * Recall (withdraw) a pending request. Submitter-only — the service
     * enforces access. (#3587 gap closure)
     */
    recall: async (requestId: string, opts?: { actorId?: string; comment?: string }): Promise<any> => {
      const route = this.getRoute('approvals');
      const res = await this.fetch(`${this.baseUrl}${route}/requests/${encodeURIComponent(requestId)}/recall`, {
        method: 'POST',
        body: JSON.stringify({ actorId: opts?.actorId, comment: opts?.comment }),
      });
      return this.unwrapResponse<any>(res);
    },

    /**
     * ADR-0044 send-back-for-revision: the request finalizes `returned` and
     * the flow run parks at a wait point. Pending-approver-only.
     */
    revise: async (requestId: string, opts?: { actorId?: string; comment?: string }): Promise<any> => {
      const route = this.getRoute('approvals');
      const res = await this.fetch(`${this.baseUrl}${route}/requests/${encodeURIComponent(requestId)}/revise`, {
        method: 'POST',
        body: JSON.stringify({ actorId: opts?.actorId, comment: opts?.comment }),
      });
      return this.unwrapResponse<any>(res);
    },

    /**
     * ADR-0044 resubmit-after-revision: re-enters the approval node.
     * Submitter-only. Returns the flow outcome (`resumed` / `autoRejected`).
     */
    resubmit: async (requestId: string, opts?: { actorId?: string; comment?: string }): Promise<any> => {
      const route = this.getRoute('approvals');
      const res = await this.fetch(`${this.baseUrl}${route}/requests/${encodeURIComponent(requestId)}/resubmit`, {
        method: 'POST',
        body: JSON.stringify({ actorId: opts?.actorId, comment: opts?.comment }),
      });
      return this.unwrapResponse<any>(res);
    },

    /** Nudge the pending approver(s); a thread interaction — the flow does not move. */
    remind: async (requestId: string, opts?: { actorId?: string; comment?: string }): Promise<any> => {
      const route = this.getRoute('approvals');
      const res = await this.fetch(`${this.baseUrl}${route}/requests/${encodeURIComponent(requestId)}/remind`, {
        method: 'POST',
        body: JSON.stringify({ actorId: opts?.actorId, comment: opts?.comment }),
      });
      return this.unwrapResponse<any>(res);
    },

    /** Ask the submitter for more information (thread interaction). */
    requestInfo: async (requestId: string, opts?: { actorId?: string; comment?: string }): Promise<any> => {
      const route = this.getRoute('approvals');
      const res = await this.fetch(`${this.baseUrl}${route}/requests/${encodeURIComponent(requestId)}/request-info`, {
        method: 'POST',
        body: JSON.stringify({ actorId: opts?.actorId, comment: opts?.comment }),
      });
      return this.unwrapResponse<any>(res);
    },

    /** Append a comment (optionally with attachments) to the request thread. */
    comment: async (requestId: string, opts: { comment: string; actorId?: string; attachments?: string[] }): Promise<any> => {
      const route = this.getRoute('approvals');
      const res = await this.fetch(`${this.baseUrl}${route}/requests/${encodeURIComponent(requestId)}/comment`, {
        method: 'POST',
        body: JSON.stringify({ actorId: opts.actorId, comment: opts.comment, attachments: opts.attachments }),
      });
      return this.unwrapResponse<any>(res);
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
   * Per-record sharing grants (#3587 gap closure)
   *
   * Manual (and rule-materialised) row-level access grants on a specific
   * record, served under the data surface. Every route 501s
   * [NOT_IMPLEMENTED] on deployments without the sharing service.
   */
  shares = {
    /** List the sharing grants on a record. */
    list: async (object: string, recordId: string): Promise<any[]> => {
        const route = this.getRoute('data');
        const res = await this.fetch(
            `${this.baseUrl}${route}/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}/shares`,
        );
        const body = await this.unwrapResponse<{ data?: any[] } | any[]>(res);
        return Array.isArray(body) ? body : (body?.data ?? []);
    },

    /**
     * Grant a principal access to a record. 400 [VALIDATION_FAILED] on a
     * bad recipient/level combination.
     */
    grant: async (
        object: string,
        recordId: string,
        opts: {
            recipientType: string;
            recipientId: string;
            accessLevel: string;
            source?: string;
            sourceId?: string;
            reason?: string;
        },
    ): Promise<any> => {
        const route = this.getRoute('data');
        const res = await this.fetch(
            `${this.baseUrl}${route}/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}/shares`,
            { method: 'POST', body: JSON.stringify(opts) },
        );
        return this.unwrapResponse<any>(res);
    },

    /** Revoke a share by its id. */
    revoke: async (object: string, recordId: string, shareId: string): Promise<{ deleted: boolean }> => {
        const route = this.getRoute('data');
        const res = await this.fetch(
            `${this.baseUrl}${route}/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}/shares/${encodeURIComponent(shareId)}`,
            { method: 'DELETE' },
        );
        if (res.status === 204) return { deleted: true };
        return this.unwrapResponse<{ deleted: boolean }>(res);
    },

    /**
     * Tenant-wide sharing RULES (M10.17) — criteria-based grants that
     * materialise into per-record shares. Top-of-surface admin routes
     * (`/api/v1/sharing/rules`), distinct from the per-record grants above.
     */
    rules: {
        /** List sharing rules, optionally by object / active-only. */
        list: async (opts?: { object?: string; activeOnly?: boolean }): Promise<any[]> => {
            const params = new URLSearchParams();
            if (opts?.object) params.set('object', opts.object);
            if (opts?.activeOnly !== undefined) params.set('activeOnly', String(opts.activeOnly));
            const qs = params.toString();
            const res = await this.fetch(`${this.baseUrl}/api/v1/sharing/rules${qs ? `?${qs}` : ''}`);
            const body = await this.unwrapResponse<{ data?: any[] } | any[]>(res);
            return Array.isArray(body) ? body : (body?.data ?? []);
        },

        /** Create or upsert a sharing rule. 400 [VALIDATION_FAILED] on a bad definition. */
        save: async (rule: {
            name: string;
            object: string;
            criteria?: any;
            recipientType?: string;
            recipientId?: string;
            accessLevel?: string;
            label?: string;
            description?: string;
            active?: boolean;
        }): Promise<any> => {
            const res = await this.fetch(`${this.baseUrl}/api/v1/sharing/rules`, {
                method: 'POST',
                body: JSON.stringify(rule),
            });
            return this.unwrapResponse<any>(res);
        },

        /** Get a sharing rule by id or name. 404 [RULE_NOT_FOUND] when absent. */
        get: async (idOrName: string): Promise<any> => {
            const res = await this.fetch(`${this.baseUrl}/api/v1/sharing/rules/${encodeURIComponent(idOrName)}`);
            return this.unwrapResponse<any>(res);
        },

        /** Delete a sharing rule; its materialised grants cascade. */
        delete: async (idOrName: string): Promise<{ deleted: boolean }> => {
            const res = await this.fetch(`${this.baseUrl}/api/v1/sharing/rules/${encodeURIComponent(idOrName)}`, {
                method: 'DELETE',
            });
            if (res.status === 204) return { deleted: true };
            return this.unwrapResponse<{ deleted: boolean }>(res);
        },

        /** Re-evaluate a rule against current data and reconcile its grants. */
        evaluate: async (idOrName: string): Promise<any> => {
            const res = await this.fetch(`${this.baseUrl}/api/v1/sharing/rules/${encodeURIComponent(idOrName)}/evaluate`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            return this.unwrapResponse<any>(res);
        },
    },
  };

  /**
   * Global cross-object search (M10.5): one query across every searchable
   * object the caller can read. 501s on kernels without `searchAll`.
   * (#3587 gap closure)
   */
  search = async (
      q: string,
      opts?: { objects?: string[]; limit?: number; perObject?: number },
  ): Promise<any> => {
      const params = new URLSearchParams();
      params.set('q', q);
      if (opts?.objects?.length) params.set('objects', opts.objects.join(','));
      if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
      if (opts?.perObject !== undefined) params.set('perObject', String(opts.perObject));
      const res = await this.fetch(`${this.baseUrl}/api/v1/search?${params.toString()}`);
      return this.unwrapResponse<any>(res);
  };

  /**
   * Saved reports (#3587 gap closure)
   *
   * Tenant-wide report definitions, execution, and recurring email
   * schedules, served by `@objectstack/plugin-reports` behind the REST
   * surface. Every route 501s [NOT_IMPLEMENTED] on deployments without the
   * reports service. Fixed path — `reports` is not in `ApiRoutesSchema`.
   */
  reports = {
    /** List saved reports, optionally filtered by object or owner. */
    list: async (opts?: { object?: string; ownerId?: string }): Promise<any[]> => {
        const params = new URLSearchParams();
        if (opts?.object) params.set('object', opts.object);
        if (opts?.ownerId) params.set('ownerId', opts.ownerId);
        const qs = params.toString();
        const res = await this.fetch(`${this.baseUrl}/api/v1/reports${qs ? `?${qs}` : ''}`);
        const body = await this.unwrapResponse<{ data?: any[] } | any[]>(res);
        return Array.isArray(body) ? body : (body?.data ?? []);
    },

    /** Create or update a saved report definition. 400 [VALIDATION_FAILED] on a bad spec. */
    save: async (report: any): Promise<any> => {
        const res = await this.fetch(`${this.baseUrl}/api/v1/reports`, {
            method: 'POST',
            body: JSON.stringify(report ?? {}),
        });
        return this.unwrapResponse<any>(res);
    },

    /** Get a saved report by id. 404 [REPORT_NOT_FOUND] when absent. */
    get: async (id: string): Promise<any> => {
        const res = await this.fetch(`${this.baseUrl}/api/v1/reports/${encodeURIComponent(id)}`);
        return this.unwrapResponse<any>(res);
    },

    /** Delete a saved report; its schedules cascade. */
    delete: async (id: string): Promise<{ deleted: boolean }> => {
        const res = await this.fetch(`${this.baseUrl}/api/v1/reports/${encodeURIComponent(id)}`, {
            method: 'DELETE',
        });
        if (res.status === 204) return { deleted: true };
        return this.unwrapResponse<{ deleted: boolean }>(res);
    },

    /** Execute a saved report and return its rendered output. */
    run: async (id: string): Promise<any> => {
        const res = await this.fetch(`${this.baseUrl}/api/v1/reports/${encodeURIComponent(id)}/run`, {
            method: 'POST',
            body: JSON.stringify({}),
        });
        return this.unwrapResponse<any>(res);
    },

    /**
     * Create a recurring email schedule for a report. Provide either
     * `intervalMinutes` or `cronExpression`; `recipients` is required.
     */
    schedule: async (
        id: string,
        opts: {
            recipients: string[];
            name?: string;
            intervalMinutes?: number;
            cronExpression?: string;
            timezone?: string;
            format?: string;
            subjectTemplate?: string;
            ownerId?: string;
            active?: boolean;
        },
    ): Promise<any> => {
        const res = await this.fetch(`${this.baseUrl}/api/v1/reports/${encodeURIComponent(id)}/schedule`, {
            method: 'POST',
            body: JSON.stringify(opts),
        });
        return this.unwrapResponse<any>(res);
    },

    /** List the recurring schedules attached to a report. */
    listSchedules: async (id: string): Promise<any[]> => {
        const res = await this.fetch(`${this.baseUrl}/api/v1/reports/${encodeURIComponent(id)}/schedules`);
        const body = await this.unwrapResponse<{ data?: any[] } | any[]>(res);
        return Array.isArray(body) ? body : (body?.data ?? []);
    },

    /** Delete a schedule by its id (report-independent path). */
    unschedule: async (scheduleId: string): Promise<{ deleted: boolean }> => {
        const res = await this.fetch(`${this.baseUrl}/api/v1/reports/schedules/${encodeURIComponent(scheduleId)}`, {
            method: 'DELETE',
        });
        if (res.status === 204) return { deleted: true };
        return this.unwrapResponse<{ deleted: boolean }>(res);
    },
  };

  // The former `views` CRUD namespace was removed in #3612 — no server
  // surface mounts /ui/views (both surfaces serve only /ui/view/:object…).
  // View definitions are metadata: read and save them via `meta.*`.

  /**
   * Notification Services
   *
   * Device registration and preference methods were removed in #3612 — the
   * /notifications/devices and /notifications/preferences server routes that
   * ADR-0012 describes were never built. They return together with the server
   * (and a route-ledger row keeps them honest).
   */
  notifications = {
    /**
     * List notifications for the current user.
     *
     * Returns the newest `limit` notifications — a WINDOW, not a page. The
     * `cursor` parameter was removed in protocol 17 (#6361): it was appended to
     * the query string here and read by nothing on the server, so a caller
     * paginating by it re-read the first window forever. Omit `limit` to take
     * the server's window (the platform inbox answers 50, clamped to 1..200);
     * raise it to see further back. There is no continuation token.
     */
    list: async (options?: { read?: boolean; type?: string; limit?: number }): Promise<ListNotificationsResponse> => {
      const route = this.getRoute('notifications');
      const params = new URLSearchParams();
      if (options?.read !== undefined) params.set('read', String(options.read));
      if (options?.type) params.set('type', options.type);
      if (options?.limit) params.set('limit', String(options.limit));
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
   * AI Services — the surface `service-ai` really mounts (#3718).
   *
   * ## What this namespace is, and what it replaced
   *
   * Until v17 `client.ai` held `nlq`, `suggest` and `insights`, building
   * `/api/v1/ai/{nlq,suggest,insights}`. **No repo has ever mounted those
   * paths**; every call 404ed from the first release that shipped them. They
   * were deleted rather than implemented, because the AI service that was
   * actually built serves a different surface entirely — the two sets were
   * disjoint. The methods below are that surface: `POST /ai/chat` (JSON or
   * streaming), `POST /ai/complete`, `GET /ai/models`, and the six
   * `/ai/conversations` routes.
   *
   * ## Where the server lives
   *
   * `service-ai` is a **Cloud/EE package in the `cloud` repo**. This repo's
   * dispatcher only proxies `/api/v1/ai/**` to whatever `buildAIRoutes()`
   * mounted, and 404s `AI service is not configured` when the service is
   * absent (the open-source default) — so treat every method here as
   * plugin-provided and check `discovery.services` first.
   *
   * That split is also why the guard for these URLs lives on the other side of
   * the repo boundary: `cloud`'s `packages/service-ai/src/ai-route-ledger.ts`
   * enumerates the table `buildAIRoutes()` returns and drives this namespace
   * against it, so a method here that stops resolving fails a test there.
   *
   * ## Chat, and `useChat`
   *
   * `useChat()` from `@ai-sdk/react` remains the right client for a React chat
   * UI — it speaks the same UI Message Stream Protocol {@link chatStream}
   * parses, and it owns message state. These methods exist for everything that
   * is not a React component: server-side callers, jobs, CLIs, tests.
   */
  ai = {
    /**
     * Chat completion, returned as JSON.
     *
     * Sends `stream: false` — the endpoint streams by default, so the flag is
     * forced here rather than left to the caller. Tools are resolved
     * server-side before the reply comes back, and the turn is persisted to
     * `conversationId` (auto-created and echoed back when omitted).
     */
    chat: async (request: AiChatRequest): Promise<AiChatResponse> => {
      const route = this.getRoute('ai');
      const res = await this.fetch(`${this.baseUrl}${route}/chat`, {
        method: 'POST',
        body: JSON.stringify({ ...request, stream: false }),
      });
      return this.unwrapResponse<AiChatResponse>(res);
    },

    /**
     * Chat completion as a stream of {@link AiStreamChunk} frames (the Vercel
     * UI Message Stream Protocol).
     *
     * Returns a promise for an async iterable rather than being an async
     * generator itself, so the request is issued — and an HTTP error thrown —
     * when you call it, not when you first iterate.
     *
     * ```ts
     * for await (const frame of await client.ai.chatStream({ messages })) {
     *   if (frame.type === 'text-delta') process.stdout.write(frame.delta);
     * }
     * ```
     */
    chatStream: async (request: AiChatRequest): Promise<AsyncIterable<AiStreamChunk>> => {
      const route = this.getRoute('ai');
      const res = await this.fetch(`${this.baseUrl}${route}/chat`, {
        method: 'POST',
        headers: { 'Accept': 'text/event-stream' },
        body: JSON.stringify({ ...request, stream: true }),
      });
      return parseEventStream(res);
    },

    /** Single-shot text completion. */
    complete: async (request: AiCompleteRequest): Promise<AiChatResponse> => {
      const route = this.getRoute('ai');
      const res = await this.fetch(`${this.baseUrl}${route}/complete`, {
        method: 'POST',
        body: JSON.stringify(request),
      });
      return this.unwrapResponse<AiChatResponse>(res);
    },

    /**
     * Models this environment offers in the chat model picker (ADR-0028) —
     * plan-filtered, with the default flagged. Populate a model picker from
     * this rather than hard-coding ids.
     */
    models: async (): Promise<AiModelsResponse> => {
      const route = this.getRoute('ai');
      const res = await this.fetch(`${this.baseUrl}${route}/models`);
      return this.unwrapResponse<AiModelsResponse>(res);
    },

    /**
     * Persistent conversations.
     *
     * Every route is scoped to the authenticated user server-side: `create`
     * binds the conversation to the caller and the rest 403 on someone else's.
     * `userId` in a request body is ignored — it is not a way to act for
     * another user.
     */
    conversations: {
      /** Create a conversation. */
      create: async (request?: CreateAiConversationRequest): Promise<AiConversation> => {
        const route = this.getRoute('ai');
        const res = await this.fetch(`${this.baseUrl}${route}/conversations`, {
          method: 'POST',
          body: JSON.stringify(request ?? {}),
        });
        return this.unwrapResponse<AiConversation>(res);
      },

      /** List the caller's conversations, newest first. */
      list: async (options?: ListAiConversationsRequest): Promise<AiConversation[]> => {
        const route = this.getRoute('ai');
        const params = new URLSearchParams();
        if (options?.agentId) params.set('agentId', options.agentId);
        if (options?.limit !== undefined) params.set('limit', String(options.limit));
        if (options?.cursor) params.set('cursor', options.cursor);
        const qs = params.toString();
        const res = await this.fetch(`${this.baseUrl}${route}/conversations${qs ? `?${qs}` : ''}`);
        const body = await this.unwrapResponse<ListAiConversationsResponse>(res);
        return body?.conversations ?? [];
      },

      /** Get one conversation with its full message history. */
      get: async (id: string): Promise<AiConversation> => {
        const route = this.getRoute('ai');
        const res = await this.fetch(`${this.baseUrl}${route}/conversations/${encodeURIComponent(id)}`);
        return this.unwrapResponse<AiConversation>(res);
      },

      /** Update mutable fields. At least one of `title` / `metadata` is required. */
      update: async (id: string, patch: UpdateAiConversationRequest): Promise<AiConversation> => {
        const route = this.getRoute('ai');
        const res = await this.fetch(`${this.baseUrl}${route}/conversations/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        });
        return this.unwrapResponse<AiConversation>(res);
      },

      /** Delete a conversation and its messages. */
      delete: async (id: string): Promise<{ deleted: boolean }> => {
        const route = this.getRoute('ai');
        const res = await this.fetch(`${this.baseUrl}${route}/conversations/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        if (res.status === 204) return { deleted: true };
        return this.unwrapResponse<{ deleted: boolean }>(res);
      },

      /** Append a message; returns the updated conversation. */
      addMessage: async (id: string, message: AiMessage): Promise<AiConversation> => {
        const route = this.getRoute('ai');
        const res = await this.fetch(`${this.baseUrl}${route}/conversations/${encodeURIComponent(id)}/messages`, {
          method: 'POST',
          body: JSON.stringify(message),
        });
        return this.unwrapResponse<AiConversation>(res);
      },
    },

    /**
     * Named agents.
     *
     * `/ai/chat` talks to the environment's default agent; these talk to one
     * you name. Both routes have been mounted since long before this namespace
     * existed — `objectui` hand-built their URLs in five places because the SDK
     * offered nothing to call (#3718).
     */
    agents: {
      /**
       * Agents the CALLER may chat with — the route filters by the caller's
       * permissions (ADR-0049), so an empty list is a legitimate answer for a
       * seat-less user rather than an error to retry.
       *
       * The `.agents` read below survived #4053 unchanged, and that is the
       * conclusion rather than an oversight. `AiAgentsResponseSchema` moved
       * under the envelope's `data` as a RELOCATION (#3843's precedent), so
       * `unwrapResponse` hands back `{ agents }` from an enveloped producer and
       * the same object from a pre-conversion one. Had the route flattened to
       * `data: [...]` (#3983's precedent) this line would read `undefined` and
       * answer `[]` — an empty catalog, which is what the console reads as "this
       * caller has no AI", so the regression would have been invisible.
       * `ai-agents-envelope.test.ts` pins both readings.
       */
      list: async (): Promise<AiAgentSummary[]> => {
        const route = this.getRoute('ai');
        const res = await this.fetch(`${this.baseUrl}${route}/agents`);
        const body = await this.unwrapResponse<AiAgentsResponse>(res);
        return body?.agents ?? [];
      },

      /**
       * Chat with a named agent, returned as JSON.
       *
       * Sends `stream: false` for the same reason `ai.chat` does — the route
       * streams by default, so the flag is forced here rather than left to the
       * caller to remember.
       */
      chat: async (agentName: string, request: AiAgentChatRequest): Promise<AiChatResponse> => {
        const route = this.getRoute('ai');
        const res = await this.fetch(`${this.baseUrl}${route}/agents/${encodeURIComponent(agentName)}/chat`, {
          method: 'POST',
          body: JSON.stringify({ ...request, stream: false }),
        });
        return this.unwrapResponse<AiChatResponse>(res);
      },

      /**
       * The streaming twin of {@link chat} — same route, streaming mode, the
       * Vercel UI Message Stream frames. Mirrors `ai.chat` / `ai.chatStream`
       * rather than introducing a third shape for the same endpoint.
       */
      chatStream: async (agentName: string, request: AiAgentChatRequest): Promise<AsyncIterable<AiStreamChunk>> => {
        const route = this.getRoute('ai');
        const res = await this.fetch(`${this.baseUrl}${route}/agents/${encodeURIComponent(agentName)}/chat`, {
          method: 'POST',
          headers: { 'Accept': 'text/event-stream' },
          body: JSON.stringify({ ...request, stream: true }),
        });
        return parseEventStream(res);
      },
    },

    /**
     * The human-in-the-loop approval queue.
     *
     * When a tool call needs a human decision the turn parks an action here
     * instead of executing it. An app embedding the chat has to render and
     * resolve that queue; until now it had to hand-build these four URLs.
     *
     * Reads and decisions are separately permissioned server-side (`ai:read`
     * vs `ai:approve`), so a caller that can list the queue may still be
     * refused on approve — handle the 403, do not assume one implies the other.
     */
    pendingActions: {
      /** Queued actions, newest first. */
      list: async (options?: ListAiPendingActionsRequest): Promise<AiPendingAction[]> => {
        const route = this.getRoute('ai');
        const params = new URLSearchParams();
        if (options?.status) params.set('status', options.status);
        if (options?.conversationId) params.set('conversationId', options.conversationId);
        if (options?.limit !== undefined) params.set('limit', String(options.limit));
        const qs = params.toString();
        const res = await this.fetch(`${this.baseUrl}${route}/pending-actions${qs ? `?${qs}` : ''}`);
        const body = await this.unwrapResponse<ListAiPendingActionsResponse>(res);
        return body?.items ?? [];
      },

      /** One queued action. 404s when the id is unknown. */
      get: async (id: string): Promise<AiPendingAction> => {
        const route = this.getRoute('ai');
        const res = await this.fetch(`${this.baseUrl}${route}/pending-actions/${encodeURIComponent(id)}`);
        return this.unwrapResponse<AiPendingAction>(res);
      },

      /**
       * Approve AND execute.
       *
       * CHECK THE RETURNED `status`: a tool that fails after approval comes
       * back `{ status: 'failed', error }` with HTTP 200, because the approval
       * succeeded even though the execution did not. Treating 2xx as "the write
       * happened" reports a failed write as a success.
       */
      approve: async (id: string): Promise<ApproveAiPendingActionResponse> => {
        const route = this.getRoute('ai');
        const res = await this.fetch(`${this.baseUrl}${route}/pending-actions/${encodeURIComponent(id)}/approve`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        return this.unwrapResponse<ApproveAiPendingActionResponse>(res);
      },

      /** Reject with an optional reason. Executes nothing. */
      reject: async (id: string, reason?: string): Promise<RejectAiPendingActionResponse> => {
        const route = this.getRoute('ai');
        const res = await this.fetch(`${this.baseUrl}${route}/pending-actions/${encodeURIComponent(id)}/reject`, {
          method: 'POST',
          body: JSON.stringify(reason === undefined ? {} : { reason }),
        });
        return this.unwrapResponse<RejectAiPendingActionResponse>(res);
      },
    },
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
     * Get translations for a locale.
     *
     * Speaks the path-param dialect (`/translations/:locale`) — the shape
     * `plugin-rest-api.zod.ts` declares and the ONLY shape any serving surface
     * mounts (service-i18n's autonomous routes, the dispatcher's HTTP mounts).
     * The `?locale=` query form this used to send matched no route anywhere
     * and 404'd on the wire; the dispatcher's domain body accepts it, but
     * nothing ever routes a bare `/translations` to that body (#3636).
     *
     * Returns the locale's full bundle. The `options.namespace` / `options.keys`
     * this used to accept rode the query string to a server that read neither,
     * so the filter silently did nothing — trimmed with the request schema's
     * fields in #3676.
     */
    getTranslations: async (locale: string): Promise<GetTranslationsResponse> => {
      const route = this.getRoute('i18n');
      const res = await this.fetch(
        `${this.baseUrl}${route}/translations/${encodeURIComponent(locale)}`,
      );
      return this.unwrapResponse<GetTranslationsResponse>(res);
    },

    /**
     * Get translated field labels for an object.
     *
     * Both the object and the locale ride the path (`/labels/:object/:locale`)
     * — same reason as `getTranslations` above: the `?locale=` form could
     * never match the two-path-param mount (#3636).
     */
    getFieldLabels: async (object: string, locale: string): Promise<GetFieldLabelsResponse> => {
      const route = this.getRoute('i18n');
      const res = await this.fetch(
        `${this.baseUrl}${route}/labels/${encodeURIComponent(object)}/${encodeURIComponent(locale)}`,
      );
      return this.unwrapResponse<GetFieldLabelsResponse>(res);
    }
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
        // Detect V2 options by presence of canonical-only keys. The predicate
        // is derived from QueryOptionsV2 itself and SHARED with the copy of
        // this method on ScopedProjectClient — see QUERY_OPTIONS_V2_ONLY_KEYS
        // for why an inline hand-written key list is not allowed here (#6322).
        const v2 = options as QueryOptionsV2;
        const normalizedOptions: QueryOptions = {} as QueryOptions;
        let expandParam: string | undefined;
        if (isCanonicalQueryOptions(options)) {
            // V2 canonical options detected — map to legacy HTTP transport keys
            if (v2.where) normalizedOptions.filter = v2.where as any;
            if (v2.fields) normalizedOptions.select = v2.fields;
            if (v2.orderBy) normalizedOptions.sort = v2.orderBy as any;
            if (v2.limit != null) normalizedOptions.top = v2.limit;
            if (v2.offset != null) normalizedOptions.skip = v2.offset;
            // `expand` has no legacy QueryOptions counterpart to normalize INTO
            // (QueryOptions never had `populate`), so it goes straight to its
            // own transport param below.
            expandParam = canonicalExpandParam(v2.expand);
            if (v2.aggregations) normalizedOptions.aggregations = v2.aggregations;
            if (v2.groupBy) normalizedOptions.groupBy = v2.groupBy;
        } else {
            // Legacy QueryOptions — pass through as-is
            Object.assign(normalizedOptions, options);
        }

        // 1. Handle Pagination
        //
        // [#6485] PRESENCE, not truthiness — the same test the canonical
        // normalizer directly above already applies (`if (v2.limit != null)`).
        // Emitting on truthiness made `0` survive the normalizer and then be
        // discarded here, so `find('task', { limit: 0 })` reached the server
        // with no `top` param. The GET list route has no default page size, so
        // an absent `top` returns the ENTIRE match set: the caller who asked
        // for no records got every record, under a 200 with no warning.
        // `top=0` is honoured end to end — the protocol normalizer folds it to
        // `limit: 0` and forwards it, and `SqlDriver.find` paginates on
        // presence too, so the statement carries `LIMIT 0` and answers empty.
        // `skip=0` is a consistency change only: it already equals the
        // server's default, so the request means the same either way — but one
        // emitter must not hold two rules for one pair.
        // Mirrored verbatim in `ScopedProjectClient.data.find`.
        if (normalizedOptions.top != null) queryParams.set('top', normalizedOptions.top.toString());
        if (normalizedOptions.skip != null) queryParams.set('skip', normalizedOptions.skip.toString());

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

        // 6. Handle Expand (canonical-only — see canonicalExpandParam)
        if (expandParam) {
            queryParams.set('expand', expandParam);
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
     * Atomic cross-object batch — the canonical master-detail save path
     * (issue #1604 / ADR-0034 item 4).
     *
     * Executes heterogeneous create/update/delete operations across MULTIPLE
     * objects in ONE server-side engine transaction: commit all or roll back
     * all. A field value of `{ $ref: <earlier op index> }` resolves to the id
     * created by that earlier operation, so a child row can reference a
     * parent created in the same request:
     *
     * ```ts
     * const { results } = await client.data.batchTransaction([
     *   { object: 'project', action: 'create', data: { name: 'Apollo' } },
     *   { object: 'task', action: 'create', data: { title: 'Kickoff', project: { $ref: 0 } } },
     * ]);
     * ```
     *
     * This method is always atomic and deliberately exposes no `atomic`
     * flag — the endpoint rejects `atomic: false` with `400 BATCH_NOT_ATOMIC`.
     * Non-atomic, partial-success bulk writes stay on the per-object
     * {@link batch} / {@link createMany} / {@link updateMany} surface;
     * callers that need a best-effort fallback (e.g. against servers
     * predating this route, which respond 404 — check `error.httpStatus`)
     * must isolate it in their own adapter rather than here.
     *
     * URL note: the server mounts this route at the PARENT of the data
     * prefix (`POST {basePath}/batch` vs `{basePath}/data/...`, see
     * rest-server `registerBatchEndpoints`), so the path is derived by
     * dropping the last segment of the resolved data route.
     */
    batchTransaction: async (
      operations: CrossObjectBatchOperation[],
    ): Promise<CrossObjectBatchResponse> => {
        const dataRoute = this.getRoute('data');
        const base = dataRoute.replace(/\/[^/]+\/?$/, '') || '/api/v1';
        const request: CrossObjectBatchRequest = { operations, atomic: true };
        const res = await this.fetch(`${this.baseUrl}${base}/batch`, {
            method: 'POST',
            body: JSON.stringify(request),
        });
        return this.unwrapResponse<CrossObjectBatchResponse>(res);
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
    },

    /**
     * Duplicate a record (gated by the object's `enable.clone` capability).
     * `overrides` are applied on top of the copied values — e.g. a new name
     * or a cleared unique field. (#3587 gap closure)
     */
    clone: async (object: string, id: string, overrides?: Record<string, any>): Promise<any> => {
        const route = this.getRoute('data');
        const res = await this.fetch(
            `${this.baseUrl}${route}/${encodeURIComponent(object)}/${encodeURIComponent(id)}/clone`,
            { method: 'POST', body: JSON.stringify(overrides ? { overrides } : {}) },
        );
        return this.unwrapResponse<any>(res);
    },

    /**
     * Streaming export (M10.9): CSV / JSON / XLSX file download. Returns the
     * raw `Response` — the body is a file stream (`Content-Disposition`
     * attachment), not a JSON envelope; call `.blob()` / `.text()` yourself.
     * `filter` is JSON-encoded into the query; `orderby` accepts the
     * `field:dir,field2:dir` shorthand or an object. (#3587 gap closure)
     */
    export: async (
        object: string,
        opts?: {
            format?: 'csv' | 'json' | 'xlsx';
            limit?: number;
            filter?: any;
            orderby?: string | Record<string, 'asc' | 'desc'>;
            header?: boolean;
        },
    ): Promise<Response> => {
        const route = this.getRoute('data');
        const params = new URLSearchParams();
        if (opts?.format) params.set('format', opts.format);
        if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
        if (opts?.filter !== undefined) {
            params.set('filter', typeof opts.filter === 'string' ? opts.filter : JSON.stringify(opts.filter));
        }
        if (opts?.orderby !== undefined) {
            params.set('orderby', typeof opts.orderby === 'string' ? opts.orderby : JSON.stringify(opts.orderby));
        }
        if (opts?.header !== undefined) params.set('header', String(opts.header));
        const qs = params.toString();
        return this.fetch(`${this.baseUrl}${route}/${encodeURIComponent(object)}/export${qs ? `?${qs}` : ''}`);
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
        // Two server envelopes are in play, and they disagree about where the
        // SEMANTIC code and the per-field list live:
        //
        //   @objectstack/rest, flat:
        //     { error, code: 'VALIDATION_FAILED', fields: [...] }
        //   runtime dispatcher, wrapped:
        //     { success: false, error: { code: 'VALIDATION_FAILED', message,
        //         httpStatus: 400, details: { fields: [...] } } }
        //
        // `error.code` in the WRAPPED form used to be the HTTP STATUS, with the
        // real code parked in `error.details.code`. Reading it straight into
        // `err.code` handed callers the number 400 where the flat form handed
        // them 'VALIDATION_FAILED', so the branch our own docs teach —
        //   `if (err.code === 'VALIDATION_FAILED') err.fields.forEach(…)`
        // — simply never matched on a dispatcher-served surface. #3842 fixed
        // that at the producer (Prime Directive #12): `error.code` is the
        // semantic string on both surfaces now, and the number has its own
        // `error.httpStatus`.
        //
        // Between #3842 and #4007 a third read sat in this chain, digging the
        // pre-#3842 parking spot (`error.details.code`) for "newer SDK, older
        // server" pairings. #4007 retired it: SDK and server ship on one
        // release train (a changesets fixed group), so that pairing is not a
        // supported deployment — and ADR-0112 batches 1–2 renamed the code
        // VALUES anyway, so a code dug out of an old server's parking spot
        // would no longer match any branch written against the current
        // catalog. Location-compat without value-compat protects nothing.
        //
        // So: `err.code` is always the semantic STRING (the numeric status is on
        // `err.httpStatus`, where it always was), and `err.fields` is always the
        // per-field list when the server sent one. The two reads below are the
        // two LIVE envelopes' declared spots, not a fallback chain — the flat
        // shape's retirement belongs to the envelope-convergence line (#3843).
        const asSemanticCode = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
        const errorCode =
          asSemanticCode(errorBody?.code)
          ?? asSemanticCode(errorBody?.error?.code);
        const fieldErrors =
          Array.isArray(errorBody?.fields) ? errorBody.fields
          : Array.isArray(errorBody?.error?.details?.fields) ? errorBody.error.details.fields
          : undefined;
        // `.message` is what UIs (e.g. the console's error toast) show to end
        // users verbatim, so keep it to the server's human-readable message —
        // no `[ObjectStack]` branding and no `CODE:` prefix. The code stays
        // available programmatically via `error.code`, and the full response
        // body was already logged above for debugging.
        const error = new Error(errorMessage) as any;

        // Attach error details for programmatic access
        error.code = errorCode;
        // `category` / `retryable` are declared INSIDE `error` (ApiErrorSchema);
        // the flat envelope never carries them and nothing ever emitted them at
        // the body top level, so the old top-level read returned `undefined`
        // against every conformant server (ADR-0112 D9b, #4006).
        error.category = errorBody?.error?.category;
        error.httpStatus = res.status;
        error.retryable = errorBody?.error?.retryable;
        // Prefer the wrapped envelope's own `details` over the whole body. The
        // flat envelope has no top-level `details`, so it keeps falling through
        // to `errorBody` exactly as before — only the wrapped shape changes,
        // and only from "the entire response" to the structured object it
        // actually carries.
        error.details = errorBody?.details ?? errorBody?.error?.details ?? errorBody;
        if (fieldErrors) error.fields = fieldErrors;
        
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
      realtime: '/api/v1/realtime',
      // `workflow` removed (#4451, v17): the slot retired with the ApiRoutes
      // field — there was never a surface behind the convention.
      approvals: '/api/v1/approvals',
      notifications: '/api/v1/notifications',
      ai: '/api/v1/ai',
      i18n: '/api/v1/i18n',
      // [#5679] `mcp` became a declared `ApiRoutes` key, and this map is
      // TOTAL over them by design — a new declared route owes a convention.
      // `/api/v1/mcp` is not a guess: it is what both discovery producers
      // actually emit, so the fallback agrees with the discovered value
      // rather than competing with it.
      //
      // Note this table is the UNSCOPED convention (every row is `/api/v1/…`),
      // which suits `mcp` exactly: `/mcp` is mounted bare, so even a
      // project-scoped discovery response advertises the unscoped path.
      mcp: '/api/v1/mcp',
      // [#6633] `datasources` became a declared `ApiRoutes` key (the base of
      // the `datasources/:name/external/*` federation-admin family), and this
      // map is TOTAL over declared keys by design. `/api/v1/datasources` is
      // not a guess: it is where `@objectstack/rest` mounts the family today,
      // so an unconnected client builds byte-identical URLs to the pre-#6633
      // hardcode — the fallback agrees with the mount instead of competing
      // with it.
      datasources: '/api/v1/datasources',
      // [#6714] `email` became a declared `ApiRoutes` key (the base under
      // which `POST {email}/send` is mounted), and this map is TOTAL over
      // declared keys by design. `/api/v1/email` is not a guess: it is where
      // `@objectstack/rest` mounts the surface on a default-base boot, so an
      // unconnected client builds byte-identical URLs to the pre-#6714
      // hardcode — the fallback agrees with the mount instead of competing
      // with it.
      email: '/api/v1/email',
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

  /**
   * Prefix segment inserted between the baseUrl and the resource path.
   *
   * [#6714 face 3] The API base comes from the parent's discovery-derived
   * `_apiBase()` rather than a hard-coded `/api/v1`: the server's scoped
   * mount point is `getScopedBasePath(getApiBasePath())`, which follows
   * `apiPath`, so a scoped client talking to an `apiPath` deployment built
   * 404 URLs for every `meta` / `data` / `batch` / `packages` / `automation`
   * call. An unconnected parent — or one whose advertised routes the base
   * cannot be derived from — keeps building byte-identical
   * `/api/v1/environments/...` URLs.
   */
  private scope(): string { return `${this.parent._apiBase()}/environments/${encodeURIComponent(this.environmentId)}`; }

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
    /** Same `{ type, name, item }` envelope as the unscoped surface (#5563). */
    getItem: async (type: string, name: string, options?: { packageId?: string }): Promise<GetMetaItemResponse> => {
      const params = new URLSearchParams();
      if (options?.packageId) params.set('package', options.packageId);
      const qs = params.toString();
      const res = await this.parent._fetch(this.url(`/meta/${type}/${name}${qs ? `?${qs}` : ''}`));
      return this.parent._unwrap<GetMetaItemResponse>(res);
    },
    /** Carries the ADR-0008 OCC token in `version` — see the unscoped twin. */
    saveItem: async (type: string, name: string, item: any): Promise<SaveMetaItemResponse> => {
      const res = await this.parent._fetch(this.url(`/meta/${type}/${name}`), {
        method: 'PUT',
        body: JSON.stringify(item),
      });
      return this.parent._unwrap<SaveMetaItemResponse>(res);
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

      // Same normalization as ObjectStackClient.data.find — one shared
      // predicate and one shared expand mapping, so the two copies cannot
      // diverge on which vocabulary a bag speaks (#6322).
      const v2 = options as QueryOptionsV2;
      const normalizedOptions: QueryOptions = {} as QueryOptions;
      let expandParam: string | undefined;
      if (isCanonicalQueryOptions(options)) {
        if (v2.where) normalizedOptions.filter = v2.where as any;
        if (v2.fields) normalizedOptions.select = v2.fields;
        if (v2.orderBy) normalizedOptions.sort = v2.orderBy as any;
        if (v2.limit != null) normalizedOptions.top = v2.limit;
        if (v2.offset != null) normalizedOptions.skip = v2.offset;
        expandParam = canonicalExpandParam(v2.expand);
        if (v2.aggregations) normalizedOptions.aggregations = v2.aggregations;
        if (v2.groupBy) normalizedOptions.groupBy = v2.groupBy;
      } else {
        Object.assign(normalizedOptions, options);
      }

      // [#6485] Presence, not truthiness — see the twin in
      // `ObjectStackClient.data.find` for why `0` must reach the wire.
      if (normalizedOptions.top != null) queryParams.set('top', normalizedOptions.top.toString());
      if (normalizedOptions.skip != null) queryParams.set('skip', normalizedOptions.skip.toString());
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
      if (expandParam) {
        queryParams.set('expand', expandParam);
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
    /**
     * Atomic cross-object batch, environment-scoped
     * (`POST /api/v1/environments/:id/batch`).
     * See {@link ObjectStackClient} `data.batchTransaction` for semantics.
     */
    batchTransaction: async (
      operations: CrossObjectBatchOperation[],
    ): Promise<CrossObjectBatchResponse> => {
      const request: CrossObjectBatchRequest = { operations, atomic: true };
      const res = await this.parent._fetch(this.url('/batch'), {
        method: 'POST',
        body: JSON.stringify(request),
      });
      return this.parent._unwrap<CrossObjectBatchResponse>(res);
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
    /** List recent runs for a flow, optionally narrowed to one status. */
    listRuns: async <T = any>(
      flowName: string,
      opts?: { limit?: number; cursor?: string; status?: ExecutionStatus },
    ): Promise<T> => {
      const params = new URLSearchParams();
      if (opts?.limit != null) params.set('limit', String(opts.limit));
      if (opts?.cursor) params.set('cursor', opts.cursor);
      // [#7359] — see the sibling `listRuns` alias above.
      if (opts?.status) params.set('status', opts.status);
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
    /**
     * Resume a run suspended at a `screen` / `wait` node with the collected
     * input (ADR-0019 durable pause). Mirrors the unscoped
     * `client.automation.resume` — including its refusal (403) to resume an
     * `approval` pause, which belongs to the approvals API (#3801), and its
     * **breaking #8684 behaviour**: a run that resumed and then failed now
     * REJECTS with `400` `FLOW_FAILED` (author text on
     * `err.details.errorMessage`) instead of resolving with an inner
     * `{ success: false }` under HTTP 200. See that method for the full shape.
     */
    resume: async <T = any>(
      flowName: string,
      runId: string,
      signal?: {
        inputs?: Record<string, unknown>;
        output?: Record<string, unknown>;
        branchLabel?: string;
      },
    ): Promise<T> => {
      const res = await this.parent._fetch(
        this.url(`/automation/${encodeURIComponent(flowName)}/runs/${encodeURIComponent(runId)}/resume`),
        { method: 'POST', body: JSON.stringify(signal ?? {}) },
      );
      return this.parent._unwrap<T>(res);
    },
    /** Fetch the screen a paused run is waiting on. */
    getScreen: async <T = any>(flowName: string, runId: string): Promise<T> => {
      const res = await this.parent._fetch(
        this.url(`/automation/${encodeURIComponent(flowName)}/runs/${encodeURIComponent(runId)}/screen`),
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
  GetMetaItemResponse,
  SaveMetaItemResponse,
  PublishMetaItemResponse,
  CheckPermissionRequest,
  CheckPermissionResponse,
  GetObjectPermissionsResponse,
  GetEffectivePermissionsResponse,
  RealtimeConnectRequest,
  RealtimeConnectResponse,
  RealtimeSubscribeRequest,
  RealtimeSubscribeResponse,
  GetPresenceResponse,
  // Workflow re-exports removed (#4451, v17): the types were deleted from
  // @objectstack/spec/api with the retired workflow slot.
  // View-management re-exports removed (#6239, v17): the five viewId-addressed
  // methods and their ten schemas were deleted from @objectstack/spec/api with
  // the retired `ViewProtocol` — no host implemented them and no route reached
  // them. A view's stored definition travels on the metadata types
  // (`GetMetaItemResponse` / `SaveMetaItemResponse` with `type: 'view'`), and
  // the resolved render-time view on `getUiView`.
  RegisterDeviceRequest,
  RegisterDeviceResponse,
  ListNotificationsResponse,
  AiMessage,
  AiChatRequest,
  AiChatResponse,
  AiStreamChunk,
  AiCompleteRequest,
  AiModelsResponse,
  AiConversation,
  CreateAiConversationRequest,
  ListAiConversationsRequest,
  ListAiConversationsResponse,
  UpdateAiConversationRequest,
  AiAgentSummary,
  AiAgentsResponse,
  AiAgentChatRequest,
  AiPendingAction,
  ListAiPendingActionsRequest,
  ListAiPendingActionsResponse,
  ApproveAiPendingActionResponse,
  RejectAiPendingActionResponse,
  GetLocalesResponse,
  GetTranslationsResponse,
  GetFieldLabelsResponse,
  RegisterRequest,
  RefreshTokenRequest,
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
  CrossObjectBatchOperation,
  CrossObjectBatchRequest,
  CrossObjectBatchResponse,
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
