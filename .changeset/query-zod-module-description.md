---
"@objectstack/spec": patch
---

fix(spec): `data/query.zod.ts` now describes the query AST, not one sort node

The published skill reference indexes and the generated `data/query` reference
page opened on "Sort Node" — the description of a single `{ field, order }`
pair — for the file that carries the entire `QueryAST`.

The generators publish the module's OWN doc block: top-level, in the header
zone, documenting no symbol. `query.zod.ts` had no block of its own, and
`SortNodeSchema`'s qualified, because the file's rationale comments sit between
that block and its schema, so nothing attached it to a symbol. The mechanism was
understood when the file was written — a warning comment sits directly under
that block saying the first block becomes the page description. What was not
noticed is the ORDERING: the first block belonged to a symbol, and a comment
warning about a rule is not the same as satisfying it.

The file now opens with a short header of its own, reusing the sentence
`QueryAST`'s own type block already carried. Four published skill indexes
(`objectstack-query`, `objectstack-data`, `objectstack-api`, `objectstack-ui`)
and the reference page name the query AST as a result. `SortNode`'s block is
untouched and still documents the schema it belongs to; the warning comment
beside it now names which block is published and which selector picks it.

What the wrong row cost, in the skills' own terms: the skill tells an agent to
read the source for exact field shapes, so a pointer labelled "Sort Node" makes
it skip the one file that carries the AST.
