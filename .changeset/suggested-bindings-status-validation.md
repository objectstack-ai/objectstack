---
"@objectstack/core": patch
"@objectstack/runtime": patch
"@objectstack/rest": patch
---

fix(rest): refuse an unknown `?status` on `/security/suggested-bindings` instead of answering an empty list (#7678)

`GET /api/v1/security/suggested-bindings?status=garbage` returned **200 with an
empty list**. That is worse than an error: an empty list is a plausible,
actionable-looking answer, so the response reads as *"there are no suggestions"*
rather than *"your filter was not a status"*. An admin checking whether a package
still has pending audience-binding suggestions got a clean, wrong all-clear.

The route (`registerSecurityEndpoints`) forwarded `req.query.status` straight into
`listAudienceBindingSuggestions`, whose contract — `AudienceBindingSuggestionFilter`
— declares exactly three values (`pending`, `confirmed`, `dismissed`). Anything
else was not an injection (the `where` clause is structured, never interpolated),
it simply matched no row.

**The rule already existed; only one of its two seams had it.** The runtime
dispatcher's `/security` domain has refused unknown statuses since the filter was
first tightened, carrying a comment describing precisely the empty-list arm above.
The live REST route is a second seam onto the same service call and never got it —
a dispatcher-vs-REST divergence pointing the opposite way from the earlier `/meta`
cases, where routes existed on the dispatcher but were never mounted on REST.

So this is a **convergence, not a second implementation**. The vocabulary, the
predicate and the refusal wording move to `@objectstack/core`'s security barrel
(`isAudienceBindingSuggestionStatus`, alongside `shouldDenyAnonymous` and the other
decisions shared by every HTTP seam), and both callers import it. The accepted
values stay keyed *by* the contract type, so adding a status to
`AudienceBindingSuggestionFilter` leaves a key missing and fails to compile rather
than silently drifting.

An unknown `?status` is now refused with **400** and the ADR-0112 envelope
(`{ error: { code: 'VALIDATION_ERROR', message } }`) — matching the repeated-query-
parameter guard already on this route — and the service is not called at all. The
vocabulary is case-sensitive, so `?status=PENDING` is refused like any other
non-status.

Unchanged: every declared status still returns its list, omitting `?status`
entirely still returns the unfiltered list, `?packageId` is untouched, and the
dispatcher seam answers exactly as it did before.
