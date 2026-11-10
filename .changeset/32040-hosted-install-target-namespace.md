---
'@object-ui/i18n': patch
---

feat(ui): the hosted unmanaged install dialog shows and edits the namespace its copy takes

Clause-②: yes (widening) — `@object-ui/i18n` gains five `marketplace.install.targetNamespace.*` strings; `marketplaceApi`'s new `getInstallNamespace` export and optional `targetNamespace` input live in the private `@object-ui/app-shell`, so they publish nothing
Metadata-protocol: none

On a hosted environment, an unmanaged install now draws a "Target namespace" field in the install dialog, pre-filled with the default the control plane would use (read through `GET /api/v1/cloud-connection/install-namespace`), and sends the value as `target_namespace`. When no default can be read (the runtime is not connected, or the control plane did not answer) the field starts empty and a typed name still installs; an empty field sends nothing and the control plane's default stands. A managed install draws no field and sends no namespace.

If the namespace belongs to another package, the dialog stays open, says the name is taken and asks for another. A malformed or reserved namespace shows the server's sentence beside the field. A second unmanaged copy of the same package is still refused, and no new namespace is offered for it, since a different namespace does not clear that refusal.

The strings are in all eleven locales of the `marketplace` namespace.
