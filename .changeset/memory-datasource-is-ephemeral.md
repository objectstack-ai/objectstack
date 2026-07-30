---
'@objectstack/service-datasource': patch
'@objectstack/spec': patch
---

A datasource declared with `driver: 'memory'` is now ephemeral, and its `config` reaches the driver (#4083).

The memory branch of `createDefaultDatasourceDriverFactory` was the one kind that dropped `spec.config` and constructed a bare `new InMemoryDriver()`. The driver's own default is `persistence: 'auto'`, which under Node means file persistence at a CWD-relative `.objectstack/data/memory-driver.json` — so a declared memory datasource silently became a file-backed store that reloaded its rows on the next boot, nothing disclosed it, and two memory datasources in one process wrote through the same default path.

It also contradicted the platform's own contract: `objectstack dev` treats an explicit memory driver as the user opting *out* of persistence and persists through a sqlite file instead.

How it surfaced: the ADR-0062 auto-connect acceptance test seeds two rows and asserts a federated read returns them. On a virgin checkout it passed — so CI, always fresh, stayed green — and on every later local run it failed, the rows accumulating two at a time.

FROM → TO: if you relied on a declared memory datasource keeping its data across restarts, say so explicitly — `{ driver: 'memory', config: { persistence: 'file' } }` (or any shape `MemoryConfigSchema.persistence` accepts, including a custom adapter). Constructing `new InMemoryDriver()` yourself is unchanged: that path still defaults to `'auto'`.
