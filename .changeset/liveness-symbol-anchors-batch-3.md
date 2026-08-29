---
"@objectstack/spec": patch
---

chore(spec): re-anchor the `email_template` / `api` / `doc` / `book` / `query` / `job` liveness ledgers to consuming symbols (#13003)

Adoption batch 3 of the symbol-anchor citation grammar landed by #12516,
file-disjoint from batches 1 and 2. The `liveness/` ledgers ship inside this
package's npm tarball (they are named in `files`), so this is a published-data
change even though no runtime behaviour moves and no schema key changes.

Ninety-five `path:NNN` evidence citations across `liveness/email_template.json`,
`api.json`, `doc.json`, `book.json`, `query.json` and `job.json` are now written
`path#symbol`, together with every path-only pointer in the same entries, each
re-closed by reading the code on the current tree rather than by shifting a line
number. A symbol moves with its consumer, so the pointer survives the in-file
drift that rots a line, and goes red when the consumer is renamed or deleted — a
direction a stale line can never produce.

What the re-closure found. Seventy-nine of the ninety-five citations were already
pointing at the wrong place, every one of them IN RANGE and so invisible to the
existence check, the line bound and the key-mention check alike. Four whole files
were 100% rotted — `doc.json` 15 of 15, `book.json` 13 of 13, `query.json` 12 of
12, `job.json` 11 of 11 — and the sixteen accurate citations that survive are
concentrated in two places: twelve of the thirteen row-mapping pointers in
`email_template.json`, and four pointers into short, stable policy helpers in
`api.json`. In `doc.json`, its `book.zod.ts` pointers had come to rest inside
the `ResolverDoc` / `ResolvedEntry` INTERFACES — type declarations of the very
fields whose consumers they claimed to cite, which is what a `dead` key has too —
while the whole doc-serving block of `rest-server.ts` moved roughly 1,600 lines
out from under the rest. `email_template.json`'s nine `email-service.ts` pointers
rotted together when #9225 split the resolver out of `sendTemplate` into
`resolveAndRenderTemplate`, moving the reads from the 400s to the 1,170-1,310
band; one of them landed 1,150 lines away on a docblock about the `sys_email`
outbox id contract. Two security-shaped keys had their only pointer land on a
DIFFERENT key's enforcement: `api.authRequired` cited the rate limiter's 429
body, and `email_template.variables` cited the exact line its sibling `isSystem`
cites for itself.

Two pointers were falsified in PROSE as well as position. `api.cacheTtl` cited a
line that was still accurate and named `cacheControlHeader`, which is not a
symbol anywhere in `packages/**` (the function is `computeCacheControl`);
`query.where` named `applyFilters`, which is real and sits roughly 11,250 lines
from the position cited beside it.

Two entries were not checkable at all rather than merely stale.
`query.expand`'s pointer was written `engine.ts:2519+`, and the trailing `+`
stops the token matching the scanner's path pattern — so it degraded silently to
prose and was never resolved, bounded or key-checked, while reading like the most
precise citation in the file. `query.aggregations.filter`, the youngest entry in
that ledger, wrote five of its eight consumers as bare package+filename prose
(`driver-sql sql-driver.ts`), which the same pattern cannot parse. Both are now
repo-rooted anchors — the `webhook.json` class from batch 2, reproduced here once
by a single character and once by a missing prefix.

`job.json` is the file that argues the case most directly: its 2026-08-02 note
records that the seeded lines had already drifted ~25 lines and were restamped
with fresh numbers. Twenty-six days later every one of those fresh numbers had
drifted again, onto `} else {`, a bare `try {`, a bare `}` and a line about
registering actions. Restamping a line is the same claim with a newer date.

Nothing is re-classified here. Entries whose evidence lives only in `objectui` at
a pinned commit this checkout cannot reproduce — `book.description` / `.slug` /
`.icon` / `.order` and `job.label` / `.description` — are left byte-for-byte
untouched and are NOT re-stamped, on the `tool.json` precedent: dating a call
graph nobody re-closed is the false confidence this ledger exists to prevent.
