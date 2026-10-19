---
"@objectstack/plugin-sharing": patch
---

fix(plugin-sharing): a minted share link carries an organization, never a NULL one (ADR-0131 D9)

Clause-②: no

- **What changed.** `ShareLinkService.createLink` stamps `sys_share_link.organization_id`. It takes the organization of the linked record, read under the system context. When the record names none, it takes the acting context's organization (`tenantId`). When neither names one, it applies the system-write rule: under `single`, the Default Organization (the only one there is); under a wall (`group` or `isolated`), the mint is refused with `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` (status 500) and no link is written. The same refusal answers a `single` install that holds no organization or several. Before, every link was written with `organization_id` NULL.
- **A link on another organization's record.** Under `group`, a member active in one organization can mint on a visible record of another. The link carries the record's organization, not the session's.
- **What stays the same.** Under `single` nothing a user sees changes. The mint response keeps the `ShareLink` shape and carries no organization field. A composition that registers no `sys_organization` object writes links as before.
- **Who can meet the refusal.** No in-repo caller reaches it. Both share-link routes need a signed-in caller. Under a wall, an organization-less API key is refused at admission, and an organization-less session cannot see a record that has a tenant column, so its mint is refused before the stamp. The refusal is reached by a walled, organization-less caller minting on an object with no tenant column, or by a system caller that threads no `tenantId`. The fix is to pass the organization on the context (`{ isSystem: true, tenantId }`).
