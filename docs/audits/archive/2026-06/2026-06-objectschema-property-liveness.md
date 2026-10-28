# Audit: ObjectSchema (top-level) property liveness & necessity

**Date**: 2026-06-15 · **Scope**: top-level `ObjectSchema` props in `packages/spec/src/data/object.zod.ts` (per-field props audited separately). **Method**: consumer cross-reference (runtime: objectql/driver-sql/rest/security/sharing; renderers: objectui app-shell/plugin-form/grid/list/detail). LIVE = a non-spec/non-test consumer reads it.

## Headline
Object schema carries **roughly as many dead props as live ones**. Unlike the field layer there's **no camelCase naming drift**, but a large tier of **aspirational "enterprise data-management" config** has zero runtime.

## DEAD — the entire `enable` / `ObjectCapabilities` block
`trackHistory`, `searchable`, `apiEnabled`, `apiMethods`, `files`, `feeds`, `activities`, `trash`, `mru`, `clone` — **all 10 flags have zero behavior-changing readers** in either repo. Most serious: **`apiEnabled` / `apiMethods` are NOT enforced by REST** — an object cannot be hidden from the API via these flags (false sense of security). `database-loader.trackHistory` is a separate ctor option, not `enable.trackHistory`.

## DEAD — aspirational enterprise blocks (no runtime)
`versioning`, `partitioning`, `cdc`, `softDelete`, `search` (`SearchConfigSchema`), `recordTypes`, `defaultDetailForm`, `keyPrefix`, `tags`, `abstract`, `isSystem` (object-level), `active` (object-level). Several carry elaborate docstrings describing behavior that is unimplemented (`defaultDetailForm` fallback chain, `recordTypes`).

## DEAD — duplication traps
- `recordName` (object-level autonumber: type/displayFormat/startNumber) — superseded by a **field** of `type:'autonumber'` + `autonumberFormat` (`objectql/.../engine.ts:757,767`).
- `softDelete` ↔ `enable.trash` — duplicated, both dead.
- `search` block ↔ `enable.searchable` — duplicated, both dead.
- `tenancy`: only `tenancy.enabled` is read (`driver-sql/sql-driver.ts:1081`, `plugin-security:790`); `strategy`/`tenantField`/`crossTenantAccess` are inert.

## LIVE & necessary (the load-bearing core)
| property | layer | evidence |
|---|---|---|
| `name` | both | `driver-sql/sql-driver.ts` (table), `objectql/registry.ts` keys |
| `fields` | both | engine/DDL + `plugin-form/SplitForm.tsx:162` |
| `datasource` | fw | `objectql/engine.ts:1147,1368` (driver routing) |
| `external` | fw | `runtime/external-validation-plugin.ts`, `engine.ts` (remote table + write gate) |
| `indexes` | fw | `driver-sql/sql-driver.ts:1181` (DDL) |
| `validations` | fw | `objectql/validation/rule-validator.ts:154,256,581` (incl. state_machine) |
| `actions` | fw | `runtime/app-plugin.ts:929` (served on /meta/objects/:name) |
| `protection` | fw | `objectql/registry.ts:562` → `_lock` envelope |
| `managedBy` | both | `registry.ts:208` (default perms); ui `crudAffordances.ts:60` |
| `userActions` | ui | `plugin-grid/ObjectGrid.tsx:1307` (per-object CRUD) |
| `sharingModel` / `publicSharing` | fw | `plugin-sharing/sharing-service.ts:54`, `share-link-service.ts:56` |
| `systemFields` | fw | `registry.ts` (organization_id auto-inject gate) |
| `label`/`pluralLabel`/`icon`/`displayNameField`/`titleFormat`/`compactLayout`/`fieldGroups`/`listViews`/`detail.renderViaSchema` | ui | `plugin-grid/ObjectGrid.tsx:830,1101`; `app-shell/RecordDetailView.tsx:193,1423`; `metadataConverters.ts:79` |

## Recommendation (for ADR)
1. **Decide the fate of `enable`/ObjectCapabilities** — either enforce (esp. `apiEnabled`/`apiMethods` in REST, a real security expectation) or remove. Shipping a non-enforcing `apiEnabled` is a latent security bug.
2. **Prune the aspirational tier** (`versioning`/`partitioning`/`cdc`/`softDelete`/`search`/`recordTypes`/`defaultDetailForm`) or mark `experimental`.
3. **De-duplicate**: drop object-level `recordName` (use field autonumber); collapse `tenancy` to the one live flag or wire the rest.
