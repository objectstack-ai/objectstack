---
'@objectstack/skills': patch
---

docs(skills): objectstack-data teaches that the package shipping a `fieldPatches` relabel translates that text in its own `translations`

Clause-②: no
Metadata-protocol: none

`skills/objectstack-data/SKILL.md`, the `fieldPatches` paragraph: patched text is translated in the patching package's `translations`, under the owner's keys (`objects.crm_account.fields.industry.label`, `.help`, `.options.<value>`); the owner's translation of the text the patch replaced never applies, a pair `.custom` translation comes first on `/meta`, and a locale the package does not translate serves the patch text. This is the skill text for the behaviour `@objectstack/spec` 18 already ships; the docs page `data-modeling/object-extensions` teaches the same. One eval case asks where a dependent package's zh-CN strings for its patch go. The file pays in full by dropping restatement and its token ceiling does not move: the lead-in line under the Quick Reference heading, the second half of the multi-value-lookup note (the Relationship Patterns rows carry it), and the two unique scopes named again under the index example. No schema or runtime change.
