/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * usePendingActions — REST helper hook for the framework's HITL (Human-In-
 * The-Loop) approval queue, exposed by `@objectstack/service-ai` at
 * `/api/v1/ai/pending-actions/*`.
 *
 * Designed to be shared between the Console workspace inbox and the Studio
 * builder's AI traces panel. Pure React + fetch — no extra deps so it
 * stays inside `plugin-chatbot`'s tiny bundle.
 *
 * The hook polls the list endpoint (default 5 s) and exposes
 * `approve`/`reject` mutators that re-fetch on completion so consumers
 * don't need to micromanage state.
 *
 * The poll follows the answer it last got (objectui#11736). It does not re-arm
 * at a fixed interval no matter what: a refused read stops it, a transient
 * failure backs it off, and a success resets it. The policy lives here, in the
 * hook, so every caller gets the same behaviour. It is documented on
 * `ListReadOutcome` below.
 *
 * @module
 */

import * as React from 'react';

import type {
  ApproveAiPendingActionResponse,
  RejectAiPendingActionResponse,
} from '@objectstack/spec/api';
import type {
  PendingActionRow,
  PendingActionStatus,
} from '@objectstack/spec/contracts';

/**
 * Lifecycle of a pending action proposal, and the row `GET
 * /api/v1/ai/pending-actions` returns — THE spec types, re-exported
 * (objectui#3160, objectstack#4115 ledger batch 6).
 *
 * `@objectstack/spec/contracts` declares both as the contract of
 * `IAIService.proposePendingAction` / `.listPendingActions`, which is exactly
 * what the REST route serialises; the copies that used to live here were a
 * hand transcription of the same rows and had drifted in three ways, each of
 * which silently disabled a compile-time check:
 *
 *  - `status: PendingActionStatus | string` — a union with `string` ABSORBS the
 *    literals, so the type conveyed nothing at all and `statusesForTab` could
 *    have returned a status the server has never heard of;
 *  - `[k: string]: unknown` — the objectstack#4075 mechanism: an index
 *    signature makes any structural comparison against the spec answer
 *    "identical" no matter how far the copy drifts;
 *  - `created_at` / `updated_at`, which the contract does not carry and no
 *    consumer in this repo reads. If the inbox ever needs them, the fix is to
 *    model them in the spec, not to re-widen the row here.
 *
 * `| null` was dropped with the copy for the same reason: it described what a
 * nullable SQL column might serialise to, not what the contract promises, and
 * every reader here (`formatRelative`, `safeParseJson`) already accepts
 * `null | undefined` on its own parameter.
 */
export type { PendingActionRow, PendingActionStatus };

/**
 * The two decision responses —
 * `POST /api/v1/ai/pending-actions/:id/approve` and `…/reject` — THE spec
 * types, re-exported under this package's published names (objectui#3783).
 *
 * `@objectstack/spec/api` declares both (`ApproveAiPendingActionResponseSchema`
 * / `RejectAiPendingActionResponseSchema` in `api/protocol.zod.ts`), and those
 * are the same schemas `@objectstack/client`'s `ai.pendingActions.approve()` /
 * `.reject()` type their return values with — so what is re-exported here IS
 * the wire, not a second reading of it. The local names stay `ApproveOutcome` /
 * `RejectOutcome` because they are this package's public API surface
 * (`src/index.tsx`); only the shapes change.
 *
 * `status: 'failed'` is an HTTP **200** carrying a reason, not a 5xx: the
 * approval succeeded, the execution did not (see the doc comment on
 * `ApproveAiPendingActionResponseSchema`). The comment that used to sit here
 * claimed 500, which contradicted both the spec and this hook's own design —
 * `call()` throws on `!res.ok`, so a 500 could never reach the resolved-value
 * path `AiPendingActionsInbox` reads `out.error` from.
 *
 * The copies this replaces were hand transcriptions and had drifted three ways.
 * Because the local names are NOT the spec's names,
 * `scripts/check-spec-symbol-derivation.mjs` — which fires when a local
 * declaration OCCUPIES a spec export name — had no handle on them at all;
 * renaming a hand copy is invisible to a name-based guard:
 *
 *  - `ApproveOutcome.id: string`, REQUIRED here and absent from the approve
 *    response — `id` is on the REJECT side. This drift was not dormant: the
 *    public `onDecided` callback (`useHitlInChat`) promised consumers a
 *    `string` and handed them `undefined` at runtime, with no compiler
 *    complaint anywhere;
 *  - `status: 'executed' | 'failed' | string` — a union with `string` ABSORBS
 *    the literals, so the annotation carried no information at all. The same
 *    drift #3220 removed from the row above;
 *  - `[k: string]: unknown` — the objectstack#4075 mechanism: an index
 *    signature makes any structural comparison against the spec answer
 *    "identical" however far the copy has drifted, so a parity test bolted onto
 *    the copy would have been green from its first day.
 */
export type ApproveOutcome = ApproveAiPendingActionResponse;
export type RejectOutcome = RejectAiPendingActionResponse;

export interface UsePendingActionsOptions {
  /**
   * Base URL of the AI service, e.g. `http://localhost:3000/api/v1/ai`.
   * Falls back to `/api/v1/ai` (same-origin) when unset.
   */
  apiBase?: string;
  /**
   * Status filter forwarded as `?status=` to the list endpoint. Set to
   * `'all'` (or undefined) to fetch every row.
   */
  status?: PendingActionStatus | 'all';
  /**
   * Conversation filter forwarded as `?conversationId=`. Useful for
   * scoping the inbox to a specific chat thread.
   */
  conversationId?: string;
  /** Hard limit forwarded as `?limit=`. */
  limit?: number;
  /**
   * Extra headers merged into every request (e.g. `X-Environment-Id`,
   * `Authorization`). Cookies are always sent via `credentials: 'include'`.
   */
  headers?: Record<string, string>;
  /**
   * Polling interval in ms. `0` disables polling (caller must invoke
   * `refresh()` manually). Default: 5000.
   */
  pollInterval?: number;
  /** Disable the hook entirely (skips initial fetch + polling). */
  enabled?: boolean;
}

export interface UsePendingActionsReturn {
  items: PendingActionRow[];
  total: number;
  isLoading: boolean;
  error: Error | undefined;
  /** Re-fetch the list. Awaitable. */
  refresh: () => Promise<void>;
  /**
   * Approve a row. Resolves with the dispatcher outcome (success or
   * failed). Re-fetches the list on completion. Throws on transport,
   * 404, or 409 errors.
   */
  approve: (id: string) => Promise<ApproveOutcome>;
  /**
   * Reject a row with an optional reason. Re-fetches the list on
   * completion. Throws on transport, 404, or 409 errors.
   */
  reject: (id: string, reason?: string) => Promise<RejectOutcome>;
}

const DEFAULT_BASE = '/api/v1/ai';

function buildUrl(base: string, path: string, params?: Record<string, string | number | undefined>): string {
  const root = base.replace(/\/$/, '');
  const qs = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === '') continue;
      qs.set(k, String(v));
    }
  }
  const tail = qs.toString();
  return `${root}${path}${tail ? `?${tail}` : ''}`;
}

async function call<T>(
  url: string,
  init: RequestInit,
  extraHeaders: Record<string, string> | undefined,
): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(extraHeaders ?? {}),
      ...(init.headers ?? {}),
    },
  });
  let body: any = null;
  try { body = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const msg =
      body?.error?.message ??
      body?.message ??
      body?.error ??
      `${res.status} ${res.statusText}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)) as Error & { status?: number; body?: unknown };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body as T;
}

/**
 * The poll's one fault policy: what a single list read's answer does to the
 * NEXT read (objectui#11736).
 *
 *  - `ok`: the read answered. The next poll comes after `pollInterval`, and
 *    the backoff resets.
 *  - `transient`: there was no answer, or the answer means "try again later".
 *    That covers a transport failure (no HTTP status at all, such as a network
 *    error or an unreadable body), `408`, `429`, and every `5xx` except `501`.
 *    The poll backs off: each consecutive failure doubles the delay, up to
 *    `MAX_BACKOFF_MS`.
 *  - `refused`: an answer that repeating the same request cannot change. That
 *    covers `501 Not Implemented`, which the open edition answers on a
 *    deployment with no AI service, and every other HTTP status (`401`, `403`,
 *    `404`, ...). The poll STOPS. Two things restart it: a read that succeeds
 *    (a manual `refresh()`, or the re-fetch after `approve` / `reject`), or a
 *    change to the hook's inputs, which starts the poll over.
 *
 * Before objectui#11736 the poll was a `setInterval` that re-armed whatever
 * the read answered. On a deployment without the AI service it asked a dead
 * endpoint every five seconds for as long as the page stayed open.
 */
type ListReadOutcome = 'ok' | 'transient' | 'refused';

/**
 * Ceiling for the transient-failure backoff, in ms. A caller whose own
 * `pollInterval` is longer keeps that interval as the ceiling, so a backoff
 * never polls faster than success does. The value was copied from
 * `@object-ui/app-shell`'s shared user feeds (`MAX_BACKOFF_MS` in
 * `sharedUserFeeds.ts`) when this was written. Nothing keeps the two equal.
 */
const MAX_BACKOFF_MS = 120_000;

/** Classify a failed list read. `call()` puts the HTTP status on the error as `status`. */
function classifyListFailure(err: Error): Exclude<ListReadOutcome, 'ok'> {
  const status = (err as Error & { status?: unknown }).status;
  if (typeof status !== 'number') return 'transient';
  if (status === 408 || status === 429) return 'transient';
  if (status >= 500 && status !== 501) return 'transient';
  return 'refused';
}

/**
 * The poll's schedule. It is held in a ref, and the timer is a `setTimeout`
 * chain armed after each read settles, not a `setInterval`.
 */
interface PollSchedule {
  /**
   * Bumped by every start and every teardown of the poll effect. A read
   * schedules the next one only if the generation it started in is still
   * current, so a read that outlives an unmount or an input change re-arms
   * nothing.
   */
  generation: number;
  /** The success cadence in ms. `0` means the hook is not polling. */
  interval: number;
  /** Consecutive transient failures: the backoff exponent. */
  failures: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Re-arm (or stop) the poll from a read that has just settled. Every list
 * read comes through here: the poll's own tick, the initial read, a manual
 * `refresh()`, and the re-fetch after a decision. So there is one timer at a
 * time, and the policy cannot be skipped by reading through a different door.
 */
function settlePoll(
  poll: PollSchedule,
  generation: number,
  outcome: ListReadOutcome,
  read: () => Promise<void>,
): void {
  if (generation !== poll.generation || poll.interval <= 0) return;
  clearTimeout(poll.timer);
  poll.timer = undefined;
  if (outcome === 'refused') return;
  poll.failures = outcome === 'ok' ? 0 : poll.failures + 1;
  const ceiling = Math.max(poll.interval, MAX_BACKOFF_MS);
  const delay = Math.min(poll.interval * 2 ** poll.failures, ceiling);
  poll.timer = setTimeout(() => {
    poll.timer = undefined;
    void read();
  }, delay);
}

/**
 * Hook that drives the HITL pending-actions inbox.
 *
 * Polls every `pollInterval` while the endpoint answers. A refused read
 * (`501`, `403`, `404`, any `4xx` other than `408` / `429`) stops the poll. A
 * transient failure backs it off, doubling up to a ceiling. A read that
 * succeeds resumes the normal cadence (objectui#11736; see `ListReadOutcome`).
 *
 * @example
 * ```tsx
 * const { items, isLoading, error, approve, reject, refresh } =
 *   usePendingActions({
 *     apiBase: 'http://localhost:3004/api/v1/ai',
 *     status: 'pending',
 *     headers: { 'X-Environment-Id': 'env_local' },
 *   });
 * ```
 */
export function usePendingActions(
  options: UsePendingActionsOptions = {},
): UsePendingActionsReturn {
  const {
    apiBase = DEFAULT_BASE,
    status = 'pending',
    conversationId,
    limit,
    headers,
    pollInterval = 5000,
    enabled = true,
  } = options;

  const [items, setItems] = React.useState<PendingActionRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<Error | undefined>(undefined);

  // Stash mutable bits in a ref so the polling effect doesn't re-arm on
  // every header object identity change.
  const cfgRef = React.useRef({ apiBase, status, conversationId, limit, headers });
  cfgRef.current = { apiBase, status, conversationId, limit, headers };

  const pollRef = React.useRef<PollSchedule>({
    generation: 0,
    interval: 0,
    failures: 0,
    timer: undefined,
  });

  // A named function expression: the poll's timer calls `load` itself, so the
  // schedule never has to reach the fetch through a memoised identity.
  const refresh = React.useCallback(async function load(): Promise<void> {
    const poll = pollRef.current;
    const generation = poll.generation;
    const { apiBase, status, conversationId, limit, headers } = cfgRef.current;
    setIsLoading(true);
    setError(undefined);
    let outcome: ListReadOutcome = 'ok';
    try {
      const url = buildUrl(apiBase, '/pending-actions', {
        status: status && status !== 'all' ? status : undefined,
        conversationId,
        limit,
      });
      const out = await call<{ items: PendingActionRow[]; total?: number }>(
        url,
        { method: 'GET' },
        headers,
      );
      setItems(Array.isArray(out.items) ? out.items : []);
      setTotal(typeof out.total === 'number' ? out.total : (out.items?.length ?? 0));
    } catch (err) {
      const failure = err instanceof Error ? err : new Error(String(err));
      setError(failure);
      outcome = classifyListFailure(failure);
    } finally {
      setIsLoading(false);
    }
    settlePoll(poll, generation, outcome, load);
  }, []);

  // The effect below reaches `refresh` through this ref and keys only on the
  // primitives that define the poll. It must not key on `refresh`'s identity:
  // `useCallback` is a performance hint that React may discard (AGENTS.md
  // commandment #10, objectui#8640).
  const refreshRef = React.useRef(refresh);
  refreshRef.current = refresh;

  const approve = React.useCallback(async (id: string): Promise<ApproveOutcome> => {
    const { apiBase, headers } = cfgRef.current;
    const url = buildUrl(apiBase, `/pending-actions/${encodeURIComponent(id)}/approve`);
    try {
      const out = await call<ApproveOutcome>(url, { method: 'POST', body: '{}' }, headers);
      return out;
    } finally {
      void refresh();
    }
  }, [refresh]);

  const reject = React.useCallback(async (id: string, reason?: string): Promise<RejectOutcome> => {
    const { apiBase, headers } = cfgRef.current;
    const url = buildUrl(apiBase, `/pending-actions/${encodeURIComponent(id)}/reject`);
    try {
      const out = await call<RejectOutcome>(
        url,
        { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) },
        headers,
      );
      return out;
    } finally {
      void refresh();
    }
  }, [refresh]);

  // Initial fetch + polling. Each read re-arms the next one through
  // `settlePoll`, according to what it was answered.
  React.useEffect(() => {
    if (!enabled) return;
    const poll = pollRef.current;
    poll.generation += 1;
    poll.interval = pollInterval > 0 ? pollInterval : 0;
    poll.failures = 0;
    void refreshRef.current();
    return () => {
      poll.generation += 1;
      poll.interval = 0;
      clearTimeout(poll.timer);
      poll.timer = undefined;
    };
  }, [enabled, pollInterval, apiBase, status, conversationId, limit]);

  return { items, total, isLoading, error, refresh, approve, reject };
}
