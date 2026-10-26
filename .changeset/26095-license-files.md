---
'@objectstack/account': patch
'@objectstack/console': patch
'@objectstack/lint': patch
'@objectstack/metadata-protocol': patch
'@objectstack/sdui-parser': patch
'@objectstack/service-datasource': patch
'@objectstack/service-messaging': patch
'@objectstack/setup': patch
'@objectstack/skills': patch
'@objectstack/studio': patch
'@objectstack/trigger-api': patch
'@objectstack/trigger-record-change': patch
'@objectstack/trigger-schedule': patch
'@objectstack/verify': patch
---

chore(packages): ship a LICENSE in the 14 published packages that had none

Clause-②: no
Metadata-protocol: none

npm packs a package's own `LICENSE` whatever its `files` says, and nothing in the release tooling copies the repository's root `LICENSE` into a package, so these 14 published tarballs carried no licence text at all while declaring `"license": "Apache-2.0"`. Each now carries a byte-for-byte copy of the root `LICENSE`, the same file the other 59 published packages already ship. With this, every one of the 73 published packages outside `ui/` ships a LICENSE and a README.
