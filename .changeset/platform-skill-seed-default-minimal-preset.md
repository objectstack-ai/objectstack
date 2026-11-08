---
'@objectstack/skills': patch
---

Clause-②: no
Metadata-protocol: none

`objectstack-platform`: § Seed Data now names `ignore` as the seed `mode` default (`SeedMode` defaults to `ignore`, not `upsert`), and § `requires:` says that `--preset minimal` keeps `job` and `queue` when `email`, `approvals` or `auth` is present instead of dropping every always-on token. `objectstack-automation`'s DocuSign eval case no longer forbids a string its own model answer uses, and its model answer now verifies DocuSign Connect's own signature header through `config.signature` instead of polling.
