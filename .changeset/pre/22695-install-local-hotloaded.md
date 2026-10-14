---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): install-local's `hotLoaded` reports whether the running kernel loaded the package (#22695)

Clause-②: no

- **What was wrong.** `POST /api/v1/marketplace/install-local` always answered `hotLoaded: true`. When the manifest came from the cloud catalog and `manifest.register` threw, the install still wrote the package to its ledger and answered `200` (the lenient path). The package loads at the next restart, but the answer said the running kernel held it already, and its `note` said the app was "now available in this runtime".
- **What it answers now.** On that path the answer carries `hotLoaded: false` and a new string key, `hotLoadError`, holding the register error's message. The `note` says the package is installed and cached, that the running kernel could not load it, and that the runtime registers it again at its next restart. A reader can then say "installed, loads at the next restart" instead of reporting a false success.
- **What did not change.** An install whose register succeeds answers exactly as before: `hotLoaded: true`, and no `hotLoadError` key. An inline (file-import) manifest whose register throws is still refused with `422 PLUGIN_REGISTER_FAILED`, and nothing is written. The lenient path still installs: the ledger entry is written, and the package loads at the next restart.
