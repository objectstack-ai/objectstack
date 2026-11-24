// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The approvals inbox's reading state in the address (objectstack#36966): the
 * tab, the status / process / object filters, the search text and the sort.
 *
 * Kept in component state alone, all of it was lost whenever the queue
 * remounted, which is every Back from a request's page: the inbox came back on
 * 「待我审批」 with every filter cleared. Carried in the query string, Back, a
 * reload and a copied link all reopen the inbox as the reader left it — the
 * way an object list keeps its toolbar state in its `uf_*` params.
 *
 * | Param     | Carries                         | Default (no param) |
 * |-----------|---------------------------------|--------------------|
 * | `scope`   | the tab: `submitted` or `all`   | `pending`          |
 * | `status`  | one {@link APPROVAL_STATUSES} value, tabs other than `pending` only | every status |
 * | `process` | the process label a row shows   | every process      |
 * | `object`  | the object's machine name       | every object       |
 * | `q`       | the search text                 | no search          |
 * | `sort`    | `oldest` or `amount`            | `recent`           |
 *
 * Conventions the list views' `uf_*` family set, followed here:
 *
 * - A default is no param, so an untouched inbox keeps a bare address.
 * - Reading is strict and quiet: a value outside its vocabulary is read as the
 *   default, and the inbox still opens. Nothing here throws. `process` and
 *   `object` name data, not a fixed vocabulary; the queue checks them against
 *   the rows it loads (see `ApprovalsQueue`).
 * - Every write keeps the params this module does not own (`request` and any
 *   other) and replaces the current history entry: a filter change is never a
 *   step Back has to walk through.
 * - The names are page-scoped and none is one the console reserves
 *   (`@object-ui/app-shell`'s `urlParams.ts`): the tab rides `scope`, because
 *   `tab` is the record page's detail tab there.
 */

import { APPROVAL_STATUSES } from '@objectstack/spec/contracts';

export type InboxTab = 'pending' | 'submitted' | 'all';
export type InboxSort = 'recent' | 'oldest' | 'amount';

export interface InboxUrlState {
  tab: InboxTab;
  /** A status value, or `'all'`. */
  status: string;
  /** A process label, or `'all'`. */
  process: string;
  /** An object machine name, or `'all'`. */
  object: string;
  /** The search text; `''` is no search. */
  q: string;
  sort: InboxSort;
}

/** The param each part of the state is carried in. */
export const INBOX_URL_PARAMS = {
  tab: 'scope',
  status: 'status',
  process: 'process',
  object: 'object',
  q: 'q',
  sort: 'sort',
} as const satisfies Record<keyof InboxUrlState, string>;

export const INBOX_URL_DEFAULTS: Readonly<InboxUrlState> = Object.freeze({
  tab: 'pending',
  status: 'all',
  process: 'all',
  object: 'all',
  q: '',
  sort: 'recent',
});

const TABS: readonly InboxTab[] = ['pending', 'submitted', 'all'];
const SORTS: readonly InboxSort[] = ['recent', 'oldest', 'amount'];
const STATUSES: ReadonlySet<string> = new Set<string>(APPROVAL_STATUSES);

function oneOf<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/** A non-blank name, or `'all'`. */
function name(raw: string | null): string {
  return raw !== null && raw.trim() !== '' ? raw : 'all';
}

/** The inbox state an address carries; every part it lacks or garbles reads as its default. */
export function parseInboxUrlState(params: URLSearchParams): InboxUrlState {
  const tab = oneOf(params.get(INBOX_URL_PARAMS.tab), TABS, INBOX_URL_DEFAULTS.tab);
  const rawStatus = params.get(INBOX_URL_PARAMS.status);
  // 「待我审批」 lists only requests waiting on the reader and draws no status
  // filter: a status there would hide rows behind a control that is not shown.
  const status = tab !== 'pending' && rawStatus !== null && STATUSES.has(rawStatus) ? rawStatus : 'all';
  return {
    tab,
    status,
    process: name(params.get(INBOX_URL_PARAMS.process)),
    object: name(params.get(INBOX_URL_PARAMS.object)),
    q: params.get(INBOX_URL_PARAMS.q) ?? '',
    sort: oneOf(params.get(INBOX_URL_PARAMS.sort), SORTS, INBOX_URL_DEFAULTS.sort),
  };
}

/**
 * `prev` with `patch` written in: a part set to its default deletes its param,
 * every other part named in `patch` sets it, and every param the patch does
 * not name is kept as it was.
 */
export function applyInboxUrlState(prev: URLSearchParams, patch: Partial<InboxUrlState>): URLSearchParams {
  const next = new URLSearchParams(prev);
  for (const key of Object.keys(patch) as (keyof InboxUrlState)[]) {
    const value = patch[key];
    if (value === undefined) continue;
    const param = INBOX_URL_PARAMS[key];
    if (value === INBOX_URL_DEFAULTS[key]) next.delete(param);
    else next.set(param, value);
  }
  return next;
}
