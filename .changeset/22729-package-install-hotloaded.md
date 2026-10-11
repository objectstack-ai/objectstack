---
'@objectstack/cli': patch
---

fix(cli): `os package install` no longer reports a hot install when the runtime answers `hotLoaded: false` (#22729)

Clause-②: no

- **What was wrong.** `os package install` printed "Package installed into the running kernel" for any `200` from `POST /api/v1/marketplace/install-local`. On the endpoint's lenient path (a catalog manifest whose hot-register throws), the runtime writes the package to its ledger and answers `200` with `hotLoaded: false` and the register error's message as `hotLoadError`: the package loads at the runtime's next restart, and the running kernel does not hold it. The command read neither key.
- **What it prints now.** On `hotLoaded: false` it prints a warning that the package is installed but the running kernel could not load it, and that it loads at the runtime's next restart, followed by a `Hot-load error:` line carrying `hotLoadError` as the runtime answered it. When `hotLoadError` is missing, blank or not a string, no reason line is printed. The exit code stays `0`: the install itself succeeded.
- **What did not change.** A hot-loaded install (`hotLoaded: true`) prints exactly as before, and so does an answer without `hotLoaded` (a runtime that predates the key). The command has no `--json` output, and none is added.
