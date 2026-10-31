---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@objectstack/service-automation': patch
'@objectstack/platform-objects': patch
---

feat(console): Setup → Integrations → Connector Credentials, and a credential step after a marketplace install

Clause-②: yes (widening: `@objectstack/service-automation` exports `CONNECTOR_CREDENTIALS_UI_BUNDLE`, `CONNECTOR_CREDENTIALS_COMPONENT_REF` and `CONNECTOR_CREDENTIALS_NAV_CAPABILITY`, and registers a new Setup navigation entry `nav_connector_credentials` resolving component ref `automation:connector-credentials`; no existing key, route or shape changes)
Metadata-protocol: none

An administrator can now set a connector credential without the API or the server environment.

- **Setup → Integrations → Connector Credentials** lists every reference the credential routes list (`GET /api/v1/automation/connectors/credential-refs`): its status (`set`, `missing`, `rejected` with the upstream's reason), the connectors naming it, and when and by whom it last changed. Each writable reference has a masked input that starts empty, whatever is stored; an empty input means "keep the current value", so nothing is sent for it. Saving sends `PUT` and the row takes the entry the server answers after its reconcile. A reference with a value stored here has **Clear**, behind a confirmation, which sends `DELETE`. A reference an environment variable supplies is read-only.
- Where the routes refuse (`403` for a missing capability or a multi-organization tenancy posture, `501`, `503`), the page shows the server's own sentence as a configuration notice, and a server without the routes (`404` / `405`) gets "this server does not manage connector credentials". Neither is drawn as an error.
- **After a marketplace install** into this runtime — install-local, an org package installed here, or a cloud install once its app is served — the install result lists the credentials the package's connectors still need (the same listing, filtered by `connectors[].packageId`), each with the same masked input and **Skip for now**. A skipped reference stays listed with a link to the Setup page. The step comes after the install because the routes refuse a reference no installed package declares (`404`); the connectors materialize as soon as a credential is set, with no restart. Where the listing cannot be read, the install answer's `credentialNote` is shown instead.
- The navigation entry is contributed by `@objectstack/service-automation` at `kernel:ready` through the manifest service, so it appears only where the automation service runs, and only for a viewer holding `manage_metadata`. The label is translated in the four platform locales; the page and the step are translated in all ten Console packs.
