---
'@objectstack/hono': patch
---

fix(hono): `createHonoApp`'s catch arms withhold a driver diagnostic from an undeclared `500` instead of shipping it to the client (#23532)

Clause-②: no

`@objectstack/hono`'s `createHonoApp` has two catch arms: the auth mount's, and the `${prefix}/*` catch-all's around `HttpDispatcher.dispatch()`. A throw that does not declare an ADR-0112 envelope is answered from its own `message`, and that message was shipped unread. A driver diagnostic therefore reached the client verbatim: on a host whose object `ghost` was registered but whose table was never synced, `POST /api/v1/data/ghost` answered `500 INTERNAL_ERROR` with the message `insert into [statement and bound values redacted] - no such table: ghost`, naming the SQLite error and the physical table.

**What changed.** Before it ships that message, the arm now asks `looksLikeInternalErrorLeak` (`@objectstack/types`), as every other door that emits a thrown message already does: `HttpDispatcher.error`, the REST registrars, `@objectstack/plugin-hono-server`'s direct-mount routes and this adapter's own `/auth/config` arm. When the answer is a `5xx` and the message looks like a driver or SQL dump, the message is replaced by the same text those doors use, `Internal server error`. The status and the `code` are unchanged.

**What did NOT change:**

- a `5xx` whose message does not look like a dump keeps it: a bare `new Error('boom')` is still `500 INTERNAL_ERROR` with the message `boom`;
- a `4xx` keeps its message, as on the other doors, because a `4xx` message is an answer meant for the caller;
- a throw that declares an ADR-0112 envelope is answered as declared, as before.
