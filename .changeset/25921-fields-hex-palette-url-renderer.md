---
'@object-ui/fields': patch
---

refactor(fields)!: retire three zero-consumer entry exports (the hex badge palette pair and the url cell renderer)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/fields#deriveHexBadgePalette, @object-ui/fields#HexBadgePalette, @object-ui/fields#UrlCellRenderer) the retired operands are a colour helper, its return type and a React cell renderer of the fields package; nothing in the workspace or in hotcrm imports or names any of them outside the package, and no packages/spec schema, registered node type, conversion surface or stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports any of these three names from `@object-ui/fields`. None had an importer or a mention anywhere outside the package, in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected. Badges and dots with a declared hex colour and `url` cells render exactly as before.

The code stays in the package; only the entry stops publishing it. The hex colour math moves from `index.tsx` to an internal module that `getBadgeHexAppearance` and `getDotHexAppearance` read, and `UrlCellRenderer` stays the renderer the standard map serves for `url` fields. Every other name the entry exported stays exported unchanged, among them `getBadgeHexAppearance`, `getDotHexAppearance`, the `HexColorAppearance` type, `getBadgeColorClasses`, `getCellRenderer`, `EmailCellRenderer`, `PhoneCellRenderer` and `ColorSwatchCellRenderer`.

What leaves, and what to write instead:

- FROM `deriveHexBadgePalette` TO `getBadgeHexAppearance(hex)` for the pill colours and `getDotHexAppearance(hex)` for the dot colours; both return the derived colours as CSS custom properties on `style`.
- FROM `HexBadgePalette` TO the `HexColorAppearance` type those two functions return.
- FROM `UrlCellRenderer` TO `getCellRenderer('url')`, which returns the same renderer (or the one a host registered for `url` with `registerFieldRenderer`).
