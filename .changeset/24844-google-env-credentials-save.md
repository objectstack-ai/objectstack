---
'@objectstack/service-settings': patch
---

fix(service-settings): Setup → Authentication saves "Enable Google login" ON when the Google credentials come from the server (#24844)

Clause-②: no

On a deployment that sets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` and leaves the two credential fields empty, saving `auth.google_enabled: true` was refused with `SETTINGS_VALIDATION` (`google_client_id` / `google_client_secret`: `required`). An admin who switched Google off on the page could not switch it back on there, although the server held valid credentials. The settings service reads only `OS_*` names, so it cannot see that pair.

`auth.google_client_id` and `auth.google_client_secret` are no longer `required`. Google sign-in needs the two credentials to resolve, saved on the page or set on the server; it never needed them stored. The `google_enabled` help already says so: Google is offered once both resolve, and the server's pair wins over saved values.

Who may sign in, and which providers the login page offers, do not change for any deployment. Saving the toggle ON while neither pair resolves is now accepted; the login page then shows no Google button, as it does with the toggle left at its default.
