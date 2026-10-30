---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): an admin can open a read-only package's app in Studio to look at it

Clause-②: no
Metadata-protocol: none

The app bar's Edit app pencil and the app switcher's 「Edit APP in Studio」 row were drawn only for an app whose package Studio lists as writable (objectui#12615), so a code or installed package's app (HotCRM, for one) offered no way into Studio at all. The same metadata authors now get a browse entry for such an app: an eye in the app bar, 「Open app in Studio」, and 「Open APP in Studio」 in the switcher, landing where the pencil would, in Studio's read-only posture. A writable package's app keeps the pencil and 「Edit APP in Studio」. The console's own apps, a package the list does not carry and a list not yet read still draw neither.

`useStudioEntryGate` answers the gate with a posture (`edit` or `view`) from the same server `writable` verdict; `useStudioDesignGate` is its `edit` half, so the sidebar's Design entry and a page's pencil are unchanged. Two keys are added in all ten locales: `topbar.openAppInStudio` and `layout.appSwitcher.openAppInStudio`.
