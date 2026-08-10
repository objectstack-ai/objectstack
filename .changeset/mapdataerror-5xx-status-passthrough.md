---
'@objectstack/rest': patch
---

REST: a declared 5xx status now survives on the CRUD data routes

`mapDataError`'s explicit-status passthrough accepted only 4xx, while
`resolveErrorResponse` (the door every metadata/UI/discovery/batch route uses)
accepts 400-599. The same thrown error therefore got two different answers
depending on which route caught it, and on the data routes a producer's
declared 5xx was overwritten — the status re-derived from the message text, or
falling through to `500 INTERNAL_ERROR`.

The passthrough is now 400-599 on both doors, with the same disposition #5437
already ruled for a declared server fault: **keep the status, keep the
machine-readable `code`, drop the prose**. The `code` half reads
`declaresServerFault` from `@objectstack/types`, so an empty or non-string code
is not mistaken for an ADR-0112 declaration and nothing is invented when the
producer named no code.

User-visible effect: an aggregate function a SQL backend cannot compile
(`count_distinct` / `array_agg` / `string_agg`) now answers
`501 NOT_IMPLEMENTED` instead of `500 INTERNAL_ERROR`, and an upstream/
dependency `502` / `503` reaches the caller as itself rather than as a generic
500. The 4xx half is unchanged (wording truncated, `object` retained), no 5xx
message text reaches the client, and the withheld text still reaches the
operator log.
