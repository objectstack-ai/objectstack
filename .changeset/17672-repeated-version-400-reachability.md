---
'@objectstack/rest': minor
'@objectstack/runtime': patch
---

fix(runtime): a repeated `?version=` on `GET /packages/:id` is refused `400 VALIDATION_ERROR` in the repo's one message, and `@objectstack/rest` publishes the rule that owns it (#17672)

`GET /api/v1/packages/:id?version=a&version=b` answered **`404`**, with a second
sentence written at that door. This repo already had a landed answer for exactly
that condition on exactly that route — `400 VALIDATION_ERROR` in the ADR-0112
nested body (#6307) — and one implementation of it, `refuseRepeatedQueryParams`
/ `repeatedQueryParamMessage` in `packages/rest/src/query-multiplicity.ts`,
whose header is the authority on the rule.

Driven before the change, one host, three refusals:

```
GET /packages/com.acme.crm?version=a&version=b  -> 404 RESOURCE_NOT_FOUND
GET /packages/com.acme.crm?version=99.0.0       -> 404 RESOURCE_NOT_FOUND
GET /packages/com.absent.pkg?version=99.0.0     -> 404 RESOURCE_NOT_FOUND
```

A client branching on the answer could not tell "your request named the
parameter twice" from the two genuine not-founds. After:

```
GET /packages/com.acme.crm?version=a&version=b  -> 400 VALIDATION_ERROR
GET /packages/com.acme.crm?version=99.0.0       -> 404 RESOURCE_NOT_FOUND
GET /packages/com.absent.pkg?version=99.0.0     -> 404 RESOURCE_NOT_FOUND
```

The body is the dispatcher's declared envelope —
`{ success: false, error: { code: 'VALIDATION_ERROR', message, httpStatus: 400 } }`
— with `VALIDATION_ERROR` derived by `buildApiError` from
`standardErrorCodeForHttpStatus(400)`, the standard catalog's member for 400.
⛔ Nothing in `packages/spec` moves.

**What was actually blocking this was reachability, not judgement.**
`@objectstack/rest` declares exactly one export subpath and that module was not
on it, so #17668 could neither call the rule nor (correctly) copy it, and
shipped the `404` with its own sentence instead. The barrel now publishes
`repeatedQueryParamMessage` and `refuseRepeatedQueryParams`, and the dispatcher
domain calls the message function — so the sentence a caller is told for a
repeated parameter is the same one on every door that carries the rule, ⛔ never
a second copy that drifts.

⚠️ The two published symbols are not interchangeable across a package boundary,
and the barrel entry says so. `repeatedQueryParamMessage` is the portable half:
a pure function of two primitives. `refuseRepeatedQueryParams` writes the bare
ADR-0112 body onto a `res`, which suits handlers of that shape and ⛔ not a
runtime dispatcher domain — measured, its body fails that surface's
`BaseResponseSchema` with `success is missing, must be a boolean`.

**Not a breaking change, measured rather than assumed.** The `404` it replaces
was introduced by #17668 (`1a25f4a8d`), which is not an ancestor of
`@objectstack/runtime@17.4.0` (exit 1; two control commits from that tag's own
history answer exit 0 on the same predicate, in a checkout
`--is-shallow-repository` reports `false`). It has never been published, so no
released consumer can have branched on it. Everything else about the door is
unchanged: `?version=<installed>` and `?version=latest` still serve the
installed row, an absent version and an unknown id still answer `404`, and a
one-element array is still one occurrence.

Also corrected, on the module that owns the rule: its header said the
dispatcher's `/packages` domain "reads no `version`" — load-bearing prose,
since it is part of why the rule needs only one home. That stopped being true
when #17668 landed. The paragraph now states what is true, which is that the one
home did not move and now serves two doors.
