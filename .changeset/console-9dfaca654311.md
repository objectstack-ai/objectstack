---
"@objectstack/console": minor
---

Console (objectui) refreshed to `9dfaca654311`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 24 releasing of 24 changesets added across 17 non-merge commits.

- **minor** — **BREAKING** — The default (`simple`) `object-form` draws a self-describing inline section entry, as the `tabbed`, `wizard`, `split`, `drawer` and `modal` forms already did (objectui#11615). Bef… (objectui `9dfaca654`)
- **minor** — The `record:related_list` registration no longer declares `columns` required, so the page compile accepts a related list that lists no columns of its own (objectui#11613). (objectui `4c127cdef`)
- **minor** — The record page header draws the record's picture beside its title, from the field the object names in its object-level `imageField` (`@objectstack/spec` 17.6.0, objectstack#21182… (objectui `c096f0327`)
- **minor** — **BREAKING** — A form view's `subforms[].columns` entry is judged by `@objectstack/spec`'s `InlineGridColumnSchema` now, by reference, so `objectui validate` and `os validate` give one verdict o… (objectui `9db9ff3f9`)
- **minor** — **BREAKING — `PartialSchema<T>` is RETIRED from `@object-ui/types`** (objectui#11608, enforce-or-remove). The utility type leaves the `.` entry, the one entry that published it, w… (objectui `8b14aecbd`)
- **minor** — **BREAKING** — The `grid` field's eight field-level keys are camelCase now, and their snake_case spellings are retired and refused by name on every face (objectui#11610). (objectui `2abec3a96`)
- **minor** — **`BaseSchema` no longer declares `[key: string]: any`** (objectui#8347, executing the objectui#7927 ruling: the TypeScript face is a contract). Every node type extends `BaseSchem… (objectui `b403bb36f`)
- **minor** — All ten locale packs gain `view.noObject`, the hint an object-bound block shows when its node names its object in neither place (objectui#11605). (objectui `fd060f076`)
- **minor** — The `object-chart` and `view:chart` registrations no longer declare `objectName` required, so the page compile accepts a node whose `dataSource` binding names the object, and a ch… (objectui `fd060f076`)
- **minor** — The `object-metric` and `object-pivot` registrations no longer declare `objectName` required, so the page compile accepts a node whose `dataSource` binding names the object, and a… (objectui `fd060f076`)
- **minor** — The `object-form`, `view:form`, `embeddable-form` and `object-master-detail-form` registrations no longer declare `objectName` required, so the page compile accepts a node whose `… (objectui `fd060f076`)
- **minor** — The `object-grid` and `view:grid` registrations no longer declare `objectName` required, so the page compile accepts a node whose `dataSource` binding names the object (objectui#1… (objectui `fd060f076`)
- **minor** — The `object-kanban` registration no longer declares `objectName` required, so the page compile accepts a board whose `dataSource` binding names the object, and a board that names… (objectui `fd060f076`)
- **minor** — The `list-view` and `view:list` registrations no longer declare `objectName` required, so the page compile accepts a node whose `dataSource` binding names the object, and a list t… (objectui `fd060f076`)
- **minor** — `ElementDataSourceGate` takes a `requiresObject` prop: when a placement opts in and its node names its object in neither place, the gate renders a short "no object named" hint ins… (objectui `fd060f076`)
- **minor** — A Studio form field that declares the `ref:dataset` widget now renders a dataset picker instead of the JSON editor fallback (objectui#11601). (objectui `b508ac50d`)
- **minor** — The console asks `GET /api/v1/usage/storage` only when the runtime serves it (objectui#11002). On a self-hosted or open-source runtime, an environment admin's console used to requ… (objectui `d2e859936`)
- **minor** — The `record:line_items` registration no longer declares `childObject` required, so the page compile accepts a node whose `dataSource` binding names the child object (objectui#1156… (objectui `902ebab63`)
- **patch** — `deriveColumns`, the default columns of a master-detail inline grid whose author listed none, now takes which columns it draws, their order and which of them are `defaultHidden` f… (objectui `15f67025b`)
- **patch** — An object page's view tab, and the breadcrumb that names the open view, draw the label of a view the object document embeds as the server served it (objectui#11336). (objectui `6e9090c26`)
- **patch** — The docs portal's book sidebar now shows what the book resolver answers, with nothing narrowing the docs in front of it (objectui#11340, ADR-0046 §6.4). The resolver decides book… (objectui `7c9a6b194`)
- **patch** — Studio's "Organization flows" page no longer says its drafts publish atomically, and a deep link to a flow that is not on the page no longer says no metadata designers are registe… (objectui `b92329c89`)
- **patch** — On a read-only package, a click on a flow canvas node in Studio Automations selects the node and opens its inspector read-only again (objectui#11546). (objectui `278d2444e`)
- **patch** — fix(plugin-detail): `record:details` read mode shows a `textarea` value with its line breaks (objectui#11577) (objectui `b61c116b2`)

⚠️ 4 of these carry a breaking change: 4 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

<!-- adr-0087: not-required (no-migration-prescription)
     This diff moves `.objectui-sha` and the artefacts that travel with it: this console
     changeset, the regenerated `sdui.manifest.json` and its record
     `scripts/sdui-manifest.record.json`, the re-recorded
     `packages/sdui-parser/objectui-lockstep.json` (objectui's `packages/sdui-parser/src` is
     byte-identical across the range) and the re-measured pin citations in `packages/spec/src`,
     which carry their own `@objectstack/spec` patch changeset. It adds, removes or renames no
     ObjectStack-authorable key: no Zod schema, no spec declaration and no stored
     `sys_metadata` shape moves in it, so `objectstack migrate meta` has nothing here to
     rewrite, and this body carries no FROM/TO prescription of its own.
     The range carries five declared-breaking objectui changes: four changesets carry the
     author's breaking annotation, and a fifth commit's subject carries `!` (objectui#8347,
     `b403bb36f`, whose changeset states `Clause-②: yes (narrowing)` without the word). Each
     is objectui's own package surface, with its upstream record, and each is answered here:
     (1) objectui#11615 (`9dfaca654`): `ObjectFormSection.fields` gains the spec's
     `FormFieldInput` arm, which breaks TypeScript readers of that objectui type; no code in
     this repository imports `@object-ui/types`. The default `simple` form now draws a
     self-describing inline section entry, as the other five form types already did; no
     example in this repository authors a `simple` `object-form` with an inline section
     entry, and no authored document has to change.
     (2) objectui#11266 (`9db9ff3f9`): objectui's zod and TypeScript faces judge a form
     view's `subforms[].columns` entry by `@objectstack/spec`'s own `InlineGridColumnSchema`,
     the closed shape this repository has enforced since objectstack#20927, so objectui's
     validator now gives the verdict `os validate` already gave; the ObjectStack accept set
     does not move.
     (3) objectui#11608 (`8b14aecbd`): `PartialSchema` leaves `@object-ui/types`; nothing in
     this repository names it.
     (4) objectui#11610 (`2abec3a96`, objectui#11614): the `grid` widget's eight field-level
     keys are camelCase, and the snake_case spellings are refused by name. The ObjectStack
     runtime form field (`buildObjectFormRuntimeField`, `ui/component.zod.ts`) already refuses
     the snake_case spellings by name, with guidance naming objectui#11610, so no document
     this contract admits carries them. The camelCase spellings are not declared there yet:
     until objectstack#21768 declares them, an ObjectStack-authored `grid` field takes its
     `columns` and the widget's own defaults. That declaration widens a closed field and
     carries its own record.
     (5) objectui#8347 (`b403bb36f`): `BaseSchema` loses its index signature, a TypeScript
     narrowing of objectui's node types; no code in this repository compiles against them,
     and objectui's zod faces keep their accept sets for every key but `visibleWhen`, which
     widens on both to the `{ dialect, source }` envelope this repository's own parse writes.
     Where an entry mirrors an ObjectStack key, the ledger entry belongs to the
     `packages/spec` PR that lands it, never to the pin bump.
     Scope of the claim, stated rather than implied: it is a claim about THIS diff, not a
     per-entry re-measurement of the upstream declared-breaking entries.
-->

objectui range: `2e818d0b51ec...9dfaca654311`
