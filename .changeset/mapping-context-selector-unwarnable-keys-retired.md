---
'@objectstack/spec': major
'@objectstack/platform-objects': patch
---

feat(spec)!: retire the five keys the advisory lint could never have warned about — mapping `extractQuery`/`errorPolicy`/`batchSize`, contextSelector `includeAll`/`placement` (#4509)

Five authorable keys parsed, stored, and controlled nothing. What groups them is
not the type they sit on but **why they had to go out in a major rather than
after a deprecation cycle**: four of the five carry schema DEFAULTS, and a
default materialises at parse time — so the liveness advisory lint cannot tell a
value the author wrote from one the schema supplied. Marking them would have
warned on every mapping and every selector in existence, which is why the ledger
recorded them as `_authorWarnSkipped` instead. For a key in that state, removal
is not the escalation after a warning. It is the only channel that ever reaches
the author.

**The retirement kit:**

| FROM | TO | Fix |
|---|---|---|
| `mapping.extractQuery` | *(removed)* | Delete the key. Exports run through the ordinary query API (`POST /api/v1/data/:object/query`) — no exporter has ever read a mapping artifact. |
| `mapping.errorPolicy` | *(removed)* | Delete the key. Error handling on the import path belongs to the import REQUEST's own options, not the stored mapping. |
| `mapping.batchSize` | *(removed)* | Delete the key. The write path sizes its own batches. **Do not relocate the value** — see below. |
| `app.contextSelectors[].includeAll` | *(removed)* | Delete the key. Selectors are mandatory-scope; widen `optionsSource.filter` to widen the choices. |
| `app.contextSelectors[].placement` | *(removed)* | Delete the key. Selectors always render in the sidebar header; `'topbar'` placed nothing. |

Run `os migrate meta --from 16` to rewrite existing sources automatically.

**`includeAll` is the one worth reading twice.** It was not unread — it was
deliberately *disobeyed*, and for a security reason. A context selector is a
mandatory scope, so an "All" row would clear the scope on a surface that exists
to be scoped; on Studio's package selector that means listing the platform's own
system/cloud kernel packages to a developer who scoped to their own package. The
renderer never offered an All row regardless of the flag, so `includeAll: false`
hardened nothing and `includeAll: true` unlocked nothing. `STUDIO_APP` shipped
authoring `includeAll: true` against a renderer that ignored it — that authoring
site goes with the key in this change.

**`batchSize` deliberately offers no rename.** `bulkActionDef.batchSize`,
`connector.batchSize`, `sync.batchSize`, `offline.batchSize`, the seed loader's
and the NoSQL driver cursor's are all LIVE and enforced — but each is a
different key on a different type sizing its own path, and none of them sizes a
mapping import. The rejection says so explicitly, because "removed" plus a
familiar name one line away is exactly how a dead setting gets laundered into a
live-looking one. Same trap `datasource.retryPolicy` had to defuse against
`hook`/`job` `retryPolicy` (which spell the delay `backoffMs`) one issue
earlier.

Both schemas are `.strict()`, so the keys are deleted from the shape and
rejected with a `guidance` prescription rather than tombstoned; their liveness
rows are deleted rather than kept. The retired ALIAS spellings (`query`,
`onError`, `errorHandling`, `errorMode`, `batch`, `chunkSize`, `skipErrors`,
`showall`, `location`) route to the same prescriptions instead of suggesting a
rename onto a key that is also gone.

Registered as the ADR-0087 D2 conversion `mapping-inert-keys-removed` and an
extension of `app-dead-authoring-keys-removed`, both wired into the protocol-17
D3 chain step. The mapping conversion is scoped to the `mappings` collection
deliberately — a stack-wide strip would delete an enforced `batchSize` from
connector, sync, bulk-action and offline shapes.

`datasource` reached zero dead keys in #4583; `mapping` reaches zero here.
