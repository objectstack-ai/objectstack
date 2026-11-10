---
'@objectstack/spec': minor
'@objectstack/plugin-auth': minor
---

`GET /api/v1/auth/config` can now say whether this host creates Developer Edition organizations, in a new optional `features.developerEditionCreate` flag. It is derived from the host's organization-create choices (`AuthManagerOptions.organizationEditions`, served as `features.organizationEditions`): `true` exactly when they hold a choice whose `edition` is `developer`, which a host declares only where its own organization-create door accepts `?edition=developer`. With no such choice, it is served as `false`, so no developer choice is offered.

The flag only advertises: nothing in `@objectstack/plugin-auth` reads it to change behaviour, and no door here takes an edition. A host that sets it without serving that door offers a choice its server ignores.

Like every public auth flag, it is classified in `PUBLIC_AUTH_FEATURES` (login surface, opt-in), so an action, a param or a field group may now also name it: `requiresFeature: 'developerEditionCreate'` is a new accepted value, lowered to `features.developerEditionCreate == true`.

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: none — the skills name the PUBLIC_AUTH_FEATURES registry, never its members
