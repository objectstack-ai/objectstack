---
"@objectstack/objectql": patch
---

fix(objectql): a roll-up registered at RUNTIME must not need a restart to compute

The engine's roll-up summary index had exactly one invalidation site —
`engine.registerApp` — and the runtime publish path does not go through it: it
registers straight into the registry (`protocol.saveMetaItem` →
`registry.registerObject`). So a kernel that had already performed a single
write — publishing itself writes `sys_metadata` rows — held a summary index
built before the new object existed. Every child write of a freshly published
roll-up then found no descriptor and silently skipped the recompute, leaving the
parent field null until the process restarted.

That is how an AI-built app's "已完成任务数" shipped permanently empty over
completely correct metadata: the roll-up was configured, the child rows were
seeded with resolved foreign keys, and nothing recomputed (cloud#970).

`SchemaRegistry` now carries a monotonic `objectRevision`, bumped on every
change to the registered object set, and the engine rebuilds its index whenever
that number has moved — so a registry-derived cache can no longer go stale
through a path that forgot to call the invalidator.
