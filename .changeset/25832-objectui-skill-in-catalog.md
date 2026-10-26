---
'@objectstack/skills': patch
---

docs(skills): the `objectui` skill joins the published catalog, so `@objectstack/skills` ships the `@object-ui/*` authoring skill beside the `objectstack-*` ones

Clause-②: no
Metadata-protocol: none

- **What ships.** `skills/objectui/` (its `SKILL.md`, 11 guides, 3 rules, 11 evals and a README) moves in from the objectui repository's own `skills/` tree. A project that syncs `@objectstack/skills` now gets an `objectui` skill in its agent directory, and `npx skills add objectstack-ai/objectstack/skills` lists it on the `next` channel.
- **Stamped like the others.** Its `compatibility:` line now reads `Requires @objectstack/spec 18.x`, and `metadata.version` carries the workspace version, as on every catalog skill.
- **Content changes on the way in.** The guides use the platform's vocabulary: expression examples gate on `data.status` or a user position, not on a `role` field, and the expressions guide gates a combined condition with `visibleWhen` instead of the deprecated `visibleOn`. The `@object-ui/permissions` example keeps its real `roles` keys, and the plugin guide's color input passes `value ?? ''` instead of a hard-coded black fallback.
