---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): a flow opens full-screen in its own page; the Automations pillar's flow list is gone

Clause-②: yes (narrowing)
Metadata-protocol: none
Skills-docs: none — no page under `skills/` or `content/docs/` names the Automations rail's strings or teaches overriding a Studio console string

<!-- adr-0087: not-required (no-migration-prescription) the narrowing is nine console strings retired from the studio locale namespace of @object-ui/i18n; no packages/spec schema, registered node type, stored row or metadata key names them, nothing a metadata author writes changes, and a host that overrode one has nothing to rewrite: its override is simply no longer shown -->

**BREAKING** for a host that overrides one of the nine studio console strings listed under "Removed translation keys" below: they are retired with the Automations pillar's flow list in 19.0.0, and an override of one of them no longer applies.

In Studio, a flow now opens on its own page, full-screen beside the left menu, from the flow list in "All metadata", instead of in the Automations pillar's flow list and canvas. Its header is the one every full-screen item page has: × goes back to the flow list with its filters and sort kept, ‹ › step through the list in its order, and the flow's label, type and package are shown, with its machine name in a chip beside the label. A ⋯ menu holds New similar and Delete flow. The header still shows the flow's Trigger, Status (the engine's run status), Run as and version, and the Enabled switch (or, on a read-only package, the activation switch). The tab row holds the designer's Canvas, Variables, Runs, Problems and Debug, then References, History and Source, which replace the item-tools menu and its side sheets; a refreshed or shared link reopens the same tab. Save stays in the Studio top bar and still publishes that one flow, pinned to the version it was loaded at. Leaving with unsaved edits (×, ‹ ›, the menu, the Changes sheet, a reload, closing the tab) asks first.

A flow is created from the flow list's 「新建」, with the same starting points, and that create refuses to overwrite a flow published under the same name, as the pillar's did. When the name is taken by a flow in this package, the dialog says so and offers to open it. New similar opens the copy on its own page, with a strip saying where it landed. Deleting a flow returns to the flow list. The copilot still knows which flow is open, and still refreshes it after its edits.

The organization's own flows, which belong to no package, have their own flow list and open on their own pages; that list offers no 「新建」, as before, and when it is empty it says how a packaged flow is changed instead (open its package and use New similar).

Old bookmarks keep working. A link to a flow in the Automations pillar opens that flow's page, and a link to the pillar itself opens the flow list, for a package, a read-only package's customizations and the organization's own flows alike. A flow's History link opens its History tab. A link naming a flow the package does not hold says so and opens no other flow; one naming a flow that belongs to no package opens it among the organization's flows. A flow's draft-review link (and the environment view) opens the general item page with its review, as it did when flows had a pillar. A permission set's review link keeps opening its matrix page, as before.

The flow list has no column yet for a flow's trigger object or its run status; until it has one, both are shown in the flow's header.

Removed translation keys (studio namespace of `@object-ui/i18n`, released in 18.6.0; no code reads them since the flow list left the designer). Each is removed from both packs it shipped in, `en` and `zh`:

- `engine.studio.auto.heading` (en, zh)
- `engine.studio.auto.none` (en, zh)
- `engine.studio.auto.emptyMain` (en, zh)
- `engine.studio.auto.group.noObject` (en, zh)
- `engine.studio.auto.kind.record` (en, zh)
- `engine.studio.auto.kind.scheduled` (en, zh)
- `engine.studio.auto.kind.screen` (en, zh)
- `engine.studio.auto.kind.autolaunched` (en, zh)
- `engine.studio.auto.legend` (en, zh)

An override of one of these keys no longer applies; delete it. `engine.studio.org.none` is kept: the organization's empty flow list shows it.
