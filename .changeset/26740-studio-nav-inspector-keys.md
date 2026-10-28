---
'@object-ui/i18n': patch
---

feat(i18n): `studio` namespace rows for the Studio nav-item inspector's badge, order and visible-condition fields

Clause-②: no
Metadata-protocol: none

- **Eleven new `engine.inspector.appNav.*` keys** in `@object-ui/i18n/namespaces/studio`, in `en` and `zh`: the badge and its style (with the four style names the spec's `badgeVariant` declares), the order and its hint, and two hints for the `visible` condition. They label the fields the Studio's Interfaces nav-item inspector now offers for keys a navigation entry already declares (objectstack#26740). Additive: no key changes or goes, no export changes.
