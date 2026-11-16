---
'@objectstack/organizations': patch
---

fix(organizations): a new organization's seed resolves its founder

Clause-②: no
Metadata-protocol: none

On a walled (`isolated`) deployment, `POST /api/v1/auth/organization/create` replayed the app's seed into the new organization before better-auth wrote the founder's `sys_member` row. A seed loaded into an organization resolves a person only through membership in that organization, so every person reference the seed declared (`Field.user()`, `Field.lookup('sys_user')`, the injected `owner_id`) was stored empty with "not a member of organization ORG", the founder's included.

The per-organization replay now waits, for an organization a signed-in person creates (`POST /api/v1/auth/organization/create`, whose `sys_organization` insert carries that person as `attributedUserId`), until that organization's first `sys_member` row is stored, and replays then. A seed record naming the founder now stores the founder's user id. A person who is not a member of the new organization still resolves to nothing, with the same warning. The replay still runs once per organization, still seeds in the founder's language, and still finishes before a host's `onOrganizationCreated` callback runs. Organizations created any other way (the Default Organization bootstrap, a system insert, or a server-side `auth.api.createOrganization({ body: { userId } })` call made with no auth request in scope, whose insert carries no `attributedUserId`) replay on the insert, as before.
