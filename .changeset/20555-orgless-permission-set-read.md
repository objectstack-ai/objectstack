---
"@objectstack/plugin-security": patch
---

A permission-set resolution with no active organization now reads the organization-less permission sets only. A permission set scoped to an organization applies only while that organization is active. This is the rule `resolveUserAuthzGrants` already applies to grant rows.

Clause-②: no

Before, the by-name `sys_permission_set` read carried no organization when the caller had none active. Every organization's row of each requested name came back, and the first one won. The names requested include the principal's positions. So a permission set another organization had authored under the name of a built-in role could reach an organization-less principal's resolved sets and effective object map. The same read could also resolve another organization's same-named copy of a set the principal holds through a global grant.

- **Unchanged:** a principal with an active organization resolves exactly as before. That read was already scoped to the organization and the organization-less rows, and it still prefers the organization's own row. Global grants still apply everywhere. A global position folded onto a global permission set of the same name still resolves with no organization active, and so does a global user grant. Permission sets declared in metadata or bootstrap resolve as before, because they never reach this read.
- **If a principal relied on it:** make the organization active, or grant the permission set globally (no organization) when it is meant to apply everywhere.
