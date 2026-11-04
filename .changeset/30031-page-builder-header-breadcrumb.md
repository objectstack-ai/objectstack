---
'@objectstack/skills': patch
---

docs(skills): the `page:header` title row drops the retired `breadcrumb` and names the live `placedActions: true`

Clause-②: no
Metadata-protocol: none

- `skills/objectui/guides/page-builder.md`: the `page:header` sentence named `breadcrumb` among the title row's keys. `PageHeaderProps.breadcrumb` is a `retiredKey` tombstone since @objectstack/spec 17 (ADR-0087 D2), and the props lint refuses an authored one. The row now lists `title`, `subtitle`, `actions` or `placedActions: true`; the last two are refused together.
- `skills/objectstack-ui/rules/pages.md`: the `page:header` catalogue row no longer says `placedActions: true` is "not drawn yet". The header renderer reads it since #30097 and draws every action of the object placed at `record_header` / `record_more`.
