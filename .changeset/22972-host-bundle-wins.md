---
'@objectstack/platform-objects': patch
---

A host's translation bundle for a platform key now overrides the platform's text, whichever loads first

Clause-②: no

`PlatformObjectsPlugin` loaded its translation bundles (the Setup App, the `sys_*` objects, `metadataForms.*`) on `kernel:ready`, and the i18n service merges each load over the last. A bundle a host loaded earlier, during its own `init()` or `start()` (every `defineStack({ translations })` app is one), was overwritten for every key the platform also ships. Measured on both i18n providers: a host zh-CN bundle that set `objects.sys_organization.label` to 「工作区」 still served 「组织」. The docs already said such a bundle "would override the platform's".

The platform bundles now load UNDER what the service already holds for each locale.

- **A host's key wins in either order.** A bundle loaded before the platform's is laid back on top of it, and a bundle loaded after it wins as before.
- **Everything the host does not ship still serves the platform's text.** That covers sibling keys of a host key (a host field label leaves the platform's `help` for that field in place), and every locale the host does not ship.
- **Studio-authored translations are unaffected.** The bundles now load in `start()`, as soon as an i18n service exists, which is before the authored overlay is synced at `kernel:ready`. Deleting an authored override of a platform key brings back the platform text, as before. A kernel whose i18n service only appears later in Phase 2 (an `AppPlugin` registering the in-memory fallback on a lean kernel) gets the bundles on `kernel:ready` instead.
- **A provider without `getTranslations`** still gets the platform bundles, loaded over what is there as before, and the boot warns once that host bundles loaded earlier do not override it.

No platform text changes: zh-CN `sys_organization` is still 「组织」. A host that wants different text ships it in its own bundle. The other platform packages' bundles share no key with this package's, and no example app's bundle repeats a platform key, so nothing else changes what it serves.
