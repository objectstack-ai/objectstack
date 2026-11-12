---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): deleting a self-registrant's first organization is no longer refused over their self-registration grant

Clause-②: no
Metadata-protocol: none

On a deployment whose audience lets people sign up themselves (`audience.posture` `open` or `email_domain`), the person's first membership lands the declared `audience.selfRegistrationPermissionSet` as a grant owned by that organization. `POST /auth/organization/delete` counted that grant as a record the organization still owned, so every self-registrant's first organization answered `409 DELETE_RESTRICTED` naming `sys_user_permission_set (1)`, while their second organization deleted normally.

The delete now treats that grant as the organization's own auth structure, as it already treats the organization-admin grants: it is left out of the count and removed together with the organization. The set is the one the audience declares when the delete runs. Every grant of any other set in the organization is still counted and still refuses the delete, so an organization whose members were given other permission sets must have those removed first, as before. A grant only ever applies while its own organization is the active one, so removing it changes nothing the person can do in any other organization they belong to. The Default Organization's delete is unchanged.
