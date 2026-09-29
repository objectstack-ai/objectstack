---
"@objectstack/spec": patch
---

Liveness ledger: `flow.description`, `hook.label` and `hook.description` are now `live`, not `dead`. Studio already shows all three to a human. Ledger data, one README cell per type and one gate test fixture only. ⛔ No schema, parse, `.describe()` or accept-set change.

The ledgers ship inside this package (`files[]` includes `liveness`), and `@objectstack/lint` reads them to decide which authored keys draw an advisory warning. None of the three rows sets `authorWarn`, so the set of warnings does not change.

- **What shows them.** These are display keys, so under the ledger's "Designer previews count as consumers" ruling, being shown to a human is the whole of their claimed effect. Neither `flow` nor `hook` registers its own list columns in the Studio metadata admin, so the Studio metadata list page falls back to its default columns: name, `label` and `description`. The Studio metadata quick-find indexes and shows every item's `label` and `description` too. Each row cites that reader at the `.objectui-sha` pin `dd3f7e1be`.
- **Where the values come from.** Each row names its producer: the Studio route that mounts the list page, the metadata client's `GET /api/v1/meta/:type` read, and this repo's shared list answer (`createMetaListAnswer`), which adds no projection for either type that would drop the keys. A booted read of the showcase app confirms it: `GET /api/v1/meta/flow` served 30 flows and `GET /api/v1/meta/hook` served 4 hooks, each with its authored `label` and `description` and the showcase's project-scoped package id.
- **Still kept, still not warned.** The re-grade reverses no ADR-0033 decision. All three rows stay docs-shaped annotation, deliberately kept and exempt from enforce-or-remove. Each row keeps the note it carried while `dead`, as history.
- The regenerated liveness counts are the `liveness/state-counts/flow.md` and `liveness/state-counts/hook.md` shards. `flow` has 35 live and 5 dead (was 34 and 6). `hook` has 21 live and 1 dead (was 19 and 3). The README's `flow` and `hook` Notes cells no longer list these keys as dead. The liveness gate test that borrowed `flow.description` as its sample `dead` row now uses the `flow.active` tombstone, which the gate holds at `dead`.
