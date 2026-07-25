---
"@objectstack/spec": minor
"@objectstack/runtime": minor
"@objectstack/rest": minor
"@objectstack/plugin-hono-server": minor
"@objectstack/objectql": patch
"@objectstack/platform-objects": patch
---

feat: single-source API-method derivation — the server is the only adjudicator (#3391)

An object's effective API surface is now resolved from **six primitives**
(`get/list/create/update/delete/bulk`) by ONE derivation table in
`@objectstack/spec/data` (`resolveEffectiveApiMethods` / `isApiOperationAllowed`
/ `effectiveOperationsArray` / `API_METHOD_DERIVATION`). Every gate consumes it:
the REST data surface, the runtime HTTP/MCP dispatcher, and the
`/me/permissions` annotation. The `apiMethods` whitelist is three-state —
`undefined` = unrestricted, `[]` = deny-all, a subset = the derived closure — and
the legacy 8 verbs (`upsert/aggregate/history/search/restore/purge/import/
export`) are DERIVED from the primitives, never declared standalone (a standalone
declaration is honored one release with a registration-time deprecation warning).

**Derivation:** `import` ⊆ create∨update (writeMode-precise: insert→create,
update→update, upsert→create∧update); `export` ⊆ list (reserved user-export slot,
always on this phase); `aggregate`/`search` ⊆ list (search also needs
`searchable`); `history` ⊆ get ∧ `trackHistory`; `upsert` ⊆ create∧update;
bulk sub-ops ⊆ bulk ∧ derived(child). `restore`/`purge` do not derive (the
`enable.trash` flag was retired, #2377).

**New response-side contract:** `EffectiveObjectPermissionSchema` extends
`ObjectPermissionSchema` with an optional `apiOperations` array;
`GetEffectivePermissionsResponse.objects` uses it, and `/me/permissions` now
hands down the per-object effective operation set. The authoring
`ObjectPermissionSchema` is deliberately NOT extended — the frontend consumes
the effective set the server resolves, never the raw whitelist.

**Behavior changes (tightening — a `declared ≠ enforced` gap closed):**

1. `apiMethods: []` + `apiEnabled: true` now denies every operation (405),
   matching the documented three-state contract instead of the prior fail-open
   "no restriction". In-repo impact is zero (every `[]` object also sets
   `apiEnabled: false`, so 404 precedes 405).
2. The runtime dispatcher / MCP whitelist is now live. It previously read the
   flat shape while `getObject()` returns the flags nested under `.enable`, so
   the gate never fired — a silent dead gate now enforced (nested-first,
   flat-compatible).
3. `import`/`export` reverse-derive: an object with a plain CRUD whitelist (no
   explicit `import`/`export`) now admits import (⊆ create∨update) and export
   (⊆ list). Row-level FLS is shared with list; the export column header is now
   projected to the FLS-readable set so it can never expose a wider column set
   than list (previously a masked column leaked its name as an empty column).
4. The bulk surfaces (`createMany`/`updateMany`/`deleteMany`, per-object
   `/batch`, cross-object `/batch`) now require the `bulk` primitive AND the
   child write (`bulk ∧ child`). The four in-repo explicit-whitelist objects
   (`sys_user`, `sys_user_preference`, `sys_business_unit`,
   `sys_business_unit_member`) gained `bulk`; a third-party object with an
   explicit write whitelist that omits `bulk` will now 405 on the Many/batch
   routes.
5. The 405 body's `allowed` array is now the derived EFFECTIVE operation set
   (enum-ordered), not the raw whitelist.
