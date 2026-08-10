---
"@objectstack/runtime": minor
---

fix(runtime): a `/share-links` permission denial answers 403, not 500 (#6649)

The dispatcher's `/share-links` domain ended in a hand-written catch that read
one status channel:

```
return sendErr(err?.status ?? 500, err?.code ?? 'INTERNAL', err?.message ?? '…');
```

Every refusal `ShareLinkService` raises itself carries `status` (its `makeError`
sets `status` + `code`), which is why the 403 `FORBIDDEN` and 422
`SHARING_NOT_ENABLED` answers were always correct. But the refusals that come
out of the **security middleware** do not come from that service. Creating a
link performs a visibility read — `svc.createLink` calls
`engine.find(object, { context })` — and when the caller's permission sets grant
no `allowRead` on the object, the CRUD gate throws
`PermissionDeniedError { code = 'PERMISSION_DENIED'; statusCode = 403 }`, a class
with **no `status` field at all** (`plugin-security/src/errors.ts`; runtime's own
mirror in `security/resolve-execution-context.ts` has the same shape).
`ShareLinkService` does not catch it, so it reached the domain catch, `err?.status`
was `undefined`, and a 403-class refusal left as **HTTP 500** while `error.code`
faithfully read `PERMISSION_DENIED`.

That envelope contradicted itself, and the contradiction is load-bearing on the
client: 5xx is retryable to many SDKs and browser clients, so a permanent
authorization answer was being retried, and a caller branching on the status saw
"the server is broken" where the truth was "you may not read this record". It is
reproducible on either tenancy posture, and — because `registerShareLinkRoutes:
false` makes this domain the ONLY share-link surface on cloud's per-environment
kernels — it is the primary surface there, not a fallback one.

The catch now exits through `deps.errorFromThrown`, the dispatcher's shared
thrown-error mapper that `/meta`, `/actions` and `/mcp` already use. It reads
`status` **or** `statusCode`, and it carries a thrown error's structured
`issues` / `fields` details through instead of collapsing them to a message.
Reaching for the shared mapper — rather than widening the hand-written chain to
`err?.status ?? err?.statusCode ?? 500` — is the part that stops this exit
re-diverging: a second hand-written copy is how the two drifted apart in the
first place.

Two wire-visible consequences, both corrections:

- A permission denial on `POST` / `GET` / `DELETE /share-links` answers **403
  `PERMISSION_DENIED`** where it answered 500 `PERMISSION_DENIED`. Clients
  treating 5xx as retryable stop retrying a permanent refusal.
- A throw carrying neither status channel nor a code answers **500
  `INTERNAL_ERROR`** where it answered 500 `INTERNAL`. `'INTERNAL'` was never
  registered for `@objectstack/runtime` in `ERROR_CODE_LEDGER` (only `rest`,
  `service-storage`, `service-i18n` and `plugin-sharing` register it, and the
  ledger's per-package rows are provenance) — so this domain was emitting a code
  it had not registered, and the required field is now filled by the catalogued
  derivation every other dispatcher exit uses (ADR-0112).

Refusals that already carried `status` are untouched: the mapper reads that
channel on the same first branch the old chain did.
