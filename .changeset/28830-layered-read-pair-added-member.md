---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the layered read on a base's address answers an email template locale added in the base's `.custom` pair with the pair's layer (#28830)

Clause-②: yes (widening)
Metadata-protocol: none

`GET /meta/email_template/<name>/layers?package=<base>&member=<locale>` (and the same read naming no package) answered `404` for a locale the base does not ship and its `.custom` pair adds, while the by-name read, the base's lists and `sendTemplate` serve that locale since #28802. It now answers the pair's row as the `overlay` and `effective` layers (`code: null`, the base ships no such locale), from the one read the by-name read uses. Another package's added locale stays `404` there and answers under the read naming that package; the base's own locales, the pair's declared overrides and every type whose identity is its name alone are unchanged.
