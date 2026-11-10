---
'@objectstack/spec': minor
'@objectstack/plugin-auth': minor
---

`GET /api/v1/auth/config` can now serve the editions a host's organization-create door accepts, as `features.organizationEditions`: a list of choices, each with the door's `edition` query value (snake_case, e.g. `developer`), a `label` and a `hint` the host already resolved in the request language, and an optional `memberLimit` when the edition caps its members (`OrganizationEditionChoiceSchema` in `@objectstack/spec/api`). A create-organization form draws each one as a choice that starts unchecked and sends its `edition` value when picked, with no product words of its own: the words are the host's.

A host declares them with the new `AuthManagerOptions.organizationEditions` option, a function `({ acceptLanguage }) => choices` that `getPublicConfig()` calls with the request's `accept-language` header. `getPublicConfig(request?)` now takes the request for that purpose, and plugin-auth's `/config` route passes it. Unset, or answering an empty list, no `organizationEditions` key is served. Each `edition` value may appear only once in the list. A host answer the public contract rejects (a blank translated hint, an `edition` used twice), an option that throws, or one that answers a promise (the option is synchronous), is never published and never fails the rest of the public config: no choices are served, `developerEditionCreate` is `false`, and the failure is logged once at `error`, naming the option and the first issue. A throw is named by its error class, with its message in the log detail, and one process logs at most 32 distinct failures.

`features.developerEditionCreate` is now derived from that list: `true` exactly when it holds a `developer` choice. The `AuthManagerOptions.developerEditionCreate` option it was set from until now never shipped in a release and is gone; declare a `developer` entry in `organizationEditions` instead. The flag is classified on the new `shell` surface of `PublicAuthFeatureSurface` (a console form outside the login pages reads it straight off `/auth/config`), not `login`.

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: none — the skills name the PUBLIC_AUTH_FEATURES registry and the auth config contract, never these members; nothing a metadata author writes changed
