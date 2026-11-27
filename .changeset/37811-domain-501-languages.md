---
'@objectstack/runtime': patch
'@objectstack/spec': patch
---

fix(runtime): the dispatcher's remaining 501 answers follow the request's language

Clause-②: no
Metadata-protocol: none

The `501 NOT_IMPLEMENTED` answers of `/auth`, `/i18n`, `/mcp`, `/meta`, `/packages`, `/automation` (the connector credential and connection doors, the run list, cancel, restore, resume, screen lookup and flow clone), the action and catalog activation doors, the permission-set clone door, the `/security` suggested-binding reopen and `/share-links` now answer in the request's top `Accept-Language` tag, as the own doors' `501`s do since #37721, and carry `Vary: Accept-Language`. Each sentence is a new key of the operation-message catalog in `en`, `zh-CN`, `ja-JP` and `es-ES`; the English is byte for byte the sentence the door answered before, and status and code are unchanged.

Two `501`s stay English: the shared `capabilityUnavailable` answer, whose sentence is the discovery remedy (`services.<slot>.message`) by contract, and the MCP resume door's, which the calling agent reads beside the door's other English refusals.
