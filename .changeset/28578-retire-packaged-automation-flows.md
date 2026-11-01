---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@objectstack/platform-objects': patch
---

feat(setup): Setup › Packaged automation's flows half retires, and Packaged actions becomes its own Setup entry

Clause-②: no
Metadata-protocol: none

ADR-0146 D11 retires Setup's packaged FLOWS page. Studio's Automations pillar now holds a packaged flow's on/off switch and its copy (New similar). That happened in D4. Setup keeps the operational state of packaged actions.

- **Setup navigation.** The `nav_packaged_automation` entry ("Packaged Automation", component ref `automation:packaged`) is replaced by `nav_packaged_actions` ("Packaged Actions", component ref `automation:packaged-actions`). It sits in the same group beside Packages, and like before it has no service or permission gate. The new label is translated in all four locales, and the retired id is tombstoned so its label cannot come back without a nav item.
- **The page.** `automation:packaged-actions` opens a page that holds only the packaged-actions switch list. The `automation:packaged` ref is no longer registered, and the old page is removed. In `@object-ui/app-shell`, `PackagedActionsPage` replaces the `PackagedAutomationPage` export. The shared flow and action helpers stay.
- **Studio stops linking to the retired page.** The "Organization flows" empty state now says how to change a packaged flow: open its package and use New similar. It no longer links out to Setup. The landing's `packagedAutomationPath` route builder is removed.

A second change (#28578) moves Setup's metadata pages into Studio's All metadata area. It follows separately.
