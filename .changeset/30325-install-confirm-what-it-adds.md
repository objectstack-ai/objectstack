---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): a marketplace app's Install confirms what it adds before it installs

Clause-②: no
Metadata-protocol: none

- **The confirm.** Install on a marketplace package page (an install into this runtime) now opens a short confirm in the console's own dialog before anything is installed. It says how many objects, permission sets and sample records the package adds, and which permission sets it will suggest granting to all signed-in users (the Everyone position) once installed; nothing is granted until an administrator accepts. Its Install installs exactly as the button did before, so trying an app is still one more click; Cancel installs nothing. Sample data stays on.
- **Where the counts come from.** The package body the install itself installs: the catalog's version manifest the page already reads for the package's install modes, so the confirm adds no request. Objects and permission sets are counted across every package body it carries; sample records are the records of its seed datasets, shown as "up to N" when a dataset is scoped to some environments or locales and may not load here. If the manifest cannot be read, the confirm says so and Install still works; the install result says what loaded.
- **Strings.** `@object-ui/i18n` gains `marketplace.install.preview.*` (title, reinstallTitle, intro, reading, unreadable, objects, permissionSets, sampleRecords, atMost, sampleNote, suggestsEveryone) in all 10 languages, in the lazy `marketplace` namespace (`@object-ui/i18n/namespaces/marketplace`) that loads with the marketplace pages, so the eager language packs do not grow.
