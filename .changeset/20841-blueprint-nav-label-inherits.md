---
'@objectstack/spec': patch
---

fix(spec): `BlueprintNavItemSchema.label` says an absent label is inherited at render time, not defaulted by the expander

Clause-②: no

The `label` describe on a blueprint nav item read "defaults to the target label/name". An
expander or an AI author that follows "defaults" copies the target's label into the entry, and
the entry then stops following a rename of that target. The runtime nav entry's `label` has
meant something else since it became optional: absent, the entry inherits the CURRENT label of
what it opens at render time; present, it renders verbatim. The blueprint describe now says
exactly that, and tells the author not to copy the target's label in as a default.

Describe text only: the key stays `z.string().optional()`, so the schema accepts and refuses
the same blueprints. The reference page `content/docs/references/ai/solution-blueprint.mdx`
is regenerated from it.
