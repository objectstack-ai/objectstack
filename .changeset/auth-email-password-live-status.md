---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): Setup → Authentication says when email and password sign-in runs other than the switch shows

Clause-②: no
Metadata-protocol: none

With nothing stored, `auth.email_password_enabled` resolves to the manifest default (on), while the running config takes the deployment's own `emailAndPassword.enabled`. A deployment that declares it off therefore showed the switch on for a sign-in method that is off. The auth plugin now registers a live-status provider for the `auth` namespace: whenever the switch and the running value disagree, `GET /api/settings/auth` heads the page with the `live_status` banner saying what runs (off by the deployment's configuration; off on a cloud-managed environment that holds it off, `warning` when a stored on is not applied; or, for any other disagreement, what runs), in the caller's language across the 11 platform locales. Nothing is stated while they agree. The resolved `values` and every save are unchanged: a stored value still wins where it is applied.
