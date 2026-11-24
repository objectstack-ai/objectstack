---
'@objectstack/spec': minor
'@object-ui/components': minor
'@object-ui/layout': minor
'@object-ui/app-shell': minor
'@object-ui/i18n': minor
'@objectstack/metadata-core': patch
'@objectstack/platform-objects': minor
---

feat(spec, ui): an object takes a colour from a fixed palette, and its icon is drawn as a white glyph on a square of that colour

Clause-②: yes (widening)
Metadata-protocol: added

- **`ObjectSchema.color` (new, optional).** One name from a closed palette of nine: `gray`, `blue`, `teal`, `green`, `amber`, `orange`, `red`, `pink`, `purple` (exported as `OBJECT_COLORS` and the `ObjectColor` type from `@objectstack/spec/data`). No free colour values: `color: '#ff0000'` is refused, and the refusal lists the nine names. An object without a `color` is drawn in the neutral `gray`. Nothing to migrate: every existing object stays valid and simply has no colour.
- **The AI blueprint carries it too.** `BlueprintObjectSchema.color` is the same leaf (required-but-nullable on `SolutionBlueprintStrictSchema`, like `icon`), and its rule asks the model to colour every object and give each object of one solution a different colour while the palette lasts. A producer of the STRICT shape must now send `color` on each object, `null` when it has none; the lenient shape a stored blueprint is read with keeps it optional.
- **`ObjectIconTile` (new, `@object-ui/components`).** Draws an icon name as a white glyph on a rounded square of a palette colour, in four sizes. Each name has a light-theme and a dark-theme value chosen so the white glyph keeps at least 3:1 contrast. `OBJECT_COLOR_TILE_CLASS` and `objectColorOrDefault` are exported with it.
- **Navigation draws objects as tiles.** In the sidebar, the app-home menu and the phone menu, every entry that opens an object is drawn as that object's tile: the entry's own `icon` when it names one, else the object's, on the object's colour. Dashboards, pages and links keep their line icons. `NavigationRenderer` takes a new `resolveTargetColor` resolver (`NavTargetColorResolver`) beside `resolveTargetIcon`; the console answers it from the object metadata it already holds (`useNavTargetColor`). A host that passes no `resolveTargetColor` gets its object entries as gray tiles where it had line icons.
- **The designer picks icon and colour together.** In the object's settings, the icon picker shows the nine colour swatches, and the trigger and every icon in the grid are previewed as the tile they become. The picker elsewhere (pages, apps, navigation entries) is unchanged: only objects carry a colour.
- The other places that draw an object's icon (list and record headers, search, related-record chips, the designer's object lists) switch to the tile in a follow-up release.

`@objectstack/metadata-core`: the field-level-security reference table classifies the new `color` key as `keep` (a palette name names no field).

`@objectstack/platform-objects`: the generic object form's metadata-form packs ship the new `color` row's label and help text in all 10 locales.
