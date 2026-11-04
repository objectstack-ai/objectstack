---
'@objectstack/skills': patch
---

docs(skills): the objectui page-builder guide stops listing the retired `breadcrumb` on the `page:header` title row

Clause-②: no
Metadata-protocol: none

- `skills/objectui/guides/page-builder.md`: the `page:header` sentence named `breadcrumb` among the title row's keys. `PageHeaderProps.breadcrumb` is a `retiredKey` tombstone since @objectstack/spec 17 (ADR-0087 D2), and the props lint refuses an authored one. The row now lists `title`, `subtitle`, `actions`. No other text changes.
