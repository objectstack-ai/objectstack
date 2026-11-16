---
'@object-ui/console': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): the first-run checklist takes a host profile; a managed environment adds "Put your first app in" and "Add your first record"

Clause-②: no
Metadata-protocol: none

The administrator's first-run checklist on Home now draws its rows from a profile, selected by the flag the server already serves (`features.cloudManaged` of `GET /api/v1/auth/config`). No new field is served, and the checklist code has no branch on the host.

- **Self-hosted (the flag off or absent):** the checklist is exactly what it was.
- **Managed (`features.cloudManaged: true`):** two rows are added after the platform's rows.
  - **Put your first app in** is done once the launcher lists an app that is not one of the platform's built-ins (`com.objectstack.*`, such as Setup and Studio). It reads the console's existing `/me/apps` answer and sends no request of its own.
  - **Add your first record** is done once a person created a record on an object one of those apps lists. It sends one `sys_activity` read (`type` `created`, an actor set, at most one row). The activity feed keeps 14 days, so this row is optional on the managed profile: it never keeps the checklist open and is not counted in its progress.
  - The Email delivery row is shown only once mail reads as delivering. The hosted platform mail channel cannot yet report itself as configured, so the row would otherwise say "not set up" on an environment whose mail is delivered.

`@object-ui/app-shell` exports `isPlatformBuiltinApp`, the test that the AI chat's package switcher already used, so the checklist and the switcher apply the same test. New translation keys `console.firstRunChecklist.firstApp.*` and `console.firstRunChecklist.firstRecord.*` are in every language pack.
