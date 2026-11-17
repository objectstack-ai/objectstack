---
'@objectstack/skills': patch
---

docs(skills): the hooks skill teaches when a `before*` hook's `ctx.api` writes roll back with a refused save

Clause-②: no
Metadata-protocol: none

objectstack-data's `references/data-hooks.md`, "Before vs After Hooks" table: the `before*` Transaction cell no longer says only "Within transaction". It now says the hook runs in one transaction with the outer write, so a refusal anywhere in that write (a validation, a later hook, a driver constraint) rolls back the hook's `ctx.api` writes too, with no per-hook opt-out. It names the four exits: a transaction the caller opened decides; an object off the default datasource, or a default driver with no transactions (turso's remote transport), opens none, so those writes stay stored after a refusal; a hook registered in code with `registerHook` opens none. It also says MongoDB needs a replica set, which was read in the driver's code and not measured. Best Practices gains one DON'T: a `before*` hook does not write business records to another datasource through `ctx.api`. Its transaction refuses that write with `CrossDatasourceTransactionWriteError`, and only an append-only ledger (`lifecycle.class` `audit` / `telemetry` / `event`) is written outside it. `evals/hooks-security-seeds-datasources.json` gains two cases, one for each rule. Four restatements in data-hooks.md were removed to pay for the new text.
