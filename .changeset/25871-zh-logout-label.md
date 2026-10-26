---
'@object-ui/i18n': patch
---

fix(i18n): the Chinese account menu's sign-out item reads 「退出登录」, not 「注销」

Clause-②: no
Metadata-protocol: none

In the `zh` pack, `user.logout` read 「注销」, which a Chinese reader takes as "delete my account", on the menu every signed-in user opens. It now reads 「退出登录」, the wording the same pack already uses for signing out elsewhere. No key is added or removed; other locales are unchanged.
