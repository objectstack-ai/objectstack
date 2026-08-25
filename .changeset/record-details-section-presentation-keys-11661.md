---
"@objectstack/spec": minor
---

Declare three more `record:details` section keys the renderer has honoured all along (#11661, inheriting the #11289 ruling): `defaultCollapsed` (start a `collapsible: true` section collapsed; renderer default expanded), `icon` (heading icon, lucide name; non-identifier values render as literal text) and `description` (plain-string sub-heading under the section heading). All three were refused by the strict section schema, so `objectstack validate` warned an authored key "did nothing" while the renderer read it. All three are optional with NO schema defaults — the fallbacks stay the renderer's. The same measurement's `title` and `headerColor` deliberately remain refused: `title` is a second spelling of the heading slot `label` declares (held for a declare-vs-converge ruling), and `headerColor` only reaches the DOM as a template-literal Tailwind class that generates no CSS (dead-in-practice; reported as an objectui finding).
