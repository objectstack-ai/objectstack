---
'@object-ui/app-shell': patch
---

feat(app-shell): a Studio item header keeps the item's name readable; its chips, item tools and action labels give way first

Clause-②: no
Metadata-protocol: none

On a narrow content column (a laptop window with the right panel open) the item header's title row no longer cuts the item's name to nothing. The title keeps its first twelve characters (its whole name when shorter), and the row gives way in two steps before the title does. First the identity chips (the api-name chip, the kind chip, the override and pair chips) and the five item tools (Layers, References, History, Audit, Source) leave the row and read at the top of the item's ⋯ menu: the chips as one entry, the tools as menu items opening the same sheets. Then the labelled actions (Customize, a flow's on/off switches, the Design and Run buttons) show their icon alone, the label staying their accessible name. The Interfaces and Automations headers fold into their own ⋯ menu; the Data header, which has none, draws one while something is folded. With the row's boxes fitting the row again, the ⋯ trigger stays inside the column instead of under the right panel. The draft status chip stays in the row. `StudioItemHeader` takes this as a `foldMenu` prop and exports `StudioItemHeaderFoldedItems` for a pillar's own menu; a header without `foldMenu` is unchanged.

The pillar rails draw the customization mark as its glyph alone ("Customized (BASE)" and "Added" are its accessible name and lead its tooltip), so a customized row keeps its label. The All metadata lists keep the mark's text.
