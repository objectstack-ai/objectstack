---
"@objectstack/organizations": minor
---

`claimOrphanOrgRows` and `claimOrgSeedOwnership` name the ObjectQL doors they write through — a new exported `OrgScopingEngine` type replaces `ql: any` on both, and `OrgScopingQuerySlot` states the doors the plugin forwards rather than only the three it calls itself (#18211).

Runtime behaviour is unchanged: the same guards run, the same rows are updated, and an engine without a `registry` still returns `[]` with a warning instead of throwing — `registry` is optional on the new type precisely so that tested path stays describable.

- **Why a type and not a comment.** The tenant-audit census decides whether a write call site is an engine write by reading the **receiver's declared type**. An `any` receiver has no type to read, so both of these sites were reported as sites nothing could place — an error in that census, never a default, because a write it cannot see is a write the tenant-audit population does not certify. Naming the doors places both by type. The certified population moves 223 to 225 and both read as elevated (they write under `context: SYSTEM_CTX`).
- **Narrow on purpose**, following `OrphanCleanupEngine` in `@objectstack/plugin-sharing`: `OrgScopingEngine` declares `find`, `update` and an optional `registry`, and nothing else. Widen it by adding a door that is actually used, never by re-exporting the engine's full contract.
- **The slot change is a finding, not a refactor.** `OrgScopingQuerySlot` declared `registerMiddleware`, `find` and `getSchema` — but the plugin also hands that value to `claimOrphanOrgRows`, which writes through it. While the back-fill's parameter was `any` that coupling was invisible to the type system; naming the parameter turned it into a type error, and the slot now states it.
- **Type-level tightening for consumers.** A caller passing a value that does not structurally offer `find` and `update` no longer compiles. Such a caller already got `[]` and a warning at run time from the existing guards, so nothing that worked stops working — but the failure moves from run time to build time, which is why this is not a patch.
- ⛔ **No `UNTYPED_RECEIVERS` ledger row was added.** That ledger is documented shrink-only and keyed by (file, receiver); growing it by two rows to silence two sites runs against its own discipline, and a typed receiver needs no row at all.
