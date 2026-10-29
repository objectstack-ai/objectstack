---
'@objectstack/platform-objects': patch
---

fix(platform-objects): the API key Revoke and Restore toasts name the key

Clause-②: no
Metadata-protocol: none

The `revoke_api_key` and `restore_api_key` row actions on `sys_api_key` now say which key they acted on, for example `API key "QA key" revoked`, instead of the bare `API key revoked` / `API key restored`. The zh-CN, ja-JP and es-ES translations name the key too. Nothing to do.
