---
---

test(spec): ratchet the "single-record writes imply batch" invariant across every `*.object.ts` (#3026)

Test-only — releases nothing. Adds the monorepo-wide scan that would have
caught #3745 before it shipped: the eight objects that kept 405-ing `/batch`
and the `*Many` routes after the #3391 P1 bulk gate became `bulk ∧ child`,
because the sweep that added the `bulk` primitive was scoped to one package
while the gap lived in three others.
