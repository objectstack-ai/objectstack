---
"@objectstack/metadata-protocol": patch
---

fix(seed-loader): the per-org tenant stamp is an id, not a natural key — stop
re-resolving it and dropping it

In a multi-org deployment the SeedLoader's per-organization replay landed
**every row org-less**, so a freshly created organization booted with a CRM
whose tables held data nobody could see: the tenant wall (`organization_id =
<active org>`) hides a NULL-org row from all members, including the org's own
owner.

The stamp and the reference pass disagreed about what `organization_id` holds.
The loader writes `config.organizationId` — the replay target's **id** — into
the record; the reference pass then sees a field declared as a lookup →
`sys_organization` and resolves its value as a **natural key**, probing
`sys_organization.name`. That misses, and a missed reference is dropped rather
than kept, taking the tenant attribution with it. The `id` fallback probe cannot
rescue it either: under replay every probe is AND-scoped with `organization_id =
<target org>`, and `sys_organization` — being the tenant table itself — carries
no such column, so that probe matches nothing by construction.

What hid it for so long is the **id shape**. `looksLikeInternalId` recognises
UUID and Mongo ObjectId and short-circuits resolution for both, so any fixture
that minted UUID organization ids passed. Every organization better-auth
actually creates is `org_<base36>` — including the default organization
`ensureDefaultOrganization` bootstraps on first boot — and that shape is not
recognised. The defect therefore fired on real deployments and on nothing else.

The loader now remembers that it wrote the stamp itself and skips resolution for
that one field. A seed that authors `organization_id` explicitly still goes
through resolution, so naming an organization by its natural key keeps working.

Reported by `apps/ee-tenant-crm-showcase` in the cloud repo, which reproduces
the whole path end-to-end: two organizations over one database, each replaying
the artifact's seed datasets into its own private copy.
