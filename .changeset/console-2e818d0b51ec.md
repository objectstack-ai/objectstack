---
"@objectstack/console": minor
---

Console (objectui) refreshed to `2e818d0b51ec`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 17 releasing of 18 changesets added across 22 non-merge commits; omitted: 1 release-nothing changeset, 6 commits carrying no changeset (they ship no package code).

- **minor** — `FlexBlockNode`, the TypeScript type of an authored `flex` node, types its bag's child list as nodes: `properties.children` is `SchemaNode | SchemaNode[]`, where it was `unknown[]… (objectui `b10c68e58`)
- **minor** — The dashboards' metric card node, `plugin-dashboard:metric`, is a declared node type, and both dashboard surfaces hand `SchemaRenderer` declared nodes with no cast (objectui#11466… (objectui `83e3f8377`)
- **minor** — **BREAKING** — **An `object-metric` node in a dashboard widget's legacy `component` envelope now draws the retired-format prompt instead of its number (objectui#11466).** This follows the mainta… (objectui `83e3f8377`)
- **minor** — **BREAKING** — A node slot and `SchemaRenderer`'s `schema` prop take the union of the declared node types, `DeclaredNode` (objectui#11466). (objectui `83e3f8377`)
- **minor** — `safeValidateSchema`, and so `objectui validate`, accepts `record:line_items`, the last ADR-0080 public block it refused at `type` (objectui#10872). `@objectstack/spec` 17.6.0 car… (objectui `8d0ca9183`)
- **minor** — `ObjectKanbanSchema.grouping` is declared on both faces, as `@objectstack/spec`'s `GroupingConfig`, by reference (objectui#11216). (objectui `a7557a7d4`)
- **patch** — The dashboard surfaces read every `widgets[]` entry without leaning on `BaseSchema`'s index signature: a widget key is read on the widget arm alone, and the `chart` node is built… (objectui `2e818d0b5`)
- **patch** — A refused save, pin, reorder, view setting, report save, publish or discard in the console is now said to the user, and the view-config panel no longer reports a refused save as s… (objectui `e8c0b9614`)
- **patch** — The `object-grid` summary footer reads `currency`, `defaultCurrency`, `precision` and `scale` from the object field only. A column that carries one of these keys no longer changes… (objectui `d768c3178`)
- **patch** — fix(types): `AnyComponentSchema`'s declaration prints every category union by name, so `@object-ui/types` no longer sits at the edge of TypeScript's serialization ceiling (objectu… (objectui `bdc9049ed`)
- **patch** — "Save as view" now saves a Kanban view the platform accepts, and both Create View doors save the same view from the same dialog choices (objectui#11581). (objectui `b65aa5e65`)
- **patch** — The console and runner stylesheets compile only from their declared `@source` lines. Tailwind's automatic source detection is now off (`source(none)`), as it already was for `@obj… (objectui `5a2ca6b12`)
- **patch** — A refused view save is now said to the user, and the Create View dialog no longer closes as if the view were saved (objectui#11578). (objectui `f1c937966`)
- **patch** — The console's Create View dialog now creates chart views the platform accepts (objectui#11576). (objectui `d0097af2e`)
- **patch** — fix(plugin-grid): switching a server-grouped grid's grouping field shows exactly the new field's groups (objectui `2f54dca53`)
- **patch** — fix(app-shell): an interface page relays its source view's `tree` and `chart` blocks, and its own `allowPrinting` (objectui#11572) (objectui `09036173c`)
- **patch** — A stored list view now renders the same on an interface page and on the object page when it carries a legacy `options` bag (objectui#10380). (objectui `068564691`)

⚠️ 2 of these carry a breaking change: 2 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

**In this console build, declared nowhere** — objectui merged 6 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ fix(release): the publish lane pushes the version's git tags and creates its GitHub Releases itself — changesets/action@v1 finds no `New tag:` line under CLI v3 (objectui#11596) (… (objectui `973fc20f3`)
- _(no changeset)_ docs(skills): `schema-expressions.md` states `{ condition, style }` as the only authorable conditional-formatting rule on every list carrier (objectui#11534) (#11595) (objectui `94985a92b`)
- _(no changeset)_ chore: release packages (#5400) (objectui `b493919c7`)
- _(no changeset)_ docs(plugin-detail): the reference-rail README says `entries` go in the `properties` bag, and that the validator refuses a flat one (objectui#10872) (#11584) (objectui `7a7660c65`)
- _(no changeset)_ docs(skills): the page-builder guide's object-form example names its fields; a per-form override goes on a section entry (objectui#11550) (#11561) (objectui `0a53c67f9`)
- _(no changeset)_ docs(skills): type three marked fences' schema as SchemaRendererProps['schema'] (objectui#11543) (#11558) (objectui `5cde2c6fe`)

<!-- adr-0087: not-required (no-migration-prescription)
     This diff moves `.objectui-sha` and the artefacts that travel with it: this console
     changeset, `scripts/sdui-manifest.record.json` (the regenerated `sdui.manifest.json` is
     byte-identical: 107 components, sha256 `0ead67c1111d…` at both pins), the re-recorded
     `packages/sdui-parser/objectui-lockstep.json` and the re-measured pin citations in
     `packages/spec/src`, which carry their own `@objectstack/spec` patch changeset. It adds,
     removes or renames no ObjectStack-authorable key: no Zod schema, no spec declaration and
     no stored `sys_metadata` shape moves in it, so `objectstack migrate meta` has nothing here
     to rewrite, and this body carries no FROM/TO prescription of its own.
     The 2 declared-breaking entries listed above are both objectui#11466 (`83e3f8377`, the
     range's one `!` commit, measured with `git log ab1879721595..2e818d0b51ec`) and both are
     objectui's OWN package surfaces, each already carrying its upstream record: (1) a node
     slot and `SchemaRenderer`'s `schema` prop take objectui's `DeclaredNode` union, a
     TypeScript type of `@object-ui/types` / `@object-ui/react` that no ObjectStack schema
     declares or references; (2) an `object-metric` node inside a dashboard widget's legacy
     `component` envelope draws objectui's retired-format prompt instead of its number. That
     envelope is not ObjectStack-authorable: `ui/dashboard.zod.ts` refuses a widget's
     `component` key by name as an objectui-internal renderer capability, so no stored
     ObjectStack dashboard can carry the form being retired, and no example in this repo
     authors one (the showcase's `object-metric` tiles are page blocks, which this entry
     leaves drawing). Where an entry mirrors an ObjectStack key, the ledger entry belongs to
     the `packages/spec` PR that lands the retirement, never to the pin bump.
     Scope of the claim, stated rather than implied: it is a claim about THIS diff, not a
     per-entry re-measurement of the 2 upstream declared-breaking entries.
-->

objectui range: `ab1879721595...2e818d0b51ec`
