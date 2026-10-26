/**
 * Approval requests as a standard `DataSource` (objectui#12032, A1 of the
 * approvals rebuild objectui#2763).
 *
 * The standard renderers read approval requests through this source:
 * `ListView` for a list, `RecordDetailView` for one request. Both take ONE
 * `dataSource`. `RecordDetailView` also sends its side reads through it
 * (`sys_user`, comments, activities, history). So this source routes. Reads of
 * `sys_approval_request` go to the approvals routes through an `ApiDataSource`
 * built here in code (not a view's `provider: 'api'` block, which is retired —
 * objectui#12325). Every other resource, and every
 * other method, goes to the host adapter unchanged. The rows come back exactly
 * as the approvals service serves them, so `viewer` (list and get) and
 * `decision_progress` (get only, by contract) are ordinary fields a view binds.
 *
 * ## One source per scope
 *
 * The inbox's three lists are SERVER-SIDE scopes on `GET /approvals/requests`,
 * never client filters. A scope is fixed when the source is built and rides on
 * every list request as the door's `read.params`:
 *
 *   - `awaiting_me`     → `status=pending&approverId=<every identity, comma-joined>`
 *   - `submitted_by_me` → `submitterId=<the user>`
 *   - `all`             → nothing
 *
 * A scope that names no identity (no approver identity, no submitter id) reads
 * as an empty list and sends no request, as the inbox does. ⛔ It never falls
 * through to the unscoped list: that would show every request to someone who
 * asked for "mine".
 *
 * ## The list speaks the route's own names, and refuses the rest
 *
 * The approvals list route has a CLOSED parameter set. It accepts `object`,
 * `recordId`, `status`, `approverId`, `submitterId`, `q`, `limit` and `offset`,
 * and answers any other name with a 400 (objectstack's
 * `APPROVAL_REQUEST_LIST_PARAMS`). `ListView` speaks the data API's `$` names.
 * So each list read is translated here:
 *
 *   - `$top` → `limit`, `$skip` → `offset`, `$search` → `q`;
 *   - `$select` is dropped. The route has no projection, so dropping it widens
 *     the columns that come back, never the rows;
 *   - every other name (`$filter`, `$orderby`, `$expand`, `$searchFields`, …)
 *     is REFUSED with a thrown `UNSUPPORTED_QUERY_PARAM` error before any request
 *     goes out, so `ListView` shows its error panel. ⛔ It is never dropped: a
 *     dropped filter is a list of rows the viewer did not ask for, shaped
 *     exactly like the right answer.
 *
 * ## The get reads one request, with no parameters
 *
 * `GET /approvals/requests/:id` reads no query parameters, so the get goes
 * through a door with no scope params and sends none of the caller's
 * `QueryParams`. `RecordDetailView` asks for `$expand` on every declared
 * relation, and this route has no expansion; it serves its own display names
 * instead (`submitter_name`, `record_title`, …). A 404 resolves `null` (not
 * found). Every other failure rejects, so the record page can say "no access" or
 * "could not load" (the door's `findOne` contract).
 *
 * ## Other reads of approval requests are refused, not forwarded
 *
 * The host adapter's other row-reading methods (`aggregate`,
 * `queryGroupHeaders`, `exportDownload`) would read `sys_approval_request`
 * through the data API: outside the scope and without `viewer`. Called for
 * approval requests, they reject with the same `UNSUPPORTED_QUERY_PARAM`
 * refusal. For every other resource they are the host's.
 *
 * ## One request's timeline reads through the actions route (objectui#12045)
 *
 * The request's record page lists its `sys_approval_action` rows as a related
 * list. Through the data API that read is refused to an ordinary approver: the
 * object is deliberately closed to ordinary positions, and the approvals
 * service answers who may see a decision (can the caller see the PARENT
 * request?) on `GET /approvals/requests/:id/actions`. So a `find` of
 * `sys_approval_action` whose `$filter` is exactly one request's scope,
 * `{ request_id: '<id>' }` (the shape a related list sends for its parent),
 * reads that route instead. The route answers the request's whole timeline,
 * oldest first, so the source applies the rest of the read itself:
 *
 *   - `$orderby` (the object-array form) is applied to the rows, by stored
 *     value, as the data API orders them;
 *   - `$top` / `$skip` window the ordered rows, and `total` is the timeline's
 *     length, so a paged list pages over the right set;
 *   - `$count` is honoured as it stands: it asks for `total`, which every
 *     timeline read returns. A tab strip probes a related list's size with
 *     `{ $filter, $top: 1, $count: true }`; refusing it would leave the
 *     request's Timeline tab without its count;
 *   - `$select` and `$expand` are dropped: they shape columns, never which
 *     rows come back, and the route serves its own display names
 *     (`actor_name`) in place of an expansion;
 *   - any other name is REFUSED with the same `UNSUPPORTED_QUERY_PARAM`
 *     refusal as the list, before any request goes out.
 *
 * A read of `sys_approval_action` with any other filter is not one request's
 * timeline, and goes to the host unchanged.
 *
 * ## Every record surface reads a request through the same doors
 * (objectui#12045, the page-mount step)
 *
 * A request opens on more than one surface: the record route, an `ObjectView`
 * drawer or split overlay, and the record views embedded in the object data
 * page and an interface list page. Every one of them takes its `dataSource`
 * from the console's adapter. `routeApprovalRecordReads` wraps that adapter so
 * the reads that make a request's record page right go to the approvals
 * routes on every surface, and nothing else changes:
 *
 *   - a `findOne` of `sys_approval_request` reads `GET /approvals/requests/:id`,
 *     the one door that serves the `viewer` block and the decision tally;
 *   - one request's timeline reads the actions route, as above.
 *
 * Unlike a scoped source, it serves no list of requests: a `find` of
 * `sys_approval_request` (Setup's list views, with their filters and sorts,
 * and the timeline's label read of its `request_id` column, which asks for
 * `{ id: { $in: [...] } }`) stays on the data API, which serves each caller
 * the requests the approvals door would (objectstack's request read gate,
 * objectstack-ai/objectstack#22559). Every other member is the host's.
 */
import { ApiDataSource } from '@object-ui/core';
import { createAuthenticatedFetch } from '@object-ui/auth';
import type { DataSource, QueryParams, QueryResult } from '@object-ui/types';
import { API_BASE, type ApprovalRequestRow } from './approvalsApi';

/** The object whose reads this source routes to the approvals routes. */
export const APPROVAL_REQUEST_OBJECT = 'sys_approval_request';

/** The timeline object: one request's rows read through the actions route. */
export const APPROVAL_ACTION_OBJECT = 'sys_approval_action';

/** The column that scopes a timeline row to its request. */
const ACTION_REQUEST_FIELD = 'request_id';

/** The inbox's three server-side scopes. */
export type ApprovalRequestScope =
  | { kind: 'awaiting_me'; approverIds: readonly string[] }
  | { kind: 'submitted_by_me'; submitterId: string | null | undefined }
  | { kind: 'all' };

export interface ApprovalRequestsDataSourceOptions {
  /** The adapter every other resource and method goes to (the console's own). */
  host: DataSource;
  /** The list this source serves. */
  scope: ApprovalRequestScope;
  /** Transport. Defaults to the console's authenticated fetch (Bearer + tenant). */
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** API root. Defaults to the one `approvalsApi` uses. */
  baseUrl?: string;
}

/** The `$` names the list translates, and the route name each becomes. */
const TRANSLATED: Readonly<Record<string, string>> = {
  $top: 'limit',
  $skip: 'offset',
  $search: 'q',
};

/** A projection: dropping it widens columns, never rows. */
const DROPPED = new Set(['$select']);

/** Host methods that read rows of a resource; refused for approval requests. */
const REFUSED_HOST_READS = new Set(['aggregate', 'queryGroupHeaders', 'exportDownload']);

/** The refusal `ListView` classifies as a rejected query (its error panel). */
function refusal(what: string): Error & { code: string } {
  const err = new Error(
    `${APPROVAL_REQUEST_OBJECT}: the approvals list cannot honour ${what}. ` +
      'It pages (limit, offset) and searches (q) within its scope, and nothing else.',
  ) as Error & { code: string };
  err.code = 'UNSUPPORTED_QUERY_PARAM';
  return err;
}

/** An absent value, as the door's own query flattening reads one. */
function isAbsent(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

/** The route parameters for one list read, or a thrown refusal. */
function toListQuery(params: QueryParams | undefined): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  const refused: string[] = [];
  for (const [key, value] of Object.entries(params ?? {})) {
    if (isAbsent(value)) continue;
    const name = TRANSLATED[key];
    if (name) query[name] = typeof value === 'string' ? value.trim() : value;
    else if (!DROPPED.has(key)) refused.push(key);
  }
  if (refused.length > 0) throw refusal(refused.sort().join(', '));
  return query;
}

/** The scope's route parameters, or `null` when it names no identity. */
function toScopeParams(scope: ApprovalRequestScope): Record<string, string> | null {
  switch (scope.kind) {
    case 'awaiting_me': {
      const ids = scope.approverIds.map((id) => String(id).trim()).filter(Boolean);
      return ids.length > 0 ? { status: 'pending', approverId: ids.join(',') } : null;
    }
    case 'submitted_by_me': {
      const id = String(scope.submitterId ?? '').trim();
      return id ? { submitterId: id } : null;
    }
    case 'all':
      return {};
  }
}

/** The one request a timeline read is scoped to, or `null` when it is not one. */
function timelineRequestId(params: QueryParams | undefined): string | null {
  const filter = params?.$filter;
  if (filter == null || typeof filter !== 'object' || Array.isArray(filter)) return null;
  const keys = Object.keys(filter);
  if (keys.length !== 1 || keys[0] !== ACTION_REQUEST_FIELD) return null;
  const id = (filter as Record<string, unknown>)[ACTION_REQUEST_FIELD];
  return typeof id === 'string' && id.trim() !== '' ? id : null;
}

/**
 * Names a timeline read applies itself, or drops because they shape columns.
 * `$count` asks for `total`, which every timeline read returns.
 */
const TIMELINE_APPLIED = new Set(['$filter', '$orderby', '$top', '$skip', '$count']);
const TIMELINE_DROPPED = new Set(['$select', '$expand']);

/** The refusal a timeline read throws: the same code `ListView` classifies. */
function timelineRefusal(what: string): Error & { code: string } {
  const err = new Error(
    `${APPROVAL_ACTION_OBJECT}: one request's timeline cannot honour ${what}. ` +
      'It orders ($orderby) and pages ($top, $skip) over that request\'s actions, and nothing else.',
  ) as Error & { code: string };
  err.code = 'UNSUPPORTED_QUERY_PARAM';
  return err;
}

/** One `$orderby` term, as the object-array form spells it. */
type OrderTerm = { field: string; order: 'asc' | 'desc' };

function isOrderTerm(term: unknown): term is { field: string; order?: unknown } {
  if (term == null || typeof term !== 'object') return false;
  const { field } = term as { field?: unknown };
  return typeof field === 'string' && field !== '';
}

/** The timeline's ordering, or a thrown refusal for a form it cannot apply. */
function toOrderTerms(orderby: QueryParams['$orderby']): OrderTerm[] {
  if (isAbsent(orderby)) return [];
  const terms: unknown[] = Array.isArray(orderby) ? orderby : [];
  const objectTerms = terms.filter(isOrderTerm);
  if (terms.length === 0 || objectTerms.length !== terms.length) {
    throw timelineRefusal('$orderby in any form but a list of { field, order }');
  }
  return objectTerms.map((term) => ({ field: term.field, order: term.order === 'desc' ? 'desc' : 'asc' }));
}

/** Stored-value comparison; an absent value sorts after every present one. */
function compareStored(a: unknown, b: unknown): number {
  const aAbsent = a === undefined || a === null;
  const bAbsent = b === undefined || b === null;
  if (aAbsent || bAbsent) return aAbsent === bAbsent ? 0 : aAbsent ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

/** A non-negative integer window bound, or a thrown refusal. */
function windowBound(name: '$top' | '$skip', value: unknown): number | undefined {
  if (isAbsent(value)) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw timelineRefusal(`${name} = ${String(value)}`);
  return n;
}

/** The approvals routes a request's record page reads, built once per source. */
interface ApprovalReadDoors {
  /** `GET /approvals/requests` — the list route, for a scoped source. */
  url: string;
  fetchFn: NonNullable<ApprovalRequestsDataSourceOptions['fetch']>;
  /** One request, from `GET /approvals/requests/:id` (`null` only on a 404). */
  findRequest(id: string): Promise<unknown>;
  /** One request's timeline, from the actions route, ordered and windowed here. */
  findTimeline(requestId: string, params: QueryParams): Promise<QueryResult<unknown>>;
}

function approvalReadDoors(options: Pick<ApprovalRequestsDataSourceOptions, 'fetch' | 'baseUrl'>): ApprovalReadDoors {
  const fetchFn = options.fetch ?? createAuthenticatedFetch();
  const url = `${(options.baseUrl ?? API_BASE).replace(/\/+$/, '')}/approvals/requests`;
  const itemDoor = new ApiDataSource<ApprovalRequestRow>({ read: { url, method: 'GET' }, fetch: fetchFn });

  const findTimeline = async (requestId: string, params: QueryParams): Promise<QueryResult<unknown>> => {
    const refused = Object.keys(params)
      .filter((key) => !TIMELINE_APPLIED.has(key) && !TIMELINE_DROPPED.has(key))
      .filter((key) => !isAbsent((params as Record<string, unknown>)[key]));
    if (refused.length > 0) throw timelineRefusal(refused.sort().join(', '));
    const order = toOrderTerms(params.$orderby);
    const top = windowBound('$top', params.$top);
    const skip = windowBound('$skip', params.$skip) ?? 0;
    const actionsDoor = new ApiDataSource<Record<string, unknown>>({
      read: { url: `${url}/${encodeURIComponent(requestId)}/actions`, method: 'GET' },
      fetch: fetchFn,
    });
    const { data } = await actionsDoor.find(APPROVAL_ACTION_OBJECT);
    const rows = [...data];
    if (order.length > 0) {
      // Stable: `Array.prototype.sort` keeps the route's oldest-first order
      // between rows the terms leave tied.
      rows.sort((a, b) => {
        for (const term of order) {
          const c = compareStored(a[term.field], b[term.field]);
          if (c !== 0) return term.order === 'desc' ? -c : c;
        }
        return 0;
      });
    }
    const page = top === undefined ? rows.slice(skip) : rows.slice(skip, skip + top);
    return { data: page, total: rows.length };
  };

  return {
    url,
    fetchFn,
    findRequest: (id) => itemDoor.findOne(APPROVAL_REQUEST_OBJECT, encodeURIComponent(id)),
    findTimeline,
  };
}

/**
 * The host's other members, bound to it, and cached per host function so a
 * consumer reads one identity for a method across renders. `wrap` replaces a
 * method's implementation; it sees the host's own, already bound.
 */
function forwardToHost<T extends object>(
  host: T,
  own: Readonly<Record<string, unknown>>,
  wrap?: (prop: string, method: (...args: unknown[]) => unknown) => ((...args: unknown[]) => unknown) | undefined,
): T {
  const bound = new Map<PropertyKey, { source: unknown; fn: unknown }>();
  return new Proxy(host, {
    get(target, prop) {
      if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(own, prop)) return own[prop];
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      const hit = bound.get(prop);
      if (hit && hit.source === value) return hit.fn;
      const method = (value as (...args: unknown[]) => unknown).bind(target);
      const fn = (typeof prop === 'string' && wrap?.(prop, method)) || method;
      bound.set(prop, { source: value, fn });
      return fn;
    },
  });
}

/**
 * Build the routed source for one scope. Hand it to `ListView` /
 * `RecordDetailView` as their `dataSource`; mount one per scope.
 */
export function createApprovalRequestsDataSource(
  options: ApprovalRequestsDataSourceOptions,
): DataSource {
  const { host, scope } = options;
  const doors = approvalReadDoors(options);
  const scopeParams = toScopeParams(scope);

  const find = async (resource: string, params?: QueryParams): Promise<QueryResult<unknown>> => {
    if (resource === APPROVAL_ACTION_OBJECT) {
      const requestId = timelineRequestId(params);
      return requestId === null ? host.find(resource, params) : doors.findTimeline(requestId, params ?? {});
    }
    if (resource !== APPROVAL_REQUEST_OBJECT) return host.find(resource, params);
    const query = toListQuery(params);
    if (scopeParams === null) return { data: [], total: 0 };
    const listDoor = new ApiDataSource<ApprovalRequestRow>({
      read: { url: doors.url, method: 'GET', params: { ...scopeParams, ...query } },
      fetch: doors.fetchFn,
    });
    return listDoor.find(resource);
  };

  const findOne = async (resource: string, id: string, params?: QueryParams): Promise<unknown> => {
    if (resource !== APPROVAL_REQUEST_OBJECT) return host.findOne(resource, id, params);
    return doors.findRequest(id);
  };

  return forwardToHost(host, { find, findOne }, (prop, method) =>
    REFUSED_HOST_READS.has(prop)
      ? (resource: unknown, ...rest: unknown[]) =>
          resource === APPROVAL_REQUEST_OBJECT ? Promise.reject(refusal(prop)) : method(resource, ...rest)
      : undefined,
  );
}

/**
 * The console's adapter, with the reads a request's record page makes routed
 * to the approvals routes on every surface (objectui#12045): a `findOne` of
 * `sys_approval_request` and one request's `sys_approval_action` timeline.
 * Every other read, a `find` of `sys_approval_request` included, and every
 * other member are the host's. See the module doc for why lists stay on the
 * data API.
 *
 * Returns the host's own type: the result IS the host, with two reads
 * re-routed, so whatever reads the host reads it.
 */
export function routeApprovalRecordReads<T extends DataSource>(
  host: T,
  options: Pick<ApprovalRequestsDataSourceOptions, 'fetch' | 'baseUrl'> = {},
): T {
  const doors = approvalReadDoors(options);

  const find = async (resource: string, params?: QueryParams): Promise<QueryResult<unknown>> => {
    const requestId = resource === APPROVAL_ACTION_OBJECT ? timelineRequestId(params) : null;
    return requestId === null ? host.find(resource, params) : doors.findTimeline(requestId, params ?? {});
  };

  const findOne = async (resource: string, id: string, params?: QueryParams): Promise<unknown> =>
    resource === APPROVAL_REQUEST_OBJECT ? doors.findRequest(id) : host.findOne(resource, id, params);

  return forwardToHost(host, { find, findOne });
}
