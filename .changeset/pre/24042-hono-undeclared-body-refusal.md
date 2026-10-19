---
'@objectstack/hono': minor
---

fix(hono)!: `createHonoApp` reads a dispatched body by `@objectstack/plugin-hono-server`'s rule, so a JSON body sent as `text/plain`, or any other body that declares neither JSON nor a form, is refused `400 INVALID_REQUEST` when the dispatched domain reads it, instead of being parsed or dispatched as `{}`

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, no stored row is rewritten or deleted, and no exported declaration is added, removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the accept set of the `createHonoApp` catch-all and its `/auth/*` fallback for bodies that declare neither JSON nor a form, which used to be parsed as JSON whatever they declared or dispatched as `{}`, and are now refused when a domain reads them. The remedy is in the requests a client sends, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

The `${prefix}/*` catch-all and the `/auth/*` legacy fallback parsed every body as JSON whatever its `Content-Type`, and handed `dispatch()` `{}` for any body that did not parse. So the two Hono doors answered one request two ways: `@objectstack/plugin-hono-server` (`objectstack dev`, `os serve`) refused a valid query body sent as `text/plain`, and this door honoured it; a garbled body that did not declare JSON reached the data domain here as `{}`, the empty query, and read every row the caller could read.

What changes for an integrator, on a host that serves `createHonoApp`, for a `POST`, `PUT` or `PATCH` body read by a domain that reads the parsed body (the data, metadata and every other domain that takes `body`), and on the `/auth/*` legacy fallback for every method it hands a body (all but `GET` and `HEAD`):

- A JSON body sent as `text/plain`, or as any media type other than JSON or a form: FROM parsed and honoured, TO `400` with `{ "success": false, "error": { "code": "INVALID_REQUEST", "message": "The request body was sent as text/plain, which this server does not read into a request body. It was refused rather than read as an empty body: send it as application/json." } }`, the message naming the media type that was sent.
- Any other body that declares neither JSON nor a form (`text/plain`, `application/octet-stream`, a `+json` suffix type such as `application/merge-patch+json`, or no `Content-Type` at all), when the request declares a body (`Content-Length` other than `0`, or `Transfer-Encoding`): FROM `{}`, TO the same refusal ("sent with no Content-Type" when there is none).
- A `multipart/form-data` or `application/x-www-form-urlencoded` body: FROM `{}`, TO its parsed fields, as `plugin-hono-server` hands them (Hono's `parseBody`: the last value of a repeated name). A form that does not parse: TO the refusal "The request body could not be parsed as form data (it was sent as multipart/form-data). It was refused rather than read as an empty body."

The domain acts on nothing past its read of the body, and the dispatcher's own gates still answer first. Each answer is the status and body `@objectstack/plugin-hono-server` gives the same request. This replaces the earlier `createHonoApp` entry's statement that a body that does not declare JSON is read as before.

**Remedy, in one line.** Send a JSON body with `Content-Type: application/json`, or send no body.

**Unchanged.**

- A body sent as `application/json` (matched case-insensitively) is parsed when well-formed, `{}` when blank or whitespace-only, and refused when it does not parse, as before.
- A request that declares no body is dispatched as `{}`, whatever its media type.
- The request handed on beside the body still arrives unread, in every case. A domain that forwards it and reads its own bytes answers exactly as before, whatever the body declares: `/webhooks/redeliver` and the inbound automation hooks give their own refusal after their own sign-in or signature check, and the `/approvals/act` form `POST` reads its form.
- The catch-all dispatches `GET`, `HEAD` and `DELETE` with no body, and the `/auth/*` fallback hands `GET` and `HEAD` `{}`, as before.
