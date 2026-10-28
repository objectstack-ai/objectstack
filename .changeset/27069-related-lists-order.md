---
'@objectstack/spec': minor
'@objectstack/platform-objects': minor
'@objectstack/lint': minor
'@objectstack/metadata-core': minor
'@object-ui/app-shell': minor
'@objectstack/skills': minor
---

feat(spec): an object declares the business order of its related lists (`relatedLists`), and `relatedList: 'primary'` places a list instead of ordering it

Clause-②: yes (widening)
Metadata-protocol: semantic

The order of a record page's related lists was not authorable: owned (`master_detail`) children came first and lookup children after, each in the order the packages declared them, so a lead's related lists were in an order nobody chose.

- **`@objectstack/spec`**: `ObjectSchema` gains `relatedLists?: string[]`, beside `highlightFields`. It is an ordered list of inbound relationships, most important first. Each entry is a child object name (`'task'`, every list of that child) or `object.field` for one FK when the child points at this object through several (`'event.related_to'`). Listed lists come first in that order, and the rest follow in the old derived order. `defineStack`, and so `os validate` and `os build`, refuses an entry that matches no inbound `lookup` / `master_detail` field with `STACK_CROSS_REFERENCE_INVALID`, naming the entry and the relationships that do exist. A child declared only by a sibling package, or a platform object, is not judged there. The runtime publish door gives the same verdict on an object write (`related-list-ref-unknown`, HTTP 422 `INVALID_METADATA`), judged against the objects the registry and the stored rows hold, so a Studio, REST or MCP author is refused too. `ObjectFieldGroupSchema` gains `relatedList?: string`, spelled the same way: a group that carries it stands for that list's table in the record's details column instead of a section of fields, and a field that names such a group as its `group` is refused at parse. The record page v3 layout draws that placement; until then such a group is not drawn, as any group without fields is not. The Studio object form offers both keys.
- **`relatedList: 'primary'` changes meaning.** It no longer orders lists; `relatedLists` does. It now says where a list is drawn: in the record's body as a full-width table rather than as a side card, which on today's tabbed record page is still its own tab. And a `master_detail` FK that sets `inlineEdit` (any arm) and declares no `relatedList` is now `'primary'` by default, so inline-edited line items get their own tab on the tabbed page. Write `relatedList: true` on that FK to keep the old placement in the shared Related tab. `relatedList: false` still hides a list whatever `relatedLists` says.
- **`@object-ui/app-shell`**: `deriveRelatedLists` resolves the order in one pure function, `resolveRelatedListOrder`, and marks the inline-edit default as `isPrimary`. Studio's related-list control on a relationship field reads that default too: an inline-edited `master_detail` with no `relatedList` shows as Primary, and picking Show there writes `relatedList: true`.
- **`@objectstack/lint`**: new reference-integrity member `validateRelatedListRefs` (rule `related-list-ref-unknown`, `error`), on the CLI and on `object` writes at the runtime publish gate. A child the snapshot does not hold is refused only when no package closure is in force; under a closure it is not judged.
- **`@objectstack/metadata-core`**: the served object's field-level-security scrub classifies `relatedLists` and a field group's `relatedList` as relationship names, not fields of the object, so a caller denied a field still receives them.
- **`@objectstack/platform-objects`**: the two new form rows are labelled in en, zh-CN, ja-JP and es-ES.
- **`@objectstack/skills`**: objectstack-data's relationship rules teach `relatedLists` and the placement reading of `'primary'`; objectstack-ui's related-list bullet follows.

In this repo three record pages move on merge, each gaining its own line-items tab out of the shared Related tab: `crm_opportunity` (its `crm_opportunity_line_item.opportunity` FK), `showcase_invoice` (`showcase_invoice_line.invoice`) and `showcase_expense_report` (`showcase_expense_line.expense_report`). Each FK sets `inlineEdit: 'grid'` and declares no `relatedList`.

What to do: nothing, unless an object has a `master_detail` child with `inlineEdit` that should stay in the shared Related tab; write `relatedList: true` on that FK. To choose the order of an object's related lists, declare `relatedLists` on it.
