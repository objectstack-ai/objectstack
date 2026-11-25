---
'@object-ui/app-shell': patch
---

fix(console): on a desktop the way-home controls name the app start page they open, and the app pill drops its duplicate 「All apps」 row

Clause-②: no
Metadata-protocol: none

From 768 px up the platform home page is retired: Home is where `/` lands, the last-used app's start page. Four desktop controls still named a home page or a list of apps:

- The app pill's menu ended with 「All apps」, which opened the same app start page as the 「Back to app start page」 row above it. A desktop has no page that lists the apps; the menu's 「Switch Application」 group is that list. On a desktop the row is gone.
- The 「Back to home」 button on the not-found, access-denied and app-verdict screens, and on a record that cannot be read, now reads 「Back to app start page」 (zh: 返回应用起始页) on a desktop.
- The no-assistant screen at `/ai` does the same.
- The product mark's accessible name, 「PRODUCT home」, is 「Back to app start page」 on a desktop. Its tooltip is still the product's name.

A phone, whose Home is still its app list at `/home`, keeps 「Back to home」, 「PRODUCT home」 and its drawer's 「All apps」. No targets change. The wording reuses the existing `layout.appSwitcher.backToHome` key, so no locale key is added or removed. No props or exports change.
