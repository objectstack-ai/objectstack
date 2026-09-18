---
'@objectstack/spec': patch
---

`ToolExecutionContext.userMessageText` now cites the cloud decision as `cloud ADR-0025`, not as a bare number that resolves to this repo's plugin-packaging ADR

The docblock read `(cloud, post-ADR-0025)`. The parenthetical says the layer is
cloud, but the id was spelled bare — and a bare id resolves against *this*
registry, where `ADR-0025` is
[Plugin Package Distribution](../docs/adr/0025-plugin-package-distribution.md):
a real record about `.osplugin` artifacts, code-plugin trust tiers and
marketplace install. Nothing in it decides who owns the agent route.

That is worse than citing a number nobody has. A dangling id stops a reader; an
id that resolves lets them believe they read the right page and walk away with
the wrong decision. AGENTS.md Prime Directive 13 is explicit — an ADR "lives in
the repository whose code it governs", and a cloud decision is cited as
`cloud ADR-NNNN`, "never as a bare number".

The line now reads `(cloud, post-cloud ADR-0025)`, which is verbatim what the
sibling member `confirmedBlueprintIdentity` two declarations below already says.
The two were deliberately inconsistent while this was open; they are consistent
again.

Docblock prose only — no type, no export and no runtime behaviour changes. The
published `.d.ts` carries the comment, which is why this ships as a patch rather
than silently.
