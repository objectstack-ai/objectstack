---
'@objectstack/runtime': patch
'@objectstack/cli': patch
'@object-ui/data-objectstack': patch
---

fix(runtime,cli): the dispatcher's `/meta` permission refusal applies a deployment's `errors.permission_denied` override; `os package install` says which env variables count as credentials

Clause-②: no
Metadata-protocol: none

- `@objectstack/runtime`: the `HttpDispatcher` meta read gate now hands the request's i18n service lookup, as `RestServer` does, so an `errors.permission_denied` override reads the same on both doors. Without an i18n service, or when it fails, the built-in sentence is served and the refusal stays a 403.
- `@objectstack/cli`: the `--token` conflict refusal of `os package install` now says that `OS_RUNTIME_EMAIL`/`OS_RUNTIME_PASSWORD` count as `--email`/`--password`.
- `@object-ui/data-objectstack`: the README and a doc comment quote the current refusal sentence. No behaviour change.
