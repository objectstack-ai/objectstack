---
'@object-ui/app-shell': patch
---

feat(app-shell): the hosted marketplace install offers the install modes a package permits and sends the chosen one as `install_mode`

Clause-②: no
Metadata-protocol: none

On a hosted environment (a cloud base, no install-local door), the marketplace package page now reads the package's `installModes` from the manifest the marketplace serves, through the same resolver the install-local page uses. A package that permits both `managed` and `unmanaged` draws the same Install mode choice, and Install waits for a pick. A package that permits only `unmanaged` says before the click that its install is a copy. The install request to `POST /api/v1/cloud-connection/install` carries the mode as `install_mode`, and the control plane judges it.

A package that declares no `installModes`, or permits only `managed`, sends the request it sent before: no `install_mode` key. The marketplace list's one-click install and an update of an installed package send no mode either.

The answer is read the way install-local reads its own. An answer that names `installMode: 'unmanaged'` reports the base the copy went into, and the package does not flip to Installed, because the copy is the environment's own metadata, not a package installation. A requested copy answered without one says the environment installed the package managed instead, since that is what an environment that does not forward the mode does. Refusals on the hosted install now go through the install-local page's code-to-text path: a `DEPENDENCY_MISSING` refusal lists its unmet dependencies in the reader's language, and the install-mode refusals show the server's own message.
