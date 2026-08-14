---
"@objectstack/rest": patch
---

fix(rest): anchor `looksLikeMissingRelation` on the driver's quoted template (#8264)

`mapDataError`'s Postgres limb read `relation` and `does not exist` anywhere in
the message, not necessarily the same sentence — so ordinary business prose
using both words (`This relation does not exist in the diagram`) matched.
`does not exist` is ordinary business English; #8132 already anchored the
shared `@objectstack/types` leak predicate on the driver's own quoted
template for exactly this reason, and pinned the identical string as a
negative case. This file's copy of the same question was not covered by that
change (different package, different call site) and kept the loose reading.

Anchored the same way here — a quoted identifier required between `relation`
and `does not exist` — as a locally-owned pattern rather than a call into the
shared leak predicate: that
predicate answers a different question ("may this be withheld from the
client"), and its other limbs (`sqlite_`, `unique constraint`, `foreign key`,
a bare SQL statement) have nothing to do with this file's question (is this
specifically an unknown-relation condition, for the 404-vs-500 split
`looksLikeMissingRelation` feeds). `relation-sub-object.ts` documents "two
widths, on purpose" for a neighbouring pair of consumers that ask genuinely
different questions; that does not extend to the two USES inside this file,
which both ask the same question and share one predicate correctly.

**Both of the predicate's two call sites are covered, not just the reported
one:** the `DATA_STORE_FAULT` (500) gate the issue named, and the
`looksLikeUnknownObject` (404) limb the issue's own text did not measure. A
business message no longer gets mislabelled a `DATABASE_ERROR`, and a
crafted unquoted-but-attributable message no longer gets silently answered
`OBJECT_NOT_FOUND` — both now fall through to the generic, still-sanitised
terminal fault, which is the direction the branch's own #5462 comment already
argues for ("the safe way to be wrong is loud").

No reachable production path producing the unanchored shape was found at this
call site — this is consistency/invariant restoration between two spellings
of one question, not a fix for a demonstrated live misclassification.
