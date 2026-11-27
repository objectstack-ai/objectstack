---
'@objectstack/runtime': patch
---

Clause-②: no
Metadata-protocol: none

`save_metadata_draft`'s `clientSpecVersion` parameter description and its SemVer-form refusal now give the server's own `@objectstack/spec` version as the example instead of a hard-coded `18.6.0`. An agent that copied the old example declared a previous major and was refused on a 19 server; the example now always names a version the door accepts. The version verdict itself is unchanged.
