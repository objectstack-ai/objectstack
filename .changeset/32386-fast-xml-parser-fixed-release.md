---
'@objectstack/plugin-auth': patch
'@objectstack/driver-odata': patch
---

fix(deps): `fast-xml-parser` is on its fixed release, 5.12.0 (#32386)

Clause-②: no
Metadata-protocol: none

Both packages declare `fast-xml-parser` as a runtime dependency, so a downstream install now resolves the fixed release. `@objectstack/plugin-auth` keeps its exact pin, now `5.12.0`, the same release `@better-auth/sso` resolves (its `^5.8.0` admits it), so the SAML refusal-cause reader and the vendor still parse with one copy. `@objectstack/driver-odata` declares `^5.12.0`. No API, behaviour or export changes.
