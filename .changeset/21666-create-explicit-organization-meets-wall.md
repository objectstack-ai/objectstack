---
"@objectstack/organizations": minor
---

fix(organizations)!: a create that names an `organization_id` meets the Layer 0 write wall, as the update does — the insert stamp no longer rewrites it (#21666)

Clause-②: no (narrowing)

**BREAKING.** On a walled posture (`isolated` / `group`), the insert stamp (Middleware A) overwrote a supplied `organization_id` with the caller's active organization in every user context. A create naming another tenant's organization answered `201` and stored the row in the caller's own organization, while the PATCH naming the same organization and the array insert (`createMany`) were refused `403 PERMISSION_DENIED`. One operation answered two ways, and the caller of the `201` had no signal that its input had been replaced.

The stamp now fills only an absent or empty `organization_id`, for every non-system context (ADR-0105 D5). A supplied value is left as sent and meets the Layer 0 write wall in `@objectstack/plugin-security` (ADR-0095 D1), which answers the create exactly as it answers the update:

- **Another tenant's organization** → `403 PERMISSION_DENIED`, nothing stored (was `201`, stored in the active organization). This holds for a member and for a platform administrator on a tenant object. A member's forged `organization_id` stays refused; the wall refuses it now, where the stamp used to rewrite it.
- **No organization** → stamped with the active organization, as before.
- **The caller's own active organization** → admitted, as before.
- **Under `group`, a sister organization the caller holds** → admitted and stored in that organization, the same place the PATCH already moves a row to (was `201`, stored in the active organization). Where `organization_id` is the platform-injected column, the engine still strips it from a non-system payload as `readonly` and reports it in `droppedFields`, on the create as on the update.
- **A platform administrator on a posture-permitting object** (`private`, platform-global, better-auth-managed) is exempt from the wall on the create as on the update.

Every door that writes one row at a time under the caller's context gives the same answer: `POST /data/:object`, the `create` operation of `POST /batch`, the clone route and the import runner's per-row fallback. Two of these change in ways worth knowing:

- An import row naming another tenant's organization is now reported as a failed row (`PERMISSION_DENIED`). Before, it was created in the active organization.
- The clone route copies an `organization_id` that the object declares itself. So under `group`, a clone of a sister-organization row now lands beside its source instead of in the active organization.

System contexts are unchanged. The per-organization seed replay, the orphan claim, migrations and every other `isSystem` writer meet neither the stamp nor the wall. The `single` posture is unchanged too, because `objectstack serve` mounts this package only under a walled posture.

**What to do.** On create, either omit `organization_id` or name your active organization. If a platform operator needs a row in another organization, write it with a system-context write.

<!-- adr-0087: not-required (no-migration-prescription) a runtime write verdict: the insert stamp no longer rewrites a supplied organization_id, so the Layer 0 write wall judges it as it already judged the update and the array insert. No authorable key, spelling, export or stored shape moves, no stored row is read or rewritten, and which organization a caller meant to name is not something a ledger entry can rewrite. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this behaviour (not already-registered); and the change is a middleware verdict, not a TypeScript declaration (not runtime-interface-only or type-surface-only). -->
