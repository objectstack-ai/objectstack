---
'@objectstack/lint': minor
'@objectstack/metadata-protocol': minor
---

Dashboard writes are now judged by `validateWidgetBindings` at the runtime publish gate (#7529). A dashboard widget bound to a dataset that resolves to nothing — previously a `200` on both save and publish, failing only as a runtime error on the live board — is refused at **publish** with a located 422 (`INVALID_METADATA`, the offending key path named). Drafts are unaffected: a draft may still hold a forward reference to a dataset not yet authored, and only the draft→active promotion runs the gate.

Because rule surfaces are registered per-rule, all six of the rule's error-tier findings now gate a dashboard publish as one reference-integrity class: `widget-dataset-unknown`, `widget-dimension-unknown`, `widget-measure-unknown`, `chart-field-unknown`, `widget-legacy-analytics-unrenderable`, `dashboard-filter-field-unknown`. Warning-tier findings (`table-count-only`, `chart-config-missing`, …) ride the non-blocking `advisories` channel on the save response. Config-authored stacks are unaffected — `os validate` / `os build` / `os lint` already ran this rule; the newly gated population is exactly the `sys_metadata` overlay writes (Studio / REST `/meta` / MCP) that previously bypassed it.

The per-write snapshot (`RuntimeStackContext`) now carries the live `datasets` collection so bindings resolve against the real dataset universe — without it every legitimate board would read as dangling. Existing stored rows are untouched (the gate blocks new publishes only), and `OS_ALLOW_UNLINTED_METADATA_WRITES=1` remains the migration-window escape hatch.
