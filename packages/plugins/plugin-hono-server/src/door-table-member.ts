// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36506] A plugin's `IHttpServer`-mounted doors, served transport-neutrally
 * as one `(request: Request) => Promise<Response>` member, for a kernel with no
 * `http.server` (ruling A on #22438: the runtime dispatcher forwards the
 * request to the member on the request kernel's service slot).
 *
 * ## One body, two faces
 *
 * The member runs the SAME registration the plugin's self-hosted mount runs
 * (`mount`), on a private route table of its own: a {@link HonoHttpServer} that
 * never listens. So the caller resolution, every refusal, the request-body
 * reading and every answer are byte-for-byte the mount's: there is no second
 * copy of a door to drift from the first. The table is built on the first
 * request, and every service the doors read is still read per request.
 *
 * ⛔ The table never listens and is never the kernel's `http.server`: a
 * self-hosted kernel keeps its own mount unchanged, and no path is mounted
 * twice on a socket.
 *
 * ## What it answers outside its routes
 *
 * A method and path that match none of `routes` answers
 * `404 ENDPOINT_NOT_FOUND`, the transport's own unmatched answer, without
 * reaching any door. The dispatcher claims exactly the doors' shapes and never
 * forwards one.
 */

import type { IHttpServer } from '@objectstack/spec/contracts';
import { HonoHttpServer } from './adapter';

/** One door's method and wire route pattern (`/api/v1/...`, `:name` segments). */
export interface DoorTableRoute {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly route: string;
}

/** Does `pathname` match `pattern`, whose `:name` segments match one non-empty segment each? */
function matchesRoute(pattern: string, pathname: string): boolean {
  const want = pattern.split('/');
  const got = pathname.split('/');
  if (want.length !== got.length) return false;
  return want.every((segment, i) => (segment.startsWith(':') ? got[i].length > 0 : segment === got[i]));
}

/** The door in `routes` that `method` and `pathname` name, or `undefined`. */
export function matchDoorTableRoute(
  routes: readonly DoorTableRoute[],
  method: string,
  pathname: string,
): DoorTableRoute | undefined {
  const verb = method.toUpperCase();
  return routes.find((door) => door.method === verb && matchesRoute(door.route, pathname));
}

/** The transport's unmatched answer, as {@link HonoHttpServer}'s `unmatchedResponse` writes it. */
function unmatched(): Response {
  return new Response(JSON.stringify({ success: false, error: { code: 'ENDPOINT_NOT_FOUND', message: 'Not found' } }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Build the member over `mount`, the function that registers `routes` on an
 * `IHttpServer` (the one the self-hosted mount calls too).
 */
export function createDoorTableMember(
  routes: readonly DoorTableRoute[],
  mount: (http: IHttpServer) => void,
): (request: Request) => Promise<Response> {
  let table: HonoHttpServer | undefined;
  return async (request: Request): Promise<Response> => {
    if (!matchDoorTableRoute(routes, request.method, new URL(request.url).pathname)) return unmatched();
    if (!table) {
      const built = new HonoHttpServer(0);
      mount(built);
      table = built;
    }
    return table.getRawApp().fetch(request);
  };
}
