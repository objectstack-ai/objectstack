---
'@object-ui/auth': patch
---

feat(auth): `createOrganization` can ask for a Developer Edition organization, and `AuthPublicConfig.features` declares `developerEditionCreate`

Clause-②: yes (widening)
Metadata-protocol: none

`createOrganization` takes an optional `edition?: 'developer'` and sends it as the `edition` query parameter of `POST /organization/create`, beside `timezone`. The body stays `{ name, slug, logo }`. With no edition, no parameter is sent and the request is unchanged. `AuthPublicConfig.features` declares the optional `developerEditionCreate` boolean that `@objectstack/spec`'s `AuthFeaturesConfigSchema` serves: `true` only where the host's create door accepts `?edition=developer`. No console surface offers the choice yet.
