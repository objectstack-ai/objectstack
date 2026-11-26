---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): the marketplace Versions panel marks a code-plugin version where the install would be refused

Clause-②: yes (widening)
Metadata-protocol: none

The widening is additive: two new keys, `marketplace.detail.notInstallableHosted` and `marketplace.detail.notInstallableHostedReason`, in every locale of the `marketplace` namespace pack that `@object-ui/i18n` publishes through `./namespaces/marketplace`. No props or other exports change.

A package's detail page listed every approved version the same way, so a code-plugin version (served with `contains_code: true`) gave no sign that installing it from a hosted environment is refused with 422 `CODE_PLUGIN_UNSUPPORTED`. On a runtime with no install-local surface, where the page installs through the control plane's door (a hosted environment's console, and the control plane's own console), each code-plugin version now carries a muted "Not installable on hosted" badge (zh: 托管环境无法安装) and one line naming the way out: hosted environments do not run code plugins, so install it on a self-hosted or Enterprise runtime. A self-hosted runtime that installs through its own install-local door marks nothing, and a metadata version is never marked.
