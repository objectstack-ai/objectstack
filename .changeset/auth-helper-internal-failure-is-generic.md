---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a helper's unclassified internal failure is answered with the generic message and logged

Clause-②: no
Metadata-protocol: none

A route's unclassified internal failure is answered with a generic message, and the error is logged server-side; a refusal the vendor classifies (it carries a body code) keeps its own message and status, and so does a throw whose status addresses the caller (4xx). Every route catch in `auth-plugin.ts` already applied this rule. The three result mappers its doors answer through now apply it too:

- `mapAuthApiError`, shared by `POST /admin/create-user`, `POST /admin/set-user-password`, `POST /admin/import-users`, `POST /admin/add-sso-user`, `POST /admin/import-sso-users` and `POST /organization/add-member`: an unclassified failure answers `INTERNAL_ERROR` with `Internal server error`, the words those routes' own catches use.
- The membership step of `POST /service-account/register`: such a failure answers `INTERNAL_ERROR` with `The request could not be completed.`, the words that route's own catch uses.
- `runSetInitialPassword` (`POST /set-initial-password`): such a failure answers `INTERNAL_ERROR` with `Internal server error`.

Each such answer keeps the status it had and the code `INTERNAL_ERROR`; only the message changes. A refusal the vendor classifies, a refusal a hook or middleware declares, and a throw with a 4xx status are answered exactly as before.

Each mapper is handed the logger the plugin already holds and logs such a failure once, at error level, naming the route (`[AuthPlugin] create-user failed`, `[AuthPlugin] service-account/register failed`, …). For a host that mounts these helpers itself, `AdminUserEndpointDeps.logger`, `IdentityImportDeps.logger` and `PendingSsoUserDeps.logger` accept an optional `error`; `OrganizationAddMemberDeps`, `ServiceAccountDoorDeps` and `SetInitialPasswordOptions` accept an optional `logger`; and `mapAuthApiError` takes an optional third argument, the logger. A host that passes none answers the same generic message and logs nothing.

What to do: nothing. A client that showed the message of a `500` from these doors now shows the generic sentence; the code and status it branches on are unchanged.
