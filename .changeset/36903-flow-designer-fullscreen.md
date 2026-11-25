---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): a flow opens full-screen at its metadata address; the Automations pillar's flow list is gone

Clause-②: no
Metadata-protocol: none

A flow in Studio now opens at its own address, `/studio/PACKAGE/metadata/flow/NAME`, full-screen beside the left menu, instead of the Automations pillar's flow list and canvas. The header is the one every full-screen item page has: × back to the flow list (its filters and sort kept), ‹ › through it in the list's order, the flow's label (its machine name on the title's tooltip), type and package, and a ⋯ menu holding New similar and Delete flow. It still shows the flow's Trigger, Status (the engine's run status), Run as and version, and the Enabled switch (or, on a read-only package, the activation switch). The tab row is the designer's Canvas, Variables, Runs, Problems and Debug, then References, History and Source, which replace the item-tools menu and its side sheets; the open tab is in the address (`?tab=`). Save stays the Studio top bar's and still publishes that one flow, pinned to the version it was loaded at; leaving with unsaved edits (×, ‹ ›, the menu, a reload, closing the tab) asks first.

A flow is created from the flow list's 「新建」 on the same starting points, and that create's publish now asserts no published flow of the name, as the pillar's did. New similar opens the copy at its own address, with the strip saying where it landed. Deleting a flow returns to the flow list. The copilot keeps reading which flow is open (from the address) and keeps refreshing after its edits.

The organization's own flows, which belong to no package, are listed at `/studio/~org/metadata/flow?source=runtime` and open at `/studio/~org/metadata/flow/NAME?source=runtime`; that list offers no 「新建」, as before.

Old addresses keep working: `/studio/PACKAGE/automations?surface=flow:NAME` redirects to the flow's address and a bare `/studio/PACKAGE/automations` to the flow list; `/studio/~org/automations` (with or without a flow) redirects to the scope's own addresses. Other query parameters are kept. `/studio/PACKAGE/metadata/flow/NAME/history` opens the History tab. An address naming a flow the package does not hold says so and opens no other flow; one naming a package-less flow opens it in the organization scope. A draft-review link (`?review=1`) and the environment view (`?scope=environment`) still open the flow's generic item page, as they did when flows had a pillar.

The list has no column yet for a flow's trigger object or its run status; until it does, both are on the flow's header. Ten console strings only the flow list and its legend used are removed from the studio locale namespace.
