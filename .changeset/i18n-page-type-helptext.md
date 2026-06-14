---
"@objectstack/platform-objects": patch
---

i18n(metadata-forms): correct stale page-`type` help text across locales

The page `type` field help text still described page types as "record, home, app, dashboard …" — listing `dashboard` (and implying grid/kanban/calendar) as page types, which is wrong after the ADR-0047 page-type cleanup: those are visualizations configured under Interface, not page kinds. Updated en / zh-CN / ja-JP / es-ES to "page kind — list / record / home / app / utility; visualizations live under Interface". Also fixed the stale zh-CN `kind` help text (it described "record / list / detail" instead of the record-page override mode).
