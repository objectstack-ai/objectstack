---
'@objectstack/hono': minor
---

fix(hono)!: `createHonoApp` refuses a declared JSON body that does not parse with `400 INVALID_REQUEST` when the dispatched domain reads it, instead of dispatching it as `{}`

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, no stored row is rewritten or deleted, and no exported declaration is added, removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the accept set of the `createHonoApp` catch-all and its `/auth/*` fallback for one input: a body declared as JSON that does not parse, which used to be dispatched as `{}` and is now refused when a domain reads it. The remedy is in the requests a client sends, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

The `${prefix}/*` catch-all handed `dispatch()` `{}` for a body that did not parse, and the data domain read that as an empty query or an empty update: a truncated `POST /data/OBJECT/query` answered every row the caller could read, and a truncated `PATCH` answered `200` for an update that changed nothing.

What changes for an integrator, on a host that serves `createHonoApp`:

- A `POST`, `PUT` or `PATCH` body sent as `application/json` (matched case-insensitively) that is not blank and does not parse, to a domain that reads the parsed body (the data, metadata and every other domain that takes `body`): FROM that domain's answer for `{}`, TO `400` with `{ "success": false, "error": { "code": "INVALID_REQUEST", "message": "The request body could not be parsed as JSON (it was sent as application/json). It was refused rather than read as an empty body: send a well-formed JSON document, or no body at all." } }`. The domain acts on nothing past its read of the body, and the dispatcher's own gates still answer first. This is the same status and body `@objectstack/plugin-hono-server` answers for the same request.
- The same applies to the `/auth/*` legacy fallback that runs when no auth service is registered, for every method it hands a body (all but `GET` and `HEAD`).

**Remedy, in one line.** Send a JSON body as well-formed JSON with `Content-Type: application/json`, or send no body.

**Unchanged.**

- An empty or whitespace-only JSON body is dispatched as `{}` (an empty query), as before.
- The request handed on beside the body still arrives unread, in every case. A domain that forwards it and reads its own bytes answers exactly as before, a malformed JSON body included: `/webhooks/redeliver` and the inbound automation hooks give their own refusal after their own sign-in or signature check, and the `/approvals/act` form `POST` reads its form.
- The catch-all dispatches `GET`, `HEAD` and `DELETE` with no body, and the `/auth/*` fallback hands `GET` and `HEAD` `{}`, as before.
