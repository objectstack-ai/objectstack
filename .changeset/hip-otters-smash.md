---
'@objectstack/spec': patch
---

Give six `*.zod.ts` modules a true module-header doc block, so their reference pages open with their introduction again

`postgres` / `mysql` / `sqlite` driver config, `cloud/template-manifest`, `system/doc` and
`api/error-code-ledger` each already carried a real module introduction — but written glued
to the module's first declaration, which under #5059's strict selection rule is that
symbol's TSDoc and therefore not the module's description. The prose was never the problem;
its attachment was. Each block is promoted verbatim to a top-level header that documents no
symbol, the shape 183 of the reference sources already use, and
`content/docs/references/**` is regenerated: six pages gain their opening paragraphs, no
other page changes and no schema byte moves.
