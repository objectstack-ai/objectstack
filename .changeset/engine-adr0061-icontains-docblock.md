---
"@objectstack/objectql": patch
---

docs(objectql): correct the ADR-0061 search-expansion docblock to `$icontains` (#13744)

Comment-only, zero behaviour. The ADR-0061 docblock on `ObjectQL`'s
`expandSearchOnAst` described the `$search` expansion as a cross-field `$or` of
`$contains` in **two** places, and both were false:

- "expand `search` into a server-resolved cross-field `$or` of `$contains`" —
  the shape of the expansion;
- "All drivers already execute `$or`/`$contains`, so this needs no driver
  changes" — the easier one to miss, because it reads as a statement of fact
  about driver capability rather than a description of the expansion.

The implementation one file over (`search-filter.ts`) emits `$icontains` for the
source-column clauses and records the adjudication in its own header:
"[#7641] The case-insensitive operator is `$icontains`, NOT `$contains`." The
two files contradicted each other and the implementation was the correct one, so
the docblock is brought into line with it. `search-filter.ts` is not touched.

Why a stale comment was worth a change at all: `engine.ts` is the file an agent
working the query engine reads first, so a docblock asserting the retired
spelling is a live invitation to re-introduce the defect #7641 paid to retire.

Deliberately NOT changed, in the same file: the multi-value containment passage
on `referenceProbeFilter`, where `$contains` is the *correct* spelling — that
paragraph is about membership over a stored array, not about ADR-0061 search
expansion. Likewise the `__search` companion clause in `search-filter.ts`, which
stays `$contains` by design (both sides are already lowercase, so a
case-sensitive operator over two folded values is exact).
