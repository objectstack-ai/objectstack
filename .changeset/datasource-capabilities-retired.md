---
"@objectstack/spec": major
"@objectstack/example-crm": patch
---

feat(spec)!: retire `datasource.capabilities` — eleven flags nothing read, one of them a safety claim (#4583)

`DatasourceCapabilities` declared eleven booleans — `transactions`, seven `query*`
flags, `joins`, `fullTextSearch`, `readOnly`, `dynamicSchema` — all strict-guarded,
all read by nothing. Pushdown is decided by the runtime driver's own `supports.*`
object, a different mechanism entirely, so a datasource declaring
`queryAggregations: false` never once changed which engine path ran. The block is
removed rather than bridged: there was nothing on the other side to connect it to.

**`readOnly` is why this is not tidy-up.** It reads as a safety property and was
authored as one — the shipped CRM example labelled a datasource "CRM Analytics Read
Replica" on the strength of it, while the datasource accepted writes exactly like the
primary. The key had already been MOVED twice toward somewhere it might be enforced,
out of `config` in #4410 and into `capabilities` in #4465, and was inert at every
address. This removes it instead of moving it a third time.

**Removing it does not hand you a working replacement, and the rejection says so.**
The one enforced datasource-wide write gate is `external.allowWrites: false`, and it
applies only to a FEDERATED datasource — `assertWriteAllowed` returns early for a
`managed` (or unset-`schemaMode`) datasource, so that key would be equally inert for a
local database. **A managed datasource has no read-only gate at all**; that gap is
#4584, deliberately not invented here. Until it is answered, enforce read-only where
it is real: grant the connection SELECT-only at the database.

FROM → TO:

```ts
// before — parsed cleanly, changed nothing
defineDatasource({
  name: 'analytics', driver: 'sqlite', config: { filename: ':memory:' },
  capabilities: { readOnly: true, queryAggregations: true },
})

// after — delete the block; for a FEDERATED datasource the enforced gate is:
defineDatasource({
  name: 'warehouse', driver: 'postgres', config: { … },
  schemaMode: 'external',
  external: { allowWrites: false },
})
```

`os migrate meta --from 16` rewrites it automatically (ADR-0087 conversion
`datasource-capabilities-removed`). Both `DatasourceSchema` and
`DriverDefinitionSchema` are `.strict()`, so a leftover key is a loud rejection
carrying the prescription — never a silent strip.

Also fixed: `READ_ONLY_BELONGS_ON_DATASOURCE`, the prescription every SQL driver
shares for a `readOnly` written inside `config`, was still sending authors *to* the
removed key. It now names the enforced gate and states plainly where that gate does
not apply — a prescription that lands on an inert key manufactures exactly the belief
it was meant to correct.

The `datasource` liveness ledger drops from 20 dead properties to 9 (remaining:
`healthCheck` ×3, `retryPolicy` ×4, `external` ×2 — batches B/C/D of #4583).
