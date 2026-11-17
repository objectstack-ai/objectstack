---
'@object-ui/i18n': patch
---

feat(console): the Studio landing is ordered by what the author came to do, and its copy says what they can do

Clause-②: yes (widening)
Metadata-protocol: none

The Studio landing (`/studio`, the App Builder) used to open with a paragraph about writable packages and `.custom` customization packages, list the author's writable packages, then two entries named for the architecture ("Organization flows", "Environment catalog"), and put the installed apps, the likeliest thing to change, last, each with a Read-only badge and its package id. Now:

- **Installed apps come first**, even when there are recent packages: "Recently viewed" now follows the author's own apps. The section says in one line that each app is upgraded by its vendor and the author's changes are kept separately. Each card carries a **Customize** button that opens the app in Studio, as clicking the card does; it no longer shows a Read-only badge or the package id (the id is the card's title). A card whose app has nothing changed says "No changes yet" instead of "0 customized, 0 switched off". The marketplace link sits beside the section heading as "Install from the marketplace".
- **A system package is not an installed app.** A kernel package the server lists flat with a `system` or `cloud` scope (a hosted environment's `sys.*` packages) no longer draws a card under Installed apps, by the same `kernel` tag the Studio package switcher reads.
- **The author's own apps follow**, with the create card renamed "New app of your own" (was "New package (writable base)").
- **Entries outside any app come last.** "Environment catalog" is now **"Positions and permissions"** ("Positions, permission sets and sharing rules, shared by every app."); it still opens the same Studio area (ADR-0146 D1 keeps these editors in Studio). "Organization flows" is now **"Flows in no app"**, shows how many there are, and is drawn only when there is at least one; when the count cannot be read the entry is drawn with no number.
- The page's lead is one sentence about what the author can do. In Chinese the landing body no longer carries 「.custom」「基座」「只读」.

No route, permission or storage changes. The widening is new keys in the `studio` namespace (`en`, `zh`): `engine.studio.landing.lead`, `.appsHeading`, `.appsHint`, `.marketplaceInstall`, `.customizeTitle`, `.customizations.none`, `.ownHeading`, `.newApp`, `.newAppDescription`, `.outsideHeading`, `.rolesPermissions.name`, `.rolesPermissions.description`, `.unassignedFlows.name`, `.unassignedFlows.description`; no key is removed or renamed. The landing no longer reads `engine.studio.landing.description`, `.mineHeading`, `.noneWritable`, `.installedHeading`, `.readonlyHint`, `.marketplace`, `.orgHeading`, `.envCatalog.name`, `.envCatalog.description` and `engine.studio.org.description`; they stay in the namespace. `engine.studio.org.name` and `engine.studio.pkg.new` are still read by the package switcher, unchanged.
