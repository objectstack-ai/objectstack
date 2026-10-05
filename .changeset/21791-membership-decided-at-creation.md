---
'@objectstack/plugin-auth': patch
'@objectstack/organizations': patch
'@objectstack/types': patch
---

Membership under the `auto` policy is settled when the user is created, per ADR-0093 D7.

Clause-②: no

- **At creation.** A user created under `auto` is bound to the default organization at creation, and the first session of that creating request carries it. Membership is not decided again when the user signs in later.
- **One-time backfill.** The ADR-0093 D6 backfill of pre-existing users runs once per deployment, and once per process even if its record cannot be written. Its verdict is recorded in the `sys_migration` ledger with id `adr-0093-membership-backfill`. A pass on a deployment with no organization at all records nothing, and the backfill runs again once the default organization is created. If the ledger is missing or cannot be read, the pass does not run and logs a warning. If the record cannot be written, that is logged as an error. `OS_SKIP_MEMBERSHIP_BACKFILL=1` still disables the pass.
- **Default organization owner.** The platform admin is bound as owner of the default organization once, by the bootstrap that first decides it, in both the single-org and the walled organizations wiring. The decision is recorded in the same ledger with id `adr-0093-default-org-owner-bind` and held for the rest of the process even if the record cannot be written. After that, a missing default organization is recreated without binding anyone. Without a readable ledger, the owner is bound only when the bootstrap creates the default organization.
- **Full scan.** The backfill reads the user and membership tables page by page with no row cap. A scan that cannot read either table in full binds nobody and records nothing. With organizations present but no default target, as in multi-organization deployments, the refusal is recorded.
- **Upgrade.** The first boot of an upgraded deployment runs the backfill once.
- **Unchanged.** `invite-only` binds nobody. Multi-organization deployments get no automatic binding. Users created through sign-up, admin create-user, import or SSO are bound under `auto` as before.
- **Narrowed.** A `sys_user` row inserted straight through the data engine never passes through user creation. Once the backfill is recorded, a later `app:seeded` pass leaves it unbound. That includes users written by a seed that finishes after its inline budget. Code that inserts users this way must write their membership itself; the showcase approval-demo personas now do.
- **`keysetWalk` (`@objectstack/types`).** The walk now decides that a page did not advance only when it gets back the same cursor key or the same page again. It no longer compares keys in JavaScript string order, which disagrees with database collations and could report a healthy walk as truncated.
- **`createEnsureDefaultOrganizationOnce`** (new export of `@objectstack/plugin-auth`) is the gated bootstrap both wirings call. `ensureDefaultOrganization` gains the `bindOnlyOnCreate` and `bindOwner` options and the `owner_bind_decided` reason.
