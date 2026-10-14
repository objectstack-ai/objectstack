---
'@objectstack/spec': patch
---

The spec source no longer ties its objectui read-point records to the console pin. A console pin bump now changes no `packages/spec/src` text unless a key's behaviour changes.

Clause-②: no

- **Pin-tied citations are gone.** Every citation that said it named the objectui commit this repository builds against (the 49 written `` `.objectui-sha` = <sha> ``) now states the commit it was read at, `b9814b334`, and no longer claims to follow the pin. Six of them are inside the `reason` text of v18 semantic migration entries (`kernel-runtime-config-timeout-unit-in-key`, `kernel-health-check-and-hot-reload-durations-unit-in-key`, `logging-durations-unit-in-key`, `system-metrics-jsdoc-durations-unit-in-key`, `system-tracing-otel-exporter-durations-unit-in-key`, `tenant-schema-cache-ttl-unit-in-key`). Only that wording changes there. The measurement each entry reports is unchanged.
- **Read points that have a liveness-ledger row moved into it.** 40 citations moved out of doc comments and test headers into the `note` of their row in `packages/spec/liveness/*.json`. That covers the view-binding completeness table, the list-view map, chart and form-span records, action `outcomeMessages` / `onSuccess` / `aria`, dashboard widgets and chart `aria`, dataset measure `format`, joined reports, field `options` / `scale` / `inlineColumns`, `enable.apiMethods`, and translation `flows`. Each moved note names the renderer by symbol, as `objectui @<sha> <file>#<symbol>`, never by line number. The long per-hop re-read chains are dropped. What each record claims is kept, either in the ledger note or in the shortened doc comment.
- **No schema, type, export, default or refusal changes.** The one `.describe()` that changed is the form-field `span` text. It now gives the renderer's behaviour without naming a commit, and `content/docs/references/ui/view.mdx` was regenerated to match.
- Component-member read points (`ComponentPropsMap`) and retirement-history citations still carry their dated objectui commits in the source. A later change handles them.
