---
'@objectstack/skills': patch
---

docs(skills): the i18n and data skills teach the flow step-name key `flows.FLOW.nodes.NODE_ID.label` and the related-list title key `objects.OBJECT._relatedLists.LIST.label`

Clause-②: no
Metadata-protocol: none

objectstack-i18n's SKILL.md, in the paragraph on the keys that sit deeper than their group's `label`, now names the flow step-name key `flows.FLOW.nodes.NODE_ID.label`: a screen is named through its heading `flows.FLOW.screens.NODE_ID.title` and takes a `nodes` key only beside a `title` of its own, `os i18n check` asks for a flow's top-level steps, and a step of one of the `FLOW_TECHNICAL_NODE_TYPES` (listed) is asked only where a decision's branch leads to it. Text only; paid inside the same file by cutting three restatements in the coverage and extract sections.

The object translation group table gains the `_relatedLists.LIST` row beside `_tabs`: the `label` of an object-form `relatedLists` entry on the parent object, keyed by the entry's literal `list` (a dotted `object.field` is one key); an entry with no `label` has no key and keeps the child field's `relatedListTitle`, else the child's plural label; the unprefixed `relatedLists` spelling is refused, naming the key. objectstack-data's `rules/relationships.md` says the same on the `relatedLists` entry: its `label` translates at `objects.PARENT._relatedLists.LIST.label`, and an entry with none has nothing to translate. One eval case covers both keys. Paid inside each file by cutting restatement; no ceiling of the skills token ratchet moves.
