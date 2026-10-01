---
"@objectstack/service-analytics": patch
---

Clause-②: no

Security: refuse an inline (caller-POSTed) dataset's own dimension or measure `field` text when it is not a column reference, at the analytics dataset door, before the dataset is compiled and before any strategy runs — for every caller (admin included) and whether or not a security service is wired. The service compiles an inline dataset into a cube whose members read as declared, so a dimension or measure whose `field` is a raw expression resolved to a declared cube member and was left to the field-level read gate, which stands down with no security service and on an object its reader answers `undefined` for; in those tiers the expression reached the native statement as written. The refusal reuses the field-read gate's existing judge and envelope (`PERMISSION_DENIED` / 403, naming the member, never the expression text); no new error code, and no new admission module. A registered dataset's own field text is author text, queried by cube name and left to the existing gates; the dataset's own filter, the selection's runtime filter and cube-query members are lowered into the compiled query and already judged on the query path (#21156), so they are unchanged. ADR-0021's author surface ("zero raw expressions") is the posture this enforces for caller-supplied dataset content.
