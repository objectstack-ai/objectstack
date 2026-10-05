---
'@objectstack/plugin-auth': patch
---

Membership under the `auto` policy is settled when the user is created, per ADR-0093 D7.

Clause-②: no

- **At creation.** A user created under `auto` is bound to the default organization at creation, and the first session of that creating request carries it. Membership is not decided again when the user signs in later.
- **One-time backfill.** The ADR-0093 D6 backfill of pre-existing users runs once per deployment. Its verdict is recorded in the `sys_migration` ledger with id `adr-0093-membership-backfill`. A pass that finds no default organization records nothing, and the backfill runs again once the default organization is created. If the ledger is missing or cannot be read, the pass does not run and logs a warning. If the record cannot be written, that is logged as an error. `OS_SKIP_MEMBERSHIP_BACKFILL=1` still disables the pass.
- **Unchanged.** `invite-only` binds nobody. Multi-organization deployments get no automatic binding. Users created through sign-up, admin create-user, import or SSO are bound under `auto` as before.
- **Narrowed.** Once the backfill is recorded, a `sys_user` row inserted straight through the data engine is not bound by a later `app:seeded` pass, because it never passes through user creation. The shipped examples create users through sign-up, so they are unaffected.
