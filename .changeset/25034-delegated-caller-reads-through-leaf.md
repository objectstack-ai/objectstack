---
'@objectstack/plugin-audit': patch
'@objectstack/service-storage': patch
---

fix(plugin-audit,service-storage): a delegated (on-behalf-of) caller reads the parent-record gates through the ReadableIds leaf, no longer through the bounded 2000-row probe (ADR-0139 D5.1, as amended)

Clause-②: no
Metadata-protocol: none

The activity, ledger and comment-thread read gates (`@objectstack/plugin-audit`) and the attachment read gate (`@objectstack/service-storage`) routed every read by a delegated caller to the whole-read probe: a SYSTEM pre-scan of at most 2000 rows, then one caller-scoped read per parent object. Past 2000 candidate rows, a delegated caller was served a truncated list (fail-closed, never a leak) with a matching `total`.

Since the engine composes a `ReadableIds` leaf for a delegated caller from the delegator intersection (ADR-0090 D10, #25009), the gates now write such a caller the same leaves as any caller. It is served every row its delegator intersection admits, with a true `total`. This is the same set the probe's own readability answer admits, without the window. ADR-0139 D5's two remaining classes are unchanged: a parent narrowed by an object-scoped read middleware, and a parent bound to another datasource. Both still take the bounded probe, read with the caller's delegated context. The gates no longer read the delegation link themselves, and the `delegated-caller` value is gone from the gates' internal whole-read probe reasons. Neither is exported.
