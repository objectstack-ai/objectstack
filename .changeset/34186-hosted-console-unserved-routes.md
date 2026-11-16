---
'@objectstack/service-settings': patch
'@objectstack/cloud-connection': patch
'@object-ui/app-shell': patch
---

fix(console): the console asks the deployment notice, install-local and a page's lookup targets only of a host that serves them

Clause-②: yes (widening)
Metadata-protocol: none

A hosted environment's console asked three routes its host does not serve, and each answered an error in the network log on every load.

- **The deployment notice.** `GET /api/v1/runtime/config` now serves `features.deploymentNotice`. It is true exactly when the deployment notice is composed on this host: `SettingsServicePlugin` registers the notice's door as the kernel service `settings.deployment-notice` when it mounts the settings routes with it, and `RuntimeConfigPlugin` reads that registration per request. A host that mounts the settings routes itself, with no door, answers `GET /api/settings/deployment/notice` with `503` and now reports `false`. The route table is the same on both hosts, so it cannot answer this. A host's `resolveFeatures` policy cannot override the key. The console's home and System Overview read the notice only when the key is true. A runtime that serves no key is older than this change and still serves the notice, so the console keeps reading it there; only an explicit `false` stops the read.
- **Install-local on the marketplace catalog.** The catalog's side load reads `GET /api/v1/marketplace/install-local` only when `features.installLocal` is true, the gate the package page already reads. A host without it no longer answers a `404` on every load and Refresh, and the catalog list draws as before.
- **A page's lookup targets.** In an app with no package, a page and an object's route asked each lookup target's definition by name, and a target the host does not register (`sys_business_unit` on the control plane's Members page) answered `404` on every open. The targets the route has not asked already are now asked first in one `GET /api/v1/meta/object?names=` read, which leaves an absent object out, and only the ones it serves are then read by name. A registered target still resolves as before. An app with a package reads its lookup targets as before.
