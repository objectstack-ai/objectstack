---
'@objectstack/spec': patch
---

Reference docs: qualify a union variant's `### Nested Shape:` and `### Allowed Values:` headings by which variant they belong to.

The `### Union Options` renderer calls the property-table renderer once per variant, and both halves of the `Schema.key` qualifier those headings carry are shared by every sibling variant of one schema. Two `ViewItem` variants each declaring a shape-opening `config` therefore emitted `### Nested Shape: \`ViewItem.config\`` twice — two identical anchors on one page, on the very heading whose qualifier exists to prevent that. Measured on the published tree: 12 excess occurrences, 10 distinct headings, 4 pages, all under schemas rendering `### Union Options`.

The heading now names the variant with the accessor grammar the page already prints — `ViewItem[viewKind='list'].config`, or `[option 2]` where the union pins no distinct discriminant — reusing the same `variantSelector` that stamps the variant segment into a property accessor, so a page carries one variant notation rather than two. `### Allowed Values:` is covered in the same change (no page collides there today; the exposure is identical). Headings outside a union variant, and unions with a single heading-emitting arm, are byte-identical: regenerating the 214-page tree changes 39 heading lines and nothing else.

This changes what the docs site publishes, hence a release-visible patch rather than a skipped changeset.
