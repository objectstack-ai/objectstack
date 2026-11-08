---
'@objectstack/skills': patch
---

docs(skills): the objectstack-ui actions rule teaches that a param's `helpText`, like `description`, takes a sentence or an inline locale map, and that the map is how a page button's inline `action` writes its hint per locale

Clause-②: no
Metadata-protocol: none

The skill taught a param's `helpText` as a sentence only, so an agent writing a page button's inline `action`, which no translation bundle reaches, left its hint in one language. `{{ record.* }}` holes work in either form, as `content/docs/protocol/objectui/actions.mdx` and the action param schema say.
