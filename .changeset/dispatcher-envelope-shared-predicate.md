---
---

`domain-handler-registry.test.ts` now uses `envelopeViolations` instead of its own
copy of the rule. Deliberately empty frontmatter: test-only, this releases nothing.

That test hand-rolled "no key beside the envelope's own may hold the payload" for
#4038. #4090 promoted the rule into the spec so it would stop having two
definitions; leaving the local copy would have recreated the exact failure this
line has been closing — one rule, two places, only one updated next time.

The two were also not equivalent. The local set allowed any body whose top-level
keys were `success` / `data` / `meta`, so it passed a success body with no `data`
at all and one carrying an `error` beside `success: true`. The shared predicate
rejects both, which makes this a strict tightening rather than a refactor:
injecting `{ success: true }` into the producer now fails the suite, and used to
pass it.
