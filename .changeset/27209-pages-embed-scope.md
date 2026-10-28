---
'@objectstack/skills': patch
---

docs(skills/objectstack-ui): `pages.md` 〈Inline metadata views〉 states the embed scope `os build` enforces — this package or one it declares in `manifest.dependencies`

Clause-②: no
Metadata-protocol: none

The build-lint sentence said a `metadata` fence's referenced object-rule / flow / permission set "must exist in this package". `docs/metadata-embed-ref` judges an embed against the package that ships the doc plus the packages it declares in `manifest.dependencies` (direct dependencies only; the declaration is one-way), so the rule the skill teaches now matches: an embed may name a declared dependency's item, anything else fails the build, and the refusal names the scope it judged. No platform behaviour changes.
