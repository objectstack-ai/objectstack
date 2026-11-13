---
'@object-ui/console': patch
---

fix(console): the first-run checklist's email row reads done when the running system delivers mail, including mail set up through the deployment's environment

Clause-②: no
Metadata-protocol: none

- **`@object-ui/console`.** The email row now follows the provider the server states is in use (`live.provider` of `GET /api/settings/mail`). Mail configured through the environment (`OS_EMAIL_*`, the stack's `email` block, or a transport the host hands over) saves nothing in Settings, so the row used to stay not done although mail was delivered. The development log, which delivers nothing, keeps the row not done even when saved values look complete. A server that does not state the provider is judged on the saved values, as before.
