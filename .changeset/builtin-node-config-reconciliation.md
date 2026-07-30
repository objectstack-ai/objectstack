---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
---

Reconcile the remaining flat builtins' declared config against what their
executors read (#4045 — the CRUD / screen / map step, after notify / http /
connector in #4210).

**Six executor-derived Zod contracts.** `GetRecordConfigSchema`,
`CreateRecordConfigSchema`, `UpdateRecordConfigSchema`,
`DeleteRecordConfigSchema`, `ScreenConfigSchema` (+ `ScreenFieldConfigSchema`)
and `MapConfigSchema` in `automation/builtin-node-config.zod.ts`, each written
by reading the executor rather than transcribing the descriptor literal, so the
new bidirectional ledger test is evidence rather than a tautology. Contract
exports only — nothing parses with them yet (#4045 step 3b, gated on the #4059
warning data).

**Seven capabilities the executors honour are now authorable.** Each was read
by the executor and offered by no form — online or offline — so it was reachable
only by hand-written metadata:

- `get_record.fields` — the query projection, passed straight into
  `find`/`findOne`;
- `screen.recordId` — the record `mode: 'edit'` opens; the form declared the
  edit mode while offering no way to name its target;
- `screen.fields[].options` / `defaultValue` / `placeholder` — all three
  forwarded into the ScreenSpec the client renders, so a select field's choices
  could not be authored in Studio at all. Same nested repeater position as the
  `visibleWhen` gap #3528 was filed for;
- `map.indexVariable` and `map.input` — the index binding and the per-item
  subflow params.

**`map`'s undeclared `flow` alias graduates to the conversion layer.** The
executor carried `cfg.flowName ?? cfg.flow` for a spelling no schema ever
described — the `notify.source` shape (Prime Directive #12). The bare fallback
is deleted and `flow-node-map-flow-alias` (protocol 17, retires at 18) renames
it at load, including the `AutomationEngine.registerFlow` rehydration seam.

**`assignment` is pinned as deliberately un-reconcilable**, with the reason on
record: with no `assignments` wrapper its top-level config keys ARE the author's
variable names, so no fixed key set can describe it and a catchall Zod would
reconcile vacuously. What the ledger pins instead is that the form offers
exactly the canonical `assignments` map and that the map stays open.

With this, every builtin that publishes a `configSchema` is reconciled against
its executor, and the ones that publish none each have a recorded reason.
