---
"@objectstack/studio": patch
---

Studio: redesign generic metadata-detail pages.

Every detail page routed through `/$package/metadata/$type/$name`
(views, dashboards, apps, flows, agents, permissions, …) used to
have **no visible page header** — only a breadcrumb — plus a
wasted top band hosting a floating 3-dot menu, a dev-jargon
`objectstack.view-preview` plugin-id badge, and an unnecessary
viewer-picker dropdown. Errors were rendered as red prose leaking
the raw `[ObjectStack] Metadata item X not found` backend string.

This pass aligns generic detail pages with the Object-page pattern:

- The route now loads the item, renders a real header card
  (icon · label · machine name · type chip · description), and
  parks the `ResourceActionsMenu` on the right of the header
  instead of in its own floating top bar.
- `PluginHost` drops the always-visible plugin-id badge from the
  toolbar (`objectstack.view-preview` etc. — pure dev jargon)
  and the same id badge from inside the viewer-picker dropdown
  items.
- `MetadataInspector` (the default JSON-tree Preview viewer) no
  longer renders its own "Header card" — that's the route's job
  now, so users don't see "Sales Representative" twice on the
  Permission page.
- Friendly "not found" empty states replace the red error prose
  in `view-preview-plugin`, `FlowViewer`, and `MetadataInspector`.
  Internal error strings like
  `[ObjectStack] Metadata item flow/X not found` no longer leak
  to the UI; users see "Flow not found · We couldn't load X. It
  may have been deleted or moved to another package."
