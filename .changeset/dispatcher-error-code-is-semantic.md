---
"@objectstack/spec": minor
"@objectstack/runtime": minor
"@objectstack/client": patch
---

fix(runtime,spec)!: the dispatcher's `error.code` is the semantic string it always declared; the HTTP status moves to `httpStatus` (#3842)

`HttpDispatcher.error()` took the HTTP status as its `code` argument and wrote it
straight into the field `ApiErrorSchema` reserves for a semantic string, so
`error.code` came back as `400`/`403`/`503` — a number, duplicating the response
status and occupying the one slot a caller is meant to branch on. The real code
then had to go somewhere else, and did, three somewhere-elses: `details.code`
(auth gate, permission denial, anonymous deny), `details.type`
(project-membership gate), and `error.type` (`routeNotFound`). Four sites, three
parking spots, because the declared one was full.

**FROM → TO on the wire.** A dispatcher error body

```json
{ "success": false,
  "error": { "message": "…", "code": 403, "details": { "code": "PERMISSION_DENIED" } } }
```

is now

```json
{ "success": false,
  "error": { "code": "PERMISSION_DENIED", "message": "…", "httpStatus": 403 } }
```

| Reading | Was | Now |
|---|---|---|
| semantic code | `error.details.code` / `error.details.type` / `error.type` | `error.code` |
| HTTP status | `error.code` | `error.httpStatus` (or the response status) |
| context | `error.details` (with the code mixed in) | `error.details` (context only, absent when empty) |

**One-line fix for a direct reader:** replace `body.error.details?.code ??
body.error.type` with `body.error.code`, and `body.error.code` with
`body.error.httpStatus`. **SDK callers need no change** — `ObjectStackClient`
already normalised this (`err.code` semantic, `err.httpStatus` numeric) and still
reads the old shape, so a client newer than its server is unaffected.

Every code already on the wire moves **verbatim** — `PERMISSION_DENIED`,
`ROUTE_NOT_FOUND`, `PASSWORD_EXPIRED`, `PROJECT_MEMBERSHIP_REQUIRED`,
`VALIDATION_FAILED`, `unauthenticated`. This change moves a field; it does not
rename anything. Reconciling the repo's two code vocabularies is #3841, and this
leaves it exactly one map and one enum to sweep instead of four parking spots.

A branch with no code of its own is served one derived from the status, via the
single declared map `HttpStatusErrorCodeMap` / `standardErrorCodeForHttpStatus`
in `@objectstack/spec/api` (`403` → `permission_denied`, `503` →
`service_unavailable`, …). Derivation is necessary because `ApiErrorSchema.code`
is required; drawing it from `StandardErrorCode` keeps a derived code a
catalogued one rather than an invented string.

**Spec changes:**

- `ApiErrorSchema` gains optional `httpStatus: number` — the precedent is
  `EnhancedApiErrorSchema.httpStatus`. Additive.
- `StandardErrorCode` gains `method_not_allowed` and `precondition_required`,
  the two statuses the runtime returns that the enum could not name. Additive.
- **Breaking — `DispatcherErrorCode`** was `'404' | '405' | '501' | '503'` (string
  spellings of HTTP statuses, for matching against the numeric `error.code`). It
  is now `'ROUTE_NOT_FOUND' | 'METHOD_NOT_ALLOWED' | 'NOT_IMPLEMENTED' |
  'SERVICE_UNAVAILABLE'` — the same four members the removed `error.type` enum
  declared, moved verbatim. FROM `DispatcherErrorCode.parse('404')` TO
  `DispatcherErrorCode.parse('ROUTE_NOT_FOUND')`; to match a status, read
  `error.httpStatus`. TypeScript flags every call site.
- **Breaking — `DispatcherErrorResponseSchema`**: `error.code` is `z.string()`
  (was `z.number().int()`), `error.type` is **removed** (folded into `code`), and
  `error.httpStatus` / `error.details` are declared. This schema is what
  legitimised the deviation — it declared the opposite of `ApiErrorSchema` for
  the same field. FROM `{ code: 404, type: 'ROUTE_NOT_FOUND' }` TO
  `{ code: 'ROUTE_NOT_FOUND', httpStatus: 404 }`.

**Also aligned, because they are the same wire surface:** `dispatcher-plugin`'s
`errorResponseBase` (the THROWN-error exit) and its inline 404, and the MCP 405.
`errorResponseBase` previously discarded a thrown error's `.code` outright — it
had nowhere to put it — so the two exits of one surface disagreed about what a
caller would see; they now agree. Every body on this surface is built by one
helper (`packages/runtime/src/error-envelope.ts`), guarded in both directions by
`error-envelope.conformance.test.ts`: each branch driven and parsed against the
schema imported from `packages/spec`, plus a source scan so a new branch cannot
quietly reintroduce a numeric `code` or a `type`-as-code sibling.

This deletes the #3687 pin in `http-dispatcher.test.ts`, which asked to be
deleted rather than updated once the dispatcher was fixed.
