---
'@object-ui/auth': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(auth,app-shell,i18n): the create-workspace dialog offers a Developer Edition choice where the host serves `features.developerEditionCreate`

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/auth`:** `createOrganization` takes an optional `edition?: 'developer'` and sends it as the `edition` query parameter of `POST /organization/create`, beside `timezone`. The body stays `{ name, slug, logo }`. With no edition, no parameter is sent and the request is unchanged. `AuthPublicConfig.features` declares the optional `developerEditionCreate` boolean that `@objectstack/spec`'s `AuthFeaturesConfigSchema` serves.
- **`@object-ui/app-shell`:** `CreateWorkspaceDialog` draws one unchecked "Developer Edition" checkbox, with the hint "Free, non-production, up to 5 members", only when `/auth/config` serves `features.developerEditionCreate: true`. Checked, every create attempt (slug-collision retries included) carries `edition: 'developer'`. A refusal shows in the dialog's existing error line and is never retried without the edition. Without the flag the dialog draws no choice and creates exactly as before.
- **`@object-ui/i18n`:** new keys `workspace.developerEdition` and the count family `workspace.developerEditionHint`, in every pack. The member cap is interpolated as `count`, not spelled out in the packs.
