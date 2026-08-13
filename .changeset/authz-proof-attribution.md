---
"@objectstack/verify": patch
---

fix(verify): a conformance ledger's `proof` must NAME the row it proves, not merely exist (#7976)

`checkLedger` asserted exactly one thing about a `proof`: that the file is on
disk (`existsSync(join(proofRoot, r.proof))`). Nothing ever read it. So a row
could cite a test that exercises a **neighbouring** primitive and stay green
forever — and the ADR-0056 D10 authz matrix is where that bites, because it is
the artifact reviewers consult *instead of* re-deriving the audit by hand. Not
hypothetical bookkeeping: `rls-read` and `rls-by-id-write` cite the **same**
file, and until PR #7975 read it line by line nothing could tell whether it
exercised one, the other, or both. That answer cost a manual read of two proof
files and a live ablation; no gate could have produced it either way.

"Does this test actually prove this row" is **not** mechanically decidable, and
this does not attempt it — no heuristic, no coverage inference. It converts the
undecidable question into a checkable one: **the proof file names the rows it is
the proof for, and the pairing must be MUTUAL.**

`CheckLedgerOptions.attribution` (opt-in; every existing ledger is unchanged
until it opts in) takes a marker keyword — the authz matrix uses `authz-row` —
which proof files declare in their header, one line per row:

```ts
// authz-row: rls-read
// authz-row: rls-by-id-write
```

Both directions are then asserted:

1. every row's cited proof file **claims that row's id**, and
2. every claim is **reciprocated** — the claimed id is a real ledger row, and
   that row cites this very file.

Direction 2 is why the option also takes a `scan`: a claim sitting in a file no
row cites is invisible to the citation walk by construction, which is exactly
what a renamed row or a re-pointed proof leaves behind.

A **comment marker** rather than an exported manifest is deliberate. Proof files
are test modules whose import registers — and can boot — real stacks, so a claim
has to be readable without executing them; this is the same `readFileSync` the
existence check already implied. It also mirrors the `@proof:` header idiom
dogfood proofs already carry for the ADR-0054 liveness registry, while keeping a
**separate keyword on purpose**: liveness proof ids and matrix row ids are
different vocabularies (one file is `@proof: cbp-controlled-by-parent` *and*
`authz-row: controlled-by-parent`), and collapsing them would let one gate's
rename silently re-point the other's.

All 24 authz rows that cite a proof were annotated by **reading the cited file**,
never by pattern-matching names. One citation did not survive that read and was
dropped rather than rubber-stamped: `requireAuth-removed` cited
`showcase-anonymous-deny.dogfood.test.ts`, which drives the platform default and
observes 401 — precisely what the `anonymous-deny` row (the same file) already
claims. It never authors `requireAuth: false`, never reads the spec tombstone
and never boots an auth-less stack, so it cannot prove this row's distinguishing
half: that there is **no opt-out**. The row keeps `state: 'enforced'` on its
unchanged enforcement site; it simply stops borrowing a sibling's credibility,
and its note now says where the retirement really is pinned.
