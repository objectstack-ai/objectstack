---
'@objectstack/plugin-security': patch
'@objectstack/organizations': patch
---

fix(plugin-security, organizations): the seed-ownership claims hand over only the rows the seed wrote, and a guest-written or public-form row keeps no owner (ADR-0138 D1)

The claim that hands seeded records to the platform admin runs on every `app:seeded`, so on every boot of an app with seed data. Its NULL-owner arm re-owned every unowned row of every eligible object, and no stored column tells a seed row from a guest-written row or a public form's intake. Those rows keep no owner on purpose (ADR-0138 D1: "the owner stays unset"), and the claim handed them to the platform admin at the next boot.

- **`claimSeedOwnership`** (`@objectstack/plugin-security`) re-owns a NULL-owner row only when the seed reported landing on it: `owner_id IS NULL AND id IN (seeded ids)`, in chunks of half the per-row hook ceiling, read through the `seed-settlement` contract's `seededRecordIds`. The settle pass (`app:seeded`) and the first-admin promotion (`bootstrapPlatformAdmin`, new option `seededRecordIds`) both pass the reading. A replay reports the rows an earlier boot wrote, so a seed row is still claimed on a later boot. The `usr_system` arm is unchanged: only a seed or a legacy install writes that owner.
- **`claimOrgSeedOwnership`** (`@objectstack/organizations`) takes the same selector, read for the organization the owner bind claims for: the rows that organization's seed replay landed on, which ran in the same call that created it. Each write carries at most half the per-row hook ceiling's worth of ids, so none is refused for its size and the claim no longer reads pages.
- A row a hook, a flow or an assignment rule gave an owner keeps it, as before.

**Direct callers.** Called without `seededRecordIds`, `claimSeedOwnership` re-owns only `usr_system`-owned rows and its pass report says no seed reading was published; `claimOrgSeedOwnership` re-owns nothing and says so. The deprecated `ensureDefaultOrganization` wrapper in `@objectstack/organizations` holds no kernel, so it hands over no row; use `OrganizationsPlugin`, which binds the reading.

**Outside the claim's purpose** (handing the boot seed to the first admin), and so no longer re-owned by a later boot's pass: rows written by seed writers that emit no `app:seeded` — a package install's or a publish's seed apply, the dev hot-reload seeder, and the marketplace install's seed. A dataset they share with the boot bundle is re-reported by the next boot's replay and claimed then.
