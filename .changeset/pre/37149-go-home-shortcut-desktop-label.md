---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): on a desktop the ⌘⇧H row names the app start page it opens, not the retired home page

Clause-②: no
Metadata-protocol: none

From 768 px up the platform home page is retired: `⌘⇧H` / `Ctrl+Shift+H` (unchanged) opens where `/` lands, the last-used app's start page. The keyboard-shortcuts dialog and the app pill's menu still called that 「Back to home」. On a desktop both now read 「Back to app start page」 (zh: 返回应用起始页), one wording for the one destination; the pill's row keeps its `⌘⇧H` keycaps. A phone, whose Home is still its app list, keeps 「Back to home」 in the dialog.

Locale value change, no new key: `layout.appSwitcher.backToHome` in every built-in locale. No props or exports change.
