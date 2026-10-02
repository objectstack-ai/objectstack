---
'@objectstack/spec': patch
---

fix(spec): the strict blueprint nav item's `label` describe says `null` inherits the target's current label

Clause-②: no

`SolutionBlueprintStrictSchema` is the output contract the AI design step generates against, and
strict mode makes every nav entry's `label` a required decision. Its describe read only "Nav entry
label, or null", so nothing the model reads said which of the two choices follows a rename of the
target, and the model was steered toward writing one. The describe now states the lenient
`BlueprintNavItemSchema.label` rule in the strict spelling: `null` ⇒ the entry inherits the CURRENT
label of what it opens at render time (a renamed target shows its new name); a string ⇒ rendered
verbatim, never a copy of the target's label. Write a label only when the entry must read
differently from what it opens.

Describe text only: the key stays `z.string().nullable()`, so the schema accepts and refuses the
same blueprints. A pin holds the lenient and strict `label` describes to one rule.
