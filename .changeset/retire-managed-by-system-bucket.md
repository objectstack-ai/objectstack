---
"@objectstack/spec": minor
"@objectstack/platform-objects": minor
"@objectstack/plugin-security": minor
"@objectstack/plugin-approvals": minor
"@objectstack/plugin-hono-server": minor
"@objectstack/service-messaging": minor
---

feat(spec)!: retire the overloaded `managedBy: 'system'` bucket — the residue becomes `system-data` (#3355)

**FROM → TO: `managedBy: 'system'` → `managedBy: 'system-data'`.** One-line fix:
rename the value. Nothing else about the object changes. `os migrate meta --from 16`
rewrites it for you; stored metadata is CONVERTED by the ADR-0087 entry
`object-managed-by-system-to-system-data`, never silently reinterpreted.

ADR-0103 split the overloaded `system` bucket in v16, and it split it
**additively**: the 20 engine-owned objects moved to the new explicit
`engine-owned`, while the 8 admin/user-writable ones — the RBAC link tables
(`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`),
`sys_user_preference`, `sys_approval_delegation`, and the three messaging config
grids — stayed behind on `system`. That was the right move for a v16 that could
not break authors, but it left the enum in a state where the surviving value
names the half that had already moved out: `system` sitting on precisely the
objects a user writes.

That is not a cosmetic complaint. An author choosing between `system` and
`engine-owned` had nothing in the vocabulary to choose *on*, so the bucket was
re-overloadable by anyone reading the name in good faith — a model author most
of all, since "system table" reads as "the engine owns this" in every other
codebase. `system-data` states both boundaries explicitly: the **schema** is the
platform's (versus `platform`, which is tenant-modelled), the **data** is the
admin's or the user's (versus `engine-owned`, where the engine owns both).

Because v16 already drained the engine side, the conversion is a **one-to-one
mechanical value rename** with no judgement call — by construction every
remaining `system` declaration is writable platform data.

**One deliberate consequence — the affordance default flips.** `system` defaulted
LOCKED and each of the 8 objects re-opened its writes with a
`userActions: { create: true, edit: true, delete: true }` block. `system-data`
defaults **WRITABLE** (full CRUD), because a bucket that exists to say "the data
is yours" should not make every member ask for it back. Those blocks are now
redundant and have been deleted from the 8 platform objects; keep `userActions`
only to **NARROW**. If you converted an object that carried no `userActions`, it
gains the generic affordances — the honest reading of the bucket it moved into.

**No enforcement moves.** The engine write guard, the `DelegatedAdminGate`, RLS
and permission sets all adjudicate off resolved affordances and the principal,
never off the bucket name. `system-data` simply joins `platform` / `config` as a
bucket the fail-closed guard does not cover, because a writable default has
nothing to close on. The 8 objects passed that guard before (via `userActions`)
and pass it now (via the bucket default), for the same resolved-affordance
reason.

`'system'` is **retired from the load path**: the enum rejects it with a
prescription naming `system-data` and the one-line fix. Absorbing it silently at
load would leave every author still writing the name this rename exists to
unteach.
