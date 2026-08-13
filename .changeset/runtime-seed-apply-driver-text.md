---
"@objectstack/runtime": patch
"@objectstack/metadata-protocol": patch
---

fix(runtime): the package-publish door no longer discloses driver text on `seedApplied` (#8443)

`POST /api/v1/packages/:id/publish-drafts` answered, on a **200**:

```json
{ "success": true, "data": { "seedApplied": {
  "success": false, "error": "SQLITE_ERROR: no such table: sys_metadata" } } }
```

The door keeps a route-level seed apply for protocols that do not apply seeds
inside `publishPackageDrafts` themselves. That fallback is a second copy of
`metadata-protocol`'s `applySeedBodies`, and it kept the ADR-0112 defect the
original was fixed for: a caught error's sentence interpolated onto a
client-facing payload. `seedApplied` rides on a success body as **data**, so no
HTTP boundary's 5xx message withhold can reach it — the disclosure had to be
closed at the producer.

Driven for real before being changed, which found **two** carriers on that one
field rather than the one reported:

- the door's `catch` — a driver failure under the seed loader's
  dependency-graph read, which is unguarded;
- the per-read `errors[]` entries — a driver failure reading the just-published
  seed body back. This is the carrier a `sys_metadata` outage reaches first, so
  a fix confined to the `catch` would have left the commonest outage shape
  disclosing exactly as before.

Both now follow the rule already in force next door: a caught sentence is
quoted only when the error **declared** itself a client-facing refusal (4xx
`status`); anything else gets a stable line and the original goes to the server
log.

**Authoring feedback is preserved, not blanked.** A malformed seed body used to
arrive in the same `catch` as a raw `ZodError` — undeclared, so the withhold
would have replaced a real authoring error with `seed apply failed`. The seed
request is now parsed with `safeParse` and its rejection minted as a declared
`INVALID_METADATA` / 422, so the author receives a curated summary naming the
seed and the key (strictly better than the multi-line dump of zod internals the
field used to carry). Self-correcting refusals such as `[item_locked]` continue
to reach the caller verbatim.

`@objectstack/metadata-protocol` exports `clientFacingFailureText` and
`seedRequestValidationError` so the runtime door applies the producer's own
decision instead of restating it — **an enabling export only; no behaviour in
that package changes.**
