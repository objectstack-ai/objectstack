---
'@objectstack/metadata-protocol': minor
---

Every seed row of an object that carries an organization is stamped with the install's organization, platform-namespace seeds included, or the seed loader refuses the row

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A validity change in the seed loader's write path: no key of the seed schema or of any other metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. A seed dataset that loaded before keeps its authored shape; what changes is the organization its rows carry, that a row with no derivable owner is refused instead of written NULL, and that a row of an object with no organization column is no longer stamped. The package publishes (not unpublished); no ADR-0087 id covers this rule and this diff adds none (not registered / already-registered). -->

**BREAKING** accept-set narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0131 D3, D9).

- **The exemption is withdrawn.** When a seed load names no organization (`config.organizationId`), the loader stamps the install's sole organization on every row of an object that carries an `organization_id` column. Seeds of `sys_`, `cloud_` and `ai_` objects used to be exempt as "intentionally global" and landed NULL. There are no platform-global seeds left, so they now carry the organization too: a seeded `sys_business_unit` is the organization's own business unit.
- **No owner, no row.** When the load names no organization and the install holds none, or holds several, a row of an object that carries an `organization_id` column is refused, counted in the result's errors and named in the message. Nothing of it is written. Before this change those rows were written NULL. A row that sets its own `organization_id` still loads.
- **No column, no stamp.** A row of an object with no organization column (`tenancy: { enabled: false }`, or a platform object whose injected column was dropped) is written without one, whether the organization was named by the load or derived. Before this change such a row was stamped anyway, and the engine refused it as an unknown field, so the row was lost.
- **Unchanged.** A load that names its organization (the per-organization replay under a walled posture) stamps it on every row that carries the column, as before. A composition that registers no organization object at all keeps loading its seeds unstamped. Rows written before this change keep their bytes; attributing that residue is ADR-0131 C7's.

**The remedy.** Under the `single` posture the Default Organization exists before seeds load, so a boot seed always has its owner. A load that is refused names the organization it needs: pass it as `config.organizationId` (the organization the seed populates on a walled deployment), or set `organization_id` on the record.
