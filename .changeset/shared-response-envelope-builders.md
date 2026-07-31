---
"@objectstack/types": minor
"@objectstack/rest": patch
"@objectstack/service-storage": patch
"@objectstack/service-settings": patch
"@objectstack/service-datasource": patch
"@objectstack/service-i18n": patch
"@objectstack/plugin-sharing": patch
---

refactor(types,rest,services,plugin-sharing): one shared writer for the response envelope, and `error.code` is enforced at compile time (#3973)

`BaseResponseSchema` declares one envelope for every REST body the platform
emits. It declared it once; the code that *wrote* it was copied per route
module. After #3843 and #3983 converted the last drifting one, seven modules
each carried their own two-line `sendOk` / `sendError` pair — so the envelope's
shape lived in fourteen places rather than one.

`pnpm check:route-envelope` proved those seven copies agreed, which is why this
is a cleanup rather than a bug fix. But a guard proves agreement; it does not
create it. An eighth module starts by copying the pair again — not
hypothetically: `share-link-routes.ts` was found already drifting by the
repo-wide scan, and its drift had broken `client.shareLinks.create()` and
`.list()` through `unwrapResponse` (#3983).

## What moved

`sendOk` / `sendError` now live once, in `@objectstack/types`
(`response-envelope.ts`), and all seven modules import them:

| Module |
|---|
| `service-storage/storage-routes.ts` |
| `service-settings/settings-routes.ts` |
| `service-datasource/admin-routes.ts` |
| `rest/external-datasource-routes.ts` |
| `rest/package-routes.ts` |
| `service-i18n/i18n-service-plugin.ts` |
| `plugin-sharing/share-link-routes.ts` |

Placement was the open question in #3973, not design. `packages/spec` is
schemas-only (Prime Directive #2), and the callers span `rest`, four
`services/*` and one `plugins/*`, which rules out anything depending on them.
`@objectstack/types` depends on nothing but `@objectstack/spec`, so every caller
can reach it, and it is already where the repo puts a helper the HTTP boundaries
share — `looksLikeInternalErrorLeak` (#3867) sits one file over and made the
same argument first.

The builders take a structural `{ status(n), json(body) }`, so the package
imports no HTTP contract at all: `IHttpResponse` satisfies it, and so does the
`any`-typed `res` the older modules carry.

## `error.code` is now checked by the compiler

All seven copies typed the parameter `code: string`. ADR-0112 (#3841) closed the
vocabulary — `ErrorCode` is `StandardErrorCode ∪ ERROR_CODE_LEDGER` — but an
invented code was still caught only at runtime, by a conformance suite parsing a
driven body, i.e. only on routes some test happened to drive.

The shared `sendError` types `code` as `ErrorCode`, so an unregistered code now
fails to compile, at every call site at once:

```ts
sendError(res, 400, 'NOT_A_REGISTERED_CODE', 'invented');
// Argument of type '"NOT_A_REGISTERED_CODE"' is not assignable to parameter of type 'ErrorCode'.
```

This cost no call-site churn: every code the seven modules emit was already
registered.

## `extra` is closed at the same place

`sendError`'s last parameter is `Pick<ApiError, 'category' | 'httpStatus' |
'details' | 'requestId'>` — exactly what `ApiErrorSchema` declares beside `code`
and `message`.

It was `Record<string, unknown>` while `settings-routes` still hung `namespace` /
`key` / `reason` / `fields` beside `code`. Those bodies passed every gate anyway:
`ApiErrorSchema` is a plain `z.object`, so unknown keys were STRIPPED rather than
rejected, and `envelopeViolations` inspects only the body's top level —
conformant *by stripping* rather than by declaration. #4224 moved that module
onto `details`, which is what lets the parameter close here. Closing it at the
shared builder is the part that lasts: an undeclared sibling is now a compile
error in every module at once, rather than a key that quietly evaporates in
whichever module reintroduces it.

## Nothing changes on the wire

The seven pairs were identical modulo the optional `status` and `extra`
parameters this one unions, and each module's driven conformance suite still
parses its real bodies against the real spec schemas. One internal call site was
rewritten: `package-routes` passed `details` positionally and now passes
`{ details }`, producing the same `error.details` it always did.

## The guard got stronger

`scripts/check-route-envelope.mjs` counts response write sites per module. A
module that routes everything through the shared pair builds **none** itself, so
the seven now declare `0 / 0 / 0` where they used to declare `2 / 1 / 1`, and the
shared pair is pinned separately at `2 / 1 / 1` so the invariant stays total for
the surface rather than per-module. What the count asserts is no longer "your two
builders are the enveloped ones" but "you have no builders" — and a new route
that hand-rolls a body still moves it off zero and fails.
