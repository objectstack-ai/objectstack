---
'@object-ui/mobile': patch
'@object-ui/i18n': patch
'@object-ui/console': patch
---

feat(console): the profile page shows the mobile shell's App lock and opens its settings screen

Clause-②: yes (widening)
Metadata-protocol: none

Inside the ObjectStack mobile shell, a bridge that offers `openAppLockSettings()` now gets an "App lock" row on the profile page (`/system/profile` and the Account app's profile card). The row shows whether the lock is off, or on and after how long it locks, read from the shell's `getAppLock()`, and a tap opens the shell's native settings screen. The lock is the shell's own setting: the Console reads it and never changes it, so the row has no toggle. No event announces a change, so the page reads it again on mount, when it becomes visible again and when the window regains focus. In a plain browser, or a shell older than the app lock, the page is unchanged.

`@object-ui/mobile` adds the two optional bridge members, the `NativeAppLock` type and the `nativeGetAppLock` and `nativeOpenAppLockSettings` wrappers, which feature-detect with `has()` and never throw, like the other wrappers. `@object-ui/i18n` adds `profile.appLock.*` in all ten locale packs.
