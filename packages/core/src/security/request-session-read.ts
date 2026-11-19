// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The request's session-read carrier — one inbound request reads its session
 * ONCE, however many readers inside it ask.
 *
 * ## Why one request asked several times
 *
 * "Who is calling?" is answered by the auth service's in-process session read,
 * `api.getSession(inProcessSessionReadInput(headers))`: one `sys_session`
 * lookup by token and one `sys_user` lookup by id, a remote round trip each on
 * a hosted database. Three readers asked it of the same request:
 *
 *  - the inbound rate limiter (`server.security.rateLimit` armed), which keys
 *    its bucket by the principal in the transport's middleware seam, before
 *    any route runs (`@objectstack/runtime` `resolveSessionData`);
 *  - the identity step of every door (`resolveRequestExecutionContext`'s
 *    session arm, `readSession`);
 *  - REST's ADR-0069 gate (`authGate: 'reread-when-active'`, `decideAuthGate`),
 *    with a gate feature active.
 *
 * The limiter runs in a middleware the transport completes before it calls
 * the route, with a request object of its own, so nothing the limiter holds
 * reaches the route. Measured on a real kernel: two reads per request with the
 * limiter armed, two on REST with a gate active, three on REST with both.
 *
 * ## The scope — one request, never longer
 *
 * The transport opens a scope per inbound request ({@link withRequestSessionRead},
 * `@objectstack/plugin-hono-server` around its whole middleware chain and the
 * route), and every reader above reads through it ({@link readRequestSession}).
 * `resolveRequestExecutionContext` joins the scope its request opened, and opens
 * one of its own for its own call on a transport that opened none
 * ({@link joinRequestSessionRead}), so its two reads share one on any transport.
 *
 * It is an `AsyncLocalStorage` store, not a field on the request, because the
 * readers never see one request object: the transport hands its middleware and
 * its route two different objects built from the same request, and core's
 * readers receive only the request's `Headers`. The same choice as the
 * request-grants memo (`request-grants-memo.ts`), and with the same guarantees:
 * two requests interleaving across their awaits each see only their own scope,
 * a request the transport serves in process inside another opens its own, and
 * the scope is CLOSED when the request settles, so a continuation that outlives
 * it reads afresh and stores nothing. ⛔ This is not a cache and must not
 * become one: nothing read here survives the request. A host whose async
 * context does not propagate (WebContainer's `node:async_hooks`) finds no
 * scope, and every read is fresh, as before this module existed.
 *
 * ## What a stored read answers for — it is served only when a fresh read would agree
 *
 *  - **The same read.** The outer key is the auth service's session API object
 *    (two kernels in one process never share), the inner key every header of
 *    the request, names and values. The read's input is
 *    `inProcessSessionReadInput(headers)`, decided by those same headers, so an
 *    equal key is an equal read. A request that reaches a reader with other
 *    headers (an in-process forward carrying its own credential) is another
 *    entry.
 *  - **No write has landed, or is landing, since the read OPENED.** The
 *    engine's write epoch and the grants memo's engine write observer, read
 *    before the read starts and again at the lookup (`engineWriteMark`,
 *    `engineWritesQuietSince`): a revocation, a ban, a password-change flag, a
 *    membership or grant write, or the session read's own idle stamp, landing
 *    or in flight anywhere on the engine, makes the next reader read afresh.
 *    A reader that names no observable engine stores nothing.
 *  - **Not expired.** A session whose `expiresAt` has passed is not served.
 *  - **Failures are not remembered.** Only a read that resolved is stored; a
 *    read that threw leaves the next reader to read for itself, so each keeps
 *    its own outage answer (the limiter and the identity step degrade to
 *    anonymous, REST's active gate answers 503).
 *
 * Served values are clones: a reader may decorate the payload it was handed,
 * and two readers must never alias one object.
 *
 * Every check the read performs still runs, once, on the read that is
 * served: revocation and expiry (better-auth's lookup), the session limits
 * plugin-auth's `customSession` judges (ADR-0069 D4) and the ADR-0069 posture
 * it attaches. Every judge of the answer still runs on each reader: the
 * limiter spends its budget, the identity step admits or refuses, the gate
 * holds.
 *
 * ⚠️ What it cannot see, stated exactly.
 *
 *  - A write from another process lands unobserved, so a reader is served the
 *    session as of the request's first read, a few milliseconds earlier than
 *    its own read used to see it: the answer a write committing just after
 *    that reader's read always got.
 *  - The key is the headers, not ambient state another module keeps for the
 *    read. plugin-auth's objectstack mounts under the auth base path carry the
 *    request's address to the session reads made inside them, and
 *    `customSession` judges the organization's IP list on such a read
 *    (ADR-0069 D5). Those reads call the session API themselves and never read
 *    through this carrier. No reader that does runs inside that mount: the
 *    `/auth/me/*` endpoints win their match only by being registered ahead of
 *    plugin-auth's mount, its middleware included.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { AuthSessionApi } from '@objectstack/spec/contracts';
import { inProcessSessionReadInput } from '@objectstack/types';

import { engineWriteMark, engineWritesQuietSince, type EngineWriteMark } from './request-grants-memo.js';
import { readWriteEpoch } from './resolve-authz-context.js';

/** What the auth service's in-process session read answers, as `AuthSessionApi` declares it. */
export type RequestSessionRead = Awaited<ReturnType<NonNullable<AuthSessionApi['getSession']>>>;

interface RequestSessionReadEntry {
  /** A private clone of the read's answer. Never handed out directly. */
  value: RequestSessionRead;
  /** The engine the read was observed on. */
  ql: object;
  /** That engine's write state when the read opened, before it started. */
  mark: EngineWriteMark;
}

interface RequestSessionReadScope {
  /** False once the request that opened the scope has settled. */
  open: boolean;
  /** Outer key: the session API object. Inner key: {@link headerKey}. */
  entries: WeakMap<object, Map<string, RequestSessionReadEntry>>;
}

const scopeStorage = new AsyncLocalStorage<RequestSessionReadScope>();

/**
 * Run `fn` — one inbound request, as the transport serves it — inside a fresh
 * scope, and close the scope when it settles. A scope opened inside another
 * (a request served in process from inside a request) is its own.
 */
export async function withRequestSessionRead<T>(fn: () => Promise<T>): Promise<T> {
  const scope: RequestSessionReadScope = { open: true, entries: new WeakMap() };
  try {
    return await scopeStorage.run(scope, fn);
  } finally {
    scope.open = false;
    scope.entries = new WeakMap();
  }
}

/**
 * Run `fn` inside the scope the request opened, or, when none is open, inside a
 * scope of its own for the length of `fn`.
 */
export function joinRequestSessionRead<T>(fn: () => Promise<T>): Promise<T> {
  return scopeStorage.getStore()?.open ? fn() : withRequestSessionRead(fn);
}

/**
 * Every header, names and values, as one string. JSON, not delimiters: a header
 * value is caller-supplied text and must not alias another key by containing a
 * separator. `Headers` iterates in sorted lower-cased order, so two readers
 * that built their `Headers` from one request agree.
 */
function headerKey(headers: Headers): string {
  return JSON.stringify([...headers]);
}

/** Has the session this answer carries expired? A missing or unreadable expiry is not judged here. */
function sessionExpired(value: RequestSessionRead): boolean {
  const expiresAt: unknown = (value?.session as { expiresAt?: unknown } | undefined)?.expiresAt;
  if (expiresAt === undefined || expiresAt === null) return false;
  const at = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt as string | number).getTime();
  return Number.isFinite(at) && at <= Date.now();
}

/**
 * The request's in-process session read: `api.getSession(inProcessSessionReadInput(headers))`,
 * answered from an earlier read of the same request when that read would still
 * agree (see the module docblock). `ql` is the data engine the reader's auth
 * service reads through, the one whose writes can change the answer.
 *
 * A read that throws propagates to its reader unchanged and is not stored.
 */
export async function readRequestSession(
  api: AuthSessionApi,
  headers: Headers,
  ql: unknown,
): Promise<RequestSessionRead> {
  const read = () => api.getSession!(inProcessSessionReadInput(headers));
  const scope = scopeStorage.getStore();
  if (!scope?.open || !api || typeof api !== 'object') return read();

  const key = headerKey(headers);
  const stored = scope.entries.get(api)?.get(key);
  if (
    stored
    && engineWritesQuietSince(stored.ql, stored.mark, readWriteEpoch(stored.ql))
    && !sessionExpired(stored.value)
  ) {
    try {
      return structuredClone(stored.value);
    } catch {
      // Not cloneable: read afresh rather than alias.
    }
  }

  const engine = ql && typeof ql === 'object' ? ql : undefined;
  const mark = engine ? engineWriteMark(engine, readWriteEpoch(engine)) : undefined;
  const value = await read();
  if (!engine || !mark || !scope.open) return value;
  let copy: RequestSessionRead;
  try {
    copy = structuredClone(value);
  } catch {
    return value;
  }
  let perApi = scope.entries.get(api);
  if (!perApi) {
    perApi = new Map();
    scope.entries.set(api, perApi);
  }
  perApi.set(key, { value: copy, ql: engine, mark });
  return value;
}
