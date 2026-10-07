---
'@objectstack/plugin-auth': minor
---

Under the `single` tenancy posture the Default Organization is created at boot, before the application seeds and before the server accepts a request, and the first admin of a fresh deployment is its owner

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A boot-order and accept-set narrowing in the auth plugin's runtime: no key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. The `autoDefaultOrganization` constructor option keeps its name and type; what narrows is the state it can produce, described below. The package publishes (not unpublished); no ADR-0087 id covers this rule and this diff adds none (not registered / already-registered). -->

**BREAKING** boot and accept-set narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0131 D3).

- **A boot invariant.** Under the `single` posture (the posture in force, so a degraded walled request counts), the auth plugin's `start()` finds or creates the Default Organization (`slug: 'default'`), with or without a platform admin. Every application plugin starts after it. Before this change the organization was created on `kernel:ready` only once a platform admin existed, so on a fresh deployment it arrived with the first sign-up, after the seeds had loaded with no owner.
- **A failure stops the boot.** If the organization cannot be created, or the store cannot be read, `start()` throws and the deployment does not boot. Before, the bootstrap logged a warning and the deployment served anyway. An install holding several organizations and none with `slug: 'default'` gets no new organization; the boot logs it and continues.
- **`autoDefaultOrganization: false` no longer means "no organization".** It now turns off only the platform admin's owner bind. A host that set it to keep an organization-less `single` deployment gets the Default Organization anyway: under `single` no row is organization-less.
- **The first admin is the owner.** Because the organization now exists before the first sign-up, the membership reconciler binds every new user, the first admin included, as `member` the moment they are created. While the one-time owner bind is undecided and the Default Organization has no owner, the bootstrap promotes that `member` row to `owner` in place. A decided bind, an existing owner, or a membership elsewhere is never touched.
- **Membership from the first boot.** The one-time membership backfill now has its target at the first `kernel:ready`, so users present then (a seeded directory, say) are bound as members on the first boot rather than when the first admin appears.

**The remedy.** If the boot stops on the Default Organization, make the `sys_organization` insert land: check the datasource's write permission and connectivity, and whether a legacy unique index on `slug` refuses `default`. A host relying on `autoDefaultOrganization: false` for an organization-less `single` deployment has no such deployment any more; run a walled posture if organizations are meant to be absent until created.
