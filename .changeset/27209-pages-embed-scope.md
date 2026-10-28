---
'@objectstack/skills': patch
---

docs(skills/objectstack-ui): `pages.md` 〈Inline metadata views〉 states the embed scope `os build` enforces — this package or a package of the same artifact it declares in `manifest.dependencies`

Clause-②: no
Metadata-protocol: none

The build-lint sentence said a `metadata` fence's referenced object-rule / flow / permission set "must exist in this package". `docs/metadata-embed-ref` judges an embed against the package that ships the doc plus the packages of the same artifact that it declares in `manifest.dependencies` (direct only; one-way), so the rule the skill teaches now matches: an embed may name such a declared package's item, and anything else fails the build. No platform behaviour changes.
