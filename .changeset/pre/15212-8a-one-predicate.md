---
'@objectstack/objectql': minor
'@objectstack/core': minor
'@objectstack/spec': minor
'@objectstack/plugin-security': patch
---

feat(objectql,core): the driver's tenant read scope is the organization wall's verdict — one predicate for Layer 0 and every driver (ADR-0131 D8)

Clause-②: yes (widening)

- **What changed.** The engine no longer derives `DriverOptions.tenantId` / `tenantIds` beside the organization wall. `buildDriverOptions` projects the wall's own verdict onto them: the verdict plugin-security records on the operation (`OperationContext.tenantLayer0Verdict`) where its wall ran, and otherwise the same function over the engine's own facts (the posture in force, the context's organization and membership set). The function, `computeTenantLayer0Verdict` with its input type `TenantLayer0Input`, moves to `@objectstack/core` (new export); `@objectstack/plugin-security`'s `tenant-layer.ts` re-exports it and its Layer 0 is byte-identical.
- **FROM → TO, per posture, for a read, count, aggregate, update or delete on an object with an organization column:**

  | posture / caller | driver scope before | driver scope now |
  |:--|:--|:--|
  | `single`, any caller naming an organization | that organization (plus organization-less rows) | **none** |
  | `isolated`, member | the active organization | unchanged |
  | `group`, member | the membership set | unchanged |
  | walled, exempt `PLATFORM_ADMIN` on a posture-permitting object, or the verified platform owner's read | the active organization | **none** — what Layer 0 already admitted |
  | walled, system context naming an organization | that organization | unchanged |

- **Not changed.** Inserts and upserts keep the active organization as `tenantId` in every posture: the row is stamped with it, its counter scopes by it, and an upsert that would merge into another organization's row is still refused. Both `orWhereNull` compatibility arms in `SqlDriver.applyTenantScope` stay (their retirement is a later stage of ADR-0131 D13).
- **Who notices.** A `single` deployment that holds more than one organization was kept apart by the driver only by accident; postures now differ only in enforcement (ADR-0131 D11), and `single` enforces no wall. To keep organizations apart, run the `isolated` or `group` posture. Code that relied on a context organization to narrow a read on `single` names the organization in its own `where`.
- **Migration.** ADR-0087 semantic entry `driver-read-scope-follows-tenant-wall`. A deployment's `platformGlobalObjects` carve-out already reaches the driver through the column plan (ADR-0131 D7): a declared object carries no organization column, so neither wall has anything to scope.
