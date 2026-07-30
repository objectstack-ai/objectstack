---
---

Comment-only correction in `packages/rest/src/package-envelope.conformance.test.ts`
(#3843 follow-up). Deliberately empty frontmatter: this releases nothing.

Two sentences in that suite's header were written while #3841 was still undecided —
"why #3841 still owns the vocabulary" (ADR-0112 has since closed it) and "this
module needed MINTED codes" (true only of the four registered ones; the three
generic conditions reuse the standard catalog). `package-routes.ts` already carried
the corrected note; this was the test file missed beside it.

No published behaviour, type, or wire shape changes, so there is nothing for a
consumer to read in a CHANGELOG.
