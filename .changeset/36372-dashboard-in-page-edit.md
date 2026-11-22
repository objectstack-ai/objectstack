---
'@object-ui/core': patch
'@object-ui/i18n': patch
'@object-ui/plugin-dashboard': patch
'@object-ui/app-shell': patch
---

feat(console): a dashboard is edited on its own page by the people who may design its package, and every card marks the page filters it does not follow

Clause-②: yes (widening) — one new exported function (`dashboardFiltersNotApplied` in `@object-ui/core`), two new optional `DashboardRenderer` props (`onWidgetResize`, `onAddFilter`), an optional `{ packageId }` on `saveAndPublishRuntimeMetadata`, and new `@object-ui/i18n` keys (`dashboard.inPageEdit.*`, `dashboard.filters.notApplied`, `dashboard.filters.addFilter`); nothing is removed or renamed
Metadata-protocol: none

A dashboard page draws an **Edit** button for a workspace admin who may author metadata, on a package Studio lists (the gate of the app's Studio entries). Edit opens the dashboard as stored (never the translated copy the page shows) in an edit state: the header says **Editing**, with **Add card**, **Discard** and **Save**; every card draws a dashed outline and can be dragged to move it, resized from its corner by whole grid tracks (or with the arrow keys on the corner handle) and clicked to select it. The panel at the right is Studio's own dashboard panels, as they stand: a selected card's (its data, its "follow page filters" switches, Remove) and otherwise the dashboard's (label, cards, filters, layout). The filter bar's **Add filter** opens the panel's Filters section. Add card appends a card at the end and selects it.

Save writes where Studio's Customize would and publishes that one item in the same act, so everyone sees the change at once without the app's package being published: into the owning package when it is writable, else into the app's customization package (`<base>.custom`, asked of the ensure door, declaring `overrides: { package, basedOn }`), so an installed app's dashboard is edited too. A dashboard with a draft already pending there (a Studio edit not yet published) is not opened for editing, and a save over one writes nothing: that draft is never published on its saver's behalf. Discard drops every change.

Every card, in every mode, carries a small mark naming the page filters that do not reach it ("Not filtered by Region"), asked of the same binding its query is built from (`dashboardFiltersNotApplied` over `resolveBoundField`): a filter the card opts out of, or one whose `targetWidgets` leaves it out. A card every filter reaches carries none.

`saveAndPublishRuntimeMetadata` takes an optional `{ packageId }`, named on its draft write, its publish and its discard; omitted, it writes exactly as before.
