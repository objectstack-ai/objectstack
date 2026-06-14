---
"@objectstack/spec": patch
---

ui(page.form): sourceView is a view picker; hide template on list pages

- `interfaceConfig.sourceView` now declares `widget: 'view-ref'` + `dependsOn: 'source'` so the page editor renders a dropdown of the source object's views instead of a free-text input (where an author could type a non-existent view name). The objectui `view-ref` widget reads the source object's views; until it ships, the field degrades to the existing text input.
- The `template` field is now hidden for `type == 'list'` (`visibleOn: "data.type != 'list'"`). A list/interface page renders via InterfaceListPage and ignores the region template, so showing the field only added noise — same rationale as the already-hidden Data Context / Layout sections.
