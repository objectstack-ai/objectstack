---
'@objectstack/plugin-security': patch
---

fix(security): scope the bulk-write predicate guard to the caller's own filter, and dedupe pre-image reads (#3018 review follow-ups)

Two hardening follow-ups from the #3018 adversarial review.

**Predicate guard is now middleware-order-independent for writes.** #2982 made bulk
`update`/`delete` carry an `opCtx.ast`, which brought them under the step-2.9
anti-oracle predicate guard for the first time. That guard is documented to run
against the *caller's own* predicate — RLS / sharing filters legitimately reference
fields the caller cannot read (e.g. `owner_id`). But for a bulk write it inspected
`opCtx.ast.where`, which a sibling middleware (`plugin-sharing`) may have already had
an `owner_id` owner-match composed into — and the two middlewares' registration order
is not contractually guaranteed. On an object whose `owner_id` is FLS-hidden, that
could 403 a legitimate bulk write purely because the injected filter named the field.
The guard now inspects `opCtx.options.where` (the caller's untouched predicate) for
`update`/`delete`, so it can never mistake an injected owner/RLS filter for a caller
probe, independent of middleware order. Reads are unchanged (the read seed is the
caller's query verbatim and the guard runs before this middleware's own injection).

**Pre-image reads deduplicated.** The by-id "read the target row" pattern was inlined
at ~5 gates with slightly divergent shapes; a single `readRowById` helper (fail-closed:
missing engine / null id / thrown read → `null`, which always denies) now backs the
provenance gates, and a memoized `getCallerPreImage` collapses the owner-anchor echo
check (3.5) and the RLS `check` post-image (3.6) — which read the identical
`(object, id, caller-context)` row — into one read per operation. No behavior change;
the read shape can no longer drift across sites.
