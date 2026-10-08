---
'@objectstack/verify': minor
---

`bootStack` boots the production `single` shape: the Default Organization exists from the boot, every sign-up is its member, and the harness admin is its owner

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A change in what the verification harness boots, following the runtime it verifies: no key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. `BootOptions.orgContext` keeps its name and type; what it asserts is described below. The package publishes (not unpublished); no ADR-0087 id covers this rule and this diff adds none (not registered / already-registered). -->

**BREAKING** for fixtures that relied on an organization-less `single` boot, shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0131 D3, D11).

- **What `bootStack` boots now.** Under `single`, `@objectstack/plugin-auth` creates the Default Organization before the seeds load, so every boot has one, and `bootStack` no longer turns off the platform admin's owner bind. The harness admin is the Default Organization's `owner`, every user a fixture signs up is its `member`, and their sessions carry it as the active organization. This is the shape `objectstack dev` and `objectstack serve` boot. Before, `bootStack` pinned `autoDefaultOrganization: false` and booted a `single` stack with no organization at all, a shape no deployment runs after this release.
- **`orgContext` asserts, it no longer switches.** `orgContext: true` keeps its refusal: the boot fails when the harness admin holds no membership, and it still refuses to compose with `multiTenant`. The bind itself happens on every boot.
- **Unchanged.** `multiTenant` boots a walled posture as before, and the open default-organization bootstrap still abstains under it.

**The remedy.** A fixture that needs a principal outside the organization's `org_member` domain removes that user's membership (an administrator's act a real deployment performs) instead of booting without an organization. A fixture that minted its own `slug: 'default'` organization reads the one the boot created. A fixture that ran on `databaseDriver: 'memory'` and signs a user in meets the memory driver's tenant-scope refusal (`503`) until ADR-0131 C8; run that leg on the SQL in-memory driver.
