---
"@objectstack/metadata-protocol": patch
---

test(metadata-protocol): pin the THIRD union-branch policy copy against `@objectstack/spec` (#8660)

The union-branch selection policy — kind-mismatch drop, fewest-issues ranking,
`unrecognized_keys` tie-break, declaration-order determinism, depth limit 3,
branch cap 3 — has three implementations. #8318 (PR #8659) consolidated the two
inside `packages/spec` into one package-internal module and pinned them with a
shared-fixture parity test. The third, `zodIssuesToMetadataIssues` in
`protocol.ts` (the walk behind `saveMetaItem`'s `422 INVALID_METADATA` and the
read path's diagnostics), was structurally out of that consolidation's reach:
the shared module is deliberately not a public export (#4001), so a consumer in
another package cannot import it.

That left this copy exactly where the spec pair sat before #8318 — held in step
by a header comment and nothing else. A future tie-break or ranking tweak lands
in `union-branch-policy.ts` for both spec walks at once and silently not for
this one, and then the same authored metadata gets one prescription from the
terminal, another from the data API, and a third from Studio: the forked verdict
#5014 ruled out.

`src/union-branch-policy.cross-package-parity.test.ts` is the enforcement the
header stood in for. One fixture corpus, one `safeParse` per fixture, three
walks reached through PUBLIC surfaces only — `formatZodIssue` from
`@objectstack/spec`, `zodIssuesToFields` from `@objectstack/spec/api`, and this
package's own copy — compared as ordered `(path, message)` pairs. The corpus
covers every element of the policy by name, plus a hand-authored expectation per
fixture so both sides drifting the same way still fails. The two deliberate
asymmetries (the prose-only omission line, and raw zod codes here vs the
ADR-0114 catalog on the wire) are asserted in place rather than normalised away.

**`patch`, deliberately not a skipped changeset.** No production line changes,
no export moves, and every assertion is green on `main` before this lands — but
the bump floor is right rather than absent, for the same reason
`legacy-unique-guard-attribution` took one: what ships is a ratchet on
release-relevant behaviour. The 422 envelope this pins is a published contract
of `@objectstack/metadata-protocol`, and a consumer reading the CHANGELOG should
be able to see when its verdict acquired mechanical protection against drifting
away from the spec's.
