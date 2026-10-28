---
'@objectstack/platform-objects': patch
---

fix(platform-objects): the action form's `newTabUrl` help text says it is a path on this backend starting with `/`, in all four locales (en, zh-CN, ja-JP, es-ES), and names the `type: 'url'` action for an external page — matching the spec, which now refuses an absolute `newTabUrl`

Clause-②: no
Metadata-protocol: none
