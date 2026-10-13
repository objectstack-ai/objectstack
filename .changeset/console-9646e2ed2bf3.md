---
"@objectstack/console": minor
---

Console (objectui) refreshed to `9646e2ed2bf3`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 13 releasing of 14 changesets added across 9 non-merge commits; omitted: 1 release-nothing changeset, 1 commit carrying no changeset (they ship no package code).

- **minor** — The FilterBuilder's row and group types are exported as `FilterBuilderRow` and `FilterBuilderRowGroup` instead of `FilterBuilderCondition` and `FilterGroup` (objectui#6349, batch… (objectui `26b0bd2d1`)
- **minor** — `FilterBuilderOperator` is no longer exported from this package (objectui#6349, batch 12). It was `@objectstack/spec`'s `ViewFilterOperator`, the protocol's canonical view-filter… (objectui `26b0bd2d1`)
- **minor** — The result type of this package's `toDomProps` is declared and exported as `FieldDomProps` instead of `DomProps` (objectui#6349, batch 11). `@object-ui/core` publishes a different… (objectui `35a2b59a5`)
- **minor** — The node type of the tree this package's parser produces is declared and exported as `ParsedSchemaNode` instead of `SchemaNode` (objectui#6349, batch 11). `@object-ui/types` publi… (objectui `35a2b59a5`)
- **patch** — The Studio fallback form for an email template no longer offers `category` or `isSystem`, and the fallback skill form no longer offers `triggerPhrases` (objectstack-ai/objectstack… (objectui `9646e2ed2`)
- **patch** — A gallery card whose title field is a lookup now shows the referenced record's name, not `[object Object]` (objectui#12188). (objectui `5dd583f5e`)
- **patch** — The list view's URL filter state reads the FilterBuilder's group by `@object-ui/components`' new name for it, `FilterBuilderRowGroup` (it was exported as `FilterGroup`; objectui#6… (objectui `26b0bd2d1`)
- **patch** — `ListViewProps.onFilterChange` and `ListViewProps.initialFilters` now name the advanced-filter group by `@object-ui/components`' new name for it, `FilterBuilderRowGroup` (it was e… (objectui `26b0bd2d1`)
- **patch** — `toFilterGroup` now declares its return type by `@object-ui/components`' new name for the FilterBuilder's group, `FilterBuilderRowGroup` (it was exported as `FilterGroup`; objectu… (objectui `26b0bd2d1`)
- **patch** — Under a tenancy wall (`isolated` or `group`), the security catalog's pages are read-only for everyone but the platform operator, and say why (objectui#12183). (objectui `d928c8394`)
- **patch** — `DataSource` inside this package is now a re-export of `@object-ui/types`' `DataSource`, the one adapter contract, instead of an older and looser second declaration of it (objectu… (objectui `35a2b59a5`)
- **patch** — On a metadata type the `OS_METADATA_WRITABLE` hatch elevates, an item a package ships now opens read-only in the metadata editor and in the permission matrix, and an item no packa… (objectui `5b20aed39`)
- **patch** — Studio's landing page and the permission matrix name the overlay that exists: an environment overlay, not an org overlay (objectui#12171). (objectui `b0c5f9ddf`)

**In this console build, declared nowhere** — objectui merged 1 commit in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared it, so it appears in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ ci(site): deploy the docs from a GitHub Actions workflow every 6 hours, and turn Vercel's Git-triggered builds off (objectui#12178) (#12182) (objectui `7e30d0b6e`)

Clause-②: no

objectui range: `088e0f705520...9646e2ed2bf3`
