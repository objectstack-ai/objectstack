---
'@objectstack/spec': minor
'@objectstack/metadata-core': minor
'@objectstack/platform-objects': patch
---

**BREAKING** — retire `object.tenancy.organizationField`, the stamp-only column
declaration the whole protocol declared exactly once, on a table this platform ships.

The key answered "which column says who this platform row is ABOUT", where
`tenancy.tenantField` answers "what is this object WALLED by". The spec's own docblock
stated the consequence: *"For ordinary objects the two coincide and `organizationField`
is never needed."* Measured on `main` before this change, the entire repository declared
it **once** — `packages/platform-objects/src/identity/sys-api-key.object.ts`, the
better-auth credential table — and zero business objects declared it anywhere. Its
readers were three platform-row writers, scope-pinned **by name** (audit stamping, the
approval-row writer, the automation-run recorder), so an application declaration was
inert by construction while still being authorable on every object, which made every
future piece of organization logic owe the question "what if somebody set this?".
ADR-0049 enforce-or-remove; maintainer ruling 2026-09-18, verbatim and untranslated:
「organizationField 撤出可授权面 同意你的建议」.

## FROM → TO

| you wrote (17.4 and earlier) | write instead |
| --- | --- |
| `tenancy: { enabled: false, organizationField: 'active_organization_id' }` | `tenancy: { enabled: false }` — delete the key. Nothing read it on an application object |
| `tenancy: { enabled: true, organizationField: 'about_org_id' }` on an object whose tenant column really is `about_org_id` | `tenancy: { enabled: true, tenantField: 'about_org_id' }` — the surviving key both walls the object and stamps its platform rows |
| you declared it to make one platform table's rows stamp differently | nothing to write. That divergence is a platform fact now, not a knob |

The `tenancy` block is `.strict()`, so the key is **refused** with its prescription
rather than stripped, and `os migrate meta --from 17` lists the mechanical edits for
existing sources.

## What does NOT change

The `sys_api_key` divergence is intact, and that is the point of the shape this takes.
The credential table is `managedBy: 'better-auth'`, so `resolveInjectedSystemColumns`
bails before tenancy is consulted and no `organization_id` is ever injected; the column
it really carries is better-auth's `active_organization_id`. Its audit, approval and
automation-run rows still stamp that column. What moved is only where the fact is
written: `PLATFORM_STAMP_ORGANIZATION_COLUMNS` in `@objectstack/metadata-core`, one row,
keyed by object name and read by the STAMP face alone. The WALL face
(`resolveRecordWallOrganizationField`) never read the key and is untouched, so the
stamp/wall divergence pin stands unchanged.

⛔ The column is **not** renamed to `organization_id` and must never be: in this platform
"has an `organization_id` column" IS the wall, so the rename would wall the credential
table on an equality that excludes NULL and every pre-existing key would vanish from its
own owner's key list.

## For `@objectstack/metadata-core` consumers

`resolveRecordOrganizationField` and `createRecordOrganizationResolver` keep their
signatures and their four-limb precedence. Limb 0 is now keyed by the object's
registered NAME against the platform table instead of by a declaration on the definition:
the engine-bound resolver passes the name it was asked about, and the two-argument
function reads `objectDef.name` when the definition carries one. A caller that fed it a
hand-built definition carrying `tenancy.organizationField` — only reachable by
reimplementing a platform writer — now gets limbs 1 to 4.

The retirement kit, in the shape the playbook prescribes:

- the key is DELETED from `TenancyConfigSchema` (the block is a `strictObject`), and a
  `TENANCY_RETIRED_KEY_GUIDANCE` row carries the prescription beside the two v15.0
  precedents (`tenancy.strategy`, `tenancy.crossTenantAccess`)
- D2 conversion `object-tenancy-organization-field-removed` (`toMajor: 18`,
  `retiredFromLoadPath: true`) strips the key from authored sources and stored
  `sys_metadata` rows; D3 wires it into the protocol-18 chain step, and
  `RETIRED_KEYS_BY_MAJOR[18]` declares `data/TenancyConfig:organizationField`
- the `authorable-surface/data.json` row is deleted in this same commit — the strict
  route's tripwire — with the build computing the guidance-route proof for itself
- the liveness ledger row is deleted, since the key leaves the walked shape entirely
- pin tests: the authored shape is refused with its prescription, and the `sys_api_key`
  stamp is pinned end to end beside the closed-set control (the same shape under any
  other object name takes the ordinary limbs)

Clause-②: no

<!-- adr-0087: registered object-tenancy-organization-field-removed -->
