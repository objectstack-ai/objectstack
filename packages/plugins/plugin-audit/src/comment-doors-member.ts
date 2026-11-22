// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36469] The comment doors, served transport-neutrally:
 * `ICommentDoorsService.handleCommentDoor` (`@objectstack/spec/contracts`).
 *
 * ## Why this exists
 *
 * `AuditPlugin` mounts the three comment doors on the kernel's `http.server`
 * (`mountCommentDoors`). A hosted tenant kernel owns no socket and registers no
 * `http.server`, so on that shape the doors were never mounted, and the host's
 * catch-all answered every unreact, resolve and own-comment delete with the
 * unmatched `404 ENDPOINT_NOT_FOUND`. The runtime dispatcher reaches that
 * kernel instead, through its `/comments` domain, which forwards the request
 * to this member on the kernel's `comments` slot (ruling A on #22438, applied
 * to this member of the class).
 *
 * ## One body, two faces
 *
 * The member runs the SAME registrars the self-hosted mount runs
 * (`registerCommentReactionRoutes`, `registerCommentDoorsRoutes`) over the SAME
 * deps, on a private route table of its own: a `HonoHttpServer` that never
 * listens. So the caller resolution, every refusal, the request-body reading
 * (and its refusal) and every answer are byte-for-byte the mount's: there is
 * no second copy of a door to drift from the first. The table is built on the
 * first request, and every service the doors read is still read per request.
 *
 * ⛔ The table never listens and is never the kernel's `http.server`: a
 * self-hosted kernel keeps its own mount unchanged, and no path is mounted
 * twice on a socket.
 *
 * ## What it answers outside the three routes
 *
 * A method and path that match none of the three routes answers
 * `404 ENDPOINT_NOT_FOUND`, the transport's own unmatched answer, without
 * reaching any door. The dispatcher claims exactly the three shapes and never
 * forwards one.
 */

import type { IHttpServer } from '@objectstack/spec/contracts';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';

import { COMMENT_REACTION_REMOVE_ROUTE } from './comment-reaction-routes.js';
import { COMMENT_REMOVE_ROUTE, COMMENT_RESOLUTION_ROUTE } from './comment-routes.js';

/** One comment door's method and route pattern. */
export interface CommentDoorRoute {
  method: 'DELETE' | 'PUT';
  route: string;
}

/**
 * The three comment doors, in the self-hosted mount's registration order (the
 * order a request is matched in): the unreact door, then the resolution door,
 * then the own-comment delete door.
 */
export const COMMENT_DOOR_ROUTES: readonly CommentDoorRoute[] = [
  { method: 'DELETE', route: COMMENT_REACTION_REMOVE_ROUTE },
  { method: 'PUT', route: COMMENT_RESOLUTION_ROUTE },
  { method: 'DELETE', route: COMMENT_REMOVE_ROUTE },
];

/** Does `pathname` match `pattern`, whose `:name` segments match one non-empty segment each? */
function matchesRoute(pattern: string, pathname: string): boolean {
  const want = pattern.split('/');
  const got = pathname.split('/');
  if (want.length !== got.length) return false;
  return want.every((segment, i) => (segment.startsWith(':') ? got[i].length > 0 : segment === got[i]));
}

/**
 * The comment door `method` and `pathname` name, or `undefined`. Exported so
 * the runtime's claim and this member can be pinned to the same three shapes.
 */
export function matchCommentDoor(method: string, pathname: string): CommentDoorRoute | undefined {
  const verb = method.toUpperCase();
  return COMMENT_DOOR_ROUTES.find((door) => door.method === verb && matchesRoute(door.route, pathname));
}

/** The transport's unmatched answer, as `plugin-hono-server`'s `unmatchedResponse` writes it. */
function unmatched(): Response {
  return new Response(JSON.stringify({ success: false, error: { code: 'ENDPOINT_NOT_FOUND', message: 'Not found' } }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Build `handleCommentDoor` over `mount`, the function that registers the
 * three doors on an `IHttpServer` (the one the self-hosted mount calls too).
 */
export function createCommentDoorMember(mount: (http: IHttpServer) => void): (request: Request) => Promise<Response> {
  let table: HonoHttpServer | undefined;
  return async (request: Request): Promise<Response> => {
    if (!matchCommentDoor(request.method, new URL(request.url).pathname)) return unmatched();
    if (!table) {
      const built = new HonoHttpServer(0);
      mount(built);
      table = built;
    }
    return table.getRawApp().fetch(request);
  };
}
