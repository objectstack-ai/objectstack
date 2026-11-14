---
'@objectstack/spec': patch
---

docs(spec): the protocol upgrade guide names the bare item read #32607 narrows: a name two or more enabled packages hold only as stored rows, which no package ships in code, is refused naming each holder instead of served by save order

Clause-②: no
Metadata-protocol: none

The semantic entry `two-row-holders-bare-read-refused` (`packages/spec/src/migrations/entries/semantic/18.two-row-holders-bare-read-refused.ts`) registers the narrowing `.changeset/32607-two-enabled-row-holders.md` declares (ADR-0087, `adr-0087: registered`). There is no automatic rewrite, because which package's row a caller meant is a judgement about that caller. The remedy it names is the exact read (`?package=`), which serves each holder's row. It adds no key and no export.
