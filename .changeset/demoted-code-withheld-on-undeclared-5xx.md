---
"@objectstack/types": patch
---

fix(types): a DEMOTED `declaredCode` is withheld on a 5xx the producer did not declare (#12509, ADR-0112)

**Wire change, for undeclared server faults only.** When a 5xx has its prose
withheld, the producer's demoted `declaredCode` is now withheld with it —
but only when the fallback-to-500 picked that code up from a producer that
declared no HTTP answer. An author-declared code is untouched at every status.

FROM (`origin/main`, measured through the real routes):

```
POST /api/v1/packages/publish   → 500 {"error":{"code":"INTERNAL_ERROR",
    "message":"Internal server error","declaredCode":"SQLITE_ERROR"}}
POST /api/v1/analytics/query    → 500 {"error":{"code":"INTERNAL_ERROR",
    "message":"Internal server error","httpStatus":500,"declaredCode":"42P01"}}
```

TO:

```
POST /api/v1/packages/publish   → 500 {"error":{"code":"INTERNAL_ERROR",
    "message":"Internal server error"}}
POST /api/v1/analytics/query    → 500 {"error":{"code":"INTERNAL_ERROR",
    "message":"Internal server error","httpStatus":500}}
```

UNCHANGED — the author-authored channel the ADR-0112 amendment wrote
`declaredCode` for:

```
{ status: 503, code: 'ACME_LEDGER_OFFLINE' }
    → 503 {"error":{"code":"SERVICE_UNAVAILABLE",…,"declaredCode":"ACME_LEDGER_OFFLINE"}}
```

`SQLITE_ERROR` vs `42P01` names the backend, which is one of the two
disclosures the 5xx message withhold exists to prevent (the other,
identifiers, was already covered). Maintainer ruling 2026-08-27, option D.

**What a consumer must know.** A `declaredCode` on a 5xx now means the
producer declared that fault itself, which is a stronger guarantee than the
field carried before; nothing that was a *registered* code moves, and no 4xx
moves. A producer that spells a code but declares no status loses that code
on a 5xx — declare the status the refusal means and the spelling is kept.

The distinction lives in ONE place, `serverFaultProvenance`
(`packages/types/src/thrown-http-error.ts`), read by `demotedDeclaredCode` —
the read every door already makes — so all five emitting exits inherit it and
no registrar carries a variant. The prose axis of the same ruling (the
dispatcher door adopting the structural withhold for every declared 5xx
message) is #12281 and is deliberately not applied here.
