// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The console's one discovery read (objectstack#34211).
 *
 * `GET /api/v1/discovery` is read once per page load through
 * `getSharedDiscovery`, whose per-origin cache the data adapter's `connect()`
 * joins: whichever caller asks first supplies the request, every later caller
 * shares its answer. {@link readConsoleDiscovery} is that first caller —
 * `src/main.tsx` starts it at module evaluation, before any adapter exists —
 * and its request is the one `index.html`'s parse-time `startEarlyDiscovery`
 * script already sent beside the session check, taken once from
 * `Symbol.for('objectui.earlyDiscovery')` when its URL and Bearer match. The
 * request carries the stored Bearer, as the data adapter's own discovery read
 * does, and both paths keep one 10 s bound: a request still open then rejects
 * as a timeout. A failed or non-OK early request is not reused: the reader
 * then asks the server itself.
 *
 * So discovery is on the wire with `get-session`, and the adapter's
 * `connect()` finds it answered instead of starting it after the session.
 */

import { getSharedDiscovery } from '@object-ui/data-objectstack';

/**
 * How long the console's discovery request may run before it is abandoned.
 * The request is shared with the data adapter's `connect()`, so this bound is
 * the adapter's too; it matches the shell's own discovery bound.
 */
const DISCOVERY_TIMEOUT_MS = 10_000;

/** Where `index.html`'s parse-time request leaves its answer. */
const EARLY_DISCOVERY_KEY = Symbol.for('objectui.earlyDiscovery');

/** The Bearer every console request carries (`auth-preflight.ts` names the key). */
const TOKEN_KEY = 'auth-session-token';

/** The message both sides give a request that ran out of {@link DISCOVERY_TIMEOUT_MS}. */
const TIMEOUT_MESSAGE = 'discovery timeout';

/**
 * The slot `index.html`'s `startEarlyDiscovery` script fills. `body` is the
 * parsed answer of an OK response, and rejects for a failed or non-OK one, or
 * with {@link TIMEOUT_MESSAGE} once the bound ran out. `token` is the Bearer
 * it sent, `''` for none. Spelled by hand on both sides: a classic inline
 * script cannot import.
 */
interface EarlyDiscoverySlot {
  url: string;
  token?: string;
  body: Promise<unknown>;
  taken?: boolean;
}

/** The stored Bearer, `''` when there is none or storage is blocked. */
function storedToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

/** The discovery document out of its `{ success, data }` envelope, when it has one. */
function unwrap(body: unknown): unknown {
  return body && typeof body === 'object' && typeof (body as { success?: unknown }).success === 'boolean' && 'data' in body
    ? (body as { data: unknown }).data
    : body;
}

function timeoutError(): Error {
  return new Error(TIMEOUT_MESSAGE);
}

/**
 * Take the parse-time answer, once per page load, when it was asked exactly as
 * this reader would ask: the same URL and the same Bearer. It is waited for
 * within {@link DISCOVERY_TIMEOUT_MS}, and a request that ran out of that bound
 * rejects with a timeout, which the caller reports. Anything else — no slot, a
 * second call, a mismatch, a failed or non-OK request — answers `null`, and
 * the caller asks the server itself.
 */
async function takeEarlyDiscovery(url: string, token: string): Promise<{ body: unknown } | null> {
  const holder = globalThis as unknown as Record<symbol, EarlyDiscoverySlot | undefined>;
  const slot = holder[EARLY_DISCOVERY_KEY];
  if (!slot || slot.taken) return null;
  slot.taken = true;
  if (slot.url !== url || (slot.token ?? '') !== token) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeoutError()), DISCOVERY_TIMEOUT_MS);
  });
  try {
    return { body: await Promise.race([slot.body, expired]) };
  } catch (err) {
    if (err instanceof Error && err.message === TIMEOUT_MESSAGE) throw err;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Ask the server — the request `index.html` sends early, byte for byte. */
async function askDiscovery(url: string, token: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw Object.assign(new Error(`discovery ${res.status}`), { status: res.status });
    }
    return await res.json();
  } catch (err) {
    throw ctrl.signal.aborted ? timeoutError() : err;
  } finally {
    clearTimeout(timer);
  }
}

/** The discovery document, through the console's one shared request. */
export function readConsoleDiscovery(serverBase: string): Promise<unknown> {
  return getSharedDiscovery(serverBase, async () => {
    const url = `${serverBase}/api/v1/discovery`;
    const token = storedToken();
    const early = await takeEarlyDiscovery(url, token);
    return unwrap(early ? early.body : await askDiscovery(url, token));
  });
}
