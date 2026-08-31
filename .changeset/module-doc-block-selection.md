---
'@objectstack/spec': patch
---

Reference pages and skill indexes no longer open with one schema's comment: a
doc block sitting inside a module's import list is selected as the module
description only when it carries an explicit `@module` marker. The two genuine
headers in that position (`shared/mapping`, `system/cache`) now carry the
marker; the eight modules whose "description" was a detached symbol comment
(`ai/agent`, `data/datasource`, `data/hook`, `security/permission`,
`ui/action`, `ui/app`, `ui/component`, `ui/page`) had the comment moved back to
the declaration it documents — restoring editor hover for
`AIModelConfigSchema`, `DriverType`, `ActionParamSchema` and
`PageRegionSchema` — and their pages honestly print no module description
instead of a wrong one. No schema behavior changes.
