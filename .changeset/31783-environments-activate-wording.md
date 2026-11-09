---
'@objectstack/client': patch
'@objectstack/cli': patch
---

docs(client, cli): `environments.activate` and `os environments switch` no longer say the server writes the session's active environment

Clause-②: no
Metadata-protocol: none

The control plane's `POST /api/v1/cloud/environments/:id/activate` reads the environment, confirms the caller is a member of it and writes no server state (it answers `sessionUpdated: false`). The SDK's `environments.activate` jsdoc, the environments endpoint list, the comments of `os environments switch` and `os environments create`, and the `--remote` flag description of `os environments switch` all said it updated the server-side session. They now say what happens: the call confirms access, and the active environment lives only in the CLI's local credentials (`~/.objectstack/credentials.json`, and `~/.objectstack/cloud.json` where that control plane is the one recorded there). `os environments switch --no-remote` now prints `(local only — /activate was not called)` in place of `(local only — server session unchanged)`. No behaviour changes.
