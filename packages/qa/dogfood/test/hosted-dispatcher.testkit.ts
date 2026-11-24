// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36506] The hosted door over a REAL composed kernel: a request answered by
 * the runtime `HttpDispatcher` alone, the way a hosted tenant kernel is reached
 * (its host's `createHonoApp` catch-all hands every unclaimed `/api/v1/*`
 * request to `dispatch()`; the tenant kernel owns no `http.server`).
 *
 * The booted stack is self-hosted, so its own plugins also mount their doors
 * on its `http.server`; this testkit never goes through that socket. What it
 * drives is the dispatcher's domain for the path, which forwards to the
 * kernel's service member — the path a hosted tenant request takes. Without
 * that domain the answer here is the dispatcher's `404 ROUTE_NOT_FOUND`.
 */

import { HttpDispatcher } from '@objectstack/runtime';
import type { VerifyStack } from '@objectstack/verify';

/** A request through the dispatcher alone, answered as the wire would answer it. */
export type HostedDoorCall = (token: string | undefined, method: string, path: string, body?: unknown) => Promise<Response>;

/** The dispatcher-only door over `stack`'s kernel. `path` is the dispatcher path (no `/api/v1`). */
export function hostedDispatcherDoor(stack: VerifyStack): HostedDoorCall {
  const dispatcher = new HttpDispatcher(stack.kernel as never);
  return async (token, method, path, body) => {
    const request = new Request(`http://tenant.example/api/v1${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const answer = await dispatcher.dispatch(method, path, undefined, {}, { request });
    if (answer.result instanceof Response) return answer.result;
    if (answer.response) {
      return new Response(JSON.stringify(answer.response.body), {
        status: answer.response.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`the dispatcher answered ${method} ${path} with neither a Response nor an envelope`);
  };
}
