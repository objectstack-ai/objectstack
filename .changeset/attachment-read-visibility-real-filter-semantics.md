---
---

test(service-storage): give the attachment read-visibility harness real Filter Protocol semantics (#3774)

Test-only — releases nothing.

`attachment-read-visibility.test.ts` faked its engine with a matcher that
understood implicit equality and `$in` and nothing else: no `$and`, no `$or`,
no `$not`. Every assertion in the file could therefore only check the *shape*
of the filter `computeParentVisibilityFilter` emits, never the rows that filter
selects.

That was a load-bearing gap. The middleware's multi-parent read scope is
`{$or:[{parent_object, parent_id:{$in:[…]}}, …]}`, and driver-sql used to
compile each `$or` branch's own keys with OR instead of AND (#3774, fixed in
#3776) — widening exactly this shape into an in-tenant unauthorized read of
other users' attachments. The suite stayed green throughout, because a fake
that never evaluates `$or` cannot see a `$or` widening bug.

Changes:

- The harness matcher now implements the protocol for real, mirroring
  `driver-memory/memory-matcher.ts` and `formula/matches-filter.ts`: every key
  in a filter object ANDs, `$or` ORs its branches, and a branch's own contents
  still AND. Operators it does not implement now **throw** instead of being
  ignored — a silently under-implemented test double is the failure mode this
  change exists to close.
- A new case asserts the **rows** a multi-parent-type scope returns, not just
  its shape: attachments whose `parent_object` matches a branch but whose
  `parent_id` is absent from that branch's id list (including one that borrows
  the sibling branch's id) are excluded. Under the driver-sql bug this scope
  returned every attachment in the tenant instead of two.
- A conformance block pins the harness matcher against the same 2x2 fixture and
  expectations as `memory-matcher-or-semantics.test.ts`,
  `matches-filter-or-semantics.test.ts` and `sql-driver-or-filter.test.ts`, so
  the four cannot drift apart, plus a case proving the matcher actually tells
  the correct scope from the widened one.
