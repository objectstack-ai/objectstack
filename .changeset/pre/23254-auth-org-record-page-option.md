---
'@objectstack/plugin-auth': minor
---

feat(plugin-auth): `registerOrganizationRecordPage: false` leaves out the platform's `sys_organization` default record page, so a host that ships its own page is the only default

Clause-②: yes (widening)

A deployment holds at most one `isDefault: true` record page per object, and a second one is refused at registration with `DEFAULT_RECORD_PAGE_CONFLICT`. `AuthPlugin` always registered `sys_organization_detail` (the Members / Invitations / Teams tab strip) as the default record page of `sys_organization`, so a deployment composing `AuthPlugin` beside a host that ships its own default page for that object was refused at boot.

- **New option.** `AuthPluginOptions.registerOrganizationRecordPage` defaults to `true`. Only an explicit `false` leaves out `sys_organization_detail`, so the host's page is the only default whichever plugin starts first. Plugin order and precedence rules play no part.
- **Nothing else moves.** With `false`, `AuthPlugin` still registers the identity objects, the `sys_user_detail` record page, the System Overview dashboard, and the auth routes and services. It logs one `info` line at boot naming the option.
- **The default is unchanged.** A deployment that does not set the option registers `sys_organization_detail` as before. A host page beside it, with no option set, is still refused with `DEFAULT_RECORD_PAGE_CONFLICT`.
- **To adopt it:** construct `new AuthPlugin({ …, registerOrganizationRecordPage: false })` in the host that registers its own `isDefault: true` record page for `sys_organization`. With the option set and no default page of the host's own, the organization record view opens the synthesized default layout, without the Members / Invitations / Teams tabs.
