---
'@object-ui/console': patch
'@object-ui/auth': patch
'@object-ui/i18n': patch
---

feat(console): from 768 px up a sign-in lands in the last-used app, and the platform home page retires

Clause-②: yes (widening)
Metadata-protocol: none

From 768 px up there is no platform home page any more. A sign-in, the SSO round trip and the old `/home` address all land the person in an app, in this order: the app they last had open, while it is still there for them; else the app the product declares `isDefault`; else the first app somebody put into the environment (never Setup or Studio).

- A person with no such app at all stays on `/home`, which now draws only the no-apps empty state: 「No applications yet」, and for a viewer who may add an app the same doors the sidebar's 「Add app」 offers (build with AI, start from a template, the app marketplace). An administrator's first-run checklist stays above it.
- An administrator's first-run checklist, while it has open items, moves to the top of the Setup app's first page (the page Setup opens on). It is drawn from 768 px up only, and a phone is unchanged.
- `@object-ui/app-shell` exports `SetupFirstPageSlotProvider`, through which a host puts its element above the Setup app's first page.
- The console's Home affordances (⌘⇧H, the way back from a missing app, Studio's way out) go where the landing goes.
- The SSO sign-in's callback is the console root instead of `/home`, so it lands the same way.
- A phone is unchanged: it still lands in the last app first, and `/home` is still its app list.
- `@object-ui/app-shell` exports `resolveDesktopHomePath(apps, lastApp)`, the desktop's Home.
- Every console locale gains `home.noAppsAddDescription`.
