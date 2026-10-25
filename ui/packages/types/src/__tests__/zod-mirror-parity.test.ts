// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every hand-written zod mirror in `../zod/` accepts everything its TypeScript
 * declaration declares (objectui#5684).
 *
 * ## Which instrument checks which assertion (stated, because they differ)
 *
 * The `Expect< Equal< … > >` lines and the `: never`-typed `assertion*` declarations
 * are TYPE-level and are judged by `pnpm --filter @object-ui/types type-check`, whose
 * third leg is `tsc -p tsconfig.test.json` — the project that exists precisely because
 * `tsconfig.json` excludes every `.test.ts` file. ⛔ They are NOT judged by `vitest`,
 * which strips types. Read that against this file's own extension, which is the whole
 * reason it is said here rather than left to be inferred (objectui#9546): the obvious
 * way to "check parity" is to run a `.test.ts` with vitest, and that exercises the one
 * half of this file which cannot see the ratchet.
 *
 * The `expect(…)` lines in the `describe` blocks at the bottom are RUNTIME and are
 * judged by vitest. They check that the population is CLOSED and that the figures this
 * header writes down are derived from the ledgers — they never compare any mirror's
 * keys against the declaration it restates, which is the parity claim itself. ⛔ So
 * reading the runtime half for evidence about drift measures the wrong instrument and
 * concludes the guard does nothing; the same warning stands beside `UnmirroredDeclared`
 * below, where it was first written for that one ledger rather than for the file.
 *
 * Measured both ways on one tree, `.omit()`-ing both content channels off a registered
 * mirror (objectui#9256's verification, re-measured on objectui#9546): `vitest` exited 0
 * with its summary line unmoved from the clean run, while `tsc -p tsconfig.test.json`
 * exited 2 with `TS2322`. That clause RECORDS a measurement and is historical; the
 * guidance above it is LIVE, under this file's own split.
 *
 * ## The class
 *
 * A mirror restates a TS declaration by hand. When the declaration widens and the
 * mirror does not follow, the result is `declared !== enforced` on a PUBLISHED
 * surface (`@object-ui/types/zod`): the validator refuses a spelling the published
 * types invite and the renderer implements. Two instances were found
 * independently before anything looked for them —
 *
 *   - objectui#4605 (fixed in #5680): `BaseSchema`'s mirror had drifted narrow on
 *     FIVE keys, three of which the card naming it did not know about.
 *   - objectui#5186: `FieldValidationRules`' mirror refused the object dialect the
 *     TS contract declares and admitted a flat one no read point consumed.
 *
 * Both are regression evidence here, not open questions.
 *
 * ## The construction, and why it is derived
 *
 * #5680 established the shape and this file generalises it unchanged: read the
 * mirror's OWN `.shape` and compare each key against the declaration, so the next
 * widening that forgets a mirror turns red WITH NO KEY LIST TO MAINTAIN. A
 * hand-written key list is the same artefact the drift keeps producing.
 *
 * It reads `.shape` and not `keyof z.input<typeof Mirror>` because that spelling is
 * vacuous — `.passthrough()` collapses the inferred key union to bare `string`.
 * `assertionNoVacuousEntry` below pins that for every registered entry at once.
 *
 * ## What is registered
 *
 * `MIRRORS` pairs a mirror with the declaration it restates. The PAIRING is the
 * only hand-maintained part; the key census under it stays derived. Pairing by
 * name alone is not safe — the const named `FieldConstraintsSchema` mirrors
 * `FieldValidationRules`, NOT the like-named legacy `FieldConstraints` in
 * `../field-types.ts` (the flat dialect #5186 removed), and a name-derived pairing
 * reports five drifted keys that do not exist.
 *
 * `EXCLUSIONS` carries every other exported const in `../zod/` WITH ITS REASON, and
 * the runtime census at the bottom asserts the two together account for every one
 * of them. That is what keeps the population honest: a new mirror added to the
 * directory fails this file until someone registers or excludes it, so an
 * incomplete population reads as a declared decision instead of an oversight.
 *
 * ## The population, and where each number came from (objectui#6141)
 *
 * ⚠️ Every count in this header is READ, not inherited. The three that used to
 * stand here — "163 pairs" twice and "13 entries" once — were stale, and they were
 * the numbers other cards quoted as the size of the drift problem (objectui#5927's
 * framing, and objectui#6058's own dispatch, both inherited "163").
 *
 * ⚠️ READ is not the same as CHECKED, and the gap between them is where this header
 * rots: a figure read once becomes prose the moment it is written down. The three
 * LEDGER ENTRY counts below — and the ratchet section's restatement of the first of
 * them — are compared to the ledgers they describe by 'the ledger entry counts the
 * header states are derived, not prose' at the bottom of this file (objectui#7733),
 * so an entry added or removed fails this file instead of leaving a stale digit
 * standing. Their KEY totals, and the cross-ledger figures beside them, are
 * compared the same way by 'the header key totals and cross-ledger figures are
 * derived, not prose' (objectui#8222) — that pin was filed because `KnownDrift`'s
 * key total had been one low since objectui#7664 while the file stayed green.
 *
 * ⭐ **Every LIVE figure in this header is now pinned or explicitly excluded**, and
 * that is the state to preserve. A figure here is LIVE when it describes the file as
 * it is now, so it rots when the file moves; the many figures that name a reading at
 * a NAMED PAST revision ("42 / 63 until objectui#7542 …", "121 when objectui#6058
 * seeded it") are historical and cannot rot — they are readings of a tree that is
 * fixed. Exactly one figure is excluded rather than pinned, and it says so where it
 * stands: the seed decomposition under `UnmirroredDeclared`, which needs a
 * key's PROVENANCE and no ledger in this file records that. ⚠️ It was LIVE when that
 * exclusion was written and is HISTORICAL now — objectui#8243 anchored the statement
 * at named revisions — so it is no longer an exception to the sentence above, and
 * ⛔ the exclusion is not licence to pin or refresh it (objectui#8248). ⛔ Do not add
 * a live figure here without a pin, and ⛔ do not pin one by writing a second constant —
 * every pin below reads the header's OWN spelling, so the count a human edits stays
 * exactly one per site (objectui#7733's principle, and objectui#7433's before it).
 *
 * ⭐ **The LIVE / HISTORICAL split governs this file's ASSERTION MESSAGES too**
 * (objectui#8248; maintainer ruling, decision batch #71). Judge a message CLAUSE, not
 * a whole message:
 *
 *   - a clause that RECORDS A MEASUREMENT ("we measured X at revision R", "the header
 *     carries no copy") is HISTORICAL — ⛔ never rewritten by a later card, because
 *     rewriting it erases what was true when it was written;
 *   - a clause that GIVES GUIDANCE ("do Y next", "⛔ do not add Z", "this figure is
 *     live") is LIVE — it must be true NOW, and a later card MAY and MUST amend it
 *     when the world moves under it, citing the card that moved it.
 *
 * ⛔ Neither licence extends to the other half: amend the guidance clause, leave the
 * record clauses byte-identical beside it, and name the card that moved the world.
 * Guidance that has gone stale is the exact failure this file exists to catch, and it
 * misleads toward DOING work — a reader told a historical figure is "live" goes off to
 * pin or exclude it. The first application is objectui#8248's amendment to
 * objectui#8222's exclusion note, at the bottom of this file.
 *
 * On a file whose entire subject is measurement that is worth stating explicitly:
 *
 *   - **the pair population** — `Object.keys(MIRRORS).length`, pinned to the single
 *     written-down constant `EXPECTED_MIRROR_PAIRS` by the runtime census at the
 *     bottom of this file (objectui#7433); `assertionRegistryHalvesAgree` already pins
 *     it equal to `keyof Declared`. ⛔ Read the constant, not this sentence — a digit
 *     here is the artefact that rotted four times. 159 until objectui#7068 RETIRED the
 *     `crud.zod.ts#ActionCallbackSchema` pair — the const and its `ActionCallback`
 *     declaration both DELETED (the objectui#7664 route for a standalone retired pair;
 *     the legacy `ActionSchema.onSuccess` / `onFailure` keys that carried it are `never`
 *     / `retirementTombstone()` on the two faces), a pair with no entry in any ledger,
 *     so no other count moved; 157 until objectui#7664 retired the
 *     three `DeclarativeKanban*` pairs and registered the five plugin-dialect ones
 *     (`KanbanCardSchema`, `KanbanColumnSchema`, `KanbanSchema`, `CardTemplateSchema`,
 *     `ColumnWidthConfigSchema` — the `'kanban'` arm rewritten to the shape the
 *     registered renderer reads, ruling (a)); 155 until objectui#7655 registered the
 *     `ChatbotEnhancedSchema` and `ChatbotFloatingSchema` twins; 154 until objectui#7352
 *     registered `data-display.zod.ts#DrillDownConfigSchema` — a nested config mirror
 *     paired with the local `DrillDownConfig`, the `ObjectMapConfigSchema` precedent —
 *     which carries no ledger entry. ⚠️ **This line rotted twice and was re-derived at
 *     objectui#7352 contract review** (objectui#7655's contract review measured the same
 *     rot independently: three instruments read 154 where the prose said 160). Its
 *     history, measured by running the same walk over this file at each revision
 *     rather than by reading the prose: `4ca30d044` wrote "160" when `MIRRORS` held
 *     **163**; `d88e20f55` (objectui#7432) took the registry to **154** without touching
 *     the sentence; objectui#7352 then added its 1 to the stale baseline and wrote 161.
 *     Two independent derivations agreed on the figure the constant now carries — a
 *     TypeScript AST walk counting
 *     `PropertyAssignment` nodes in the `MIRRORS` initializer, and a line-oriented parse
 *     of the same block — and they agree on the historical figures above. ⛔ Do not add
 *     a delta to this number; count the registry. Nothing asserts it against a written
 *     one, so this line is prose and can rot; the pin that cannot is the one
 *     comparing the two halves to each other.
 *   - **55 entries** in `KnownDrift`, **93 keys** across them — 55 / 92 until
 *     objectui#12620 declared `DataTableSchema.rowGroups`, the host-built group
 *     bands of a grouped grid, as a runtime slot refused by name on the mirror,
 *     so `rowGroups` JOINED `data-display.zod.ts#DataTableSchema`'s existing
 *     entry beside `renderCellEditor`: the key total rose by one and the entry
 *     count did not move. It was 50 / 87 until
 *     objectui#8347 removed `BaseSchema`'s index signature, which ledgered FIVE
 *     new entries of one key each, all the INTERFACE-TO-PASSTHROUGH artifact
 *     (`app.zod.ts#AppSchemaRendererNodeSchema` and four `reports.zod.ts`
 *     pairs: a member typed with an `interface` against a `.passthrough()`
 *     mirror input, which an interface is never implicitly assignable to). It
 *     was 50 / 88 until
 *     objectui#11514 dropped the component type from the TS
 *     `DashboardWidgetSchema`'s `type`, once `plugin-dashboard` read slot entries
 *     by the slot's element type: both faces name the same widget vocabulary, so
 *     `type` LEFT `complex.zod.ts#DashboardWidgetSchema`'s entry and the entry
 *     stays on `component` and `options`. It was 49 / 87 until
 *     objectui#11515 registered the TS twins of three zod-only node arms. ONE
 *     entry is NEW with one key: `views.zod.ts#DetailSectionNodeSchema`'s
 *     `fields`, the EXPECTED DIVERGENCE on `views.zod.ts#DetailViewFieldSchema`'s
 *     `options` measured one level up, as on `views.zod.ts#DetailViewSectionSchema`.
 *     A pair born ledgered, not growth on an existing entry; the other two pairs
 *     carry no `KnownDrift` entry. It was 49 / 86 until
 *     objectui#11483 took the component type `metric-card` out of the mirror's
 *     widget vocabulary (`DashboardWidgetTypeSchema`), so a card in the slot is read
 *     by its component arm alone and its required `value` governs. The TS
 *     `DashboardWidgetSchema` keeps that type in its `type`, because it is also the
 *     read type of every `widgets[]` entry, so `type` JOINED
 *     `complex.zod.ts#DashboardWidgetSchema`'s existing entry: the key total rose by
 *     one and the entry count did not move. It was 49 / 87 until
 *     objectui#11234 RETIRED `ObjectKanbanSchema.onQuickAdd` on BOTH faces
 *     (`?: never` on the declaration, `handlerKeyRefusal(…, 'retired', …)` on the
 *     mirror), completing ruling B of decision batch #91 on `object-kanban`. The
 *     key had been a runtime slot: a callable twin against a named refusal. A
 *     matched pair of tombstones is not drift, so the key LEFT
 *     `objectql.zod.ts#ObjectKanbanSchema`'s entry and the entry stays on
 *     `onCardClick`. The key total fell by one and the entry count did not move.
 *     It was 49 / 88 until
 *     objectui#10976 narrowed `ObjectViewSchema.table` to the grid keys `ObjectView`
 *     hands the grid it draws: the TypeScript slot no longer declares `onNavigate`,
 *     the one callable the nested mirror refused, so `table` LEFT
 *     `objectql.zod.ts#ObjectViewSchema`'s entry and the entry stays on its other two
 *     keys. The key total fell by one and the entry count did not move. The slot's
 *     withheld keys are refused by name on the mirror and absent from the
 *     declaration, so both faces refuse them and neither ledger gains a row. It was
 *     48 / 87 until
 *     objectui#9256 repaired the `Omit` erasure on `form.zod.ts#InputShorthandSchema`:
 *     the face had declared nothing it inherited, so no key of it could drift, and it
 *     now carries `InputSchema`'s members, `onChange` included. ONE entry is new with
 *     one key, and it is `InputSchema`'s own runtime-slot drift inherited through the
 *     repaired heritage — not drift the change introduced. It was 49 / 89 until
 *     objectui#10874 settled the TypeScript face of the three `@object-ui/plugin-ai`
 *     declarations per key: `onApplySuggestion` / `onRejectSuggestion` became `?: never`
 *     (both faces now refuse them), so `ai.zod.ts#AIFormAssistSchema` measures clean and
 *     its ONE entry LEFT with its two keys; `onSelect` / `onDismiss` / `onSubmit` became
 *     the callables their components invoke, so `ai.zod.ts#AIRecommendationsSchema` and
 *     `ai.zod.ts#NLQuerySchema` STAY, unchanged in content and now ordinary objectui#6124
 *     rows. The entry count and the key total fell by one and by two together; the same
 *     change retired `config` / `context` on BOTH faces, which leaves those pairs
 *     agreeing and so adds no row. It was 46 / 84 until
 *     objectui#10859 armed the three `@object-ui/plugin-ai` node types in `ai.zod.ts`:
 *     THREE entries are NEW, one per armed node, and together they carry the five `on*`
 *     handler keys — `ai.zod.ts#AIFormAssistSchema` (`onApplySuggestion`,
 *     `onRejectSuggestion`: DEBT, a refusal of keys nothing reads while `../ai.ts` still
 *     types them `string`), `ai.zod.ts#AIRecommendationsSchema` (`onDismiss`,
 *     `onSelect`) and `ai.zod.ts#NLQuerySchema` (`onSubmit`), the last two RUNTIME
 *     SLOTS whose TS twin is `string` rather than a callable. +3 entries, +5 keys, each
 *     a pair born ledgered, not growth on an existing entry; all five are
 *     objectui#10874's to settle on the TS face. It was 46 / 86 until
 *     objectui#7759 group A settled `complex.zod.ts#DashboardComponentSchema`'s
 *     `header` and `globalFilters` by the spec (ruling 5617465269, principle 1): the
 *     declaration inherits the spec's `header` and the mirror's `GlobalFilterSchema`
 *     IS the spec's, so both keys measure clean and the entry SHRANK to `widgets` —
 *     the key total fell by two and the entry count did not. It was 48 / 88 until
 *     objectui#6033 settled the last two keys of its own ruling (C7 / C8): two
 *     WHOLE entries left (`form.zod.ts#ComboboxSchema`, whose one key was `options`,
 *     and `form.zod.ts#CommandSchema`, whose one key was `groups`). Both were
 *     OPTIONALITY drift — the declaration said optional, the mirror required — and
 *     both left because the mirror went `.optional()`, so the entry count and the key
 *     total fell by two together. It was 50 / 92 until
 *     objectui#10286 settled four keys of objectui#7759's groups C and D: two WHOLE
 *     entries left (`complex.zod.ts#FilterFieldSchema`, whose one key was `operators`,
 *     and `navigation.zod.ts#HeaderBarSchema`, whose one key was `variant`) and two
 *     entries SHRANK (`complex.zod.ts#FilterBuilderSchema` lost `fields` and keeps
 *     `onChange`; `form.zod.ts#FormSchema` lost `mode` and keeps `fields` and its three
 *     runtime slots), so the entry count fell by two and the key total by four.
 *     ⚠️ `operators` and `fields` left because both faces now state the spec's filter
 *     vocabulary; `variant` and `mode` left because both faces RETIRED them (the
 *     second under ruling D1-(ii)) — read the ledger notes where those entries stood
 *     before counting them as the same kind of move. It was 48 / 88 until
 *     objectui#10296 pointed `views.zod.ts#DetailViewFieldSchema`'s `options` at the
 *     spec's AUTHORING `SelectOptionSchema` (ruling F1 on objectui#7759): that pair
 *     and `views.zod.ts#DetailViewSectionSchema` are NEW entries with one key each,
 *     plus `fields` and `sections` on the EXISTING `views.zod.ts#DetailViewSchema`
 *     entry — the two containers carry those field elements. One
 *     EXPECTED DIVERGENCE against the runtime read model the declaration names, not
 *     a defect — the two entries' docblocks carry the reading. It was 49 / 90 until
 *     objectui#10293 settled `form.zod.ts#CalendarSchema`'s `defaultValue` and `value`
 *     under objectui#7759 D1-(iii): the declaration gained the ISO string the mirror
 *     accepts and gave up the `Date[]` arm the mirror refused, so both keys measure
 *     clean and the entry, its two keys and nothing else LEFT — entry count and key
 *     total moved together, by one and by two. It was 46 / 85 until
 *     objectui#7759 group E turned the four bare `z.function()` arms into
 *     `handlerKeyRefusal()` arms. THREE entries are NEW (`TableColumnSchema.cell`,
 *     `FieldConstraintsSchema.validate`, and `FormFieldSchema.validation`, which
 *     inherits that slot) and `DataTableSchema` gained two keys on its existing entry
 *     (`renderCellEditor`, plus `columns`, inheriting `cell`) — +3 entries, +5 keys.
 *     ⚠️ None of the five came out of an unmirrored ledger: each key was mirrored
 *     before and after, and the move is the WIDER ledger's loss seen from the other
 *     side — read it beside that bullet below. The retired fourth key,
 *     `FieldConditionSchema.custom`, is `never` on both faces and joins nothing.
 *     It was 46 / 83 until
 *     objectui#9447 DECLARED `onNavigate` and `onAddComment` on
 *     `views.zod.ts#DetailViewSchema`, an EXISTING entry (it already held `onBack`),
 *     so the key total moved by two and the entry count did not. ⭐ A pure TRANSFER,
 *     the `DataTableSchema` shape at a smaller size: both keys came out of
 *     `RuntimeOnlyDeclared`'s entry for the SAME pair, so the two ledgers' key totals
 *     move by the same two in opposite directions — read the two bullets together or
 *     the arithmetic looks like growth from nowhere. ⚠️ And read it beside the
 *     objectui#8572 sentence below, which is the OTHER asymmetry: there one key moved
 *     and no entry did because the entry survived on its remainder; here neither
 *     ledger's entry count moves because BOTH entries survive — this one already
 *     existed and that one keeps `onTabChange`, whose disposition is still open on
 *     objectui#7804. It was 46 / 84 until
 *     objectui#8572 RULED `complex.zod.ts#ChatbotSchema`'s `body`, the naming collision
 *     this ledger carried as "two different meanings of one key": the record arm is
 *     retired on both faces, the key measures clean and LEFT. ⚠️ One key moved and NO
 *     entry did — the entry survives on its two runtime slots — so this figure moved
 *     while the entry count above did not, and the objectui#7733 block stayed green
 *     while this one failed. That asymmetry is the shape a whole-entry departure does
 *     NOT have; read it before assuming both figures always travel together.
 *     It was 45 / 83 until
 *     objectui#7804's `TreeViewSchema` slice DECLARED `onNodeClick` on
 *     `data-display.zod.ts#TreeViewSchema`, a NEW entry here (that pair had no
 *     `KnownDrift` entry at all), so entry count and key total moved by one
 *     together. ⚠️ Its sibling move next door is not symmetric with the earlier
 *     ones: `RuntimeOnlyDeclared` lost a whole ENTRY, and with it the only pair
 *     that ledger held which `UnmirroredDeclared` did not — see the
 *     cross-ledger sentence under that bullet, which now states CONTAINMENT
 *     where it used to state a difference. It was 41 / 72 until
 *     objectui#7804's `objectql.ts` slice DECLARED nine handler keys across FOUR
 *     arms in that one mirror file, three of them NEW entries here
 *     (`ObjectFormSchema`, `ObjectGridSchema`, `ObjectViewSchema`) plus a fourth
 *     (`ObjectGallerySchema`) — the entry count moved by four because every one
 *     of the four was absent from this ledger. ⚠️ The key total moved by
 *     ELEVEN, not nine, and the two extra are NOT keys of the slice: declaring
 *     the form and grid arms propagated into `ObjectViewSchema`'s nested `form`
 *     and `table` slots, which are those sibling mirrors BY REFERENCE while the
 *     declaration types them off `ObjectFormSlotKey` / `ObjectGridSlotKey` —
 *     two unions that list exactly these handler keys. ⚠️ And only SEVEN of the
 *     nine came out of `RuntimeOnlyDeclared` below; the two
 *     `ObjectGallerySchema` keys were in NEITHER ledger, because they were
 *     declared on NEITHER face. ⛔ Read those three sentences together, or the
 *     arithmetic (+4 entries, +11 keys, −3 entries and −7 keys next door) reads
 *     as growth from nowhere. It was 41 / 65 until
 *     objectui#7804's `DataTableSchema` slice DECLARED seven handler keys on
 *     `data-display.zod.ts#DataTableSchema`, an existing entry (so the entry
 *     count did not move). ⭐ The largest single move this ledger has taken, and
 *     the first that is a pure TRANSFER: all seven came out of
 *     `RuntimeOnlyDeclared`'s entry for the same pair, so this ledger's key
 *     total and that one's move by the same seven in opposite directions — read
 *     the two bullets together or the arithmetic looks like growth from nowhere.
 *     The keys were declared on the TypeScript face and nowhere else while
 *     `renderers/complex/data-table.tsx` read and RAN each one; declaring the
 *     mirror's named refusal beside the callable twin is what turns a
 *     passthrough accept into a refusal BY NAME. It was 41 / 63 until
 *     objectui#7804's `plugin-detail` slice (batch #69) DECLARED `onNavigate`
 *     and `onAddComment` on `crud.zod.ts#DetailSchema`, an existing entry (so
 *     the entry count did not move). ⭐ The first keys this ledger has gained
 *     from a pair that declared them on NEITHER face: the TypeScript side typed
 *     them `any` through `BaseSchema`'s index signature and the mirror kept
 *     them through `.passthrough()`, while the registered renderer read and RAN
 *     them — so the pair was not "in parity", it was mutually silent, and
 *     declaring the callable twin against the mirror's named refusal is what
 *     makes the drift visible. Growth by REPAIR, in a ledger whose entries
 *     usually shrink by it. ⚠️ Two slices of objectui#7804 land in this bullet
 *     back to back and both are real, and neither is a copy-paste of the other:
 *     the `plugin-detail` one here, the `plugin-kanban` one directly below.
 *     It was 40 / 61 until
 *     objectui#7804's `plugin-kanban` slice DECLARED
 *     `objectql.zod.ts#ObjectKanbanSchema`'s
 *     `onCardClick` and `onQuickAdd` (director seat, decision batch #69), a new
 *     entry carrying TWO of the three keys the retirement below stranded on the
 *     surviving face. ⭐ The first entry this ledger has gained from an arm
 *     RETIREMENT leaving reads behind on a sibling: the keys did not move and
 *     no face drifted — the face that used to declare them stopped existing,
 *     and a different one picked up the obligation. ⚠️ TWO of the three, not
 *     three: `onCardMove` is measured `'retired'` on this face and
 *     `check:handler-key-reads` refuses that spelling while the renderer still
 *     reads the key, so neither face declares it and it is not drift at all.
 *     It was 40 / 61 until then, because
 *     objectui#8802 RETIRED the bare `kanban` node type key (maintainer ruling
 *     2026-09-09) and the `complex.zod.ts#KanbanSchema` pair with it, taking that
 *     entry's three RUNTIME SLOT keys (`onCardMove` / `onCardClick` /
 *     `onQuickAdd`) out of the ledger — ⭐ the first entry this ledger has lost by
 *     retiring a whole ARM rather than a key: the pair's TYPE LITERAL went, so a
 *     `{ "type": "kanban" }` document is refused before any member is compared.
 *     It was 41 / 64 until then, and 41 / 63 until
 *     objectui#8344 added `component` to `complex.zod.ts#DashboardWidgetSchema`, an
 *     existing entry (so the entry count did not move). 42 / 64 until
 *     objectui#8338 RETIRED the `feedback.zod.ts#ToastSchema` key on BOTH faces
 *     (ADR-0049 enforce-or-remove: `?: never` on the declaration, `retirementTombstone()`
 *     on the mirror), the entry's whole content, so the entry went with it. ⭐ The first
 *     entry this ledger has lost by RETIRING the key rather than by moving either face
 *     toward the other — and the only route open: the declaration had NO inhabitant to
 *     preserve, so "make the faces agree" had no mechanical direction. It was 41 / 63 until
 *     objectui#7760 SEEDED `feedback.zod.ts#ToastSchema` with its one key `action`
 *     (a pair born ledgered, not growth on an existing entry). ⭐ The first entry this
 *     ledger has gained from a face becoming READABLE rather than from a mirror or a
 *     declaration moving: the key's mirror face was `unknown` — which fits every
 *     declaration — until that card gave `SchemaNodeSchema` its input type argument.
 *     41 / 62 until
 *     objectui#7664 RE-KEYED the `kanban` arm (ruling (a)): the retired
 *     `DeclarativeKanbanSchema` entry carried `onCardMove` / `onCardClick`, and the
 *     plugin-dialect `KanbanSchema` entry that replaced it carries `onQuickAdd` as
 *     well — ONE ENTRY OUT, ONE IN, so the entry count did not move and the key
 *     total did. ⚠️ That is why this figure stood one low and fully green for four
 *     commits: the pin of the day (objectui#7733) read the entry count beside it,
 *     and the number that actually moved had nothing looking at it. objectui#8222
 *     measured it with two instruments and bisected it to this commit; the key
 *     totals are pinned from objectui#8222 onward. 42 / 63 until
 *     objectui#7542 REPAIRED `app.zod.ts#AppComponentSchema`'s one key `hidden` by
 *     restating the DECLARATION (`app.ts` now says `boolean`, what the spec-derived
 *     mirror enforced all along), the entry's whole content, so the entry went too —
 *     the ledger's first shrink on a SPEC-DERIVED pair, and the first by moving the
 *     declared face toward the mirror rather than the mirror toward the declaration;
 *     40 / 57 until
 *     objectui#7655 SEEDED the `ChatbotEnhancedSchema` and `ChatbotFloatingSchema` pairs
 *     with three runtime-slot refusals each (pairs born ledgered in the #6124 shape,
 *     not growth on an existing entry); 40 / 56 until
 *     objectui#7104 declared `AlertDialogSchema.onAction`, the action button's
 *     `onClick` the renderer had been reading UNDECLARED, as a RUNTIME SLOT on an
 *     already-ledgered pair (growth on an existing entry, both faces measured);
 *     39 / 55 until
 *     objectui#7455 SEEDED `app.zod.ts#AppComponentSchema` with its one
 *     spec-derived key `hidden` (a pair born ledgered, not growth on an existing
 *     entry: both faces read `boolean` until the base was widened, and only the
 *     DECLARED face moved — the entry objectui#7542 removed, above). It stood at 39 / 55 rather than
 *     39 / 56 because objectui#6940
 *     REPAIRED `DataTableSchema.rowActions` (the entry kept its other four keys, so
 *     the entry count did not move). It was 12 / 17 until
 *     objectui#6124 added the RUNTIME-SLOT class (28 pairs touched, 35 keys) — see
 *     the class note inside the ledger, above `ButtonSchema` — 36 / 52 until
 *     objectui#6576 minted `ObjectDataTableSchema` with one such arm (`onRowClick`),
 *     and 37 / 53 until objectui#7344 swept the string / `z.any()` handler mirrors:
 *     `DetailSchema` and `DetailViewSchema` entered (one `onBack` each) and
 *     `CalendarViewSchema` grew by `onEventClick`.
 *   - **4 entries** in `UnmirroredDeclared`, **5 keys** across them — 5 / 6 until
 *     objectui#6152 round 7 RETIRED `ObjectGridSchema.resizableColumns` on both faces
 *     (`?: never` on the interface, a `retirementTombstone()` on the mirror, and
 *     `ObjectGrid`'s fallback read dropped) once `@objectstack/spec` 17.7.0 refused it in
 *     the `object-grid` row. A tombstone is a mirrored member, so the entry's one key went
 *     and the entry with it — ⛔ nothing mirrored, nothing reclassified; 5 / 16 until
 *     objectui#6152 round 6 MIRRORED ten of `ObjectGridSchema`'s eleven keys, each
 *     measured READ by `ObjectGrid` (a type-checker census and a runtime probe through the
 *     real registry) and each a member of the spec's `object-grid` row — four as the spec
 *     schemas the twin names, two as the row's own members, four as restatements of the
 *     twin's local shapes. A shrink by REPAIR off an entry that kept ONE key
 *     (`resizableColumns`, its route open on that round's report), so only the key figure
 *     moved; 6 / 18 until
 *     objectui#11434's reader change gave `ProcessDesignerSchema`'s `lanes` and `version`
 *     their reader (the toolbar draws the version; each lane is a band around its nodes)
 *     and MIRRORED both, with a `BPMNLaneSchema` record mirror — a shrink by REPAIR, the
 *     objectui#6639 route, closing the last designer entry; 8 / 20 until
 *     objectui#11434 RETIRED two of the three designer entries' keys on both faces under
 *     ADR-0049 enforce-or-remove, each a tombstone and so a mirrored member:
 *     `DataModelDesignerSchema.autoLayout` (auto-layout is an action the toolbar already
 *     runs) and `ReportDesignerSchema.previewMode` (preview is a tool mode, not authored
 *     state). Both entries closed; `ProcessDesignerSchema`'s `lanes` and `version` stay,
 *     ruled READ, until that card's reader change mirrors them; 5 / 16 until
 *     objectui#10859 batch 7 armed the six `@object-ui/plugin-designer` node types in
 *     `designer.zod.ts`: THREE entries are NEW, LOCAL, one per pair born ledgered, and
 *     together they carry four keys — `DataModelDesignerSchema.autoLayout`,
 *     `ProcessDesignerSchema`'s `lanes` and `version`, `ReportDesignerSchema.previewMode`
 *     — each declared on the TypeScript face and measured ZERO-READ (props declared,
 *     never used; a runtime probe through the real registry drew the same markup with
 *     and without each). The card's ruling keeps an unread member off a second face, so
 *     each is unmirrored BY DECISION, for the seat to rule, ⛔ not mirroring debt. The
 *     two zero-read members that ruling settled first, `ProcessDesignerSchema.variables`
 *     and `ReportDesignerSchema.parameters`, LEFT the TypeScript face in the same change
 *     and are in no ledger; 6 / 20 until
 *     objectui#6152 round 5 closed ONE entry and shrank another, four keys by TWO routes
 *     that must not be read as one. TWO were RETIRED on both faces under ADR-0049
 *     enforce-or-remove, each a tombstone and so a mirrored member:
 *     `DataTableSchema.selectionStyle` (read by `data-table` but authored and produced
 *     nowhere, its hover branch dropped) and `ChatbotSchema.floatingConfig` (ZERO reads on
 *     a `chatbot` node; `ChatbotFloatingSchema` keeps its own). TWO were RECLASSIFIED BY
 *     NAME into `RuntimeOnlyDeclared` — see that bullet below: `DataTableSchema`'s
 *     `editable` and `singleClickEdit`, host-paired flags `ObjectGrid` sets in code, which
 *     emptied that entry with the retirement beside them. ⚠️ The LOCAL half did NOT reach
 *     zero: `displayMode` stays on both chatbot twins BY DECISION (objectui#7654 ruling B,
 *     its refusal TypeScript-only) — see those two entries; 9 / 44 until
 *     objectui#6152 round 4 closed THREE entries and shrank three more, twenty-four keys
 *     by THREE routes that must not be read as one. TWO were MIRRORED, each measured READ
 *     by a type-checker census: `ChatbotSchema.requestBody` (through the shared pick, so
 *     the three chatbot faces spell it once) and `ChatbotFloatingSchema.floatingConfig`
 *     (a restatement of `FloatingChatbotConfig` carrying the `triggerIcon` tombstone's
 *     runtime half). FOUR were RETIRED on both faces, each a tombstone and so a mirrored
 *     member: `LabelSchema.content` (a third spelling of the label text, the entry's only
 *     key), `ReportComponentSchema`'s `chartConfig` and `reportType` (the entry's whole
 *     content) and `DetailViewSchema.autoDiscoverRelated`, all three re-measured ZERO-READ.
 *     EIGHTEEN were RECLASSIFIED BY NAME into `RuntimeOnlyDeclared` — see that bullet
 *     below: fourteen of `DataTableSchema`'s keys and four of `DetailViewSchema`'s, the
 *     latter emptying that entry with the retirement beside them; 12 / 62 until
 *     objectui#6152 round 3 closed THREE entries and shrank two more, eighteen keys by
 *     two different routes that must not be read as one. SIXTEEN were MIRRORED, each
 *     measured READ by a type-checker census: `PaginationSchema.currentPage` (the entry's
 *     only key, on the ruling that made it canonical — its second spelling `page` was
 *     RETIRED on both faces in the same change and never entered this ledger), all eight
 *     of `FormSchema`'s layout keys (the whole entry), `ReportComponentSchema`'s
 *     `conditionalFormatting` and six of `DetailViewSchema`'s configuration keys (both
 *     entries stay). TWO were RECLASSIFIED, not mirrored: `ObjectFormSchema`'s `open`
 *     and `submitHandler` moved to `RuntimeOnlyDeclared` by NAME, emptying that entry
 *     — see that bullet below; 12 / 81 until
 *     objectui#6152 round 1 MIRRORED nineteen of `ObjectFormSchema`'s twenty-one keys,
 *     each measured authored and READ (`ObjectForm` reads them off its schema, or
 *     `ObjectView` / `RecordFormPage` / `ScreenView` relay them into the node it
 *     reads): the entry kept `open` and `submitHandler`, so only the key total moved,
 *     and the TypeScript face did not move at all; 12 / 84 until
 *     objectui#11068 MIRRORED `ObjectGridSchema.emptyState` (the grid reads it from that
 *     card on) and TOMBSTONED `rowSpecActions` / `bulkSpecActions` (second spellings
 *     nothing read): three keys off an entry that kept eleven, so only the key figure
 *     moved; 13 / 85 until
 *     objectui#7928 MIRRORED `ObjectViewSchema.listViews` BY REFERENCE to the spec's
 *     `ViewSchema.shape.listViews` (maintainer ruling A, staged behind objectui#8254 and
 *     objectui#8255): the key objectui#7779 left on its fallback clause, and that entry's
 *     ONLY remaining key, so the entry emptied and BOTH figures moved together; 14 / 86
 *     until objectui#8072 MIRRORED `InputSchema.wrapperClass`, the LAST `schema.wrapperClass`
 *     reader whose value the mirror admitted unexamined; it was that entry's ONLY key,
 *     so the entry emptied and BOTH figures moved together — read it against the next
 *     clause, where one key off a fifteen-key entry moved only the key total: 14 / 87
 *     until
 *     objectui#7762 MIRRORED `ObjectGridSchema.exportOptions` (the entry kept its other
 *     fourteen keys, so the entry count held); 14 / 96 until
 *     objectui#7779 closed nine of `ObjectViewSchema`'s ten keys (maintainer ruling
 *     B, 2026-09-06): eight MIRRORED — `navigation`, `searchableFields`,
 *     `filterableFields` by reference to the spec's `ListViewSchema` slots,
 *     `allowCreateView` / `viewActions` by reference to the sibling
 *     `ViewSwitcherSchema` slots the renderer forwards them into, `defaultViewType`
 *     / `defaultListView` / `showViewSwitcher` as local literals after a reader
 *     census — and `viewTabBar` RETIRED (tombstoned on both faces, zero reads). The
 *     entry KEPT `listViews` on the ruling's own fallback clause (its two value types
 *     measured incompatible), so the entry count held and only the keys moved; the
 *     spec reference also moved the entry between the split's halves — see the
 *     split below. 13 / 94 until
 *     objectui#7655 SEEDED a `ChatbotFloatingSchema` entry with `displayMode` and
 *     `floatingConfig`, the two keys that face declares alongside `ChatbotSchema`
 *     (whose own entry keeps all three of its keys — a pair born ledgered, not a
 *     move); 15 / 96 until objectui#7352 MIRRORED both `drillDown` rows at once
 *     (`ChartSchema` and `ObjectDataTableSchema`, each the entry's whole content, so
 *     both entries went): the ledger's second and third shrink by REPAIR, on the route
 *     objectui#6639 opened. It read 17 / 98
 *     between objectui#6576, which SEEDED the new `ObjectDataTableSchema` pair with its
 *     one measured key `drillDown` (a pair born ledgered, not growth on an existing
 *     one), and objectui#7129, which RETIRED `DetailViewSectionSchema.hideEmpty` —
 *     the ledger's first shrink by removing the DECLARATION rather than by mirroring
 *     it, and the entry's whole content, so the entry went too. objectui#7623 took
 *     that route a second time for `DashboardComponentSchema.title` (16 / 97 →
 *     15 / 96), again the entry's whole content — and the first time it reached the
 *     SPEC-DERIVED half. ⚠️ It was
 *     **121** when objectui#6058 seeded it; objectui#6152 moved 23 callback-shaped
 *     keys to the ledger below by RECLASSIFICATION, not by fixing them, and
 *     objectui#6639 MIRRORED `ObjectGridSchema.title` — one key actually repaired.
 *     Anything citing "121" as the mirroring debt is citing a number that changed
 *     meaning. ⛔ **EXPLICITLY EXCLUDED FROM THE PINS, and not restated here as
 *     digits** (objectui#8222): the comparable decomposition is survivors + mirrored
 *     + retired + reclassified, and every term but the last needs each key's
 *     PROVENANCE — which of today's keys descend from the seed. No ledger in this
 *     file records provenance; they record entry → key set as it stands. So no
 *     instrument here can derive this figure, and a copy of it in this header could
 *     only be prose. ⚠️ The copy that stood here WAS prose and had rotted: it read
 *     "95 + 1 mirrored + 2 retired + 23 reclassified", a survivor count that stopped
 *     being true when objectui#7352 and objectui#7779 closed keys out of the ledger.
 *     objectui#8222 measured that it had (⛔ do NOT read 95 against today's 87 — the
 *     two count different things: 87 is the ledger total, and two of those keys were
 *     seeded long after the 121). It is ⛔ not replaced with a fresh digit, for the
 *     reason above. The full statement is on that ledger, which owns it — read it
 *     there, and ⛔ do not copy it back.
 *   - **5 entries** in `RuntimeOnlyDeclared`, **31 keys** across them — 5 / 30
 *     until objectui#11068's `keyboardNavigation` build filed `DataTableSchema`'s
 *     `keyboardNavigation` here, on the entry that already existed, BY NAME with its
 *     reason on `RuntimeOnlyNamedAllowList`: the flag `ObjectGrid` resolves from the
 *     `object-grid` node's own key and sets in code on the `data-table` it builds.
 *     ⚠️ NOT the other side of a `UnmirroredDeclared` move: the key was declared on
 *     neither face of `DataTableSchema` until then, and the TS face now declares it
 *     while the mirror deliberately does not. The entry count held; it was 4 / 29
 *     until objectui#11355 round 2 filed `objectql.zod.ts#ObjectChartSchema`'s
 *     `isAnimationActive` here: a NEW entry, its one key a host-composed render flag
 *     (not callback-shaped), admitted BY NAME through `RuntimeOnlyNamedAllowList` with
 *     its reason, on the seat's ruling A on that card. ⚠️ NOT the other side of a
 *     `UnmirroredDeclared` move, unlike every round below: the key was declared on
 *     neither face until then, and the TS face now declares it while the mirror
 *     deliberately does not. It was 4 / 27
 *     until objectui#6152 round 5 filed TWO more non-callback keys here BY NAME, each
 *     with its reason on `RuntimeOnlyNamedAllowList`, on the `DataTableSchema` entry that
 *     already existed: `editable` and `singleClickEdit`, the inline-edit flags `ObjectGrid`
 *     sets in code beside the save path it supplies. ⚠️ The OTHER side of
 *     `UnmirroredDeclared` losing the same two — ⛔ not new debt, and nothing mirrored by
 *     it. The entry count held; it was 4 / 9
 *     until objectui#6152 round 4 filed EIGHTEEN non-callback keys here BY NAME, each
 *     with its reason on `RuntimeOnlyNamedAllowList`, on two entries that already
 *     existed: fourteen code-produced `DataTableSchema` keys and four `DetailViewSchema`
 *     keys (host-fetched runtime data, and `recordNavigation`'s required callback).
 *     ⚠️ The OTHER side of `UnmirroredDeclared` losing the same eighteen — one
 *     reclassification seen from both sides, ⛔ not new debt, and nothing mirrored by it.
 *     The entry count held; it was 3 / 7
 *     until objectui#6152 round 3 filed `objectql.zod.ts#ObjectFormSchema`'s `open` and
 *     `submitHandler` here: a NEW entry, and the first keys this ledger holds that are
 *     NOT callback-shaped — admitted by NAME through `RuntimeOnlyNamedAllowList`, each
 *     row carrying its reason, on the ruling that answered round 1's open question.
 *     ⚠️ Growth here is the OTHER side of `UnmirroredDeclared` losing the same two keys
 *     and the same entry above — one reclassification seen from both sides, ⛔ not new
 *     debt, and nothing was mirrored by it. It was 3 / 9
 *     until objectui#9447 DECLARED `onNavigate` and `onAddComment` on the mirror for
 *     `views.zod.ts#DetailViewSchema`, so both left for `KnownDrift` above — the
 *     drain this ledger is meant to take, never a refiling. ⭐ The entry SHORTENED
 *     rather than departing, which is the `DataTableSchema` shape and not the
 *     `TreeViewSchema` one below: `onTabChange` stays because it is read through an
 *     `(schema as any)` cast and its disposition is still open on objectui#7804, so
 *     there was something left to shorten. ⚠️ The containment sentence below is
 *     therefore UNDISTURBED — no entry moved, so this ledger is still a subset of
 *     `UnmirroredDeclared` and the union still equals it. It was 4 / 10
 *     until objectui#7804's `TreeViewSchema` slice took the whole
 *     `data-display.zod.ts#TreeViewSchema` entry out (its one key `onNodeClick`
 *     declared on the mirror as a named refusal, moved to `KnownDrift` above).
 *     ⭐ The consequence is not the digit: that entry was the ONLY member of
 *     this ledger absent from `UnmirroredDeclared`, so this ledger is now a
 *     SUBSET of that one and the union equals it — the sentence below says so,
 *     and it used to say the opposite. It was 7 / 17
 *     until objectui#7804's `objectql.ts` slice took three WHOLE entries out —
 *     `objectql.zod.ts#ObjectFormSchema` (five keys),
 *     `objectql.zod.ts#ObjectGridSchema` and `objectql.zod.ts#ObjectViewSchema`
 *     (one each) — the mirror having declared every one as a named refusal.
 *     ⭐ The first time this ledger lost ENTRIES rather than keys: each pair's
 *     whole runtime-only debt went at once, so there was nothing left to
 *     shorten. ⚠️ Read it beside the `KnownDrift` bullet above, which gained
 *     eleven keys where this lost seven — the difference is the two
 *     `ObjectGallerySchema` keys that were in neither ledger and the two nested
 *     `ObjectViewSchema` slots the declaration propagated into. It was 7 / 24
 *     until objectui#7804's `DataTableSchema` slice took seven keys out of
 *     `data-display.zod.ts#DataTableSchema` and into `KnownDrift` above, the
 *     mirror having declared each as a named refusal. The entry SURVIVES with
 *     five keys, so the entry count did not move; ⚠️ this ledger shrinking while
 *     `KnownDrift` grows by the same seven is ONE move seen from both sides, not
 *     two. ⭐ The direction is the one this ledger is meant to drain in: a
 *     runtime-only key leaves by being declared on the mirror, never by being
 *     quietly refiled.
 *     **0 of the 5** are a subset of the **4** pairs above, so
 *     the union of the two unmirrored ledgers is **9** pairs, being **4** from `UnmirroredDeclared` plus **5** recorded ONLY in `RuntimeOnlyDeclared`.
 *     ⭐ objectui#6152 round 7 moved the union from 10 to 9 and nothing else: the entry it
 *     closed (`ObjectGridSchema`, whose one key `resizableColumns` it retired on both
 *     faces) was in `UnmirroredDeclared` alone, so the shared count stays zero. It read
 *     `0 of the 5` against `5` pairs, a union of `10`, until then.
 *     ⭐ objectui#11434's reader change moved the union from 11 to 10 and nothing else: the
 *     designer entry it closed (`ProcessDesignerSchema`, whose `lanes` and `version` it
 *     mirrored) was in `UnmirroredDeclared` alone, so the shared count stays zero. It read
 *     `0 of the 6`, a union of `11`, until then.
 *     ⭐ objectui#11434 moved the union from 13 to 11 and nothing else: the two designer
 *     entries it closed (`DataModelDesignerSchema`, `ReportDesignerSchema`, whose keys it
 *     retired on both faces) were in `UnmirroredDeclared` alone, so the shared count
 *     stays zero. It read `0 of the 8`, a union of `13`, until then.
 *     ⭐ objectui#11355 round 2 moved the difference from 4 to 5 and the union from 12 to
 *     13: `ObjectChartSchema` entered `RuntimeOnlyDeclared` as a NEW pair recorded only
 *     there, and `UnmirroredDeclared` did not move. It read `0 of the 4`, a union of `12`,
 *     until then.
 *     ⭐ objectui#10859 batch 7 moved the union from 9 to 12 and nothing else: its three
 *     designer pairs are born in `UnmirroredDeclared` alone, so the shared count stays zero.
 *     ⭐ objectui#6152 round 5 moved the difference from 3 to 4, and the shared count to
 *     zero: `DataTableSchema` — the last pair in BOTH ledgers — left `UnmirroredDeclared`
 *     whole (two keys filed here by name, one retired) while keeping its entry here, so
 *     the union held at `9`. It read `1 of the 4`, `6` and `3` until then.
 *     ⭐ objectui#6152 round 4 moved the difference from 2 to 3: `DetailViewSchema` left
 *     `UnmirroredDeclared` whole (four keys filed here by name, one retired) while
 *     keeping its entry here. It read `2 of the 4`, a union of `11`, until then.
 *     ⭐ objectui#6152 round 3 reopened the difference, by the route predicted below:
 *     two pairs became runtime-only and nothing else. `ObjectFormSchema`'s whole
 *     unmirrored debt was its two runtime slots, now filed by name; `FormSchema`'s
 *     eight mirrorable keys were mirrored, which left only its `onDirtyChange`. The
 *     sentence is now spelled so that a difference of ANY size, zero included, reads
 *     true, ⛔ so a later drain does not have to reshape it again. From objectui#7804
 *     until round 3 it stated the containment instead (`3 of the 3`, a union of `12`
 *     pairs, "`UnmirroredDeclared` itself, exactly"). ⭐ It read `3 of the 4` / `15 pairs and
 *     not 14` until objectui#7804's `TreeViewSchema` slice, and the pair it named as the
 *     exception was the whole content of the difference: objectui#6150 had declared
 *     `onNodeClick` on an otherwise clean pair, making `TreeViewSchema` the first
 *     and only pair whose sole ledger entry was a runtime-only one, and #7804
 *     drained it by MIRRORING the key as a named refusal. ⛔ The difference figure
 *     is not recoverable by editing this sentence — it is a fact about the ledgers,
 *     and it returns only when some pair is again runtime-only and nothing else.
 *     ⚠️ Every live figure in these two sentences is pinned: the shared count before
 *     `of the` (a quantity of its own — how many entries the two unmirrored ledgers
 *     share), the union, and the figure after `plus` (the pairs recorded only as
 *     runtime-only), and three RESTATEMENTS of counts already stated above — the
 *     `RuntimeOnlyDeclared` entry count after `of the`, and both restatements of the
 *     `UnmirroredDeclared` entry count. (This list was amended by objectui#6152 round 3,
 *     which reshaped the sentence, and re-read by rounds 4 and 5, by objectui#10859
 *     batch 7 and by objectui#11355 round 2, which moved only its digits. objectui#6152
 *     round 7 names the figures by role, not by digit: the digits this list used to
 *     spell had gone stale while the pinned ones moved.)
 *     They were spelled as English WORDS
 *     until objectui#8222, which is why no instrument had ever read them: a figure
 *     spelled "six" rots exactly as fast as one spelled `6`, it is just harder to
 *     point a regex at. ⛔ Do not spell a live figure out again, and ⛔ do not
 *     restate one without checking that the pin's spelling still reaches it.
 *   - **4 entries** in `WiderThanDeclared`, **4 keys** across them, and **4 arms**
 *     under those keys — split **3** SCHEMA-NODE, **1** CONCRETE, **0** MIXED, **0** unions.
 *     It read 6 / 6 / 8 — 3 / 3 / 0 / 2 — until objectui#12163 (ruling C) made the widget
 *     `component` slot's second arm a refusal by name and narrowed its declaration to the
 *     component arm: the two dashboard entries that objectui#11466 brought in (next
 *     sentence) measured clean and LEFT together.
 *     It read 4 / 4 / 4 — 3 / 1 / 0 / 0 — until objectui#11466 typed `SchemaNode`'s object
 *     arm as the declared-node union: `complex.zod.ts#DashboardWidgetSchema`'s `component`
 *     (two CONCRETE arms, the mirror's `BaseSchema` fallback admitting any `type`) and,
 *     through the element, `complex.zod.ts#DashboardComponentSchema`'s `widgets` (two
 *     CONCRETE arms) ENTERED together.
 *     It read 3 / 3 / 3 — 2 / 1 / 0 / 0 — until objectui#11515 registered
 *     `app.zod.ts#AppSchemaRendererNodeSchema`, whose `schema` member IS
 *     `app.zod.ts#AppComponentSchema`: that pair's own SCHEMA-NODE reading is measured
 *     one level up, so the entry, its one key and its one SCHEMA-NODE arm ENTERED
 *     together, a pair born ledgered.
 *     It read 4 / 4 / 4 — 2 / 2 / 0 / 0 — until objectui#11168 slice 3 (objectui#7759
 *     group C) narrowed `form.zod.ts#FormSchema`'s `layout` to the `vertical` /
 *     `horizontal` its declaration states: `@objectstack/spec` 17.5.0 retired `grid`, and
 *     the renderer drew it as `vertical`. The entry, its one key and its one CONCRETE arm
 *     LEFT together.
 *     It read 3 / 3 / 3 — 2 / 1 / 0 / 0 — until objectui#11117 waived
 *     `objectql.zod.ts#ObjectGridSchema`'s `objectName` on the mirror beside a
 *     `dataSource.object` binding while the TypeScript twin kept it required: the entry,
 *     its one key and its one CONCRETE arm ENTERED together.
 *     It read 6 / 7 / 7 — 5 / 2 / 0 / 0 — until objectui#11073 bumped the installed
 *     `@objectstack/spec` to 17.5.0, whose `visibleWhen` envelope requires `source`: the
 *     spec-version-gated entries `views.zod.ts#DetailViewFieldSchema` (`options`, one CONCRETE
 *     arm), `views.zod.ts#DetailViewSchema` (`fields`, `sections`) and
 *     `views.zod.ts#DetailViewSectionSchema` (`fields`), three SCHEMA-NODE arms between them,
 *     LEFT together with their gate.
 *     It read 7 / 9 / 9 — 5 / 4 / 0 / 0 — until objectui#7759 group A settled
 *     `complex.zod.ts#DashboardComponentSchema`'s `header` and `globalFilters`: both keys
 *     are spec-declared, so both faces now state the spec's member, and the entry, its
 *     two keys and their two CONCRETE arms LEFT together (both keys also left
 *     `KnownDrift` — they were DISJOINT).
 *     It read 8 / 10 / 11 — 5 / 5 / 0 / 1 — until objectui#10387 RETIRED
 *     `navigation.zod.ts#HeaderBarSchema::logo` on both faces: the `header-bar` renderer
 *     reads no `logo`, so the entry, its one key and BOTH its arms left together. It was
 *     the ledger's last two-arm key, which is why `unions` reached zero.
 *     It read 8 / 11 / 12 — 5 / 6 / 0 / 1 — until objectui#10334 (objectui#7759 group F)
 *     settled `complex.zod.ts#DashboardComponentSchema::dateRange` by rule 1: the spec
 *     declares the key, so both faces now take the spec's authoring member by reference and
 *     the mirror's bare-string `defaultRange` is gone. One key with one CONCRETE arm left an
 *     entry that keeps two others, so `entries` did not move.
 *     It read 11 / 16 / 18 — 5 / 11 / 0 / 2 — until objectui#10286 closed five CONCRETE
 *     keys of objectui#7759's groups C and D: `complex.zod.ts#FilterFieldSchema::operators`
 *     and `complex.zod.ts#FilterBuilderSchema::fields` (both faces now state the spec's
 *     filter vocabulary), `layout.zod.ts#ContainerSchema::maxWidth` (the mirror's
 *     `z.boolean()` arm narrowed to the `false` the declaration states — a TWO-arm key,
 *     and the one union that left), `navigation.zod.ts#HeaderBarSchema::variant` and
 *     `form.zod.ts#FormSchema::mode` (both retired on both faces). Three entries left
 *     whole; `HeaderBarSchema` stays on `logo` and `FormSchema` on `layout`. ⚠️ Five
 *     keys, six arms: the Container key is why `arms` fell by one more than CONCRETE did.
 *     It read 12 / 18 / 22 — 5 / 13 / 0 / 4 — until objectui#10293 made
 *     `form.zod.ts#CalendarSchema`'s `defaultValue` and `value` declare the ISO string their
 *     mirror accepts: the entry and both of its two-arm keys left together, so `arms` fell
 *     by four where `keys` fell by two and `unions` by two.
 *     It read 17 / 26 / 30 — 5 / 21 / 0 / 4 — until objectui#7759 group E replaced the
 *     four bare `z.function()` arms (`renderCellEditor`, `cell`, `validate`, `custom`)
 *     with `handlerKeyRefusal()`. EIGHT keys left, one CONCRETE arm each, and five whole
 *     entries with them. ⚠️ Only four of the eight were the class the card named: the
 *     other four (`DataTableSchema::columns`, `FormFieldSchema::validation`,
 *     `FormFieldSchema::condition`, `FormSchema::fields`) read wider ONLY through the
 *     function arm nested under them, and resolved clean once it went — measured, not
 *     reclassified. None of the eight was a union, so `unions` did not move.
 *     It read 19 / 29 / 36 — 5 / 24 / 0 / 7 — until objectui#10280 (objectui#7759 group B)
 *     emptied two entries: `form.zod.ts#SliderSchema` (`defaultValue` by widening the
 *     declaration to the single-or-list the renderer normalizes, `value` by retiring it on
 *     both faces) and `overlay.zod.ts#TooltipSchema` (`content` by narrowing the mirror to
 *     the declaration). Three keys, each a two-arm union, so `arms` fell by 6 and `unions`
 *     by 3 while CONCRETE fell by 3.
 *     It read 20 / 30 / 37 — 5 / 25 / 0 / 7 — until objectui#8572 RETIRED
 *     `complex.zod.ts#ChatbotSchema::body`, that entry's whole content, so the entry, its
 *     one key and its one arm left together. ⚠️ Compare the objectui#8338 move below: the
 *     same DEPARTURE shape, but that key carried TWO arms, so CONCRETE and `arms` fell by
 *     different amounts there and by the same amount here — which is why the arithmetic is
 *     ⛔ not steppable by hand in either direction, and why both moves are written out.
 *     ⭐ The key left because the mirror stopped being wider, not because it was reclassified:
 *     the retirement makes the mirror REFUSE what the declaration also refuses.
 *     ⭐ objectui#8517 taught the operator to tell an OPEN record — `z.record(z.string(), V)`
 *     — from a partial record over a finite key union, and NOT ONE figure on this line moved
 *     with it. ⛔ Do not read that as the clause measuring nothing. It was built on two live
 *     keys, `layout.zod.ts#GridSchema::columns` and
 *     `reports.zod.ts#ReportComponentSchema::exportConfigs`, and reported BOTH at that card's
 *     base (`3f775eeb8`); objectui#8516 / objectui#8556 then narrowed both MIRRORS to
 *     `z.partialRecord` (`d4733f27e`, PR #8573) while the card was in review, so on the tree it
 *     landed on (`main` at `7bf133d58`) the two faces agree and the operator reports neither.
 *     Both readings are of FIXED trees and ⛔ neither can rot. ⇒ Every earlier reading of this
 *     ledger, objectui#7759's census included, was a FLOOR for the open-record shape and not a
 *     count; the two keys it was short are closed at the MIRROR instead of ledgered here. ⛔ Do
 *     not delete the clause as unused: it is what makes a re-widening of either mirror fail
 *     HERE, which is the file-level instrument objectui#8556 ruled that repair had to be
 *     pinned against rather than against an accept set alone. Its discrimination is pinned on
 *     synthetics at `assertionOpenRecordWideningIsReported`, with the `.passthrough()`
 *     caricature beside it.
 *     (objectui#8252 built the arm split; objectui#7760 moved every figure in it.) It
 *     read 23 / 36 / 47 — 6 / 30 / 0 / 11 — until objectui#8338 RETIRED
 *     `feedback.zod.ts#ToastSchema::action`, the entry's whole content, so the entry, its
 *     one key and BOTH its arms left together. ⚠️ Six figures moved on one key, and NOT
 *     in step: CONCRETE counts KEYS and fell by 1 while `arms` fell by 2 — ⛔ do not step
 *     these by hand, the derivation reads arms and keys through different reducers and a
 *     hand-stepped CONCRETE was wrong by one when this was written. It
 *     read 34 / 52 / 61 — 24 / 27 / 1 / 9 — until objectui#7760 gave seven of the ten
 *     recursion-breaking mirrors their existing TypeScript declaration as an explicit
 *     INPUT type argument. ⛔ That repaired no mirror and no declaration: it made a face
 *     READABLE that had been `unknown`. 19 keys across **18** pairs LEFT
 *     (**13 emptied + 5 reduced = 18**) because the reading they recorded was the
 *     annotation, and 3 keys
 *     ENTERED — `feedback.zod.ts#ToastSchema::action` (⚠️ history: that row is GONE,
 *     retired by objectui#8338 above — ⛔ do not look for it below),
 *     `navigation.zod.ts#HeaderBarSchema::logo`, `overlay.zod.ts#TooltipSchema::content`
 *     — real widenings the erased face had been HIDING. ⚠️ **pairs** there counts every
 *     entry the move TOUCHED — an entry that lost a key and KEPT others is still one it
 *     moved — and `emptied` is the subset that lost its whole content. Both readings are
 *     written down because a bare pairs figure had already forked: this line read `16`,
 *     which is NEITHER of the two readings above — ⛔ and they are not restated here as
 *     digits, because a restatement no pin reaches is the objectui#7733 shape one line
 *     further in. It was the one figure in this paragraph no pin reached, while every
 *     other one moved correctly with objectui#7760.
 *     objectui#8458 re-derived it by running this file's own `ledgerEntryMembers` over
 *     `WiderThanDeclared` at `645ecb98c` and `a480f797a` — PR #8354's parent and its
 *     merge — and diffing entry → key pairs; the decomposition is pinned by 'the
 *     objectui#7760 movement figures reconcile with themselves' at the bottom of this
 *     file. ⛔ That pin reads this sentence and nothing else: the movement is a
 *     HISTORICAL reading of two fixed trees, and pointing it at the live ledger is the
 *     hand re-derivation objectui#8243 removed. ⭐ All three are the
 *     `z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)])` single-or-list spelling
 *     objectui#7069 called systematic and could not judge, which is the whole reason
 *     that card's ledger declared this region EXCLUDED. MIXED is 0 because its one
 *     member is among the 19. ⚠️ Until #8252
 *     this ledger had NO figure in this header, and it is the one other cards quote as
 *     the size of the wider direction: objectui#7759 published its two halves as
 *     "27 keys / 21 pairs" SCHEMA-NODE and "27 keys / 18 pairs" CONCRETE, and
 *     objectui#8252's own card body inherited the first 27. Re-derived here the
 *     SCHEMA-NODE half is 24 pure plus the 1 MIXED — the figure had rotted by two while
 *     every pin in this file stayed green, which is the objectui#8222 shape on the one
 *     ledger objectui#8222 did not reach. The CONCRETE half has not moved. All six
 *     figures are read off `WIDER_ARMS` and the mirrors by 'the WIDER ledger's header
 *     figures are derived from its ARMS'; the per-KEY class is derived from the arm
 *     verdicts, never written down beside them, so a MIXED key cannot be filed whole.
 *   - **the pairs with no entry in either** unmirrored ledger — the population minus
 *     the union of the two ledgers above. ⛔ Not written down here in any form: the
 *     census derives it and pins it (objectui#7433). ⚠️ This line used to carry a
 *     running chain of deltas (141 → 142 → 143 → 144 → 147, one per card). Every one
 *     of those was computed against the stale pair count above, so they were
 *     arithmetic on a wrong base and are NOT re-derivable from this file; objectui#7352
 *     contract review replaced the chain with a measurement, which then rotted the
 *     same way the count under it did. ⛔ Do not restart the chain and ⛔ do not
 *     restate the difference as a digit — subtract the union from the registry count,
 *     both read from the file, which is what the census does.
 *   - **the pairs with no `KnownDrift` entry** — the population minus that ledger,
 *     the "pairs with no entry" `LedgerMismatch` speaks of. Derived by the same
 *     census, and likewise not written down here.
 *
 * ## Two ratchets, because the forward comparison has two halves
 *
 * The forward comparison runs over the UNION of the mirror's keys and the
 * declaration's, and a declared key can fail it in two structurally different ways:
 * the mirror declares the key and REFUSES its declared type (`NarrowerThanDeclared`
 * → `KnownDrift`), or the mirror has never heard of the key at all
 * (`UnmirroredDeclaredKeys` → `UnmirroredDeclared`). The second half was invisible
 * until objectui#6058 — an unmirrored key did not compare unequal, it left the
 * comparison entirely — so it is ledgered separately, seeded at its own measured
 * debt, and `KnownDrift` keeps its meaning and its citable history untouched.
 *
 * The second half is itself recorded in TWO ledgers, because its keys do not share
 * a remedy (objectui#6152). `UnmirroredDeclared` holds the keys where MIRRORING is
 * the fix; `RuntimeOnlyDeclared` holds callback-shaped keys that are runtime slots
 * and must never be mirrored at all — plus, since objectui#6152 round 3, the
 * non-callback runtime slots `RuntimeOnlyNamedAllowList` names one by one, each with
 * its reason. Both are reconciled against ONE measurement,
 * through the union at `RecordedUnmirrored`, so a key cannot fall between them.
 *
 * ## And a THIRD direction, which is a different comparison (objectui#7069)
 *
 * Both halves above are the FORWARD comparison: they ask whether everything the
 * declaration admits survives the mirror. Neither can see the reverse inequality —
 * a mirrored, data-shaped key whose mirror ACCEPTS a spelling the declaration
 * refuses. `NarrowerThanDeclared` finds the declared type fits, so the key is
 * silent; `UnmirroredDeclaredKeys` finds the key present in `.shape`, so it never
 * enters. The blindness is structural, not an omission, and it is pinned as such at
 * `assertionNarrowerOperatorIsBlindToAWidening` and
 * `assertionUnmirroredOperatorIsBlindToAWidening` rather than argued here.
 *
 * It is the direction that faces the AUTHOR: the mirror is what validates written
 * metadata, so a wider key returns a green `safeParse` on a spelling `tsc` refuses.
 * `WiderThanDeclaredKeys` → `WiderThanDeclared` is the third ledger, reconciled by
 * `assertionWiderMatchesLedger` and seeded at its own measured debt.
 *
 * ⚠️ Its measurement has a stated hole, and the hole is where the producer that
 * motivated the card lives: a slot spelled through `SchemaNodeSchema` reads
 * `unknown` on the input face, because that const is annotated `z.ZodType< any >`
 * to break its own recursion. `Unconstrained` excludes that face and says why; the
 * runtime leg at the bottom of this file bounds the excluded region by pinning that
 * every lazy node under the registry is that one const.
 *
 * ## And a FOURTH direction: MIRRORED but UNDECLARED (objectui#9711)
 *
 * ⚠️ **This heading exists because the three above were once cited for a guarantee
 * they do not give.** A maintainer ruling justified mirroring a twin "so the
 * `zod-mirror-parity` ratchet stays at zero drift" — and for a key the MIRROR
 * declares and the TypeScript twin does NOT, none of the three operators above could
 * see it. The ruling's INSTRUCTION was unaffected; only its stated reason was. That
 * asymmetry is the whole of objectui#9711, and the repair is an operator, not a
 * reworded sentence.
 *
 * Each of the three was blind for a DIFFERENT structural reason, which is why the
 * gap survived the card that closed its mirror image:
 *
 *   - `WithoutIndexSignature` strips any index signature (`BaseSchema`'s
 *     `[key: string]: any` until objectui#8347), so a key the declaration never
 *     states has nothing to be stripped FROM and `DeclaredKeys< D >` cannot
 *     enumerate it;
 *   - `UnmirroredDeclaredKeys` is declared-minus-mirrored — the other subtraction;
 *   - `WiderThanDeclaredKeys` maps over the INTERSECTION, so the key is outside its
 *     domain and LEAVES THE COMPARISON — the same shape objectui#6058 measured in
 *     the opposite direction, unfixed in this one.
 *
 * ⭐ This is the mirror image of a hole this file already closed BY NAME. objectui#6058
 * added `UnmirroredDeclaredKeys` for declared-but-unmirrored; its reverse stood open,
 * and nothing in this file said so. `MirroredUndeclaredKeys` → `MirroredUndeclared`
 * is the fourth ledger, reconciled by `assertionMirroredUndeclaredMatchesLedger` and
 * seeded at its own measured debt.
 *
 * All four operators are pinned on ONE synthetic pair at
 * `assertionMirroredUndeclaredOperatorReportsAMirroredOnlyKey` and the three
 * `…IsBlindToAMirroredOnlyKey` assertions beside it, each firing on a DIFFERENT key of
 * that pair — so every blindness claim is a zero read beside a LIT CONTROL on the same
 * instrument and the same corpus, rather than a zero read alone.
 *
 * ⛔ **The seed is a MEASUREMENT, not a worklist.** Declaring a key this direction
 * reports, on a published TypeScript face, ENLARGES AN ACCEPT SET — an at-tier
 * contract decision, per key, and deliberately outside the card that built the
 * instrument. Narrowing a mirror to make the direction read zero is the same decision
 * pointing the other way, and is also how a tool's output gets grepped away. ⛔ Neither
 * is the local fix for a red reconciliation.
 *
 * ⛔ No figure for this direction is written in this header. Its entry count and key
 * total live in exactly one place — the `MirroredUndeclared` docstring — and are
 * derived from that ledger's own AST by 'the fourth direction is enumerated and sized
 * at test time' at the bottom of this file. ⛔ Do not add a second copy here; that is
 * the defect objectui#7433, #7733, #8222 and #8243 each repaired one level up.
 *
 * ## KNOWN_DRIFT is a ratchet, not a waiver
 *
 * 55 of the registered pairs carry TYPE drift TODAY (measured, not assumed). Each is
 * pinned to its EXACT drifted key set, so the entry fails when new drift appears on
 * that mirror AND when the recorded drift is fixed — a stale entry cannot rot
 * quietly. Correcting them is not one change: the pairs below split into DISJOINT
 * vocabularies where one side is dead, required-vs-optional mismatches (an EMPTY
 * class since objectui#6033 made its last two keys optional on the mirror), structural
 * pairs that ride @objectstack/spec unification (objectui#2231), and one DELIBERATE
 * divergence that must stay expressible (`PageNodeSchema.pageType`). Each carries
 * its measurement and its reason inline.
 *
 * It was 17 until objectui#5927 landed the seven STRICT WIDENINGS (group A of that
 * card's grouping) — the class where the TS side is simply a superset and the
 * renderer was measured to implement the missing spellings. Four entries left the
 * ledger outright (`SelectSchema`, `ButtonGroupSchema`, `ObjectChartSchema`,
 * `ViewSwitcherSchema`) and two shrank to the keys that are NOT widenings
 * (`DataTableSchema` kept `rowActions`, `FormSchema` kept `fields`/`mode`). The
 * remaining classes are rulings, not edits, and are deliberately still here.
 *
 * Then 12 became 36 with objectui#6124, which is the opposite movement from #5927's
 * and must not be read as regression: 24 pairs ENTERED (and 4 grew) because the
 * ruling put a NAMED REFUSAL on the mirror side of 35 runtime-slot handler keys while
 * their TypeScript twins stay callable. That drift is the ruling's intended shape,
 * ledgered so the ratchet holds it exactly — a pair leaving this class means either
 * the mirror accepts a function again or a renderer lost its callback.
 *
 * It was 46 until objectui#10859 registered the three `@object-ui/plugin-ai` arms: three
 * pairs born ledgered, each for its `on*` handler keys. ⚠️ They are NOT the #6124 shape
 * this paragraph describes — the TypeScript twin of every one is `string`, not a
 * callable (objectui#10874 owns that face), and the `AIFormAssistSchema` pair is DEBT
 * rather than a runtime slot, because nothing reads its two keys at all.
 *
 * It is 48 since objectui#10874 settled that face per key: the `AIFormAssistSchema`
 * pair's two keys are `?: never` on the TypeScript side now, so that pair LEFT the
 * ledger, and the `AIRecommendationsSchema` / `NLQuerySchema` pairs JOINED the #6124
 * class above — their TypeScript twins declare the callables their components invoke
 * while the mirror refuses an authored value by name, exactly the shape that paragraph
 * describes.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import type { z } from 'zod';

import { AIConfigSchema, AIFieldSuggestionSchema, AIFormAssistSchema, AIRecommendationItemSchema, AIRecommendationsSchema, NLQueryResultSchema, NLQuerySchema } from '../zod/ai.zod.js';
import { AppComponentSchema, AppSchemaRendererNodeSchema, MenuItemSchema as AppMenuItemSchema, NavigationAreaSchema, NavigationItemSchema } from '../zod/app.zod.js';
import { BaseSchema, ComponentConfigSchema, ComponentInputSchema, ComponentMetaSchema, KeyedI18nLabelSchema, SchemaNodeSchema } from '../zod/base.zod.js';
import { CloudWorkspaceTimezoneNoticeSchema } from '../zod/cloud.zod.js';
import { ChecklistBlockItemSchema, ChecklistBlockSchema, HeroBlockSchema, StatBlockSchema, TileGridBlockAddTileSchema, TileGridBlockItemSchema, TileGridBlockSchema, UsageBarBlockSchema } from '../zod/product-blocks.zod.js';
import { RecordApprovalDecisionBlockSchema } from '../zod/record-approval-decision.zod.js';
import { RecordApprovalsBlockSchema, RecordAttachmentsBlockSchema } from '../zod/record-panels.zod.js';
import { CalendarEventSchema, CalendarViewSchema, CarouselItemSchema, CarouselSchema, ChatbotSchema, ChatbotEnhancedSchema, ChatbotFloatingSchema, ChatMessageSchema, ChatMessageSourceSchema, ChatToolInvocationSchema, DashboardComponentSchema, DashboardConfigSchema, DashboardWidgetConfigSchema, DashboardWidgetLayoutSchema, DashboardWidgetSchema, FilterBuilderSchema, FilterFieldSchema, KanbanCardSchema, KanbanColumnSchema, CardTemplateSchema, FilterGroupSchema } from '../zod/complex.zod.js';
import { ActionSchema, CRUDDialogSchema, DetailSchema } from '../zod/crud.zod.js';
import { AlertSchema, AvatarSchema, BadgeSchema, BarChartSchema, ChartDataSeriesSchema, ChartSchema, DataTableSchema, DrillDownConfigSchema, KbdSchema, ListItemSchema, ListSchema, MarkdownSchema, PivotTableSchema, StaticTableColumnSchema, StatisticSchema, TableColumnSchema, TableSchema, TimelineEventSchema, TimelineFeedItemSchema, TimelineGanttItemBarSchema, TimelineGanttItemSchema, TimelineSchema, TreeNodeSchema, TreeViewSchema } from '../zod/data-display.zod.js';
import { BPMNEdgeSchema, BPMNLaneSchema, BPMNNodeSchema, DataModelDesignerSchema, DataModelEntitySchema, DataModelFieldSchema, DataModelRelationshipSchema, DesignerCanvasConfigSchema, DesignerComponentSchema, DesignerFieldDefinitionSchema, DesignerFieldOptionSchema, DesignerPaletteCategorySchema, DesignerPaletteItemSchema, DesignerPositionSchema, FieldDesignerSchema, ObjectDefinitionSchema, ObjectManagerSchema, PageDesignerSchema, ProcessDesignerSchema, ReportDesignerElementSchema, ReportDesignerSchema, ReportDesignerSectionSchema } from '../zod/designer.zod.js';
import { AccordionItemSchema, AccordionSchema, CollapsibleSchema, ToggleGroupItemSchema, ToggleGroupSchema } from '../zod/disclosure.zod.js';
import { EmptySchema, LoadingSchema, ProgressSchema, SkeletonSchema, SonnerSchema, SpinnerSchema, ToasterSchema, ToastSchema } from '../zod/feedback.zod.js';
import { ButtonSchema, CalendarSchema, CheckboxSchema, CodeEditorSchema, ComboboxOptionSchema, ComboboxSchema, CommandGroupSchema, CommandItemSchema, CommandSchema, DatePickerSchema, FieldConditionSchema, FieldConstraintsSchema, FileUploadSchema, FormFieldSchema, FormSchema, InputOTPSchema, InputSchema, InputShorthandSchema, LabelSchema, RadioGroupSchema, RadioOptionSchema, SelectOptionSchema, SelectSchema, SliderSchema, SwitchSchema, TextareaSchema, ToggleSchema, UiCalendarSchema } from '../zod/form.zod.js';
import { AspectRatioSchema, BoxSchema, CardSchema, ContainerSchema, DivSchema, FlexSchema, GridSchema, HtmlElementSchema, IconSchema, ImageSchema, PageNodeRegionSchema, SemanticElementSchema, PageNodeSchema, ResizablePanelSchema, ResizableSchema, ScrollAreaSchema, SeparatorSchema, StackSchema, TabItemSchema, TabsSchema, TextSchema, TextSpanSchema } from '../zod/layout.zod.js';
import { BreadcrumbItemSchema, BreadcrumbSchema, ButtonGroupButtonSchema, ButtonGroupSchema, HeaderBarSchema, NavigationMenuItemSchema, NavigationMenuSchema, PaginationSchema, SidebarSchema } from '../zod/navigation.zod.js';
import { ObjectCalendarSchema, ObjectChartSchema, ObjectDataTableSchema, ObjectFormSchema, ObjectGallerySchema, ObjectGanttSchema, ObjectGridSchema, ObjectKanbanSchema, ObjectMapConfigSchema, ObjectMapSchema, ObjectTreeSchema, ObjectViewSchema, SortConfigSchema } from '../zod/objectql.zod.js';
import { AlertDialogSchema, ContextMenuSchema, DialogSchema, DrawerSchema, DropdownMenuSchema, HoverCardSchema, MenubarMenuSchema, MenubarSchema, MenuItemSchema as OverlayMenuItemSchema, PopoverSchema, SheetSchema, TooltipSchema } from '../zod/overlay.zod.js';
import { ReportBuilderSchema, ReportComponentSchema, ReportExportConfigSchema, ReportFieldSchema, ReportFilterSchema, ReportGroupBySchema, ReportSectionSchema, ReportViewerSchema } from '../zod/reports.zod.js';
import { DetailSectionNodeSchema, DetailViewFieldSchema, DetailViewSchema, DetailViewSectionSchema, DetailViewTabSchema, FilterUISchema, SortUISchema, ViewSwitcherSchema } from '../zod/views.zod.js';

import type { AIConfig as Ts_AIConfig, AIFieldSuggestion as Ts_AIFieldSuggestion, AIFormAssistSchema as Ts_AIFormAssistSchema, AIRecommendationItem as Ts_AIRecommendationItem, AIRecommendationsSchema as Ts_AIRecommendationsSchema, NLQueryResult as Ts_NLQueryResult, NLQuerySchema as Ts_NLQuerySchema } from '../ai';
import type { AppComponentSchema as Ts_AppComponentSchema, AppSchemaRendererNodeSchema as Ts_AppSchemaRendererNodeSchema, NavigationArea as Ts_NavigationArea } from '../app';
import type { BaseSchema as Ts_BaseSchema, ComponentConfig as Ts_ComponentConfig, ComponentInput as Ts_ComponentInput, ComponentMeta as Ts_ComponentMeta, KeyedI18nLabel as Ts_KeyedI18nLabel } from '../base';
import type { CloudWorkspaceTimezoneNoticeSchema as Ts_CloudWorkspaceTimezoneNoticeSchema } from '../cloud';
import type { ChecklistBlockItem as Ts_ChecklistBlockItem, ChecklistBlockSchema as Ts_ChecklistBlockSchema, HeroBlockSchema as Ts_HeroBlockSchema, StatBlockSchema as Ts_StatBlockSchema, TileGridBlockAddTile as Ts_TileGridBlockAddTile, TileGridBlockItem as Ts_TileGridBlockItem, TileGridBlockSchema as Ts_TileGridBlockSchema, UsageBarBlockSchema as Ts_UsageBarBlockSchema } from '../product-blocks';
import type { RecordApprovalDecisionBlockSchema as Ts_RecordApprovalDecisionBlockSchema } from '../record-approval-decision';
import type { RecordApprovalsBlockSchema as Ts_RecordApprovalsBlockSchema, RecordAttachmentsBlockSchema as Ts_RecordAttachmentsBlockSchema } from '../record-panels';
import type { CalendarEvent as Ts_CalendarEvent, CalendarViewSchema as Ts_CalendarViewSchema, CarouselItem as Ts_CarouselItem, CarouselSchema as Ts_CarouselSchema, ChatbotSchema as Ts_ChatbotSchema, ChatbotEnhancedSchema as Ts_ChatbotEnhancedSchema, ChatbotFloatingSchema as Ts_ChatbotFloatingSchema, ChatMessage as Ts_ChatMessage, ChatMessageSource as Ts_ChatMessageSource, ChatToolInvocation as Ts_ChatToolInvocation, DashboardComponentSchema as Ts_DashboardComponentSchema, DashboardWidgetLayout as Ts_DashboardWidgetLayout, DashboardWidgetSchema as Ts_DashboardWidgetSchema, FilterBuilderSchema as Ts_FilterBuilderSchema, FilterField as Ts_FilterField, KanbanCard as Ts_KanbanCard, KanbanColumn as Ts_KanbanColumn, CardTemplate as Ts_CardTemplate } from '../complex';
import type { BPMNEdge as Ts_BPMNEdge, BPMNLane as Ts_BPMNLane, BPMNNode as Ts_BPMNNode, DashboardConfig as Ts_DashboardConfig, DashboardWidgetConfig as Ts_DashboardWidgetConfig, DataModelDesignerSchema as Ts_DataModelDesignerSchema, DataModelEntity as Ts_DataModelEntity, DataModelField as Ts_DataModelField, DataModelRelationship as Ts_DataModelRelationship, DesignerCanvasConfig as Ts_DesignerCanvasConfig, DesignerFieldDefinition as Ts_DesignerFieldDefinition, DesignerFieldOption as Ts_DesignerFieldOption, DesignerPaletteCategory as Ts_DesignerPaletteCategory, DesignerPaletteItem as Ts_DesignerPaletteItem, DesignerPosition as Ts_DesignerPosition, FieldDesignerSchema as Ts_FieldDesignerSchema, ObjectDefinition as Ts_ObjectDefinition, ObjectManagerSchema as Ts_ObjectManagerSchema, PageDesignerSchema as Ts_PageDesignerSchema, ProcessDesignerSchema as Ts_ProcessDesignerSchema, ReportDesignerElement as Ts_ReportDesignerElement, ReportDesignerSchema as Ts_ReportDesignerSchema, ReportDesignerSection as Ts_ReportDesignerSection } from '../designer';
import type { CRUDDialogSchema as Ts_CRUDDialogSchema, DetailSchema as Ts_DetailSchema } from '../crud';
import type { AlertSchema as Ts_AlertSchema, AvatarSchema as Ts_AvatarSchema, BadgeSchema as Ts_BadgeSchema, BarChartSchema as Ts_BarChartSchema, ChartDataSeries as Ts_ChartDataSeries, ChartSchema as Ts_ChartSchema, DataTableSchema as Ts_DataTableSchema, DrillDownConfig as Ts_DrillDownConfig, KbdSchema as Ts_KbdSchema, ListItem as Ts_ListItem, ListSchema as Ts_ListSchema, MarkdownSchema as Ts_MarkdownSchema, PivotTableSchema as Ts_PivotTableSchema, StaticTableColumn as Ts_StaticTableColumn, StatisticSchema as Ts_StatisticSchema, TableColumn as Ts_TableColumn, TableSchema as Ts_TableSchema, TimelineEvent as Ts_TimelineEvent, TimelineFeedItem as Ts_TimelineFeedItem, TimelineGanttItem as Ts_TimelineGanttItem, TimelineGanttItemBar as Ts_TimelineGanttItemBar, TimelineSchema as Ts_TimelineSchema, TreeViewSchema as Ts_TreeViewSchema, BreadcrumbItem as Ts_BreadcrumbItem, BreadcrumbSchema as Ts_BreadcrumbSchema } from '../data-display';
import type { AccordionItem as Ts_AccordionItem, AccordionSchema as Ts_AccordionSchema, CollapsibleSchema as Ts_CollapsibleSchema, ToggleGroupItem as Ts_ToggleGroupItem, ToggleGroupSchema as Ts_ToggleGroupSchema } from '../disclosure';
import type { EmptySchema as Ts_EmptySchema, LoadingSchema as Ts_LoadingSchema, ProgressSchema as Ts_ProgressSchema, SkeletonSchema as Ts_SkeletonSchema, SonnerSchema as Ts_SonnerSchema, SpinnerSchema as Ts_SpinnerSchema, ToasterSchema as Ts_ToasterSchema, ToastSchema as Ts_ToastSchema } from '../feedback';
import type { ButtonSchema as Ts_ButtonSchema, CalendarSchema as Ts_CalendarSchema, CheckboxSchema as Ts_CheckboxSchema, CodeEditorSchema as Ts_CodeEditorSchema, ComboboxOption as Ts_ComboboxOption, ComboboxSchema as Ts_ComboboxSchema, CommandGroup as Ts_CommandGroup, CommandItem as Ts_CommandItem, CommandSchema as Ts_CommandSchema, DatePickerSchema as Ts_DatePickerSchema, FieldCondition as Ts_FieldCondition, FieldValidationRules as Ts_FieldValidationRules, FileUploadSchema as Ts_FileUploadSchema, FormField as Ts_FormField, FormSchema as Ts_FormSchema, InputOTPSchema as Ts_InputOTPSchema, InputSchema as Ts_InputSchema, InputShorthandSchema as Ts_InputShorthandSchema, UiCalendarSchema as Ts_UiCalendarSchema, LabelSchema as Ts_LabelSchema, RadioGroupSchema as Ts_RadioGroupSchema, RadioOption as Ts_RadioOption, SelectOption as Ts_SelectOption, SelectSchema as Ts_SelectSchema, SliderSchema as Ts_SliderSchema, SwitchSchema as Ts_SwitchSchema, TextareaSchema as Ts_TextareaSchema, ToggleSchema as Ts_ToggleSchema } from '../form';
import type { AspectRatioSchema as Ts_AspectRatioSchema, BoxSchema as Ts_BoxSchema, CardSchema as Ts_CardSchema, ContainerSchema as Ts_ContainerSchema, DivSchema as Ts_DivSchema, FlexSchema as Ts_FlexSchema, GridSchema as Ts_GridSchema, HtmlElementSchema as Ts_HtmlElementSchema, IconSchema as Ts_IconSchema, ImageSchema as Ts_ImageSchema, SemanticElementSchema as Ts_SemanticElementSchema, PageNodeRegion as Ts_PageNodeRegion, PageNodeSchema as Ts_PageNodeSchema, ResizablePanel as Ts_ResizablePanel, ResizableSchema as Ts_ResizableSchema, ScrollAreaSchema as Ts_ScrollAreaSchema, SeparatorSchema as Ts_SeparatorSchema, StackSchema as Ts_StackSchema, TabItem as Ts_TabItem, TabsSchema as Ts_TabsSchema, TextSchema as Ts_TextSchema, TextSpanSchema as Ts_TextSpanSchema } from '../layout';
import type { ButtonGroupButton as Ts_ButtonGroupButton, ButtonGroupSchema as Ts_ButtonGroupSchema, HeaderBarSchema as Ts_HeaderBarSchema, NavigationMenuSchema as Ts_NavigationMenuSchema, PaginationSchema as Ts_PaginationSchema, SidebarSchema as Ts_SidebarSchema } from '../navigation';
import type { ObjectCalendarSchema as Ts_ObjectCalendarSchema, ObjectChartSchema as Ts_ObjectChartSchema, ObjectDataTableSchema as Ts_ObjectDataTableSchema, ObjectFormSchema as Ts_ObjectFormSchema, ObjectGallerySchema as Ts_ObjectGallerySchema, ObjectGanttSchema as Ts_ObjectGanttSchema, ObjectGridSchema as Ts_ObjectGridSchema, ObjectKanbanSchema as Ts_ObjectKanbanSchema, ObjectMapConfig as Ts_ObjectMapConfig, ObjectMapSchema as Ts_ObjectMapSchema, ObjectTreeSchema as Ts_ObjectTreeSchema, ObjectViewSchema as Ts_ObjectViewSchema, SortConfig as Ts_SortConfig } from '../objectql';
import type { AlertDialogSchema as Ts_AlertDialogSchema, ContextMenuSchema as Ts_ContextMenuSchema, DialogSchema as Ts_DialogSchema, DrawerSchema as Ts_DrawerSchema, DropdownMenuSchema as Ts_DropdownMenuSchema, HoverCardSchema as Ts_HoverCardSchema, MenubarMenu as Ts_MenubarMenu, MenubarSchema as Ts_MenubarSchema, PopoverSchema as Ts_PopoverSchema, SheetSchema as Ts_SheetSchema, TooltipSchema as Ts_TooltipSchema } from '../overlay';
import type { ReportBuilderSchema as Ts_ReportBuilderSchema, ReportComponentSchema as Ts_ReportComponentSchema, ReportExportConfig as Ts_ReportExportConfig, ReportField as Ts_ReportField, ReportFilter as Ts_ReportFilter, ReportGroupBy as Ts_ReportGroupBy, ReportSection as Ts_ReportSection, ReportViewerSchema as Ts_ReportViewerSchema } from '../reports';
import type { DetailSectionNodeSchema as Ts_DetailSectionNodeSchema, DetailViewField as Ts_DetailViewField, DetailViewSchema as Ts_DetailViewSchema, DetailViewSection as Ts_DetailViewSection, DetailViewTab as Ts_DetailViewTab, FilterUISchema as Ts_FilterUISchema, SortUISchema as Ts_SortUISchema, ViewSwitcherSchema as Ts_ViewSwitcherSchema } from '../views';

/* ── Type-level helpers (objectui#5680) ─────────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
export type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
export type Expect< T extends true > = T;

/** The mirror's own shape, or `never` if it exposes none. */
type ShapeOf< M > = M extends { shape: infer S } ? S : never;
/** What a shape entry ACCEPTS (input side, so `.optional()` shows). */
type InputOf< T > = T extends z.ZodType ? z.input< T > : never;

/** The mirror's DECLARED keys, read from its own shape. */
export type MirroredKeys< M > = Extract< keyof ShapeOf< M >, string >;

/**
 * Every key whose DECLARED type the mirror would refuse.
 *
 * The tuple wrappers keep the check non-distributive: a declared type is often a
 * union, and a bare `extends` would ask the question limb-by-limb and pass as long
 * as ONE limb fit.
 *
 * Only keys present on BOTH sides are compared. A key the mirror does not declare
 * is not narrow — `BaseSchema` is `.passthrough()`, so an undeclared key rides
 * through. The opposite INEQUALITY — the mirror accepting what the declaration
 * refuses — is a different class and is not what THIS type measures;
 * `WiderThanDeclaredKeys` below measures it, and
 * `assertionNarrowerOperatorIsBlindToAWidening` pins that this one cannot.
 */
export type NarrowerThanDeclared< M, D > = {
  [K in MirroredKeys< M > & keyof D]: [D[K]] extends [InputOf< ShapeOf< M >[K] >] ? never : K;
}[MirroredKeys< M > & keyof D];

/**
 * A declaration's OWN declared members, with any index signature stripped.
 *
 * `keyof D` was unusable on this population while most component declarations
 * extended `BaseSchema`'s `[key: string]: any` (objectui#5155, removed by
 * objectui#8347): a string index signature ABSORBS every literal name —
 * `keyof ObjectGanttSchema` resolved to bare `string` — and a declaration that
 * carries its own signature still does. Measured, not assumed, at the time:
 *
 *     declare const bare: keyof ObjectGanttSchema;
 *     const _: never = bare;
 *     // -> Type 'keyof ObjectGanttSchema' is not assignable to type 'never'.
 *     //      Type 'string' is not assignable to type 'never'.
 *
 * A homomorphic mapped type is the escape: TypeScript maps declared members and
 * index signatures SEPARATELY, so remapping the index-signature keys to `never`
 * leaves the literal members — INCLUDING the ones inherited from `BaseSchema`.
 * Same probe against this alias resolves the 36 literal names of
 * `ObjectGanttSchema` and the 21 of `BaseSchema` (20 until objectui#6357 added `bind`).
 *
 * ⚠️ This lifts the ceiling on what the GUARD can READ, not on what a mirror can
 * REJECT. #5155's ceiling stands: `BaseSchema` is `.passthrough()`, so declaring a
 * key still does not buy rejection of a misspelling. The two are different
 * questions and only the first one is this file's.
 */
type WithoutIndexSignature< D > = {
  [K in keyof D as string extends K ? never : number extends K ? never : K]: D[K];
};

/** The declaration's DECLARED keys, read without `keyof` on the resolved key set. */
export type DeclaredKeys< D > = Extract< keyof WithoutIndexSignature< D >, string >;

/**
 * Declared on the TS side and ABSENT from the mirror's `.shape` entirely.
 *
 * This is the half `NarrowerThanDeclared` above cannot see, and the reason is
 * structural rather than a threshold: that type maps over the INTERSECTION
 * `MirroredKeys< M > & keyof D`, so a declared key the mirror never mentions is
 * not compared and found equal — it LEAVES THE COMPARISON. objectui#6058 measured
 * the blind spot with a two-instruments ablation: ten keys declared on
 * `ObjectGanttSchema` and stripped from its mirror left both halves of this guard
 * green (runtime 5 passed EXIT=0, compile-time EXIT=0) while
 * `gantt-declared-keys.test.ts` over the same tree read 2 failed | 7 passed EXIT=1.
 *
 * It is a real defect in the pair, not noise from the instrument: the published
 * TypeScript invites an author to write the key and the published validator has
 * never heard of it. Under `.passthrough()` the value rides through UNVALIDATED
 * (`readOnly: 'yes'` parses green); under a mirror that is not passthrough it is
 * refused outright. Either way `declared !== enforced`.
 */
export type UnmirroredDeclaredKeys< M, D > = Exclude< DeclaredKeys< D >, MirroredKeys< M > >;

/**
 * Mirrored on the zod side and ABSENT from the declaration's own members entirely.
 *
 * The REVERSE of `UnmirroredDeclaredKeys` directly above, and the direction this
 * file measured in no operator until objectui#9711 added this one. The three that
 * stood before it are each blind to it, for three DIFFERENT structural reasons —
 * which is why the gap survived the card that closed its mirror image:
 *
 *   - `WithoutIndexSignature` strips any index signature (`BaseSchema`'s
 *     `[key: string]: any` until objectui#8347), so a key the declaration never
 *     states has nothing to be stripped FROM — it is simply not a member, and `DeclaredKeys< D >` cannot enumerate it;
 *   - `UnmirroredDeclaredKeys` is `Exclude< DeclaredKeys< D >, MirroredKeys< M > >`,
 *     declared-minus-mirrored — the other subtraction by construction;
 *   - `WiderThanDeclaredKeys` maps over `MirroredKeys< M > & DeclaredKeys< D >`, the
 *     INTERSECTION, so a mirrored-but-undeclared key is outside its domain and
 *     LEAVES THE COMPARISON exactly as objectui#6058's declared-but-unmirrored keys
 *     left `NarrowerThanDeclared`'s.
 *
 * `assertionMirroredUndeclaredOperatorReports…` and the three blindness pins beside
 * it are the recognition cases; they are what distinguishes this operator from one
 * that reports nothing because it can report nothing.
 *
 * Why it is a defect and not bookkeeping: the two faces are published together, and
 * this direction is the one an AUTHOR meets first. The mirror hands a green
 * `safeParse` to a key the published TypeScript does not declare, so a metadata
 * author writing it gets a validator's blessing for a spelling the declared surface
 * never invited — and under `BaseSchema`'s `.passthrough()` index signature `tsc`
 * does not object either, so nothing at all tells them the key is outside the
 * contract. ⛔ The remedy is NOT automatic: DECLARING such a key on a published
 * TypeScript face ENLARGES AN ACCEPT SET and is a contract decision, so this
 * operator's output is a ledgered measurement and each key is a separate question.
 */
export type MirroredUndeclaredKeys< M, D > = Exclude< MirroredKeys< M >, DeclaredKeys< D > >;

/** `any`, told apart from `unknown` — `[unknown] extends [T]` accepts both. */
export type IsAny< T > = 0 extends 1 & T ? true : false;

/**
 * A mirror slot whose static INPUT face carries no information: `unknown`, `any`,
 * or a list of either.
 *
 * This is the hole in `WiderThanDeclaredKeys` below. A recursive mirror annotated
 * `z.ZodType< any >` to break the cycle inside its own `z.lazy` gets `unknown` for
 * its INPUT parameter from zod 4, so every slot spelled through it reads `unknown`
 * (or `unknown[]`) — wider than every declaration BY DEFINITION, and silent about
 * what the mirror accepts at RUNTIME, where the lazy union does validate. Comparing
 * there would report the annotation and not the accept-set, so those keys are not
 * measured. The runtime leg at the bottom of this file is what bounds the region.
 *
 * ⭐ The hole was TEN consts wide and objectui#7760 took it to THREE. That card gave
 * seven of them their existing TypeScript declaration as both type arguments, on the
 * maintainer ruling of decision batch #69 — no runtime accept set moved and no
 * declaration moved, so what changed is only what this comparison can SEE. The three
 * that kept the annotation each refused the argument for a MEASURED reason, recorded
 * on that card: `app.zod.ts#NavigationItemSchema` and
 * `complex.zod.ts#FilterBuilderConditionSchema` because the mirror already accepts
 * more than the declaration states (`id` optional against a required one; `is_null` /
 * `is_not_null` against `FilterBuilderOperator` — the reading of that card's day: since
 * objectui#9559 the declaration is the spec's `ViewFilterOperator`, which carries both,
 * and what the mirror accepts beyond it is the spec's legacy operator aliases, which it
 * normalises on parse), so the assignment `tsc` performs to
 * check the annotation IS this ledger's comparison and it fails; and
 * `complex.zod.ts#FilterGroupSchema` transitively, since its `conditions` arm is the
 * first of those two. ⛔ None of the three is an inference cycle — that was the risk
 * the ruling time-boxed a trial for, and it did not fire on any of the ten.
 *
 * ⚠️ What that bought, and it is the point of the card: the producer objectui#7069
 * called systematic — the `z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)])`
 * spelling — is INSIDE the comparison now, and the three keys it had been hiding are
 * in the ledger below. The exclusion is still live, so this predicate is not dead
 * code; it now covers the three consts above rather than the whole schema-node face.
 *
 * ⚠️ It is deliberately NOT recursive, and that is a measurement rather than a
 * preference. A version descending into object properties and array elements was
 * written and withdrawn: on the pairs with the most structure it drove the whole
 * `WiderOf< K >` instantiation to `any`, and `any` is assignable to `never`, so the
 * invariant below went SILENTLY GREEN on precisely those pairs — a guard that
 * cannot fail, wearing the shape of a stricter one.
 * `assertionNoVacuousWiderMeasurement` exists because of that attempt and pins the
 * failure mode, so the next deeper predicate cannot land unnoticed.
 *
 * What the shallow form costs: an `unknown` NESTED one level further down — a
 * schema node inside an array element's property — is not excluded, so those
 * entries record the annotation rather than an accept-set gap. They are seeded and
 * labelled, under the ledger's SCHEMA-NODE class note.
 */
export type Unconstrained< T > =
  [unknown] extends [T] ? true
  : true extends (NonNullable< T > extends readonly (infer E)[] ? ([unknown] extends [E] ? true : false) : false)
    ? true
  : false;

/**
 * The two premises the exclusion rests on, asserted rather than described — and they
 * are OPPOSITE premises, which is why there are two lines and not one.
 *
 * This pin read "`Unconstrained< z.input< typeof SchemaNodeSchema > >` is `true`"
 * until objectui#7760, and it fired on that card's first compile, exactly as its own
 * note said it would. It is kept, INVERTED: `SchemaNodeSchema` carries its declaration
 * on both faces now, and a revert to an unconstrained annotation would silently drop
 * every single-or-list slot back out of the comparison — 19 ledger keys' worth, green
 * the whole way, because a key that leaves a comparison reports nothing.
 *
 * The second line holds the other half. `NavigationItemSchema` is one of the three
 * consts that refused the argument, so the exclusion still has live members and
 * `Unconstrained` is still load-bearing. If it ever stops being unconstrained — that
 * const taking its declaration too, or its mirror narrowed to fit — this fails, and
 * the exclusion and the ledger's SCHEMA-NODE class with it have to be re-derived once
 * more.
 */
export type assertionSchemaNodeFaceIsConstrained =
  Expect< Equal< Unconstrained< z.input< typeof SchemaNodeSchema > >, false > >;

export type assertionRetainedAnnotationFaceIsUnconstrained =
  Expect< Equal< Unconstrained< z.input< typeof NavigationItemSchema > >, true > >;

/* ── The OPEN-RECORD discriminator (objectui#8517) ──────────────────────────── */

/**
 * `T`'s union arms that are OPEN RECORDS — a string index signature and NO literal
 * members of their own. That is exactly the `z.record(z.string(), V)` shape and
 * nothing else.
 *
 * ⚠️ Both halves are load-bearing, and the second one is why this is not simply
 * `string extends keyof T`. Measured in this package's test program: a zod LOOSE
 * object (what `.passthrough()` produces, and what `BaseSchema` is) also answers
 * `true` to `string extends keyof T` — `keyof z.input< typeof BaseSchema >`
 * resolves to bare `string`. Reporting on that predicate alone would report every
 * slot spelled as a nested passthrough object in this repo, which is the caricature
 * this direction has to avoid: a guard that reports everything makes the ledger
 * useless while passing any single-instance assertion. `DeclaredKeys` tells the two
 * apart because it strips the index signature and keeps the members —
 * `DeclaredKeys< z.input< typeof BaseSchema > >` resolves to that schema's literal
 * names, while `DeclaredKeys< Record< string, number > >` is `never`.
 *
 * The `IsAny` guard is not defensive tidying: `keyof any` is
 * `string | number | symbol`, so `any` answers `true` to the index-signature half
 * and `never` to the member half, and would read as an open record on every face
 * `Unconstrained` exists to keep out.
 */
type OpenRecordArms< T > =
  IsAny< T > extends true
    ? never
    : T extends unknown
      ? string extends keyof T
        ? [DeclaredKeys< T >] extends [never] ? T : never
        : never
      : never;

/**
 * `T`'s union arms that state a FINITE key set — an object, not an array, literal
 * members, no string index signature. `Partial[Record[BreakpointName, number]]` is
 * one; `object`, `{}` and `unknown` are not, and that is the whole reason this half
 * exists: a declaration that admits an ARBITRARY object refuses no key, so an
 * open-record mirror against it is not wider. Requiring one finite-keyed arm is what
 * holds the clause below to the unambiguous case — the declaration names a key set
 * and the mirror does not.
 *
 * ⚠️ `T extends object` is not tidying, and it was added because the pin below
 * caught the clause without it. `keyof number` resolves to that primitive's METHOD
 * names, so `DeclaredKeys[number]` is not `never` and a bare `number` arm reads as a
 * finite-keyed object. A declaration spelled `number | object` — permissive, refusing
 * no key — would then be reported against an open-record mirror on the strength of
 * its `number` arm alone. Arrays are excluded for the same reason (`length`,
 * `toString`), and `assertionPermissiveDeclarationIsNotWidened` covers both.
 *
 * ⚠️ Written with SQUARE brackets in this docblock on purpose (objectui#8517): the
 * same shape in the issue text is deleted by GitHub's body sanitizer, and the two
 * spellings have to stay legible side by side while this is being read.
 */
type FiniteKeyedArms< T > =
  IsAny< T > extends true
    ? never
    : T extends unknown
      ? T extends object
        ? T extends readonly unknown[]
          ? never
          : string extends keyof T
            ? never
            : [DeclaredKeys< T >] extends [never] ? never : T
        : never
      : never;

/**
 * The mirror admits an ARBITRARY string key at a position where the declaration
 * names a finite key set — the widening objectui#8517 measured as invisible to the
 * assignability test on its own.
 *
 * ## Why the assignability test cannot see it
 *
 * `Record[string, number]` and `Partial[Record[BreakpointName, number]]` are
 * MUTUALLY assignable: TypeScript grants an implicit index signature to mapped and
 * anonymous object types, so the partial record fits the open one, and the open
 * one fits the partial one because every member it could supply is `number` where
 * `number | undefined` is wanted. ⇒ `[A] extends [B]` and `[B] extends [A]` are
 * BOTH true, so neither this direction's operator nor `NarrowerThanDeclared`
 * reports the pair. That is not one direction missing a case; the pair is
 * invisible to that predicate outright. Measured on `GridSchema.columns` at this
 * card's base (`3f775eeb8`), where `safeParse({ type: 'grid', columns: { xxl: 6 } })`
 * returned green and `tsc` refused the same node. ⚠️ That reading is HISTORICAL:
 * objectui#8516 (`d4733f27e`) narrowed that mirror to a `z.partialRecord`, so the
 * pair is clean on both faces today and this clause is what would report it if the
 * mirror were widened back. ⛔ Do not restate it as a live one.
 *
 * ## The bound, stated because a predicate that does not state one reads as wider
 *
 * This looks at the TOP-LEVEL union arms of the slot and no deeper — not into array
 * elements, not into an arm's own properties. Same shallowness as `Unconstrained`
 * above and for the same reason: a recursive version of this predicate has the
 * failure mode that one had, where descending drove whole instantiations to `any`
 * and the invariant went silently green on exactly the pairs with the most
 * structure. ⇒ An open record NESTED one level down is NOT reported, and a future
 * card widening the reach has to re-run the census, not just the pins.
 *
 * ## Where it sits in the operator, and why that placement is the guarantee
 *
 * It runs ONLY on the branch the assignability test already called clean. A key
 * this file reports today therefore cannot stop being reported by anything here —
 * the change is additive by construction, not by assertion. Every ledgered pair is
 * reconciled against the measurement anyway by `assertionWiderMatchesLedger`, and
 * the additivity itself is pinned on a synthetic carrying BOTH classes at once
 * (`assertionOpenRecordClauseIsAdditive`), because a guarantee nobody has watched
 * fail is not a guarantee. ⛔ A bare count of the pairs stood here and was removed:
 * no pin reached it, which is the objectui#7733 shape this file is about.
 */
type MirrorAdmitsOpenRecord< MirrorIn, DeclaredType > =
  Unconstrained< DeclaredType > extends true
    ? false
    : [OpenRecordArms< MirrorIn >] extends [never]
      ? false
      : [OpenRecordArms< DeclaredType >] extends [never]
        ? [FiniteKeyedArms< DeclaredType >] extends [never] ? false : true
        : false;

/**
 * Every key whose mirror ACCEPTS a spelling the declaration REFUSES.
 *
 * The reverse inequality of `NarrowerThanDeclared`, and the direction objectui#7069
 * filed as invisible BY CONSTRUCTION to every ledger that stood before it.
 * `NarrowerThanDeclared` asks whether the DECLARED type fits through the mirror;
 * this asks whether what the MIRROR accepts fits inside the declaration. The two
 * are independent — a pair can fail both (disjoint vocabularies), either, or
 * neither — which is why the reverse inequality never entered the forward
 * comparison, and `UnmirroredDeclaredKeys` cannot see it either because a wider key
 * IS mirrored and so never leaves the comparison. Both blindnesses are PINNED as
 * synthetic recognition cases below rather than asserted in prose.
 *
 * Why this direction is not cosmetic symmetry: the mirror is the AUTHORING
 * boundary. A wider key hands an author a green `safeParse` on a spelling `tsc`
 * refuses, so the two published faces disagree about the accept-set and the runtime
 * reader receives input the published types say cannot exist.
 *
 * `DeclaredKeys` and not `keyof D` supplies the declared half, for the reason
 * `WithoutIndexSignature` gives: a declaration carrying a string index signature
 * (as most did through `BaseSchema` until objectui#8347) resolves `D[K]` to `any`
 * for a key it does not really state — and `any` absorbs the comparison in this direction exactly as
 * silently as in the other one.
 */
export type WiderThanDeclaredKeys< M, D > = {
  [K in MirroredKeys< M > & DeclaredKeys< D >]:
    Unconstrained< InputOf< ShapeOf< M >[K] > > extends true
      ? never
      : [InputOf< ShapeOf< M >[K] >] extends [D[K]]
        ? MirrorAdmitsOpenRecord< InputOf< ShapeOf< M >[K] >, D[K] > extends true ? K : never
        : K;
}[MirroredKeys< M > & DeclaredKeys< D >];

/**
 * Reconcile ONE pair's measured key set against what a ledger records for it:
 * `never` when they agree, the pair key otherwise.
 *
 * Factored out and driven by synthetic pairs below rather than written inline, for
 * the reason objectui#6133 gives for exporting its `reconcileGuards`: **a run over
 * TODAY's tree can only ever show that today's tree is green.** A baseline that has
 * never been shown to FAIL is indistinguishable from no baseline, and no amount of
 * green CI tells the two apart. Recognition is pinned at
 * `assertionRatchet…` below, in every direction a ledger can be wrong.
 */
export type ReconcileAgainstLedger< K, Measured, Recorded > =
  Equal< Measured, Recorded > extends true ? never : K;

/* ── Recognition: the ratchet is shown to FAIL, in both directions ──────────── */

/** A pair whose measured set matches its ledger entry stays silent. */
export type assertionRatchetAcceptsAgreement =
  Expect< Equal< ReconcileAgainstLedger< 'p', 'a', 'a' >, never > >;

/**
 * …and so does a clean pair with no entry — the great majority of the population on
 * the `KnownDrift` half and on the unmirrored half alike. ⛔ Both counts are derived
 * by the runtime census (objectui#7433), never stepped and never quoted here.
 */
export type assertionRatchetAcceptsCleanPair =
  Expect< Equal< ReconcileAgainstLedger< 'p', never, never >, never > >;

/**
 * ⬆ GROWTH on a CLEAN pair — the property the whole seeding argument rests on. A
 * NEW declared-but-unmirrored key on a pair the ledger does not mention reddens it
 * immediately. This is why a seeded baseline is a FLOOR and not a waiver.
 */
export type assertionRatchetRejectsFreshDrift =
  Expect< Equal< ReconcileAgainstLedger< 'p', 'a', never >, 'p' > >;

/**
 * ⬆ GROWTH on a LEDGERED pair — an entry cannot absorb a second key, so drift
 * cannot be smuggled into a pair that already owes some. Read the other way round,
 * this is also the pin that a fact DELETED from the seed is not silently
 * re-acceptable: deleting `'a'` from a recorded `'a' | 'b'` leaves exactly this
 * shape, and it fails.
 */
export type assertionRatchetRejectsGrowth =
  Expect< Equal< ReconcileAgainstLedger< 'p', 'a' | 'b', 'a' >, 'p' > >;

/**
 * ⬇ SHRINK — a recorded key that has since been MIRRORED fails as STALE and names
 * its own pair. Without this the ledger rots into an allowlist nobody re-reads, and
 * the shrink-only promise becomes prose.
 */
export type assertionRatchetRejectsStaleKey =
  Expect< Equal< ReconcileAgainstLedger< 'p', 'a', 'a' | 'b' >, 'p' > >;

/** ⬇ SHRINK to nothing — a fully fixed pair fails until its entry is DELETED. */
export type assertionRatchetRejectsStaleEntry =
  Expect< Equal< ReconcileAgainstLedger< 'p', never, 'a' >, 'p' > >;

/* ── Recognition: the SPLIT unmirrored ledger, both directions (objectui#6152) ── */

/**
 * The unmirrored half reconciles one measurement against the UNION of two ledgers.
 * The pins above cover the shape `Recorded = one ledger`; these cover the shape it
 * actually has. `'onX'` stands for a callback-shaped key recorded in
 * `RuntimeOnlyDeclared`, `'a'` for an ordinary omission in `UnmirroredDeclared`.
 */
export type ReconcileAgainstSplitLedger< K, Measured, Ordinary, RuntimeOnly > =
  ReconcileAgainstLedger< K, Measured, Ordinary | RuntimeOnly >;

/** The two halves TOGETHER account for the measured set — silent. */
export type assertionSplitLedgerAcceptsBothHalves =
  Expect< Equal< ReconcileAgainstSplitLedger< 'p', 'a' | 'onX', 'a', 'onX' >, never > >;

/**
 * ⬆ GROWTH — a NEW callback-shaped declared-but-unmirrored key is NOT absorbed by
 * the runtime-only half. It reddens until someone files it, which is the property
 * that makes the new category a ratchet rather than a waiver: objectui#6152's
 * reclassification bought `UnmirroredDeclared` a smaller number, not a hole.
 */
export type assertionSplitLedgerRejectsFreshCallback =
  Expect< Equal< ReconcileAgainstSplitLedger< 'p', 'a' | 'onX' | 'onY', 'a', 'onX' >, 'p' > >;

/**
 * ⬇ SHRINK — a runtime-only key that has since LEFT the measurement (mirrored, or
 * the declaration removed) fails as STALE and names its own pair. Same shrink
 * discipline `UnmirroredDeclared` carries; a reclassified fact does not stop being
 * watched.
 */
export type assertionSplitLedgerRejectsStaleRuntimeOnly =
  Expect< Equal< ReconcileAgainstSplitLedger< 'p', 'a', 'a', 'onX' >, 'p' > >;

/**
 * ⚠️ The LIMIT of this reconciliation, pinned rather than left to be discovered:
 * it is BLIND to which half a key sits in. Moving a key between the ledgers changes
 * nothing here — so the union alone cannot keep the classification honest, and
 * without the shape pins below the new category would be a bucket anything could be
 * moved into. `assertionNoCallbackShapedKeyInUnmirroredDeclared` and
 * `assertionRuntimeOnlyIsCallbackShapedOrNamed` are what actually hold the split
 * (the second read `…IsCallbackShapedOnly` until objectui#6152 round 3 gave it the
 * named allow-list arm, `RuntimeOnlyNamedAllowList`).
 */
export type assertionSplitLedgerIsBlindToWhichHalf =
  Expect< Equal< ReconcileAgainstSplitLedger< 'p', 'onX', never, 'onX' >, never > >;

/* ── Recognition: the WIDER direction fires, and the other two stay blind ───── */

/**
 * A synthetic pair whose mirror accepts `string` where the declaration states two
 * literals, and whose other key agrees on both faces.
 *
 * The three assertions under it are the whole argument of objectui#7069 reduced to
 * one pair: the new operator REPORTS the widening, and both operators that stood
 * before it are silent on the same pair — not because the drift is small, but
 * because neither comparison is capable of expressing it.
 */
type SyntheticWiderMirror = { shape: { size: z.ZodString; count: z.ZodNumber } };
interface SyntheticNarrowerDeclaration { size: 'sm' | 'lg'; count: number }

/** The widening is reported: the measurement can fire at all. */
export type assertionWiderOperatorReportsAWidening =
  Expect< Equal< WiderThanDeclaredKeys< SyntheticWiderMirror, SyntheticNarrowerDeclaration >, 'size' > >;

/** The forward operator is blind to it — the declared type still fits through the mirror. */
export type assertionNarrowerOperatorIsBlindToAWidening =
  Expect< Equal< NarrowerThanDeclared< SyntheticWiderMirror, SyntheticNarrowerDeclaration >, never > >;

/** So is the unmirrored half — a wider key IS mirrored, so it never leaves the comparison. */
export type assertionUnmirroredOperatorIsBlindToAWidening =
  Expect< Equal< UnmirroredDeclaredKeys< SyntheticWiderMirror, SyntheticNarrowerDeclaration >, never > >;

/**
 * The unconstrained face is EXCLUDED — at the top level and one array deep — while
 * a concrete widening on the SAME pair is still reported.
 *
 * Both halves matter. Without the first, every schema-node slot reports the
 * `z.ZodType< any >` annotation as a finding; without the second, the exclusion is
 * a waiver that silences the pair.
 */
type SyntheticUnconstrainedMirror = {
  shape: { node: z.ZodUnknown; nodes: z.ZodArray< z.ZodUnknown >; size: z.ZodString };
};
interface SyntheticNodeDeclaration { node: { type: string }; nodes: { type: string }[]; size: 'sm' | 'lg' }

export type assertionUnconstrainedFaceIsExcludedButNotAWaiver =
  Expect< Equal< WiderThanDeclaredKeys< SyntheticUnconstrainedMirror, SyntheticNodeDeclaration >, 'size' > >;

/* ── Recognition: the OPEN-RECORD clause (objectui#8517) ────────────────────── */

/**
 * The two shapes objectui#8517 measured, and the fact that makes the pair invisible
 * to a single assignability test: they are MUTUALLY assignable.
 *
 * ⚠️ Pinned rather than described because the intuition runs the other way and was
 * wrong when two people derived it independently — the reasoning is that
 * `Partial[Record[K, number]]` cannot fit an index signature demanding `number`,
 * because its members are `number | undefined`. TypeScript grants an IMPLICIT index
 * signature to mapped and anonymous object types, so it fits, and the open record
 * fits the partial one because every member it could supply is a `number`. ⇒ Both
 * directions hold, which is why NEITHER `WiderThanDeclaredKeys` nor
 * `NarrowerThanDeclared` reported the pair. ⛔ Do not "simplify" the clause below
 * back to an assignability test; these two lines are what says it cannot work.
 */
type SyntheticBreakpoint = 'xs' | 'sm' | 'md';

export type assertionOpenRecordFitsThePartialRecord =
  Expect< Equal< [Record< string, number >] extends [Partial< Record< SyntheticBreakpoint, number > >] ? true : false, true > >;

export type assertionPartialRecordFitsTheOpenRecord =
  Expect< Equal< [Partial< Record< SyntheticBreakpoint, number > >] extends [Record< string, number >] ? true : false, true > >;

/**
 * A synthetic pair in the live instance's shape: the slot is a union of a bare
 * number and an OPEN record, the declaration is that same union over a finite key
 * set, and a sibling key agrees on both faces.
 *
 * Both halves matter, and the second is the one that guards the caricature: an
 * operator that reported `cols` by reporting EVERYTHING would satisfy the first
 * assertion exactly as well as a correct one, so `agrees` is what tells them apart.
 */
type SyntheticOpenRecordSlot = z.ZodUnion< [z.ZodNumber, z.ZodRecord< z.ZodString, z.ZodNumber >] >;

type SyntheticOpenRecordMirror = {
  shape: { cols: SyntheticOpenRecordSlot; agrees: z.ZodString };
};
interface SyntheticFiniteKeyedDeclaration {
  cols: number | Partial< Record< SyntheticBreakpoint, number > >;
  agrees: string;
}

/** The widening is reported, and the agreeing sibling is not. */
export type assertionOpenRecordWideningIsReported =
  Expect< Equal< WiderThanDeclaredKeys< SyntheticOpenRecordMirror, SyntheticFiniteKeyedDeclaration >, 'cols' > >;

/**
 * ⭐ The caricature, pinned as a NEGATIVE. A LOOSE object — what `.passthrough()`
 * produces, and what every declaration inheriting `BaseSchema` is — also answers
 * `true` to `string extends keyof T`. A clause built on that predicate alone reports
 * such a pair, and reporting it is the failure this direction has to avoid: the
 * ledger would fill with the `.passthrough()` tolerance that `WithoutIndexSignature`
 * above rules out of this file's question, while still passing an assertion that the
 * live instance is now reported.
 *
 * ⛔ This is the assertion to run against a candidate clause FIRST, and it fires: the
 * naive clause was BUILT AND RUN, and this pin reddened under it.
 *
 * ⚠️ What that run also measured, recorded because the intuition is wrong and was
 * wrong here first. The naive clause does NOT flood the ledger — it moved 3 registry
 * pairs where this one moved 2, both read at this card's base (`3f775eeb8`); on the
 * tree this landed on, objectui#8516's narrowing has taken those two and this clause
 * moves none, which is the header bullet's subject and ⛔ does not change the
 * comparison below. The blast radius is small because the clause sits on
 * the branch the assignability test already called clean and `Unconstrained` gates
 * ahead of both, so nearly every loose face is spoken for before it is reached. Its
 * one extra report is `objectql.zod.ts#ObjectViewSchema::form`, an inline `z.lazy`
 * slot whose face is a passthrough object. ⇒ The argument against the naive clause is
 * that its single false report is a WRONG KIND of finding, not that there would be
 * many of them. ⛔ Do not restate this as "it reports everything"; that figure was
 * asserted here from prediction once and the measurement replaced it.
 */
type SyntheticLooseObjectMirror = { shape: { cfg: typeof BaseSchema } };
interface SyntheticClosedObjectDeclaration { cfg: { type: string } }

export type assertionLooseObjectArmIsNotAnOpenRecord =
  Expect< Equal< WiderThanDeclaredKeys< SyntheticLooseObjectMirror, SyntheticClosedObjectDeclaration >, never > >;

/**
 * The half of that pin a synthetic could not carry: the REAL loose face this repo
 * runs on DOES answer `true` to the naive predicate. ⇒ The pin above is discriminating
 * something that is actually there, and if a zod release ever stopped spelling a loose
 * object with a bare `string` key this line fails and the pin above needs re-deriving
 * rather than silently becoming vacuous.
 */
export type assertionTheLooseFaceReallyLooksLikeAnIndexSignature =
  Expect< Equal< string extends keyof z.input< typeof BaseSchema > ? true : false, true > >;

/**
 * A declaration that REFUSES no key is not narrower than an open record, so the
 * clause stays silent on every shape that admits anything: another open record (the
 * two faces agree), a bare `object` and an `object` sitting beside a primitive arm
 * (neither names a key set), an array element (below the bound), and `any`
 * (`Unconstrained` already owns that case, and `keyof any` includes `string`, so a
 * clause without the guard would read `any` as an open record on every pair).
 *
 * ⭐ The `beside` key is the one that was MEASURED rather than predicted: this pin
 * failed on the first candidate clause, because `keyof number` resolves to that
 * primitive's method names and so a `number` arm read as a finite-keyed object,
 * carrying the whole permissive declaration into the report. ⛔ Do not drop the
 * `T extends object` half of `FiniteKeyedArms` — this is the line that catches it.
 */
type SyntheticPermissiveMirror = {
  shape: {
    same: SyntheticOpenRecordSlot;
    loose: z.ZodRecord< z.ZodString, z.ZodNumber >;
    beside: SyntheticOpenRecordSlot;
    anything: z.ZodRecord< z.ZodString, z.ZodNumber >;
  };
};
interface SyntheticPermissiveDeclaration {
  same: number | Record< string, number >;
  loose: object;
  beside: number | object;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the `any` face this pin exists to keep out of the clause.
  anything: any;
}

export type assertionPermissiveDeclarationIsNotWidened =
  Expect< Equal< WiderThanDeclaredKeys< SyntheticPermissiveMirror, SyntheticPermissiveDeclaration >, never > >;

/**
 * The BOUND, pinned so that widening the clause's reach is a deliberate act with a
 * census behind it rather than a refactor.
 *
 * An open record NESTED inside an array element is NOT reported. The clause reads
 * the slot's TOP-LEVEL union arms and no deeper, the same shallowness `Unconstrained`
 * documents above and for the same measured reason. ⇒ A future card that descends
 * has to re-run the census, and this pin is what fails when it does.
 */
type SyntheticNestedOpenRecordMirror = {
  shape: { rows: z.ZodArray< z.ZodRecord< z.ZodString, z.ZodNumber > > };
};
interface SyntheticNestedDeclaration { rows: Partial< Record< SyntheticBreakpoint, number > >[] }

export type assertionNestedOpenRecordIsBelowTheBound =
  Expect< Equal< WiderThanDeclaredKeys< SyntheticNestedOpenRecordMirror, SyntheticNestedDeclaration >, never > >;

/**
 * ⭐ The non-regression axis, as a pin rather than as a property of the source.
 *
 * The clause runs ONLY on the branch the assignability test already called clean, so
 * a key reported before it cannot stop being reported. That is true by construction
 * — and a guarantee nobody has watched fail is not a guarantee, which is the whole
 * argument this file makes about baselines. Here both classes meet on ONE pair: the
 * ordinary widening `size` (a bare string against two literals) and the open-record
 * widening `cols`, with `agrees` clean beside them. All three verdicts have to hold
 * at once.
 */
type SyntheticBothClassesMirror = {
  shape: { size: z.ZodString; cols: SyntheticOpenRecordSlot; agrees: z.ZodString };
};
interface SyntheticBothClassesDeclaration {
  size: 'sm' | 'lg';
  cols: number | Partial< Record< SyntheticBreakpoint, number > >;
  agrees: string;
}

export type assertionOpenRecordClauseIsAdditive =
  Expect< Equal< WiderThanDeclaredKeys< SyntheticBothClassesMirror, SyntheticBothClassesDeclaration >, 'size' | 'cols' > >;

/**
 * The clause does not disturb the other two directions: `NarrowerThanDeclared` and
 * `UnmirroredDeclaredKeys` are still blind to an open-record widening, for the same
 * structural reasons they are blind to every other one. ⚠️ The first line is NOT a
 * restatement of `assertionNarrowerOperatorIsBlindToAWidening` above: that pair's
 * blindness is a one-way assignability pass, this one's is a MUTUAL one, and only a
 * pin over this shape would notice if a future narrower-side repair claimed the case.
 */
export type assertionNarrowerOperatorIsBlindToAnOpenRecord =
  Expect< Equal< NarrowerThanDeclared< SyntheticOpenRecordMirror, SyntheticFiniteKeyedDeclaration >, never > >;

export type assertionUnmirroredOperatorIsBlindToAnOpenRecord =
  Expect< Equal< UnmirroredDeclaredKeys< SyntheticOpenRecordMirror, SyntheticFiniteKeyedDeclaration >, never > >;

/* ── Recognition: the FOURTH direction fires, and the three before it stay blind ─ */

/**
 * ONE synthetic pair on which ALL FOUR operators fire, each on a DIFFERENT key.
 *
 * Built this way deliberately, and it is the board's control discipline rather than
 * a flourish: every claim below that an operator is SILENT about a key is a zero, and
 * a zero is only worth reading beside a LIT CONTROL on the SAME instrument and the
 * SAME corpus. Four separate synthetic pairs would give each operator its own corpus
 * and prove nothing about the others; here each operator is shown FIRING on this pair
 * and SILENT on this pair, so its silence is a measurement and not a broken instrument.
 *
 * The declaration carries `[key: string]: any`, which is what `BaseSchema` really
 * carried until objectui#8347 (and what a declaration with its own signature
 * still carries), and what makes the fourth direction hard to measure at all: `keyof D`
 * resolves to bare `string`, so the obvious spelling of "mirrored but undeclared"
 * subtracts every key and reads `never` for every pair forever.
 * `assertionNaiveMirroredUndeclaredIsAbsorbedByTheIndexSignature` below pins that
 * failing spelling beside the working one, so the reason `DeclaredKeys` is used here
 * is a measurement in this file and not a remembered fact.
 *
 *   `size`   — on both faces, and the mirror accepts exactly what the declaration
 *              states. It is the key NO operator may report, which is what makes
 *              this pair a control against a matcher that catches everything.
 *   `stray`  — mirrored only            -> the FOURTH direction, and only it.
 *   `missing`— declared only            -> `UnmirroredDeclaredKeys`, and only it.
 *   `wide`   — mirror accepts `string`, declaration states two literals
 *                                       -> `WiderThanDeclaredKeys`, and only it.
 *   `narrow` — mirror accepts `number`, declaration states `number | string`
 *                                       -> `NarrowerThanDeclared`, and only it.
 */
type SyntheticFourWayMirror = {
  shape: { size: z.ZodString; stray: z.ZodBoolean; wide: z.ZodString; narrow: z.ZodNumber };
};
interface SyntheticFourWayDeclaration {
  size: string;
  wide: 'a' | 'b';
  narrow: number | string;
  missing: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the shape `BaseSchema` really had until objectui#8347; the whole point of this pair
  [key: string]: any;
}

/**
 * The fourth direction FIRES, and reports EXACTLY the mirrored-only key.
 *
 * `Equal` is invariant, so this is two facts in one line: `stray` IS reported, and
 * `size` — a key that is BOTH mirrored and declared — is NOT. A matcher that
 * returned every mirrored key would fail here, which is the control the zeros below
 * are read against.
 */
export type assertionMirroredUndeclaredOperatorReportsAMirroredOnlyKey =
  Expect< Equal< MirroredUndeclaredKeys< SyntheticFourWayMirror, SyntheticFourWayDeclaration >, 'stray' > >;

/**
 * The lit control stated on its own, because it is the claim a reader will doubt:
 * the key that is on BOTH faces is not in the output.
 */
export type assertionMirroredUndeclaredDoesNotReportAnAgreedKey =
  Expect< Equal<
    Extract< MirroredUndeclaredKeys< SyntheticFourWayMirror, SyntheticFourWayDeclaration >, 'size' >,
    never
  > >;

/**
 * The obvious spelling — `keyof D` instead of `DeclaredKeys< D >` — reads `never` on
 * this pair. This is the defect, reproduced: the declaration's index signature
 * absorbs every literal name, so the subtraction has nothing left to report.
 */
type NaiveMirroredUndeclaredKeys< M, D > = Exclude< MirroredKeys< M >, Extract< keyof D, string > >;

export type assertionNaiveMirroredUndeclaredIsAbsorbedByTheIndexSignature =
  Expect< Equal< NaiveMirroredUndeclaredKeys< SyntheticFourWayMirror, SyntheticFourWayDeclaration >, never > >;

/**
 * …and the lit control for THAT zero, on the same naive instrument: strip the index
 * signature off the declaration and the naive spelling finds `stray` after all. So
 * the `never` above is the index signature absorbing the comparison, ⛔ not a naive
 * operator that cannot report anything.
 */
interface SyntheticFourWayDeclarationWithoutIndexSignature {
  size: string;
  wide: 'a' | 'b';
  narrow: number | string;
  missing: number;
}

export type assertionNaiveMirroredUndeclaredFiresWithoutAnIndexSignature =
  Expect< Equal<
    NaiveMirroredUndeclaredKeys< SyntheticFourWayMirror, SyntheticFourWayDeclarationWithoutIndexSignature >,
    'stray'
  > >;

/** And the real operator reads the same key on that declaration — the index signature is all that differed. */
export type assertionMirroredUndeclaredIsIndifferentToTheIndexSignature =
  Expect< Equal<
    MirroredUndeclaredKeys< SyntheticFourWayMirror, SyntheticFourWayDeclarationWithoutIndexSignature >,
    'stray'
  > >;

/**
 * `UnmirroredDeclaredKeys` is blind to `stray` — it reports `missing` on this very
 * pair, so the instrument is LIT and the omission is a measurement. It subtracts in
 * the other direction by construction: declared minus mirrored.
 */
export type assertionUnmirroredOperatorIsBlindToAMirroredOnlyKey =
  Expect< Equal< UnmirroredDeclaredKeys< SyntheticFourWayMirror, SyntheticFourWayDeclaration >, 'missing' > >;

/**
 * `WiderThanDeclaredKeys` is blind to `stray` — it reports `wide` on this very pair,
 * so it is LIT here too. It maps over `MirroredKeys< M > & DeclaredKeys< D >`, the
 * INTERSECTION, and a mirrored-but-undeclared key is outside that domain: it LEAVES
 * THE COMPARISON, exactly as objectui#6058's declared-but-unmirrored keys left
 * `NarrowerThanDeclared`'s.
 */
export type assertionWiderOperatorIsBlindToAMirroredOnlyKey =
  Expect< Equal< WiderThanDeclaredKeys< SyntheticFourWayMirror, SyntheticFourWayDeclaration >, 'wide' > >;

/**
 * `NarrowerThanDeclared` is blind to `stray` — it reports `narrow` on this very pair.
 * It maps over `MirroredKeys< M > & keyof D`, and with the index signature present
 * `D['stray']` resolves to `any`, which absorbs the comparison and is found equal.
 */
export type assertionNarrowerOperatorIsBlindToAMirroredOnlyKey =
  Expect< Equal< NarrowerThanDeclared< SyntheticFourWayMirror, SyntheticFourWayDeclaration >, 'narrow' > >;


/* ── The registry ───────────────────────────────────────────────────────────── */

/** Mirror VALUES, keyed `<file>#<export>`. Runtime, so the census below can read the keys. */
const MIRRORS = {
  'ai.zod.ts#AIConfigSchema': AIConfigSchema,
  'ai.zod.ts#AIFieldSuggestionSchema': AIFieldSuggestionSchema,
  'ai.zod.ts#AIFormAssistSchema': AIFormAssistSchema,
  'ai.zod.ts#AIRecommendationItemSchema': AIRecommendationItemSchema,
  'ai.zod.ts#AIRecommendationsSchema': AIRecommendationsSchema,
  'ai.zod.ts#NLQueryResultSchema': NLQueryResultSchema,
  'ai.zod.ts#NLQuerySchema': NLQuerySchema,
  'app.zod.ts#AppComponentSchema': AppComponentSchema,
  // objectui#11515 — the zod-only arm's TS twin.
  'app.zod.ts#AppSchemaRendererNodeSchema': AppSchemaRendererNodeSchema,
  'app.zod.ts#NavigationAreaSchema': NavigationAreaSchema,
  'base.zod.ts#BaseSchema': BaseSchema,
  'base.zod.ts#ComponentConfigSchema': ComponentConfigSchema,
  'base.zod.ts#ComponentInputSchema': ComponentInputSchema,
  'base.zod.ts#ComponentMetaSchema': ComponentMetaSchema,
  'base.zod.ts#KeyedI18nLabelSchema': KeyedI18nLabelSchema,
  // objectui#11930 — the arm and its TS twin landed together.
  'cloud.zod.ts#CloudWorkspaceTimezoneNoticeSchema': CloudWorkspaceTimezoneNoticeSchema,
  // objectui#12197 — the product-page blocks' arms and their TS twins landed together.
  'product-blocks.zod.ts#ChecklistBlockItemSchema': ChecklistBlockItemSchema,
  'product-blocks.zod.ts#ChecklistBlockSchema': ChecklistBlockSchema,
  'product-blocks.zod.ts#HeroBlockSchema': HeroBlockSchema,
  'product-blocks.zod.ts#StatBlockSchema': StatBlockSchema,
  'product-blocks.zod.ts#TileGridBlockAddTileSchema': TileGridBlockAddTileSchema,
  'product-blocks.zod.ts#TileGridBlockItemSchema': TileGridBlockItemSchema,
  'product-blocks.zod.ts#TileGridBlockSchema': TileGridBlockSchema,
  'product-blocks.zod.ts#UsageBarBlockSchema': UsageBarBlockSchema,
  'complex.zod.ts#CalendarEventSchema': CalendarEventSchema,
  'complex.zod.ts#CalendarViewSchema': CalendarViewSchema,
  'complex.zod.ts#CarouselItemSchema': CarouselItemSchema,
  'complex.zod.ts#CarouselSchema': CarouselSchema,
  'complex.zod.ts#ChatbotSchema': ChatbotSchema,
  'complex.zod.ts#ChatbotEnhancedSchema': ChatbotEnhancedSchema,
  'complex.zod.ts#ChatbotFloatingSchema': ChatbotFloatingSchema,
  'complex.zod.ts#ChatMessageSchema': ChatMessageSchema,
  'complex.zod.ts#ChatMessageSourceSchema': ChatMessageSourceSchema,
  'complex.zod.ts#ChatToolInvocationSchema': ChatToolInvocationSchema,
  'complex.zod.ts#DashboardComponentSchema': DashboardComponentSchema,
  'complex.zod.ts#DashboardConfigSchema': DashboardConfigSchema,
  'complex.zod.ts#DashboardWidgetConfigSchema': DashboardWidgetConfigSchema,
  'complex.zod.ts#DashboardWidgetLayoutSchema': DashboardWidgetLayoutSchema,
  'complex.zod.ts#DashboardWidgetSchema': DashboardWidgetSchema,
  'complex.zod.ts#FilterBuilderSchema': FilterBuilderSchema,
  'complex.zod.ts#FilterFieldSchema': FilterFieldSchema,
  'complex.zod.ts#KanbanCardSchema': KanbanCardSchema,
  'complex.zod.ts#KanbanColumnSchema': KanbanColumnSchema,
  'complex.zod.ts#CardTemplateSchema': CardTemplateSchema,
  'crud.zod.ts#CRUDDialogSchema': CRUDDialogSchema,
  'crud.zod.ts#DetailSchema': DetailSchema,
  'data-display.zod.ts#AlertSchema': AlertSchema,
  'data-display.zod.ts#AvatarSchema': AvatarSchema,
  'data-display.zod.ts#BadgeSchema': BadgeSchema,
  'data-display.zod.ts#ChartDataSeriesSchema': ChartDataSeriesSchema,
  'data-display.zod.ts#ChartSchema': ChartSchema,
  'data-display.zod.ts#DataTableSchema': DataTableSchema,
  'data-display.zod.ts#DrillDownConfigSchema': DrillDownConfigSchema,
  'data-display.zod.ts#KbdSchema': KbdSchema,
  'data-display.zod.ts#BarChartSchema': BarChartSchema,
  'data-display.zod.ts#ListItemSchema': ListItemSchema,
  'data-display.zod.ts#ListSchema': ListSchema,
  'data-display.zod.ts#MarkdownSchema': MarkdownSchema,
  // objectui#10859 batch 2: `pivot` gained its arm, a hand mirror of the declaration.
  'data-display.zod.ts#PivotTableSchema': PivotTableSchema,
  'data-display.zod.ts#StaticTableColumnSchema': StaticTableColumnSchema,
  'data-display.zod.ts#StatisticSchema': StatisticSchema,
  'data-display.zod.ts#TableColumnSchema': TableColumnSchema,
  'data-display.zod.ts#TableSchema': TableSchema,
  'data-display.zod.ts#TimelineEventSchema': TimelineEventSchema,
  'data-display.zod.ts#TimelineFeedItemSchema': TimelineFeedItemSchema,
  'data-display.zod.ts#TimelineGanttItemBarSchema': TimelineGanttItemBarSchema,
  'data-display.zod.ts#TimelineGanttItemSchema': TimelineGanttItemSchema,
  'data-display.zod.ts#TimelineSchema': TimelineSchema,
  'data-display.zod.ts#TreeViewSchema': TreeViewSchema,
  'designer.zod.ts#BPMNEdgeSchema': BPMNEdgeSchema,
  'designer.zod.ts#BPMNLaneSchema': BPMNLaneSchema,
  'designer.zod.ts#BPMNNodeSchema': BPMNNodeSchema,
  'designer.zod.ts#DataModelDesignerSchema': DataModelDesignerSchema,
  'designer.zod.ts#DataModelEntitySchema': DataModelEntitySchema,
  'designer.zod.ts#DataModelFieldSchema': DataModelFieldSchema,
  'designer.zod.ts#DataModelRelationshipSchema': DataModelRelationshipSchema,
  'designer.zod.ts#DesignerCanvasConfigSchema': DesignerCanvasConfigSchema,
  'designer.zod.ts#DesignerFieldDefinitionSchema': DesignerFieldDefinitionSchema,
  'designer.zod.ts#DesignerFieldOptionSchema': DesignerFieldOptionSchema,
  'designer.zod.ts#DesignerPaletteCategorySchema': DesignerPaletteCategorySchema,
  'designer.zod.ts#DesignerPaletteItemSchema': DesignerPaletteItemSchema,
  'designer.zod.ts#DesignerPositionSchema': DesignerPositionSchema,
  'designer.zod.ts#FieldDesignerSchema': FieldDesignerSchema,
  'designer.zod.ts#ObjectDefinitionSchema': ObjectDefinitionSchema,
  'designer.zod.ts#ObjectManagerSchema': ObjectManagerSchema,
  'designer.zod.ts#PageDesignerSchema': PageDesignerSchema,
  'designer.zod.ts#ProcessDesignerSchema': ProcessDesignerSchema,
  'designer.zod.ts#ReportDesignerElementSchema': ReportDesignerElementSchema,
  'designer.zod.ts#ReportDesignerSchema': ReportDesignerSchema,
  'designer.zod.ts#ReportDesignerSectionSchema': ReportDesignerSectionSchema,
  'disclosure.zod.ts#AccordionItemSchema': AccordionItemSchema,
  'disclosure.zod.ts#AccordionSchema': AccordionSchema,
  'disclosure.zod.ts#CollapsibleSchema': CollapsibleSchema,
  'disclosure.zod.ts#ToggleGroupItemSchema': ToggleGroupItemSchema,
  'disclosure.zod.ts#ToggleGroupSchema': ToggleGroupSchema,
  'feedback.zod.ts#EmptySchema': EmptySchema,
  'feedback.zod.ts#LoadingSchema': LoadingSchema,
  'feedback.zod.ts#ProgressSchema': ProgressSchema,
  'feedback.zod.ts#SkeletonSchema': SkeletonSchema,
  'feedback.zod.ts#SonnerSchema': SonnerSchema,
  'feedback.zod.ts#SpinnerSchema': SpinnerSchema,
  'feedback.zod.ts#ToasterSchema': ToasterSchema,
  'feedback.zod.ts#ToastSchema': ToastSchema,
  'form.zod.ts#ButtonSchema': ButtonSchema,
  'form.zod.ts#CalendarSchema': CalendarSchema,
  'form.zod.ts#CheckboxSchema': CheckboxSchema,
  'form.zod.ts#ComboboxOptionSchema': ComboboxOptionSchema,
  'form.zod.ts#ComboboxSchema': ComboboxSchema,
  'form.zod.ts#CommandGroupSchema': CommandGroupSchema,
  'form.zod.ts#CommandItemSchema': CommandItemSchema,
  'form.zod.ts#CommandSchema': CommandSchema,
  'form.zod.ts#CodeEditorSchema': CodeEditorSchema,
  'form.zod.ts#DatePickerSchema': DatePickerSchema,
  'form.zod.ts#FieldConditionSchema': FieldConditionSchema,
  'form.zod.ts#FieldConstraintsSchema': FieldConstraintsSchema,
  'form.zod.ts#FileUploadSchema': FileUploadSchema,
  'form.zod.ts#FormFieldSchema': FormFieldSchema,
  'form.zod.ts#FormSchema': FormSchema,
  'form.zod.ts#InputOTPSchema': InputOTPSchema,
  'form.zod.ts#InputSchema': InputSchema,
  'form.zod.ts#InputShorthandSchema': InputShorthandSchema,
  'form.zod.ts#UiCalendarSchema': UiCalendarSchema,
  'form.zod.ts#LabelSchema': LabelSchema,
  'form.zod.ts#RadioGroupSchema': RadioGroupSchema,
  'form.zod.ts#RadioOptionSchema': RadioOptionSchema,
  'form.zod.ts#SelectOptionSchema': SelectOptionSchema,
  'form.zod.ts#SelectSchema': SelectSchema,
  'form.zod.ts#SliderSchema': SliderSchema,
  'form.zod.ts#SwitchSchema': SwitchSchema,
  'form.zod.ts#TextareaSchema': TextareaSchema,
  'form.zod.ts#ToggleSchema': ToggleSchema,
  'layout.zod.ts#AspectRatioSchema': AspectRatioSchema,
  'layout.zod.ts#BoxSchema': BoxSchema,
  'layout.zod.ts#CardSchema': CardSchema,
  'layout.zod.ts#ContainerSchema': ContainerSchema,
  'layout.zod.ts#DivSchema': DivSchema,
  'layout.zod.ts#HtmlElementSchema': HtmlElementSchema,
  'layout.zod.ts#SemanticElementSchema': SemanticElementSchema,
  'layout.zod.ts#FlexSchema': FlexSchema,
  'layout.zod.ts#GridSchema': GridSchema,
  'layout.zod.ts#IconSchema': IconSchema,
  'layout.zod.ts#ImageSchema': ImageSchema,
  'layout.zod.ts#PageNodeRegionSchema': PageNodeRegionSchema,
  'layout.zod.ts#PageNodeSchema': PageNodeSchema,
  'layout.zod.ts#ResizablePanelSchema': ResizablePanelSchema,
  'layout.zod.ts#ResizableSchema': ResizableSchema,
  'layout.zod.ts#ScrollAreaSchema': ScrollAreaSchema,
  'layout.zod.ts#SeparatorSchema': SeparatorSchema,
  'layout.zod.ts#StackSchema': StackSchema,
  'layout.zod.ts#TabItemSchema': TabItemSchema,
  'layout.zod.ts#TabsSchema': TabsSchema,
  'layout.zod.ts#TextSchema': TextSchema,
  'layout.zod.ts#TextSpanSchema': TextSpanSchema,
  'navigation.zod.ts#BreadcrumbItemSchema': BreadcrumbItemSchema,
  'navigation.zod.ts#BreadcrumbSchema': BreadcrumbSchema,
  'navigation.zod.ts#ButtonGroupButtonSchema': ButtonGroupButtonSchema,
  'navigation.zod.ts#ButtonGroupSchema': ButtonGroupSchema,
  'navigation.zod.ts#HeaderBarSchema': HeaderBarSchema,
  'navigation.zod.ts#NavigationMenuSchema': NavigationMenuSchema,
  'navigation.zod.ts#PaginationSchema': PaginationSchema,
  'navigation.zod.ts#SidebarSchema': SidebarSchema,
  'objectql.zod.ts#ObjectCalendarSchema': ObjectCalendarSchema,
  'objectql.zod.ts#ObjectChartSchema': ObjectChartSchema,
  'objectql.zod.ts#ObjectDataTableSchema': ObjectDataTableSchema,
  'objectql.zod.ts#ObjectFormSchema': ObjectFormSchema,
  'objectql.zod.ts#ObjectGallerySchema': ObjectGallerySchema,
  'objectql.zod.ts#ObjectGanttSchema': ObjectGanttSchema,
  'objectql.zod.ts#ObjectGridSchema': ObjectGridSchema,
  'objectql.zod.ts#ObjectKanbanSchema': ObjectKanbanSchema,
  'objectql.zod.ts#ObjectMapConfigSchema': ObjectMapConfigSchema,
  'objectql.zod.ts#ObjectMapSchema': ObjectMapSchema,
  'objectql.zod.ts#ObjectTreeSchema': ObjectTreeSchema,
  'objectql.zod.ts#ObjectViewSchema': ObjectViewSchema,
  'objectql.zod.ts#SortConfigSchema': SortConfigSchema,
  'overlay.zod.ts#AlertDialogSchema': AlertDialogSchema,
  'overlay.zod.ts#ContextMenuSchema': ContextMenuSchema,
  'overlay.zod.ts#DialogSchema': DialogSchema,
  'overlay.zod.ts#DrawerSchema': DrawerSchema,
  'overlay.zod.ts#DropdownMenuSchema': DropdownMenuSchema,
  'overlay.zod.ts#HoverCardSchema': HoverCardSchema,
  'overlay.zod.ts#MenubarMenuSchema': MenubarMenuSchema,
  'overlay.zod.ts#MenubarSchema': MenubarSchema,
  'overlay.zod.ts#PopoverSchema': PopoverSchema,
  'overlay.zod.ts#SheetSchema': SheetSchema,
  'overlay.zod.ts#TooltipSchema': TooltipSchema,
  // objectui#12342 — the arm and its TS twin landed together.
  'record-approval-decision.zod.ts#RecordApprovalDecisionBlockSchema': RecordApprovalDecisionBlockSchema,
  // objectui#12363 — the two arms and their TS twins landed together.
  'record-panels.zod.ts#RecordApprovalsBlockSchema': RecordApprovalsBlockSchema,
  'record-panels.zod.ts#RecordAttachmentsBlockSchema': RecordAttachmentsBlockSchema,
  'reports.zod.ts#ReportBuilderSchema': ReportBuilderSchema,
  'reports.zod.ts#ReportComponentSchema': ReportComponentSchema,
  'reports.zod.ts#ReportExportConfigSchema': ReportExportConfigSchema,
  'reports.zod.ts#ReportFieldSchema': ReportFieldSchema,
  'reports.zod.ts#ReportFilterSchema': ReportFilterSchema,
  'reports.zod.ts#ReportGroupBySchema': ReportGroupBySchema,
  'reports.zod.ts#ReportSectionSchema': ReportSectionSchema,
  'reports.zod.ts#ReportViewerSchema': ReportViewerSchema,
  // objectui#11515 — the zod-only arm's TS twin.
  'views.zod.ts#DetailSectionNodeSchema': DetailSectionNodeSchema,
  'views.zod.ts#DetailViewFieldSchema': DetailViewFieldSchema,
  'views.zod.ts#DetailViewSchema': DetailViewSchema,
  'views.zod.ts#DetailViewSectionSchema': DetailViewSectionSchema,
  'views.zod.ts#DetailViewTabSchema': DetailViewTabSchema,
  'views.zod.ts#FilterUISchema': FilterUISchema,
  'views.zod.ts#SortUISchema': SortUISchema,
  'views.zod.ts#ViewSwitcherSchema': ViewSwitcherSchema,
} as const;

/** The declaration each mirror restates. Same keys as `MIRRORS` — pinned below. */
interface Declared {
  'ai.zod.ts#AIConfigSchema': Ts_AIConfig;
  'ai.zod.ts#AIFieldSuggestionSchema': Ts_AIFieldSuggestion;
  'ai.zod.ts#AIFormAssistSchema': Ts_AIFormAssistSchema;
  'ai.zod.ts#AIRecommendationItemSchema': Ts_AIRecommendationItem;
  'ai.zod.ts#AIRecommendationsSchema': Ts_AIRecommendationsSchema;
  'ai.zod.ts#NLQueryResultSchema': Ts_NLQueryResult;
  'ai.zod.ts#NLQuerySchema': Ts_NLQuerySchema;
  'app.zod.ts#AppComponentSchema': Ts_AppComponentSchema;
  'app.zod.ts#AppSchemaRendererNodeSchema': Ts_AppSchemaRendererNodeSchema;
  'app.zod.ts#NavigationAreaSchema': Ts_NavigationArea;
  'base.zod.ts#BaseSchema': Ts_BaseSchema;
  'base.zod.ts#ComponentConfigSchema': Ts_ComponentConfig;
  'base.zod.ts#ComponentInputSchema': Ts_ComponentInput;
  'base.zod.ts#ComponentMetaSchema': Ts_ComponentMeta;
  'base.zod.ts#KeyedI18nLabelSchema': Ts_KeyedI18nLabel;
  'cloud.zod.ts#CloudWorkspaceTimezoneNoticeSchema': Ts_CloudWorkspaceTimezoneNoticeSchema;
  'product-blocks.zod.ts#ChecklistBlockItemSchema': Ts_ChecklistBlockItem;
  'product-blocks.zod.ts#ChecklistBlockSchema': Ts_ChecklistBlockSchema;
  'product-blocks.zod.ts#HeroBlockSchema': Ts_HeroBlockSchema;
  'product-blocks.zod.ts#StatBlockSchema': Ts_StatBlockSchema;
  'product-blocks.zod.ts#TileGridBlockAddTileSchema': Ts_TileGridBlockAddTile;
  'product-blocks.zod.ts#TileGridBlockItemSchema': Ts_TileGridBlockItem;
  'product-blocks.zod.ts#TileGridBlockSchema': Ts_TileGridBlockSchema;
  'product-blocks.zod.ts#UsageBarBlockSchema': Ts_UsageBarBlockSchema;
  'complex.zod.ts#CalendarEventSchema': Ts_CalendarEvent;
  'complex.zod.ts#CalendarViewSchema': Ts_CalendarViewSchema;
  'complex.zod.ts#CarouselItemSchema': Ts_CarouselItem;
  'complex.zod.ts#CarouselSchema': Ts_CarouselSchema;
  'complex.zod.ts#ChatbotSchema': Ts_ChatbotSchema;
  'complex.zod.ts#ChatbotEnhancedSchema': Ts_ChatbotEnhancedSchema;
  'complex.zod.ts#ChatbotFloatingSchema': Ts_ChatbotFloatingSchema;
  'complex.zod.ts#ChatMessageSchema': Ts_ChatMessage;
  'complex.zod.ts#ChatMessageSourceSchema': Ts_ChatMessageSource;
  'complex.zod.ts#ChatToolInvocationSchema': Ts_ChatToolInvocation;
  'complex.zod.ts#DashboardComponentSchema': Ts_DashboardComponentSchema;
  'complex.zod.ts#DashboardConfigSchema': Ts_DashboardConfig;
  'complex.zod.ts#DashboardWidgetConfigSchema': Ts_DashboardWidgetConfig;
  'complex.zod.ts#DashboardWidgetLayoutSchema': Ts_DashboardWidgetLayout;
  'complex.zod.ts#DashboardWidgetSchema': Ts_DashboardWidgetSchema;
  'complex.zod.ts#FilterBuilderSchema': Ts_FilterBuilderSchema;
  'complex.zod.ts#FilterFieldSchema': Ts_FilterField;
  'complex.zod.ts#KanbanCardSchema': Ts_KanbanCard;
  'complex.zod.ts#KanbanColumnSchema': Ts_KanbanColumn;
  'complex.zod.ts#CardTemplateSchema': Ts_CardTemplate;
  'crud.zod.ts#CRUDDialogSchema': Ts_CRUDDialogSchema;
  'crud.zod.ts#DetailSchema': Ts_DetailSchema;
  'data-display.zod.ts#AlertSchema': Ts_AlertSchema;
  'data-display.zod.ts#AvatarSchema': Ts_AvatarSchema;
  'data-display.zod.ts#BadgeSchema': Ts_BadgeSchema;
  'data-display.zod.ts#ChartDataSeriesSchema': Ts_ChartDataSeries;
  'data-display.zod.ts#ChartSchema': Ts_ChartSchema;
  'data-display.zod.ts#DataTableSchema': Ts_DataTableSchema;
  'data-display.zod.ts#DrillDownConfigSchema': Ts_DrillDownConfig;
  'data-display.zod.ts#KbdSchema': Ts_KbdSchema;
  'data-display.zod.ts#BarChartSchema': Ts_BarChartSchema;
  'data-display.zod.ts#ListItemSchema': Ts_ListItem;
  'data-display.zod.ts#ListSchema': Ts_ListSchema;
  'data-display.zod.ts#MarkdownSchema': Ts_MarkdownSchema;
  'data-display.zod.ts#PivotTableSchema': Ts_PivotTableSchema;
  'data-display.zod.ts#StaticTableColumnSchema': Ts_StaticTableColumn;
  'data-display.zod.ts#StatisticSchema': Ts_StatisticSchema;
  'data-display.zod.ts#TableColumnSchema': Ts_TableColumn;
  'data-display.zod.ts#TableSchema': Ts_TableSchema;
  'data-display.zod.ts#TimelineEventSchema': Ts_TimelineEvent;
  'data-display.zod.ts#TimelineFeedItemSchema': Ts_TimelineFeedItem;
  'data-display.zod.ts#TimelineGanttItemBarSchema': Ts_TimelineGanttItemBar;
  'data-display.zod.ts#TimelineGanttItemSchema': Ts_TimelineGanttItem;
  'data-display.zod.ts#TimelineSchema': Ts_TimelineSchema;
  'data-display.zod.ts#TreeViewSchema': Ts_TreeViewSchema;
  'designer.zod.ts#BPMNEdgeSchema': Ts_BPMNEdge;
  'designer.zod.ts#BPMNLaneSchema': Ts_BPMNLane;
  'designer.zod.ts#BPMNNodeSchema': Ts_BPMNNode;
  'designer.zod.ts#DataModelDesignerSchema': Ts_DataModelDesignerSchema;
  'designer.zod.ts#DataModelEntitySchema': Ts_DataModelEntity;
  'designer.zod.ts#DataModelFieldSchema': Ts_DataModelField;
  'designer.zod.ts#DataModelRelationshipSchema': Ts_DataModelRelationship;
  'designer.zod.ts#DesignerCanvasConfigSchema': Ts_DesignerCanvasConfig;
  'designer.zod.ts#DesignerFieldDefinitionSchema': Ts_DesignerFieldDefinition;
  'designer.zod.ts#DesignerFieldOptionSchema': Ts_DesignerFieldOption;
  'designer.zod.ts#DesignerPaletteCategorySchema': Ts_DesignerPaletteCategory;
  'designer.zod.ts#DesignerPaletteItemSchema': Ts_DesignerPaletteItem;
  'designer.zod.ts#DesignerPositionSchema': Ts_DesignerPosition;
  'designer.zod.ts#FieldDesignerSchema': Ts_FieldDesignerSchema;
  'designer.zod.ts#ObjectDefinitionSchema': Ts_ObjectDefinition;
  'designer.zod.ts#ObjectManagerSchema': Ts_ObjectManagerSchema;
  'designer.zod.ts#PageDesignerSchema': Ts_PageDesignerSchema;
  'designer.zod.ts#ProcessDesignerSchema': Ts_ProcessDesignerSchema;
  'designer.zod.ts#ReportDesignerElementSchema': Ts_ReportDesignerElement;
  'designer.zod.ts#ReportDesignerSchema': Ts_ReportDesignerSchema;
  'designer.zod.ts#ReportDesignerSectionSchema': Ts_ReportDesignerSection;
  'disclosure.zod.ts#AccordionItemSchema': Ts_AccordionItem;
  'disclosure.zod.ts#AccordionSchema': Ts_AccordionSchema;
  'disclosure.zod.ts#CollapsibleSchema': Ts_CollapsibleSchema;
  'disclosure.zod.ts#ToggleGroupItemSchema': Ts_ToggleGroupItem;
  'disclosure.zod.ts#ToggleGroupSchema': Ts_ToggleGroupSchema;
  'feedback.zod.ts#EmptySchema': Ts_EmptySchema;
  'feedback.zod.ts#LoadingSchema': Ts_LoadingSchema;
  'feedback.zod.ts#ProgressSchema': Ts_ProgressSchema;
  'feedback.zod.ts#SkeletonSchema': Ts_SkeletonSchema;
  'feedback.zod.ts#SonnerSchema': Ts_SonnerSchema;
  'feedback.zod.ts#SpinnerSchema': Ts_SpinnerSchema;
  'feedback.zod.ts#ToasterSchema': Ts_ToasterSchema;
  'feedback.zod.ts#ToastSchema': Ts_ToastSchema;
  'form.zod.ts#ButtonSchema': Ts_ButtonSchema;
  'form.zod.ts#CalendarSchema': Ts_CalendarSchema;
  'form.zod.ts#CheckboxSchema': Ts_CheckboxSchema;
  'form.zod.ts#ComboboxOptionSchema': Ts_ComboboxOption;
  'form.zod.ts#ComboboxSchema': Ts_ComboboxSchema;
  'form.zod.ts#CommandGroupSchema': Ts_CommandGroup;
  'form.zod.ts#CommandItemSchema': Ts_CommandItem;
  'form.zod.ts#CommandSchema': Ts_CommandSchema;
  'form.zod.ts#CodeEditorSchema': Ts_CodeEditorSchema;
  'form.zod.ts#DatePickerSchema': Ts_DatePickerSchema;
  'form.zod.ts#FieldConditionSchema': Ts_FieldCondition;
  'form.zod.ts#FieldConstraintsSchema': Ts_FieldValidationRules;
  'form.zod.ts#FileUploadSchema': Ts_FileUploadSchema;
  'form.zod.ts#FormFieldSchema': Ts_FormField;
  'form.zod.ts#FormSchema': Ts_FormSchema;
  'form.zod.ts#InputOTPSchema': Ts_InputOTPSchema;
  'form.zod.ts#InputSchema': Ts_InputSchema;
  'form.zod.ts#InputShorthandSchema': Ts_InputShorthandSchema;
  'form.zod.ts#UiCalendarSchema': Ts_UiCalendarSchema;
  'form.zod.ts#LabelSchema': Ts_LabelSchema;
  'form.zod.ts#RadioGroupSchema': Ts_RadioGroupSchema;
  'form.zod.ts#RadioOptionSchema': Ts_RadioOption;
  'form.zod.ts#SelectOptionSchema': Ts_SelectOption;
  'form.zod.ts#SelectSchema': Ts_SelectSchema;
  'form.zod.ts#SliderSchema': Ts_SliderSchema;
  'form.zod.ts#SwitchSchema': Ts_SwitchSchema;
  'form.zod.ts#TextareaSchema': Ts_TextareaSchema;
  'form.zod.ts#ToggleSchema': Ts_ToggleSchema;
  'layout.zod.ts#AspectRatioSchema': Ts_AspectRatioSchema;
  'layout.zod.ts#BoxSchema': Ts_BoxSchema;
  'layout.zod.ts#CardSchema': Ts_CardSchema;
  'layout.zod.ts#ContainerSchema': Ts_ContainerSchema;
  'layout.zod.ts#DivSchema': Ts_DivSchema;
  'layout.zod.ts#HtmlElementSchema': Ts_HtmlElementSchema;
  'layout.zod.ts#SemanticElementSchema': Ts_SemanticElementSchema;
  'layout.zod.ts#FlexSchema': Ts_FlexSchema;
  'layout.zod.ts#GridSchema': Ts_GridSchema;
  'layout.zod.ts#IconSchema': Ts_IconSchema;
  'layout.zod.ts#ImageSchema': Ts_ImageSchema;
  'layout.zod.ts#PageNodeRegionSchema': Ts_PageNodeRegion;
  'layout.zod.ts#PageNodeSchema': Ts_PageNodeSchema;
  'layout.zod.ts#ResizablePanelSchema': Ts_ResizablePanel;
  'layout.zod.ts#ResizableSchema': Ts_ResizableSchema;
  'layout.zod.ts#ScrollAreaSchema': Ts_ScrollAreaSchema;
  'layout.zod.ts#SeparatorSchema': Ts_SeparatorSchema;
  'layout.zod.ts#StackSchema': Ts_StackSchema;
  'layout.zod.ts#TabItemSchema': Ts_TabItem;
  'layout.zod.ts#TabsSchema': Ts_TabsSchema;
  'layout.zod.ts#TextSchema': Ts_TextSchema;
  'layout.zod.ts#TextSpanSchema': Ts_TextSpanSchema;
  'navigation.zod.ts#BreadcrumbItemSchema': Ts_BreadcrumbItem;
  'navigation.zod.ts#BreadcrumbSchema': Ts_BreadcrumbSchema;
  'navigation.zod.ts#ButtonGroupButtonSchema': Ts_ButtonGroupButton;
  'navigation.zod.ts#ButtonGroupSchema': Ts_ButtonGroupSchema;
  'navigation.zod.ts#HeaderBarSchema': Ts_HeaderBarSchema;
  'navigation.zod.ts#NavigationMenuSchema': Ts_NavigationMenuSchema;
  'navigation.zod.ts#PaginationSchema': Ts_PaginationSchema;
  'navigation.zod.ts#SidebarSchema': Ts_SidebarSchema;
  'objectql.zod.ts#ObjectCalendarSchema': Ts_ObjectCalendarSchema;
  'objectql.zod.ts#ObjectChartSchema': Ts_ObjectChartSchema;
  'objectql.zod.ts#ObjectDataTableSchema': Ts_ObjectDataTableSchema;
  'objectql.zod.ts#ObjectFormSchema': Ts_ObjectFormSchema;
  'objectql.zod.ts#ObjectGallerySchema': Ts_ObjectGallerySchema;
  'objectql.zod.ts#ObjectGanttSchema': Ts_ObjectGanttSchema;
  'objectql.zod.ts#ObjectGridSchema': Ts_ObjectGridSchema;
  'objectql.zod.ts#ObjectKanbanSchema': Ts_ObjectKanbanSchema;
  'objectql.zod.ts#ObjectMapConfigSchema': Ts_ObjectMapConfig;
  'objectql.zod.ts#ObjectMapSchema': Ts_ObjectMapSchema;
  'objectql.zod.ts#ObjectTreeSchema': Ts_ObjectTreeSchema;
  'objectql.zod.ts#ObjectViewSchema': Ts_ObjectViewSchema;
  'objectql.zod.ts#SortConfigSchema': Ts_SortConfig;
  'overlay.zod.ts#AlertDialogSchema': Ts_AlertDialogSchema;
  'overlay.zod.ts#ContextMenuSchema': Ts_ContextMenuSchema;
  'overlay.zod.ts#DialogSchema': Ts_DialogSchema;
  'overlay.zod.ts#DrawerSchema': Ts_DrawerSchema;
  'overlay.zod.ts#DropdownMenuSchema': Ts_DropdownMenuSchema;
  'overlay.zod.ts#HoverCardSchema': Ts_HoverCardSchema;
  'overlay.zod.ts#MenubarMenuSchema': Ts_MenubarMenu;
  'overlay.zod.ts#MenubarSchema': Ts_MenubarSchema;
  'overlay.zod.ts#PopoverSchema': Ts_PopoverSchema;
  'overlay.zod.ts#SheetSchema': Ts_SheetSchema;
  'overlay.zod.ts#TooltipSchema': Ts_TooltipSchema;
  'record-approval-decision.zod.ts#RecordApprovalDecisionBlockSchema': Ts_RecordApprovalDecisionBlockSchema;
  'record-panels.zod.ts#RecordApprovalsBlockSchema': Ts_RecordApprovalsBlockSchema;
  'record-panels.zod.ts#RecordAttachmentsBlockSchema': Ts_RecordAttachmentsBlockSchema;
  'reports.zod.ts#ReportBuilderSchema': Ts_ReportBuilderSchema;
  'reports.zod.ts#ReportComponentSchema': Ts_ReportComponentSchema;
  'reports.zod.ts#ReportExportConfigSchema': Ts_ReportExportConfig;
  'reports.zod.ts#ReportFieldSchema': Ts_ReportField;
  'reports.zod.ts#ReportFilterSchema': Ts_ReportFilter;
  'reports.zod.ts#ReportGroupBySchema': Ts_ReportGroupBy;
  'reports.zod.ts#ReportSectionSchema': Ts_ReportSection;
  'reports.zod.ts#ReportViewerSchema': Ts_ReportViewerSchema;
  'views.zod.ts#DetailSectionNodeSchema': Ts_DetailSectionNodeSchema;
  'views.zod.ts#DetailViewFieldSchema': Ts_DetailViewField;
  'views.zod.ts#DetailViewSchema': Ts_DetailViewSchema;
  'views.zod.ts#DetailViewSectionSchema': Ts_DetailViewSection;
  'views.zod.ts#DetailViewTabSchema': Ts_DetailViewTab;
  'views.zod.ts#FilterUISchema': Ts_FilterUISchema;
  'views.zod.ts#SortUISchema': Ts_SortUISchema;
  'views.zod.ts#ViewSwitcherSchema': Ts_ViewSwitcherSchema;
}

export type MirrorKey = keyof typeof MIRRORS;

/** The two halves of the registry must describe the same population. */
export type assertionRegistryHalvesAgree = Expect< Equal< MirrorKey, keyof Declared > >;

/** The TYPE drift on one registered pair: mirrored, but the mirror refuses the declared type. */
export type DriftOf< K extends MirrorKey > = NarrowerThanDeclared< (typeof MIRRORS)[K], Declared[K] >;

/** The other half: declared on the TS side, absent from the mirror's `.shape` entirely. */
export type UnmirroredOf< K extends MirrorKey > = UnmirroredDeclaredKeys< (typeof MIRRORS)[K], Declared[K] >;

/** The third direction: mirrored, and the mirror ACCEPTS more than the declaration admits. */
export type WiderOf< K extends MirrorKey > = WiderThanDeclaredKeys< (typeof MIRRORS)[K], Declared[K] >;

/** The fourth direction (objectui#9711): mirrored on the zod side, undeclared on the TS side. */
export type MirroredUndeclaredOf< K extends MirrorKey > =
  MirroredUndeclaredKeys< (typeof MIRRORS)[K], Declared[K] >;

/** What one registered pair's mirror ACCEPTS for one key — the static INPUT face. */
export type MirrorInputOf< K extends MirrorKey, P extends MirroredKeys< (typeof MIRRORS)[K] > > =
  InputOf< ShapeOf< (typeof MIRRORS)[K] >[P] >;

/** What the DECLARATION admits for the same key, for the side-by-side comparison. */
export type DeclaredTypeOf< K extends MirrorKey, P extends keyof Declared[K] > = Declared[K][P];

/* ── The measured drift ledger ──────────────────────────────────────────────── */

/**
 * Exact drifted key set per pair, measured against `origin/main`. Pinned exactly:
 * new drift on a listed mirror fails, and so does a listed key that has been fixed.
 */
interface KnownDrift {
  /**
   * RUNTIME SLOT (objectui#6124 shape, settled by objectui#10874): `ai-recommendations`
   * registers the raw `AIRecommendations` component, `SchemaRenderer` spreads the
   * node's own keys onto its props, and it CALLS both (`onSelect?.(item)`,
   * `onDismiss?.(item)`), so the TS side declares the callables and the mirror
   * refuses them by name (`handlerKeyRefusal(…, 'runtime-slot')`). The pair was born
   * ledgered by objectui#10859 against a TS twin that still read `string`; the entry
   * is unchanged in content, and only its reason moved into this class.
   */
  'ai.zod.ts#AIRecommendationsSchema': 'onDismiss' | 'onSelect';
  /**
   * RUNTIME SLOT (objectui#6124 shape, settled by objectui#10874): `nl-query` registers
   * the raw `NLQueryInput` component, which CALLS `onSubmit` off the spread props
   * with the query text (`onSubmitProp?.(queryText)`), so the TS side declares the
   * callable and the mirror refuses it by name — same history as
   * `AIRecommendationsSchema` above.
   */
  'ai.zod.ts#NLQuerySchema': 'onSubmit';
  /**
   * INTERFACE-TO-PASSTHROUGH (objectui#8347), an artifact of this ratchet's
   * assignability test and ⛔ not a narrowing a document can hit. The member is a
   * node type declared as an `interface`; its mirror is a `.passthrough()` object,
   * whose `z.input` carries `[k: string]: unknown`. TypeScript grants an IMPLICIT
   * index signature to anonymous and mapped object types and never to an
   * interface, so an interface is not assignable to it. While `BaseSchema`
   * carried `[key: string]: any` the declared member had an explicit signature
   * and fit; objectui#8347 removed it. Measured at removal: a one-level anonymous
   * copy of the declared type (`{ [P in keyof D]: D[P] }`) IS assignable to the
   * same mirror input, so the residue is exactly the interface rule. The four
   * `reports.zod.ts` entries below are the same cause. They leave if the
   * operator learns the rule, or if the member stops being an interface.
   */
  'app.zod.ts#AppSchemaRendererNodeSchema': 'schema';
  /**
   * RUNTIME SLOT (objectui#6124): `calendar-view`'s `pickHostCallbacks` reads
   * `onViewChange` off the spread props (function values only) and hands it to
   * `CalendarView`. `onEventClick` joined with objectui#7344 — the same channel;
   * its mirror was a multi-line `z.function()` that PR #7339's census missed.
   */
  'complex.zod.ts#CalendarViewSchema': 'onEventClick' | 'onViewChange';
  /**
   * ⭐ `body` — RULED, and therefore GONE from this row (objectui#8572, maintainer
   * ruling A, decision batch #137 item 4, 2026-09-15). It was ledgered here as two
   * different meanings of one key: `SchemaNode | SchemaNode[]` on the declaration (the
   * content slot) against `Record<string, unknown>` on the mirror ("Additional API body
   * params") — the naming collision this entry recorded as "to rule on, not a widening",
   * and the thing that made `chatbot` the one arm whose output was not assignable to
   * `SchemaNode`. The ruling does not pick one of the two meanings: it RETIRES the
   * record arm — `retirementTombstone()` on the mirror, `?: never` on the declaration —
   * and leaves the chat API's params where the renderer already read them,
   * `requestBody`. ⇒ the two faces now say the same thing about the key, it measures
   * clean, and the entry would be STALE if it kept naming it (the `a listed key that has
   * been fixed` half of this ledger's own ratchet). ⛔ Do not re-add `body` to keep the
   * history readable — the history is this paragraph, beside the keys that remain.
   *
   * `onError` / `onSend` — RUNTIME SLOT (objectui#6124): `plugin-chatbot` forwards both off
   * `schema.*` into `useObjectChat`, so the TS side keeps the callables; the mirror
   * refuses them by name (`handlerKeyRefusal`). See the class note above `ButtonSchema`.
   */
  'complex.zod.ts#ChatbotSchema': 'onError' | 'onSend';
  /**
   * RUNTIME SLOT (objectui#6124) — pairs born ledgered by objectui#7655, which gave
   * the `chatbot-enhanced` and `chatbot-floating` registrations their own faces.
   * Each face keeps the callables its registration forwards off `schema.*` —
   * `onError` and `onSend` into `useObjectChat`, `onClear` from `handleClear` —
   * and the mirror refuses all three by name (`handlerKeyRefusal`). No `body`
   * here: these twins mirror the key the renderer reads, `requestBody`, and
   * inherit `body` as the children slot, so `ChatbotSchema`'s naming collision
   * was deliberately not copied across.
   */
  'complex.zod.ts#ChatbotEnhancedSchema': 'onClear' | 'onError' | 'onSend';
  /** The same three slots on the same channel — see `ChatbotEnhancedSchema` above. */
  'complex.zod.ts#ChatbotFloatingSchema': 'onClear' | 'onError' | 'onSend';
  /**
   * `widgets` — the objectui widget element (`DashboardWidgetSchema`, carrying the
   * legacy `component` envelope the spec has no room for) against the declaration's
   * two-arm slot; see that element's own entry below.
   *
   * `header` and `globalFilters` LEFT under objectui#7759 group A. Both are declared
   * by the spec's `DashboardSchema`, so under that card's ruling (5617465269,
   * principle 1) both faces now follow the spec, both ways: the declaration dropped
   * its hand-written `header` (whose `actions[].actionUrl` was optional and
   * `actions[].actionType` an open string, both of which the mirror refused) and
   * inherits the spec's; the mirror's `GlobalFilterSchema` dropped its local
   * `options` restatement (whose `label` was `z.string()`, refusing the inline
   * per-locale map the declaration admits) and IS the spec's schema. Each key was
   * also in `WiderThanDeclared` — each face refused something the other accepted —
   * and left that ledger in the same change.
   *
   * `aria` was a FOURTH drifted key here until objectui#5855 retired
   * `DashboardComponentSchema.aria` from the declaration as spec-tombstoned and
   * renderer-dead. Dropping it from the declaration dropped it from the
   * comparison, and this entry going stale is precisely what surfaced that.
   */
  'complex.zod.ts#DashboardComponentSchema': 'widgets';
  /**
   * `options` — TS declares `unknown`; the mirror declares a structured options object.
   * The mirror is the STRICTER side here — narrowing the check would be wrong, widening
   * the TS declaration is the ADR-0049 question.
   *
   * `component` — INTERFACE-TO-PASSTHROUGH since objectui#12163 (the class the
   * `app.zod.ts#AppSchemaRendererNodeSchema` entry above describes), an artifact of this
   * ratchet's assignability test and ⛔ not a narrowing a document can hit. Ruling C
   * (comment 6121298298) gave the slot one accept set on both faces: the declaration is the
   * component arm alone, `DashboardWidgetSlotComponentSchema`, and the mirror refuses every
   * other node by name. That arm's declaration is an `interface` and its mirror is a
   * `.passthrough()` object, so the interface is not assignable to the mirror's
   * `[k: string]: unknown` input. Measured on the objectui#12163 branch: every member of the
   * declaration is assignable to the mirror's, and a one-level anonymous copy of the
   * declaration (`{ [P in keyof D]: D[P] }`) is assignable to the whole mirror input, so the
   * residue is exactly the interface rule. Before objectui#12163 the key was ledgered here
   * for the declaration's `SchemaNode` arm, whose five primitive arms the mirror's
   * `BaseSchema` arm refused; that arm and its primitives left both faces, and the
   * interface rule is what remains.
   *
   * ⚠️ This entry is the reason objectui#8344 could not read its own type-check as green:
   * the ledger is a TYPE MAP over the mirrors, so a `complex.zod.ts` edit moves a row
   * INSIDE this file without editing it, and `tsc -p tsconfig.json` (the BUILD project)
   * excludes every `.test.ts` under `src` and stays green while `tsconfig.test.json`
   * reddens.
   *
   * `type` LEFT under objectui#11514. It joined with objectui#11483, which dropped the
   * component type `metric-card` from the mirror's widget vocabulary while the TS
   * interface kept it, because the interface was also the read type of every
   * `widgets[]` entry. objectui#11514 moved `plugin-dashboard`'s slot-entry reads onto
   * the slot's element type and dropped the component type on this face too, so both
   * faces name the same widget vocabulary and the key measures clean.
   */
  'complex.zod.ts#DashboardWidgetSchema': 'component' | 'options';
  /**
   * `onChange` — RUNTIME SLOT (objectui#6124): the `filter-builder` renderer
   * calls it as `props.onChange` after `SchemaRenderer`'s spread. (`fields` LEFT
   * under objectui#10286 with `FilterFieldSchema.operators`, whose element drift it
   * inherited: both faces now take the spec's `VIEW_FILTER_OPERATORS` by reference.
   * `complex.zod.ts#FilterFieldSchema` left this ledger WHOLE on the same card —
   * `operators` was its only key.)
   */
  'complex.zod.ts#FilterBuilderSchema': 'onChange';
  /**
   * ⛔ `complex.zod.ts#KanbanSchema` LEFT this ledger with its pair: objectui#8802
   * retired the bare `kanban` node type key (maintainer ruling 2026-09-09) and
   * both faces of the arm retired with it. The three RUNTIME SLOTS it recorded —
   * `onCardMove`, `onCardClick`, `onQuickAdd` — are not drifting any more
   * because there is no pair left to drift; a `{ "type": "kanban" }` document is
   * refused BY NAME by `RetiredKanbanNodeSchema`, pinned in
   * `./bare-kanban-node-key-retired-8802.test.ts`.
   *
   * ⚠️ Recorded rather than repaired AT THE TIME: `KanbanRenderer` forwarded
   * all three and the SURVIVING `objectql.zod.ts#ObjectKanbanSchema` pair
   * declared none, so they were read-but-undeclared on the surviving face.
   * Both halves of that have since landed — objectui#7804 declared the two
   * live slots, and objectui#9342 moved the `onCardMove` READ to an explicit
   * React prop and tombstoned the key on both faces.
   */
  /**
   * RUNTIME SLOT (objectui#7344): `register('detail', DetailView)` — `DetailView`'s
   * `handleBack` calls `onBack()` when set. The mirror was `z.any()` (wider than
   * the declared callable, objectui#7069's direction); it now refuses by name.
   *
   * `onNavigate` and `onAddComment` joined with objectui#7804 (batch #69), and
   * they drift for the SAME reason `onBack` does — a callable twin against a
   * named refusal — but they reach that state from the opposite side. `onBack`
   * was declared on both faces and the mirror was too WIDE. These two were
   * declared on NEITHER: the TypeScript face typed them `any` through
   * `BaseSchema`'s index signature and the mirror kept them through
   * `.passthrough()`, while `DetailView` read and ran them. ⇒ this entry
   * GREW by a repair, which is the direction this ledger's drift entries
   * normally shrink in; the growth is the declaration arriving, not a
   * regression.
   */
  'crud.zod.ts#DetailSchema': 'onBack' | 'onNavigate' | 'onAddComment';
  /**
   * `rowActions` was the FIFTH key here until objectui#6940 settled the ruling
   * this entry was explicitly waiting on. It read: DISJOINT — TS declares
   * `rowActions?: boolean` (show the column or not), the mirror declared
   * `any[]` (the actions themselves); one of the two is dead, which is a
   * ruling. The maintainer ruled the TS side live (2026-09-02, director seat
   * summon #8, option A): the renderer only truthiness-tests the key, so the
   * `any[]` face was the dead one, and the mirror became
   * `z.boolean().optional()`. The pair is now IN PARITY on that key, so it left
   * this entry — this ledger fails on a repair exactly as it fails on new
   * drift, which is why correcting this line was part of that change and not
   * optional. (`selectable` was likewise a drifted key here until objectui#5927
   * widened the mirror to `boolean | 'single' | 'multiple'` —
   * `resolveSelectionMode` in `renderers/complex/data-table.tsx` implements
   * `'single'` as a real mode.)
   *
   * The eleven callbacks — RUNTIME SLOT (objectui#6124) ×11: `renderers/complex/data-table.tsx`
   * CALLS every one of them off `schema.*` (`schema.onRowEdit?.(r)`,
   * `schema.onSelectionChange(selectedData)`, …), so the TS side keeps them callable
   * and the mirror refuses them by name.
   *
   * ⭐ It was FOUR until objectui#7804's `DataTableSchema` slice. The other seven
   * — `onAddRecord`, `onBatchSave`, `onCellChange`, `onColumnResize`,
   * `onRowActionDef`, `onRowClick`, `onRowSave` — arrived from
   * `RuntimeOnlyDeclared` below, where they sat as declared-on-TS-only keys while
   * the registered renderer read and ran each one and `BaseSchema.passthrough()`
   * ACCEPTED an authored `{ "action": "toast" }` for any of them.
   *
   * ⚠️ The disposition was measured per key, and one of the seven does NOT share
   * the group's channel: `onColumnResize` has no host prop anywhere — `ObjectGrid`
   * supplies its own closure and folds the resize into the merged column layout it
   * persists, while the other six arrive as React props a host hands `ObjectGrid`
   * or `RelatedList`. Still a live function reaching the renderer through the TS
   * face, so still a runtime slot; had it been read as `'retired'` off its
   * siblings, the arm would publish "no renderer reads this key" to every author
   * who trips it, and objectui#6175 wired that read on purpose.
   */
  'data-display.zod.ts#DataTableSchema':
    | 'onRowEdit' | 'onRowDelete' | 'onSelectionChange' | 'onColumnsReorder'
    | 'onAddRecord' | 'onBatchSave' | 'onCellChange' | 'onColumnResize'
    | 'onRowActionDef' | 'onRowClick' | 'onRowSave'
    // objectui#7759 group E — `renderCellEditor` is a RUNTIME SLOT in the
    // objectui#6124 shape (`data-table` reads `schema.renderCellEditor` and calls
    // it; `ObjectGrid` supplies it). `columns` is inherited ELEMENT drift: the
    // element's `cell` is the same class, one level down (`TableColumnSchema`).
    | 'renderCellEditor' | 'columns'
    // objectui#12620 — `rowGroups` is a RUNTIME SLOT of the same shape: host-built
    // React bands that `data-table` draws (`ObjectGrid` supplies them for a
    // grouped view); a React node is no more JSON than a function, so the mirror
    // refuses it by name.
    | 'rowGroups';
  /** RUNTIME SLOT (objectui#7759 group E, the objectui#6124 shape): `data-table`, `ObjectGrid` and `VirtualGrid` call `col.cell(value, row)`. */
  'data-display.zod.ts#TableColumnSchema': 'cell';
  /**
   * RUNTIME SLOT (objectui#6124), arrived with objectui#7804's `TreeViewSchema`
   * slice — a NEW entry here, not growth on an existing one, because
   * `TreeViewSchema` had no `KnownDrift` entry at all.
   *
   * `renderers/data-display/tree-view.tsx` gates on `if (schema.onNodeClick)`
   * and CALLS `schema.onNodeClick(node)`, so the TS side keeps it callable and
   * the mirror refuses it by name. The key came from `RuntimeOnlyDeclared`
   * below, which LOST ITS ONLY `TreeViewSchema` ENTRY in the same move — ⚠️ one
   * move seen from both sides, and the move that finally made
   * `RuntimeOnlyDeclared` a subset of `UnmirroredDeclared`; the cross-ledger
   * sentence in this file's header records that, and the pin that reads it
   * changed shape for it.
   *
   * ⚠️ Measured `'runtime-slot'` and NOT `'retired'` although NO in-repo host
   * builds a `tree-view` node carrying it: the read is live and invoked, so
   * `'retired'` would publish "no renderer reads this key" to the author who
   * trips it. Same shape as `ObjectFormSchema.onStepChange` in this card's
   * `objectql.ts` slice — channel wired end to end, supplier absent.
   */
  'data-display.zod.ts#TreeViewSchema': 'onNodeClick';
  /** RUNTIME SLOT (objectui#6124): the `accordion` renderer spreads leftover props onto the Radix `Accordion` root, where `onValueChange` is a real prop. */
  'disclosure.zod.ts#AccordionSchema': 'onValueChange';
  /** RUNTIME SLOT (objectui#6124): the `collapsible` renderer spreads leftover props onto the Radix `Collapsible` root. */
  'disclosure.zod.ts#CollapsibleSchema': 'onOpenChange';
  /** RUNTIME SLOT (objectui#6124): the `toggle-group` renderer spreads `toggleGroupProps` onto the Radix `ToggleGroup` root. */
  'disclosure.zod.ts#ToggleGroupSchema': 'onValueChange';
  /**
   * ## The objectui#6124 class — a RUNTIME SLOT on the TS face, a NAMED REFUSAL on the mirror
   *
   * Maintainer ruling 2026-08-30 (batch #8, Q2 → A with C): the 58 `on*` keys the
   * mirrors declared as `z.function()` — a type NO JSON document can satisfy — keep
   * their declaration and REFUSE BY NAME (`handlerKeyRefusal()` in
   * `../zod/tombstone.zod.ts`, the #5099 `z.custom` + guidance shape), because under
   * `BaseSchema.passthrough()` deleting a key is a SILENT accept that keeps the value
   * and forwards it to the DOM. The mirror's `z.input` for such a key is therefore
   * `undefined` — a JSON author cannot write it — while the TypeScript twin of a key
   * whose function value REACHES a renderer stays callable, because that is the
   * programmatic channel (`SchemaRenderer` spreads every non-metadata schema key as a
   * React prop; renderers read `schema.onX`, call `props.onX`, or spread leftovers onto
   * a Radix root / DOM listener slot). Two faces of one key, both true, measured per
   * key — a DELIBERATE divergence like `PageNodeSchema.pageType`, not debt to widen
   * away. ⛔ Do not "fix" one of these by making the mirror accept a function again
   * (that re-opens the JSON lie) or by deleting the TS member (that breaks the shipped
   * renderer that reads it).
   *
   * The 22 keys NOTHING reads are not in this ledger at all: their TS twin is a
   * `?: never` tombstone, so `undefined` meets `undefined` and the pair does not drift
   * on them. Every one of the 58 is pinned member-by-member, both faces, in
   * `handler-keys-json-refusal-6124.test.ts`; this ledger records the 35 that drift.
   *
   * `ButtonSchema.onClick` — RUNTIME SLOT (objectui#6124): `toFormControlDomProps` forwards it
   * to the DOM `<button>` (`onClick` is on `SDUI_DOM_PASS_THROUGH_KEYS`).
   */
  'form.zod.ts#ButtonSchema': 'onClick';
  /** RUNTIME SLOT (objectui#6124): the `checkbox` renderer calls `props.onChange(checked)` after `SchemaRenderer`'s spread. */
  'form.zod.ts#CheckboxSchema': 'onChange';
  /** RUNTIME SLOT (objectui#6124): `plugin-editor` reads `onChange ?? schema.onChange`. */
  'form.zod.ts#CodeEditorSchema': 'onChange';
  // `form.zod.ts#ComboboxSchema` and `form.zod.ts#CommandSchema` LEFT this ledger under
  // objectui#6033 (ruling C7 / C8). Each entry held one OPTIONALITY key — TS declared
  // `options?` / `groups?`, the mirror REQUIRED it. The ruling's ground was re-measured
  // first: both registered renderers draw a node with the key absent and do not throw
  // (`combobox` reads `schema.options || []`, `command` reads `schema.groups?.map`), and
  // the spec declares neither node. So the mirror went `.optional()` and the two faces now
  // agree; `combobox-command-optional-6033.test.ts` pins the accept set. (`onChange` on
  // `CommandSchema` stays OUT of this ledger for the reason it always did: the `command`
  // renderer spreads it onto cmdk's root `div`, where React fires it with a SyntheticEvent,
  // so both faces retire it.)
  /** RUNTIME SLOT (objectui#6124): the `date-picker` renderer calls `props.onChange(date)` after `SchemaRenderer`'s spread. */
  'form.zod.ts#DatePickerSchema': 'onChange';
  /** RUNTIME SLOT (objectui#7759 group E, the objectui#6124 shape): the form renderer spreads `validation` into react-hook-form's `rules` and keeps a supplied `validate` running. */
  'form.zod.ts#FieldConstraintsSchema': 'validate';
  /** RUNTIME SLOT (objectui#6124): the `file-upload` renderer calls `props.onChange(files)` after `SchemaRenderer`'s spread. */
  'form.zod.ts#FileUploadSchema': 'onChange';
  /** Inherited drift: `validation` is `FieldConstraintsSchema`, whose `validate` is the runtime slot in its own entry. (`condition`'s `custom` is RETIRED on both faces, so it measures clean.) */
  'form.zod.ts#FormFieldSchema': 'validation';
  /**
   * `fields` is inherited element drift. (`mode` LEFT under objectui#10286: it was
   * DISJOINT — TS `disabled|read|edit`, mirror `create|edit|view` — and neither was
   * read; the key is not in the spec, so both faces retired it under the objectui#7759
   * ruling's D1-(ii).) (`validationMode` was a third drifted key until
   * objectui#5927 widened it to react-hook-form's full `mode` vocabulary —
   * `useForm({ mode })` in `renderers/form/form.tsx` forwards it verbatim and RHF
   * implements `onTouched`/`all` as real branches.)
   *
   * `onSubmit` / `onChange` / `onCancel` — RUNTIME SLOT (objectui#6124) ×3: `renderers/form/form.tsx`
   * destructures all three off `schema` and calls them (`await onSubmitProp(formData)`,
   * the objectui#4259 `onChangeProp` subscription, `onCancelProp()`).
   */
  'form.zod.ts#FormSchema': 'fields' | 'onSubmit' | 'onChange' | 'onCancel';
  /** RUNTIME SLOT (objectui#6124): the `input-otp` renderer calls `props.onChange(val)` after `SchemaRenderer`'s spread. (`onComplete` is NOT here: the `toFormControlDomProps` whitelist drops it — both faces retire it.) */
  'form.zod.ts#InputOTPSchema': 'onChange';
  /** RUNTIME SLOT (objectui#6124): the `input` renderer calls `props.onChange(e.target.value)` after `SchemaRenderer`'s spread. */
  'form.zod.ts#InputSchema': 'onChange';
  /**
   * Inherited drift: `InputSchema`'s runtime slot above, reaching this face since
   * objectui#9256 repaired its `Omit` heritage (it declared nothing it inherited
   * before, so nothing could drift). Both registrations spread their props into the
   * same `input` renderer, so the slot is the same slot.
   */
  'form.zod.ts#InputShorthandSchema': 'onChange';
  /** RUNTIME SLOT (objectui#6124): the `select` renderer calls `props.onChange(matchOptionValue(…))` after `SchemaRenderer`'s spread. (This pair LEFT the ledger with objectui#5927's widenings and re-enters on a different key for a different reason.) */
  'form.zod.ts#SelectSchema': 'onChange';
  /** RUNTIME SLOT (objectui#6124): the `textarea` renderer calls `props.onChange(e.target.value)` after `SchemaRenderer`'s spread. */
  'form.zod.ts#TextareaSchema': 'onChange';
  /** RUNTIME SLOT (objectui#6124): the `card` renderer spreads `cardProps` onto the `<Card>` element (a DOM `onClick`) and reads it for `isClickable`. */
  'layout.zod.ts#CardSchema': 'onClick';
  /** `pageType` is a DELIBERATE divergence, documented at `PageVisualizationAlias` (`../layout.ts`): the TS side retains five visualization names as a sanctioned local extension while the mirror takes the spec's vocabulary by reference, which repudiates them. Widening the mirror would re-add spellings the spec rejects. */
  'layout.zod.ts#PageNodeSchema': 'slots' | 'pageType';
  /** RUNTIME SLOT (objectui#6124): the `tabs` renderer spreads `tabsProps` onto the Radix `Tabs` root AFTER its own `onValueChange`, so the authored function wins. */
  'layout.zod.ts#TabsSchema': 'onValueChange';
  // `navigation.zod.ts#HeaderBarSchema` LEFT this ledger under objectui#10286. Its one
  // key was `variant`, DISJOINT (TS `floating`, mirror `transparent`); the card measured
  // that NEITHER renders — the renderer reads no `variant` at all, through the real
  // `SchemaRenderer` every spelling drew the header byte-identical to its absence — and
  // the spec does not declare the key, so both faces retire it (`?: never` beside a
  // `retirementTombstone`).
  /** RUNTIME SLOT (objectui#6124): the `pagination` renderer calls `props.onPageChange(page)` after `SchemaRenderer`'s spread. */
  'navigation.zod.ts#PaginationSchema': 'onPageChange';
  /**
   * RUNTIME SLOT (objectui#6124 shape, minted by objectui#6576 / #6914): the pair
   * was born with this entry. `ObjectDataTable.tsx` forwards `schema.onRowClick`
   * into the `data-table` it renders (it used to read it through an
   * `(schema as any)` cast — #6914's drift), so the TS side keeps the callable
   * and the mirror refuses it by name. The FIRST handler arm on an `objectql`
   * mirror: the POLICY-group entries in `RuntimeOnlyDeclared` below record the
   * pre-#6124 state of that file, not a rule for new mirrors.
   */
  'objectql.zod.ts#ObjectDataTableSchema': 'onRowClick';
  /**
   * RUNTIME SLOT (objectui#6124 shape, declared by objectui#7804) ×5 — the
   * `objectql.ts` slice, which drained this pair's whole `RuntimeOnlyDeclared`
   * entry rather than shortening it. `plugin-form`'s `ObjectForm` reads every
   * one off `schema.*` and forwards it onto the variant node it renders, and
   * `ObjectFormComponentProps` declares only `schema` / `dataSource` /
   * `className` — so the `object-form` NODE a host builds in TypeScript is the
   * channel, and the TS side keeps all five callable while the mirror refuses
   * them by name.
   *
   * ⚠️ The disposition was measured per key, and one of the five does NOT share
   * the group's supplier: `onStepChange` has NO in-repo host filling it, while
   * `onSuccess` / `onCancel` have ten between them, `onOpenChange` three and
   * `onError` one. Its channel is wired end to end all the same — forwarded
   * onto the wizard node, then CALLED as `schema.onStepChange(step)` — so what
   * is missing is a supplier, not a read, and `'retired'` would have published
   * "no renderer reads this key" against a read that runs.
   */
  'objectql.zod.ts#ObjectFormSchema':
    | 'onCancel' | 'onError' | 'onOpenChange' | 'onStepChange' | 'onSuccess';
  /**
   * RUNTIME SLOT (objectui#6124 shape, declared by objectui#7804) ×2 — the
   * `objectql.ts` slice again, and the only pair in it whose keys were declared
   * on NEITHER face before. They are this ledger's PROPS-half shape:
   * `SchemaRenderer` spreads an authored node's leftover keys into the props
   * bag, and `ObjectGallery` reads both on ONE line
   * (`props.onRowClick ?? props.onCardClick`) before handing the winner to
   * `useNavigationOverlay` as the function it calls. So an authored value
   * reached a renderer through a face that declared nothing — with
   * `BaseSchema`'s index signature admitting it untyped — which is why
   * declaring them is a NARROWING on both faces at once.
   *
   * ⚠️ Measured per key: `onRowClick` has two in-repo suppliers (`ListView`'s
   * `baseProps`, `RelatedList`'s mobile branch), `onCardClick` has none and is
   * the `??` fallback spelling `ObjectGalleryProps` declares for a host that
   * uses that name.
   */
  'objectql.zod.ts#ObjectGallerySchema': 'onCardClick' | 'onRowClick';
  /**
   * RUNTIME SLOT (objectui#6124 shape, declared by objectui#7804) — the key the
   * maintainer's 2026-08-19 ruling on objectui#5234 (option C) kept DECLARED
   * for programmatic callers and kept OFF the authoring surface. "Not offered"
   * was true of the manifest and the designer panel; the validator still said
   * yes, because `BaseSchema` is `.passthrough()`. The named refusal closes
   * that half, and it makes this mirror agree with `@objectstack/spec`, whose
   * `ComponentPropsMap['object-grid']` `strictObject` already refused the key.
   *
   * ⚠️ No in-repo host builds an `object-grid` node carrying it — measured. The
   * read is live and deliberate (`onNavigate: onNavigate ?? schema.onNavigate`
   * into `useNavigationOverlay` — the fallback behind the component prop since
   * objectui#9547), and `plugin-grid`'s `gridNonAuthorKeys.test.tsx`
   * supplies it from a schema and asserts the call fires.
   */
  'objectql.zod.ts#ObjectGridSchema': 'onNavigate';
  /**
   * RUNTIME SLOT (objectui#6124 shape, declared by objectui#7804) — the same
   * key NAME as the entry above and nothing else in common: a different second
   * parameter (`mode: 'view' | 'edit'` rather than
   * `action: RecordNavigateAction`, objectui#9547), a different renderer, a
   * different supplier. Judged separately for exactly that reason.
   *
   * `plugin-view`'s `ObjectView` invokes it at four sites —
   * `schema.onNavigate('new', 'edit')` on create, and the record id with
   * `'edit'` / `'view'` on the other three. Supplied by `@object-ui/app-shell`'s
   * `ObjectView`, which builds the `object-view` node in TypeScript and puts
   * `onNavigate: (recordId, mode) => …` on it.
   *
   * ⭐ `form` is the SAME slice reaching one level down, and it is here by
   * measurement rather than by intent: this pair's nested form slot is the
   * sibling mirror BY REFERENCE
   * (`ObjectFormSchema.omit({ type, objectName, mode }).partial()`), while the
   * declaration types it `Partial<Pick<…, ObjectFormSlotKey>>` — and that
   * slot-key union lists exactly the handler keys this slice declared
   * (`onCancel`, `onError`, `onOpenChange`, `onStepChange`, `onSuccess`). So the
   * named refusals propagate into the nested config and an authored
   * `form: { onSuccess: … }` is refused there too. ⛔ NOT worked around by
   * omitting the keys from the nested lazy: that would keep accepting an
   * un-authorable function value one level down, which is the defect, not the
   * fix.
   *
   * `table` sat here for the same reason, on `onNavigate`, until objectui#10976
   * narrowed `ObjectGridSlotKey` to the grid keys `ObjectView` hands its grid.
   * `ObjectView` never relayed `table.onNavigate`, so the declaration stopped
   * typing it, and the nested mirror refuses it by name with the slot's other
   * withheld keys. Both faces now refuse it, and `table` measures clean. ⛔ Its
   * refusal was not dropped to get there: the key is refused, not omitted.
   */
  'objectql.zod.ts#ObjectViewSchema': 'onNavigate' | 'form';
  /**
   * RUNTIME SLOT (objectui#6124 shape, declared by objectui#7804) ×2 — the
   * SECOND handler entry on this mirror, and the first anywhere in this ledger
   * that was born from an ARM RETIREMENT rather than from a mirror or a
   * declaration moving. The three keys `KanbanRenderer` forwards off `schema.*`
   * sat on the `complex.zod.ts#KanbanSchema` entry until objectui#8802 retired
   * the bare `kanban` node type key; the reads stayed, on the surviving
   * `object-kanban` face, declared by neither side.
   *
   * The two here are declared because their function value REACHES the board on
   * that face, measured one channel at a time and NOT shared across the prefix
   * (`plugin-kanban`'s `__tests__/handlerKeyDispositionsMeasured-7804.test.tsx`):
   * `onQuickAdd` arrives at the board implementation BY IDENTITY through
   * `ObjectKanban`'s schema spread, and `onCardClick` — substituted on that
   * spread — arrives instead as the React PROP `ObjectKanbanComponentProps`
   * declares, which `ObjectKanban`'s own wrapper CALLS.
   *
   * ⚠️ The THIRD key, `onCardMove`, is still NOT here, and the reason CHANGED
   * with objectui#9342 — it is not drift either way. It used to be absent
   * because NEITHER face declared it (`undefined` meeting `undefined`); since
   * objectui#9342 BOTH faces declare it as a tombstone — `?: never` on the
   * TypeScript twin, `handlerKeyRefusal(…, 'retired', …)` on this mirror — and
   * a matched pair of tombstones is the shape `complex.zod.ts#CarouselSchema`
   * already carries for `onSlideChange`, which is likewise not in this ledger.
   * Its `'retired'` reading is objectui#7804's measurement (an authored value
   * reaches nothing: `ObjectKanban` substitutes its own mover and declares no
   * `onCardMove` React prop); what was missing was the precondition, and
   * objectui#9342 supplied it by moving `KanbanRenderer`'s read onto an
   * explicit React prop so `check:handler-key-reads` would accept a tombstone.
   *
   * ⭐ `onQuickAdd` LEFT this entry with objectui#11234, the same way
   * `onCardMove` never entered it: both faces now declare it as a tombstone —
   * `?: never` on the TypeScript twin, `handlerKeyRefusal(…, 'retired', …)` on
   * this mirror — and a matched pair of tombstones is not drift. Its function
   * did arrive at the board by identity, but on `object-kanban` it was never
   * called, because its partner `quickAdd` is retired there (objectui#8285,
   * ruling B of decision batch #91). The read that kept it a slot was
   * `KanbanRenderer`'s, reached through `ObjectKanban`; `ObjectKanban` now
   * renders the internal `KanbanBoardCore`, which takes the Quick Add pair only
   * as explicit props, and it supplies neither. ONE key left and the entry
   * stays, on `onCardClick`, so the key total moved and the entry count did not.
   */
  'objectql.zod.ts#ObjectKanbanSchema': 'onCardClick';
  /**
   * RUNTIME SLOT (objectui#6124): the `alert-dialog` renderer spreads leftover props
   * onto the Radix `AlertDialog` root (`onOpenChange`). `onAction` joined with
   * objectui#7104, which DECLARED a key the renderer had been reading undeclared:
   * it is the action button's `onClick`, so the TS face keeps the callable and the
   * mirror refuses it by name. (`onConfirm` / `onCancel` are NOT here: the footer is
   * wired to `schema.onAction` and `AlertDialogCancel`, so nothing reads them — both
   * faces retire them.)
   */
  'overlay.zod.ts#AlertDialogSchema': 'onOpenChange' | 'onAction';
  /** RUNTIME SLOT (objectui#6124): the `dialog` renderer spreads leftover props onto the Radix `Dialog` root. */
  'overlay.zod.ts#DialogSchema': 'onOpenChange';
  /** RUNTIME SLOT (objectui#6124): the `drawer` renderer spreads leftover props onto the vaul `Drawer` root. */
  'overlay.zod.ts#DrawerSchema': 'onOpenChange';
  /** RUNTIME SLOT (objectui#6124): the `dropdown-menu` renderer spreads leftover props onto the Radix `DropdownMenu` root. (`MenuItemSchema.onClick`, the 36th runtime slot, is not a pair here — that mirror is a lazy union and sits in `EXCLUSIONS`.) */
  'overlay.zod.ts#DropdownMenuSchema': 'onOpenChange';
  /** RUNTIME SLOT (objectui#6124): the `hover-card` renderer spreads leftover props onto the Radix `HoverCard` root. */
  'overlay.zod.ts#HoverCardSchema': 'onOpenChange';
  /** RUNTIME SLOT (objectui#6124): the `popover` renderer spreads leftover props onto the Radix `Popover` root. */
  'overlay.zod.ts#PopoverSchema': 'onOpenChange';
  /** RUNTIME SLOT (objectui#6124): the `sheet` renderer spreads leftover props onto the Radix `Sheet` (Dialog) root. */
  'overlay.zod.ts#SheetSchema': 'onOpenChange';
  /**
   * INTERFACE-TO-PASSTHROUGH (objectui#8347): the same artifact as
   * `app.zod.ts#AppSchemaRendererNodeSchema` above — each member is, or holds,
   * a declared `interface` (`report` is `ReportComponentSchema`, `chart` is
   * `ChartSchema`, and `sections` holds `ReportSection`s, whose `chart` is)
   * against a `.passthrough()` mirror whose input demands a string index
   * signature an interface never implicitly has. Measured at removal for
   * `chart`: the declared type is refused, a one-level anonymous copy fits.
   */
  'reports.zod.ts#ReportBuilderSchema': 'report';
  /** INTERFACE-TO-PASSTHROUGH (objectui#8347): see `ReportBuilderSchema` above; `sections` carries the element. */
  'reports.zod.ts#ReportComponentSchema': 'sections';
  /** INTERFACE-TO-PASSTHROUGH (objectui#8347): see `ReportBuilderSchema` above. */
  'reports.zod.ts#ReportSectionSchema': 'chart';
  /** INTERFACE-TO-PASSTHROUGH (objectui#8347): see `ReportBuilderSchema` above. */
  'reports.zod.ts#ReportViewerSchema': 'report';
  /**
   * RUNTIME SLOT (objectui#7344): `detail-view` spreads the node's keys onto
   * `DetailView`, whose `handleBack` calls `onBack()`. The TS twin declared the
   * handler-expression STRING (objectui#6182: not an authoring form) and now
   * declares the callable the renderer invokes; the mirror refuses by name.
   *
   * ⭐ `onNavigate` and `onAddComment` JOINED with objectui#9447, arriving from
   * `RuntimeOnlyDeclared` below — ONE move seen from both sides, not a refiling,
   * the same drain the `objectql.zod.ts` departures took. Both are objectui#6124
   * runtime slots on the SAME component this entry already names: `detail-view`
   * registers `DetailViewRenderer`, whose data-source gate returns the node
   * unchanged or a shallow `{ ...base }` spread, so an authored value reaches
   * `DetailView`'s `schema.onNavigate` / `schema.onAddComment` by identity —
   * exactly as it does under `'detail'`, whose twin arm refused both by name
   * with objectui#7804. The TS face keeps the callable on all three.
   *
   * `fields` and `sections` JOINED with objectui#10296: they carry
   * `DetailViewFieldSchema` elements, so that pair's EXPECTED DIVERGENCE on
   * `options` (the entry below) is measured here one level up. Same cause,
   * not a separate finding.
   */
  'views.zod.ts#DetailViewSchema': 'onBack' | 'onNavigate' | 'onAddComment' | 'fields' | 'sections';
  /**
   * EXPECTED DIVERGENCE, read model (objectui#10296, ruling F1 on objectui#7759).
   * The mirror is the spec's AUTHORING `SelectOptionSchema` by reference; the
   * declaration is `SelectOptionMetadata[]`, the runtime READ model. The one member
   * the two faces spell differently is `visibleWhen`: the spec's input envelope
   * requires `dialect`, the read model carries objectui's wire (objectui#2212),
   * where `dialect` is optional and `source` required. ⛔ Not repaired by pointing
   * the mirror at the declaration (it would admit `disabled` / `icon`, which the
   * spec refuses by name). Also in `WiderThanDeclared`, for the other half.
   */
  'views.zod.ts#DetailViewFieldSchema': 'options';
  /**
   * objectui#10296: `fields` carries `DetailViewFieldSchema` elements, so the
   * EXPECTED DIVERGENCE on that pair's `options` (the entry above) is measured
   * here one level up — the same reading as `fields` / `sections` on
   * `views.zod.ts#DetailViewSchema`. Same cause, not a separate finding.
   */
  'views.zod.ts#DetailViewSectionSchema': 'fields';
  /**
   * objectui#11515: the pair was REGISTERED here, born ledgered. The TS twin
   * takes each member from `DetailViewSection` by reference, as the arm
   * `.pick`s each from `DetailViewSectionSchema`, so its `fields` carries the
   * same `DetailViewField` elements and the EXPECTED DIVERGENCE on
   * `views.zod.ts#DetailViewFieldSchema`'s `options` is measured here one level
   * up, the reading the entry above records for the section. Same cause, not a
   * separate finding.
   */
  'views.zod.ts#DetailSectionNodeSchema': 'fields';
}

/* ── The measured unmirrored-declared ledger (objectui#6058) ────────────────── */

/**
 * Exact DECLARED-BUT-UNMIRRORED key set per pair: keys the published TypeScript
 * invites an author to write and the published validator has never heard of.
 *
 * ## ⚠️ READ THIS BEFORE QUOTING THE NUMBER — every figure in this heading is a
 * ## READING AT THE CARD THAT PRODUCED IT, never today's: 121 at objectui#6058, 98 by
 * ## RECLASSIFICATION at objectui#6152, 97 by the first REPAIR at objectui#6639, 96 by
 * ## RETIREMENT at objectui#7623, 94 by REPAIR again at objectui#7352, 87 by MIRRORING
 * ## BY REFERENCE at objectui#7779. Abridged — it names one card per step and skips
 * ## three movements the neighbouring steps absorb (objectui#6576 +1, objectui#7129
 * ## −1, objectui#7655 +2); the unabridged chain is the `UnmirroredDeclared` bullet in
 * ## the file header. ⛔ None of these is today's figure. Today's is one line down.
 *
 * objectui#6058 seeded this ledger at **121 keys**, and — on ONE line, because the
 * pin below reads this sentence off disk —
 * **5 keys** is what this ledger records today.
 * The movements between the two are different facts. objectui#6152 measured the 23
 * callback-shaped (`on*`) keys and ruled that mirroring is the wrong remedy for every
 * one of them;
 * they moved, intact and still pinned, to `RuntimeOnlyDeclared` below — ⛔ nothing
 * was mirrored, no declaration was removed, nothing was waived by that move. Then
 * objectui#6639 MIRRORED `ObjectGridSchema.title` (census-directed maintainer
 * ruling 2026-08-29, declare branch) — one defect actually repaired, the ledger's
 * first shrink by repair. Then objectui#7129 and objectui#7623 each RETIRED a key by
 * deleting the DECLARATION (`DetailViewSectionSchema.hideEmpty`;
 * `DashboardComponentSchema.title`) — shrinks by removal, which is neither a repair
 * of the mirror nor a waiver: the key stops being offered to authors at all. Then
 * objectui#7352 MIRRORED the two `drillDown` keys (`ChartSchema`,
 * `ObjectDataTableSchema`) by minting the `DrillDownConfigSchema` both entries named
 * as their remedy — the second and third repairs, and the first to close two entries
 * in one change. Then objectui#7655 SEEDED a `ChatbotFloatingSchema` entry with two
 * keys — growth, and the only growth this ledger has seen since the seed. Then
 * objectui#7779 MIRRORED eight of `ObjectViewSchema`'s keys BY REFERENCE and RETIRED a
 * ninth (`viewTabBar`) — the largest single shrink, and the movement this docstring
 * did not follow: the figure above read 94, fully green, until objectui#8243. Then
 * objectui#6152 round 1 MIRRORED nineteen of `ObjectFormSchema`'s keys, each measured
 * authored and read — larger than objectui#7779's shrink, and all of it by REPAIR.
 * The entry stayed, holding the two keys that round left open (`open`,
 * `submitHandler`), until objectui#6152 round 3 RECLASSIFIED both into
 * `RuntimeOnlyDeclared` by NAME and, in the same change, MIRRORED sixteen keys across
 * four other entries (`PaginationSchema`, `FormSchema`, `ReportComponentSchema`,
 * `DetailViewSchema`), each measured READ by a type-checker census — two routes, and
 * the two must not be added up as one repair. Then objectui#6152 round 4 moved
 * twenty-four keys by three routes: two MIRRORED (`ChatbotSchema.requestBody`,
 * `ChatbotFloatingSchema.floatingConfig`), four RETIRED on both faces
 * (`LabelSchema.content`, `ReportComponentSchema`'s `chartConfig` / `reportType`,
 * `DetailViewSchema.autoDiscoverRelated`), and eighteen RECLASSIFIED into
 * `RuntimeOnlyDeclared` by NAME (fourteen of `DataTableSchema`'s, four of
 * `DetailViewSchema`'s) — the largest single move since the seed, and mostly NOT a
 * repair. Then objectui#6152 round 5 moved four keys by two routes: two RETIRED on both
 * faces (`DataTableSchema.selectionStyle`, `ChatbotSchema.floatingConfig`) and two
 * RECLASSIFIED into `RuntimeOnlyDeclared` by NAME (`DataTableSchema`'s `editable` and
 * `singleClickEdit`) — ⛔ none of the four a repair, and none mirrored. Then objectui#6152
 * round 6 MIRRORED ten of `ObjectGridSchema`'s eleven keys, each measured READ — all of it
 * by REPAIR — and stopped at the eleventh, `resizableColumns`, whose ruled retirement
 * objectui#11276's move of the authored node into the spec's `properties` bag left open.
 * Then objectui#6152 round 7 RETIRED that eleventh key on both faces, once
 * `@objectstack/spec` 17.7.0 refused it in the `object-grid` row: `?: never` on the
 * interface, a `retirementTombstone()` on the mirror and `ObjectGrid`'s fallback read
 * dropped — a shrink by RETIREMENT, ⛔ not a repair, and the entry went with its one key.
 *
 * ## The decomposition of "121" — a reading at NAMED REVISIONS, so it cannot rot
 *
 * ⛔ What "121" used to mean is no longer restated as a LIVE decomposition, and
 * ⛔ do not restore one. objectui#8222 removed the file header's copy for a reason
 * that applies here too: every term but the reclassification needs each key's
 * PROVENANCE — which of today's keys descend from the seed — and no ledger in
 * this file records provenance; they record entry → key set as it stands. So no
 * instrument here can derive it, a live decomposition is unpinnable, and this one duly
 * rotted: it stood as `94 − 1 seeded + 3 mirrored + 2 retired + 23 reclassified`
 * from objectui#7352 through four ledger movements, three of which moved one of its
 * terms.
 *
 * What CAN be written down is a reading at NAMED REVISIONS — nothing later can make
 * it false, so it needs no pin against the ledger and no hand re-derivation at the next
 * repair. Measured by the walk `ledgerEntryMembers` performs, run over this file at two
 * commits:
 *
 *   - MEASURED at `beccf1c6b` — this repository's oldest reachable commit, after
 *     objectui#6152's RECLASSIFICATION and before objectui#6639's first REPAIR —
 *     this ledger held **98 keys**.
 *     ⭐ That is the positive control for the whole walk: it is exactly the
 *     `121 became 98` the heading states, arrived at from the other direction.
 *   - MEASURED at `ed7178bf3` (objectui#8242's landing, and the revision objectui#8243
 *     measured on), by SET INTERSECTION on entry → key pairs rather than by
 *     subtracting one total from another:
 *     **85** of those keys were still in the ledger and **13** had left.
 *   - So the seed decomposes, completely and with every term measured, as
 *     **85 + 13 + 23 = 121** — survivors, departures, and objectui#6152's
 *     reclassification. Those figures are pinned against each other by objectui#8243:
 *     arithmetic among historical readings only, and ⛔ nothing in that pin reads
 *     the live ledger, which is the whole reason it cannot rot.
 *
 * ⚠️ **One split below this is PROSE-DERIVED and must not be folded into the
 * figures above.** The 13 departures divide **10 MIRRORED / 3 RETIRED**, and that
 * division is read off the cards, not off any ledger: objectui#6639 mirrored
 * `ObjectGridSchema.title`; objectui#7129 retired `DetailViewSectionSchema.hideEmpty`;
 * objectui#7623 retired `DashboardComponentSchema.title`; objectui#7352 mirrored
 * `ChartSchema.drillDown`, the only one of its two `drillDown` rows that was ever part
 * of the 121 — `ObjectDataTableSchema`'s was seeded later by objectui#6576 and is in
 * neither measured set; objectui#7779 mirrored eight of `ObjectViewSchema`'s keys and
 * retired `viewTabBar`. 10 + 3 = 13 reconciles with the measurement, ⛔ which is not
 * the same as being measured. **The 13 is measured; the 10 / 3 is not**, and a later
 * reader must not collapse the two into one confident figure. (Measurable in principle
 * — a MIRRORED key is in the mirror today, a RETIRED one is declared nowhere —
 * but that would be a LIVE instrument, and a live instrument here is exactly the
 * maintenance cost this section was rewritten to remove.)
 *
 * ⚠️ Today's figure is NOT 85. Two keys entered this ledger AFTER the 121 —
 * `ChatbotFloatingSchema`'s `displayMode` and `floatingConfig`, seeded by objectui#7655
 * — and one of them is still here (objectui#6152 round 4 mirrored `floatingConfig`), so
 * the survivors plus `displayMode` are what the live figure above counts.
 * ⛔ Do not update the 85 when the ledger moves: it is a reading at `ed7178bf3` and
 * it stays one. The live figure is the pinned one, and it is the ONLY figure in this
 * docstring that moves.
 *
 * A card that cites 121 as the size of the mirroring problem, or any reading in the
 * heading's chain as a shrink from it, is wrong in both directions. objectui#6141 is
 * the standing example of what a silently moved count costs — it is why this
 * paragraph is in the ledger rather than in a commit message.
 *
 * ## ⛔ SHRINK-ONLY, and why a seed is a FLOOR rather than a waiver
 *
 * The obvious misreading is that seeding a ledger at 121 facts waives 121 defects.
 * It is the opposite, and the reason is that **before this ledger the guard saw
 * ZERO of them**. `NarrowerThanDeclared` maps over the INTERSECTION
 * `MirroredKeys< M > & keyof D`, so a declared key the mirror never mentions did
 * not compare unequal — it LEFT THE COMPARISON. Nothing that was previously caught
 * is being let through, because there was no such thing. Seeding takes the count of
 * VISIBLE, RATCHETED facts from 0 to 121 and installs a floor: the problem cannot
 * grow while they are worked off, and a new declared-but-unmirrored key on any of
 * the registered pairs reddens immediately (`assertionRatchetRejectsFreshDrift`) —
 * including a callback-shaped one, which reddens until it is filed in
 * `RuntimeOnlyDeclared` (`assertionSplitLedgerRejectsFreshCallback`).
 *
 * Same instrument and same discipline as objectui#6133's `KNOWN_HAND_TYPED_GUARDS`,
 * which is the landed precedent for this shape in this repo: seed at the measured
 * debt, fail on growth, fail on staleness, never offer a route that raises a line.
 *
 * ## What each entry is, and where the remedy lives
 *
 * ⚠️ The remedy is NOT uniformly "mirror the key" — objectui#6058's ruling is
 * explicit that forcing the 121 per-key decisions now would be wrong. Two splits
 * are recorded here so whoever works them off does not re-derive them:
 *
 *   - **SPEC-DERIVED (2 entries, 3 keys)** — it was 3 / 4 until objectui#6152 round 7
 *     RETIRED `ObjectGridSchema.resizableColumns` on both faces (a tombstone is a mirrored
 *     member): the entry emptied, so the half lost an entry and a key, and ⛔ nothing was
 *     mirrored. It was 3 / 14 until objectui#6152 round 6
 *     MIRRORED ten of `ObjectGridSchema`'s eleven keys: the entry kept `resizableColumns`,
 *     so it stayed in this half and only the keys moved, all ten by REPAIR. It was 4 / 16
 *     until objectui#6152 round 3
 *     moved `ObjectFormSchema`'s last two keys (`open`, `submitHandler`) to
 *     `RuntimeOnlyDeclared` by NAME: the entry emptied, so the half lost an entry and two
 *     keys, and ⛔ neither key was mirrored. It was 4 / 35 until objectui#6152 round 1
 *     MIRRORED nineteen of `ObjectFormSchema`'s keys: the entry kept two, so it stayed in
 *     this half and only the keys moved. It was 3 / 34 until objectui#11070 declared nine
 *     field-metadata members on `FormFieldSchema` by reference to the spec's `FieldSchema`:
 *     none of them was in the ledger, so no key closed, but the spec reference re-derives
 *     the pair's entry (its one key, `field`) into this half — the objectui#10993 membership
 *     move again, with ZERO keys repaired. It was 3 / 37 until objectui#11068 closed three
 *     keys of `ObjectGridSchema`'s entry (`emptyState` mirrored, `rowSpecActions` /
 *     `bulkSpecActions` tombstoned), an entry that stayed. It was 2 / 16 until objectui#10993 MIRRORED
 *     five `ObjectFormSchema` members by reference to the spec's `I18nLabelSchema`: none
 *     of them was in the ledger, so no key closed, but the spec reference re-derives the
 *     pair's entry (21 keys) into this half, the objectui#7762 membership move with ZERO
 *     keys repaired. ⚠️ Those 21 are still plain local omissions. It was 3 / 17 until objectui#7928 MIRRORED
 *     `ObjectViewSchema.listViews` by reference to the spec's own record
 *     (`ViewSchema.shape.listViews`): the value-type question below was answered with
 *     ruling A, the entry's one remaining key closed, and the entry left the ledger —
 *     the half lost an entry and a key, and the LOCAL half did not move. It was 2 / 3
 *     until objectui#7762 MIRRORED
 *     `ObjectGridSchema.exportOptions` as the spec's object arm BY REFERENCE, which
 *     re-derived that entry (its fourteen remaining keys) into this half: the #7779
 *     membership mechanism a second time, and the first entry to arrive here by a single
 *     mirrored member. ⚠️ Its keys' remedy did NOT change with the half — they are still
 *     plain local omissions; the reading is on the entry. Then `DashboardWidgetSchema`, and since
 *     objectui#7779 `ObjectViewSchema` again, by MEMBERSHIP this time rather than by
 *     the old false positive: that card made the mirror reference
 *     `SpecListViewSchema.shape.navigation` / `.searchableFields` /
 *     `.filterableFields` in CODE, so `SPEC_DERIVED_PAIRS` re-derives the pair
 *     here, and its one remaining key, `listViews`, is a value-type question the
 *     card's fallback clause left with the maintainer — NOT objectui#2231's
 *     unification (ruled out for this pair by name). It was 1 / 2 until then; 2 / 12
 *     until objectui#7279 RE-DERIVED `ObjectViewSchema`'s side and moved that entry
 *     (ten keys) to the LOCAL half — a RECLASSIFICATION on evidence, not a repair:
 *     no key moved between ledgers and no mirror changed. It was 3 / 13 until
 *     objectui#7623 RETIRED
 *     `DashboardComponentSchema.title` by deleting the DECLARATION — the
 *     objectui#7129 route, reaching this half for the first time. That key was never
 *     going to be answered by #2231 unification: the spec's strict `DashboardSchema`
 *     refuses a root `title` outright, and objectui#7509 had already retired every
 *     read of it, so the local declaration was offering a member the spec models
 *     nowhere and no renderer consumed. ⚠️ objectui#6705 invalidated the
 *     evidence for `ObjectViewSchema`: it was no longer in
 *     `SPEC_DERIVED_PAIRS` below (until objectui#7779 put a real code reference
 *     there), because it had never referenced a spec schema — it was
 *     `BaseSchema.extend({…})` of local literals, and the pre-#6705 text scanner
 *     charged it a neighbouring private const's `Spec…` token. That misclassification
 *     was left STANDING as #6705 found it — re-routing those keys from #2231's
 *     unification question to a local mirror edit is a remedy decision on the
 *     `UnmirroredDeclared` ledger, which #6705 was fenced out of — until
 *     objectui#7279 re-derived the side on two measurements. (a) The mirror
 *     (`objectql.zod.ts`, `ObjectViewSchema = BaseSchema.extend({…})`) took NO
 *     shape from the spec THEN (objectui#7779 later gave it three spec slots by
 *     reference, which is what re-derives it into this half today): every member was a local literal or a `z.lazy` to a
 *     sibling objectui mirror, and the `Spec…` consts below it (`KanbanConfig`,
 *     `ViewKindEnum`) feed `ListViewSchema`. (b) Read through the pin
 *     (`@objectstack/spec@17.2.0`, `ui` entry, all 122 exported object schemas
 *     walked; control keys `objectName` / `columns` hit), the spec models FOUR of
 *     the ten keys on View-shaped schemas — `listViews` on `ViewSchema`;
 *     `navigation`, `searchableFields`, `filterableFields` on `ListViewSchema` and
 *     `ObjectListViewSchema` — and SIX nowhere: `allowCreateView`,
 *     `defaultListView`, `defaultViewType`, `showViewSwitcher`, `viewActions`,
 *     `viewTabBar`. Neither fact makes the pair spec-derived: this route exists for
 *     a mirror that IS the spec schema by reference, where growing a key means
 *     diverging from the spec; this mirror can grow any key without touching it.
 *     So the entry is LOCAL and its remedy is the ordinary local route
 *     (objectui#6152's worklist) — a widening of ten keys is a remedy on the manual
 *     floor, ⛔ not performed by #7279. The 4 / 6 reading is recorded on the entry
 *     for whoever mirrors: the four take their shape BY REFERENCE from the spec slot
 *     that models them, the six are plain hand-written omissions.
 *     For `DashboardWidgetSchema` the reading is unchanged (reconfirmed on the tree
 *     by objectui#7279: `specFieldsExcept(SpecDashboardWidgetSchema.shape, …)`):
 *     its mirror takes its shape BY REFERENCE from `@objectstack/spec`. An
 *     unmirrored declared key there means the LOCAL declaration carries members the
 *     spec schema does not model, which is objectui#2231's unification question and
 *     NOT a local mirror edit. They are marked, not exempted: exempting them in the
 *     instrument would re-blind exactly the pairs objectui#5927 leaned on hardest.
 *   - **LOCAL (2 entries, 2 keys)** — omissions from a hand-written mirror. ⚠️ Neither
 *     is a plain omission. Both are `displayMode`, on the two chatbot twins, a
 *     tombstone whose refusal stays TypeScript-only BY DECISION (objectui#7654 ruling B,
 *     kept by objectui#6152 round 4) — so this half does not drain to zero by mirroring.
 *     It was 3 / 4 until objectui#11434's reader change MIRRORED `ProcessDesignerSchema`'s
 *     `lanes` and `version` — a designer pair objectui#10859 batch 7 armed and born
 *     ledgered with those two zero-read members, which objectui#11434 ruled READ and then
 *     gave a reader — closing that entry. No entry crossed between the halves, so the
 *     SPEC-DERIVED half did not move.
 *     It was 5 / 6 until objectui#11434 RETIRED `DataModelDesignerSchema.autoLayout` and
 *     `ReportDesignerSchema.previewMode` on both faces — each a tombstone and so a
 *     mirrored member — closing those two entries. No entry crossed between the halves,
 *     so the SPEC-DERIVED half did not move.
 *     It was 2 / 2 until objectui#10859 batch 7, which added three designer entries and
 *     four keys here (`autoLayout`, `lanes`, `version`, `previewMode`, each unmirrored BY
 *     DECISION for the seat to rule) and nothing to the SPEC-DERIVED half (no designer
 *     pair references the spec).
 *     It was 3 / 6 until objectui#6152 round 5 closed `DataTableSchema`'s entry (two keys
 *     RECLASSIFIED by name, one RETIRED) and shrank `ChatbotSchema`'s (`floatingConfig`
 *     RETIRED). No entry crossed between the halves, so the SPEC-DERIVED half did not move.
 *     It was 6 / 30 until objectui#6152 round 4 closed THREE entries here and shrank
 *     three more: `LabelSchema` (its one key RETIRED), `ReportComponentSchema` (both keys
 *     RETIRED) and `DetailViewSchema` (four keys RECLASSIFIED by name, one RETIRED) left;
 *     `ChatbotSchema` and `ChatbotFloatingSchema` each had one key MIRRORED, and
 *     `DataTableSchema` had fourteen RECLASSIFIED by name. No entry crossed between the
 *     halves, so the SPEC-DERIVED half did not move.
 *     It was 8 / 46 until objectui#6152 round 3 MIRRORED sixteen keys here, each
 *     measured READ: `PaginationSchema.currentPage` and all eight of `FormSchema`'s
 *     layout keys, each its entry's whole content, so two entries left; and
 *     `ReportComponentSchema.conditionalFormatting` plus six of `DetailViewSchema`'s
 *     configuration keys, two entries that stay. No entry crossed between the halves.
 *     It was 9 / 47 until objectui#11070 re-derived `FormFieldSchema`'s entry (one key)
 *     into the SPEC-DERIVED half by membership: no key moved between ledgers.
 *     It was 10 / 68 until objectui#10993 re-derived `ObjectFormSchema`'s entry (21
 *     keys) into the SPEC-DERIVED half by membership: no key moved between ledgers.
 *     It was 11 / 69 until objectui#8072 MIRRORED `InputSchema.wrapperClass`: the entry's
 *     ONLY key, so the entry left this half with it and no entry crossed to the
 *     SPEC-DERIVED half — `form.zod.ts#InputSchema` is not in `SPEC_DERIVED_PAIRS`, so
 *     that half did not move at all. A plain LOCAL repair of the kind objectui#6152's
 *     worklist is made of — ⛔ no reclassification, no retirement, no spec reference.
 *     It was 12 / 84 until objectui#7762 MIRRORED `ObjectGridSchema.exportOptions`: one key
 *     REPAIRED and the entry's other fourteen carried out of this half with it, because the
 *     spec reference that repair introduced re-derives the pair into the SPEC-DERIVED half
 *     above — the same two-effects-in-one-move shape objectui#7779 had on `ObjectViewSchema`.
 *     It was 13 / 94 until objectui#7779 MIRRORED eight of `ObjectViewSchema`'s ten
 *     keys and RETIRED a ninth, and the spec reference that mirroring introduced
 *     re-derived the entry (down to `listViews`) into the SPEC-DERIVED half — 12 / 84
 *     again, the figure this half read before objectui#7279, the same entry leaving by
 *     the opposite mechanism. 12 / 84 until objectui#7279 RECLASSIFIED the `ObjectViewSchema` entry
 *     (ten keys) into this half from the SPEC-DERIVED one — the split's first move
 *     of an ENTRY between its halves; no key and no mirror moved. Before that it
 *     was 13 / 84 until objectui#7129 RETIRED `DetailViewSectionSchema.hideEmpty`,
 *     a shrink by removing the DECLARATION rather than by mirroring it, 12 / 83
 *     until objectui#7352 MIRRORED `ChartSchema.drillDown` — its whole entry — and
 *     11 / 82 until objectui#7655 SEEDED a `ChatbotFloatingSchema` entry with the two
 *     keys that face declares alongside `ChatbotSchema` — an entry and two keys
 *     gained; `ChatbotSchema`'s own entry did not move.
 *
 * ⚠️ Both counts moved with the reclassification: the spec-derived side lost
 * `ObjectViewSchema.onNavigate` (14 → 13) and the local side lost the other 22
 * (107 → 85; 84 since objectui#6639 mirrored `ObjectGridSchema.title`, 83 since
 * objectui#7129 retired one). The pair COUNTS did not move under the
 * reclassification — every affected pair kept keys here — so the split read 16
 * entries / 97 keys after it. Three later changes moved the entry count itself:
 * objectui#6576 SEEDED `ObjectDataTableSchema` (a 17th entry, in neither half
 * above), objectui#7129 RETIRED an entry from the LOCAL half, objectui#7623
 * RETIRED one from the SPEC-DERIVED half (13 → 12 keys there), objectui#7352
 * MIRRORED two — the LOCAL `ChartSchema` entry and the seeded `ObjectDataTableSchema`
 * one — and objectui#7655 SEEDED the LOCAL `ChatbotFloatingSchema` entry, born with
 * two keys. objectui#7279 then moved `ObjectViewSchema` between the halves (2 / 12
 * and 12 / 84 before it) without moving the totals. objectui#7779 then shrank that
 * same entry from ten keys to one (96 → 87 keys; the entry count held) and moved it
 * back to the SPEC-DERIVED half by membership — the ledger's first shrink by
 * MIRRORING BY REFERENCE across most of an entry, and its second RETIREMENT on the
 * LOCAL half (`viewTabBar`). objectui#7762 then did both halves of that move again on
 * `ObjectGridSchema` with ONE key: mirroring `exportOptions` as the spec's object arm by
 * reference shrank the ledger 87 → 86 and re-derived the entry (fourteen keys) from the
 * LOCAL half into the SPEC-DERIVED one, so the entry count held while BOTH split figures
 * moved. objectui#8072 then MIRRORED `InputSchema.wrapperClass` — the opposite shape on
 * every axis: one key that was its entry's WHOLE key set, on a pair no spec reference
 * touches, so the entry emptied, the LOCAL half lost an entry and a key, and the
 * SPEC-DERIVED half did not move. objectui#7928 then MIRRORED
 * `ObjectViewSchema.listViews`, that entry's last key, by reference: the SPEC-DERIVED
 * half lost the entry, and the LOCAL half did not move. objectui#10993 then moved
 * `ObjectFormSchema`'s entry (21 keys) from the LOCAL half to the SPEC-DERIVED one by
 * membership alone, without moving the totals, and objectui#11070 moved
 * `FormFieldSchema`'s entry (one key) the same way. objectui#6152 round 1 then MIRRORED
 * nineteen of `ObjectFormSchema`'s keys: the SPEC-DERIVED half lost keys and no entry,
 * and the LOCAL half did not move. objectui#6152 round 3 then moved BOTH halves at once
 * by two routes: it RECLASSIFIED `ObjectFormSchema`'s last two keys into
 * `RuntimeOnlyDeclared` by name, so the SPEC-DERIVED half lost that entry, and it
 * MIRRORED sixteen LOCAL keys, emptying `PaginationSchema`'s and `FormSchema`'s entries
 * and shrinking `ReportComponentSchema`'s and `DetailViewSchema`'s. objectui#6152 round 4
 * then moved only the LOCAL half, by three routes: it RETIRED `LabelSchema.content`,
 * `ReportComponentSchema`'s last two keys and `DetailViewSchema.autoDiscoverRelated`,
 * RECLASSIFIED eighteen keys of `DataTableSchema` and `DetailViewSchema` into
 * `RuntimeOnlyDeclared` by name, and MIRRORED one key on each chatbot face — three
 * entries emptied. objectui#6152 round 5 then moved only the LOCAL half again, by two
 * routes: it RETIRED `DataTableSchema.selectionStyle` and `ChatbotSchema.floatingConfig`
 * on both faces and RECLASSIFIED `DataTableSchema`'s `editable` and `singleClickEdit`
 * into `RuntimeOnlyDeclared` by name — one entry emptied, and what the LOCAL half keeps
 * is `displayMode` on the two chatbot twins, by decision rather than as debt. The seeded
 * pair is no longer among them. objectui#10859 batch 7 then moved only the LOCAL half, by
 * one route: three designer pairs were BORN ledgered with four zero-read keys, unmirrored
 * by the card's ruling — three entries and four keys added, none emptied. objectui#11434
 * then moved only the LOCAL half, by one route: it RETIRED `autoLayout` and
 * `previewMode` on both faces, each a tombstone and so a mirrored member — two entries
 * and two keys gone, `ProcessDesignerSchema`'s left standing for its reader. Its reader
 * change then moved only the LOCAL half again, by the REPAIR route: `lanes` and
 * `version` got their reader and were MIRRORED — one entry and two keys gone. objectui#6152
 * round 6 then moved only the SPEC-DERIVED half, by the REPAIR route: ten of
 * `ObjectGridSchema`'s eleven keys MIRRORED, the entry kept `resizableColumns`, so no entry
 * left and the LOCAL half did not move. objectui#6152 round 7 then moved only the
 * SPEC-DERIVED half again, by the RETIREMENT route: `resizableColumns` retired on both
 * faces, so `ObjectGridSchema`'s entry left with its one key. The ledger
 * now totals — on ONE line, because the pin below reads this sentence off disk —
 * **4 entries / 5 keys** — 2 / 3 spec-derived, 2 / 2 local.
 *
 * ⛔ The four split figures above and this totals line are PINNED: 'objectui#7279'
 * at the bottom of this file derives every one of them from the `UnmirroredDeclared`
 * ledger and `SPEC_DERIVED_PAIRS` membership and compares them with the figures read
 * off this header. A figure edited by hand without the ledger moving is red, and so
 * is a ledger that moved without its figure — which is exactly how this split drifted
 * three times between objectui#6058 and objectui#7279.
 *
 * ## How this was measured, and the trap that makes the number hard to get
 *
 * ⚠️ **Do not read the offending set off the compile error.** objectui#6058 lost a
 * pass to this. The behaviour is not "TypeScript truncates", it is that the two
 * spellings of the same assertion print DIFFERENTLY, and the worse one gives no
 * sign that it is incomplete. Both measured:
 *
 *   - through a NAMED alias — the spelling `assertionDriftMatchesLedger` uses via
 *     `LedgerMismatch` — TS prints the ALIAS NAME and elaborates with exactly ONE
 *     member: `Type 'LedgerMismatch' is not assignable to type 'never'. Type
 *     '"complex.zod.ts#ChatbotSchema"' is not assignable to type 'never'.` There is
 *     no ellipsis, so 23 offending pairs read as one. `--noErrorTruncation` does NOT
 *     expand it, and neither a distributive conditional nor a template-literal
 *     wrapper forces expansion — both re-associate to the alias.
 *   - written INLINE, as `assertionUnmirroredMatchesLedger` below is, TS resolves the
 *     union and prints it WITH a truncation marker: ten neutralised entries printed
 *     five names, `... 4 more ...`, and the last. Honest about being partial.
 *
 * That is the whole reason the new assertion is spelled inline. It is still only a
 * pointer: the authoritative read is the compiler API — build a Program over
 * `tsconfig.test.json`, declare one binding per pair, and walk each type's union
 * members reading `isStringLiteral().value`, bypassing type printing entirely. Its
 * non-vacuity control on the seeding run: it read all 158 pairs and returned an
 * EMPTY set for 142 of them, so it is discriminating rather than uniformly silent.
 */
interface UnmirroredDeclared {
  /**
   * LOCAL. It was three until objectui#6152 round 4 MIRRORED `requestBody`, READ by all
   * three chatbot registrations (`body: schema.requestBody`), through the shared pick in
   * `complex.zod.ts`, so the three faces spell it once. (This note used to open by
   * saying `body` sat in `KnownDrift` for a naming collision; objectui#8572 retired that
   * arm and the `KnownDrift` row, as that entry above records.)
   *
   * It was two until objectui#6152 round 5 RETIRED `floatingConfig` on both faces (the
   * seat's answer A to round 4's open question): ZERO reads on this node by a
   * type-checker census and a runtime probe, since the `chatbot` registration never
   * reads it and only `chatbot-floating`'s does. It is `?: never` on the interface and a
   * `retirementTombstone()` on this mirror now — a tombstone is a mirrored member — and
   * `ChatbotFloatingSchema` never inherited it (it picks the shared keys and declares
   * its own `floatingConfig`), so the entry below did not move. The `chatbot` half of
   * `floating-chatbot-trigger-icon-retired.test.ts` was the tripwire for that absence,
   * and it now pins the refusal instead.
   *
   * The one left is NOT mirroring debt in waiting: `displayMode` is a `?: never`
   * tombstone since objectui#7654 (maintainer ruling B, 2026-09-05), and its refusal
   * stays TypeScript-ONLY under that ruling: stored designer documents carry
   * `displayMode: 'floating'`, and a zod arm would refuse them. objectui#6152 round 4
   * took the question under that ruling and minted no arm, so the key stays here by
   * DECISION, ⛔ not as a mirror half owed. `chatbot-display-mode-retired.test.ts` pins
   * this twin's shape as the tripwire.
   */
  'complex.zod.ts#ChatbotSchema': 'displayMode';
  /**
   * LOCAL — a pair born ledgered (objectui#7655) with the two keys the floating
   * face declares alongside `ChatbotSchema`. It was two until objectui#6152 round 4
   * MIRRORED `floatingConfig`, READ by this registration alone
   * (`floatingConfig={schema.floatingConfig}`), through a module-private restatement
   * of `FloatingChatbotConfig` whose six live members `FloatingChatbot` destructures;
   * that restatement carries the `triggerIcon` tombstone's runtime half, as the
   * objectui#7654 tripwire asked (`floating-chatbot-trigger-icon-retired.test.ts`).
   *
   * `displayMode` is RETIRED (objectui#7654, maintainer ruling B, 2026-09-05): a
   * `?: never` tombstone on this face and on `ChatbotSchema` alike, unmirrored on
   * both twins BY DECISION — round 4 kept the refusal TypeScript-only under that
   * ruling, for the stored documents the entry above names. ⛔ Not a waiver: every
   * OTHER key this pair declares is mirrored, and a second key here reddens the pair
   * like growth on any other entry.
   */
  'complex.zod.ts#ChatbotFloatingSchema': 'displayMode';
  // `complex.zod.ts#DashboardComponentSchema` recorded `title` here (SPEC-DERIVED)
  // until objectui#7623 RETIRED the declaration — the objectui#7129 route, not a
  // mirror edit: the spec's strict `DashboardSchema` refuses a root `title` outright,
  // and objectui#7509 had already retired every read of it. The pair keeps its
  // `KnownDrift` entry above (three TYPE-drifted keys) and records nothing here.
  /**
   * SPEC-DERIVED → objectui#2231. The mirror takes its shape by reference from
   * `@objectstack/spec`, so these are members the LOCAL declaration carries and the
   * spec schema does not model. Its one TYPE-drifted key is in `KnownDrift` above and
   * routes the same way.
   */
  'complex.zod.ts#DashboardWidgetSchema': 'pagination' | 'searchable';
  // `designer.zod.ts#DataModelDesignerSchema` recorded `autoLayout` here (LOCAL) from
  // objectui#10859 batch 7 until objectui#11434 RETIRED it on both faces: auto-layout
  // is an action (the toolbar runs it on demand), so the key is a `?: never` tombstone
  // on the interface and a `retirementTombstone()` on this mirror — a tombstone is a
  // mirrored member — and the entry closed. `designer.zod.ts#ReportDesignerSchema`'s
  // `previewMode` left by the same route in the same change (preview is a tool mode,
  // not authored state). Both are pinned by `designer-members-retired-11434.test.ts`.
  // `designer.zod.ts#ProcessDesignerSchema` recorded `lanes` and `version` here (LOCAL)
  // from objectui#10859 batch 7 — a pair born ledgered with two zero-read members,
  // omitted from the mirror BY DECISION — until objectui#11434 settled both as READ
  // (BPMN versions and swim lanes are mainstream) and its reader change gave each a
  // reader (`ProcessDesigner` draws the version in its toolbar and each lane as a band
  // around the nodes it names) and MIRRORED both, `lanes` through the new
  // `designer.zod.ts#BPMNLaneSchema` pair. A shrink by REPAIR — the objectui#6639 route
  // — and the entry closed; `ProcessDesigner.readers-11434.test.tsx` pins the readers.
  // `data-display.zod.ts#ChartSchema` recorded `drillDown` here (LOCAL) from
  // objectui#6058's seeding until objectui#7352 MIRRORED it: `DrillDownConfigSchema`
  // (`data-display.zod.ts`, a registered pair of its own above) now restates
  // `DrillDownConfig` key for key, and `ChartSchema.drillDown` references it. A shrink
  // by REPAIR — the objectui#6639 route, the ledger's second and third use of it (this
  // entry and `ObjectDataTableSchema`'s below went in the same change) — not a
  // reclassification and not a retirement: the key is still declared, still authorable,
  // and is now enforced. The pair holds no entry in either unmirrored ledger.
  // `data-display.zod.ts#DataTableSchema` recorded keys here (LOCAL) from objectui#6058's
  // seeding until objectui#6152 round 5 emptied the entry by two routes that must not be
  // read as one (the seat's answers 1 and 2 to round 4's open questions):
  //
  //   - `editable` and `singleClickEdit` were MOVED to `RuntimeOnlyDeclared` below BY
  //     NAME, each with its reason on `RuntimeOnlyNamedAllowList` — round 4's class rule
  //     for a key a host produces in code (`ObjectGrid`, beside the save path it
  //     supplies) and no document authors. ⛔ Neither was mirrored and neither
  //     declaration moved; the docs page that taught them on an authored node
  //     (`content/docs/components/complex/data-table.mdx`) was corrected in the same
  //     change, which is what had stopped round 4 at them.
  //   - `selectionStyle` was RETIRED on both faces under ADR-0049 enforce-or-remove:
  //     read by `data-table`, but authored and produced nowhere (re-measured in this
  //     repository and in `objectstack`), so its hover-only branch was dropped and the key
  //     is `?: never` on the interface and a `retirementTombstone()` on the mirror. A
  //     tombstone is a mirrored member.
  //
  // It was three keys after round 4, which moved FOURTEEN host-produced keys to
  // `RuntimeOnlyDeclared` by name; 17 before that, and 29 before the twelve `on*` keys
  // went there (objectui#6152). `rowActions` is in `KnownDrift` above — the mirror does
  // declare that one, disjointly. The pair now records nothing here.
  /**
   * SPEC-DERIVED by MEMBERSHIP since objectui#11070, LOCAL before it: that card declared
   * nine field-metadata members by reference to the spec's `FieldSchema`, so
   * `SPEC_DERIVED_PAIRS` re-derives the pair into that half. ⚠️ `field` itself did not
   * move and is not a spec key here: it is the resolved object-field metadata stash,
   * kept out of the authorable surface on purpose (objectui#6609).
   */
  'form.zod.ts#FormFieldSchema': 'field';
  // `form.zod.ts#FormSchema` recorded eight layout keys here (LOCAL) —
  // `defaultFieldTab`, `fieldContainerClass`, `fieldPanes`, `fieldPanesOrientation`,
  // `fieldPanesResizable`, `fieldTabs`, `fieldTabsPosition`, `mobileStickyActions` —
  // until objectui#6152 round 3 MIRRORED all eight, each measured READ by the `form`
  // renderer off `schema.*` (a type-checker census, not a grep), `fieldTabs` /
  // `fieldPanes` shaped by two module-private entry schemas that restate `FormFieldTab`
  // / `FormFieldPane` member for member. The whole entry, so it went. It was nine:
  // `onDirtyChange` is in `RuntimeOnlyDeclared` below (objectui#6152), and it is why
  // this pair is now in that ledger and NOT in this one — see the cross-ledger
  // sentence in the file header. `fields` stays in `KnownDrift` above (mirrored,
  // drifted in TYPE), untouched.
  // `form.zod.ts#InputSchema` recorded `wrapperClass` here (LOCAL) — the entry's
  // ONLY key, so objectui#8072 MIRRORING it took the whole entry with it. The pair
  // keeps its `KnownDrift` entry above (`onChange`, a runtime slot the mirror
  // refuses by name) and records nothing here. ⭐ That is why this move shrank the
  // entry count and the key total together where objectui#7762's did not: one key
  // off a one-key entry empties it, one key off a fifteen-key entry does not.
  // `form.zod.ts#LabelSchema` recorded `content` here (LOCAL) — the entry's ONLY key —
  // until objectui#6152 round 4 RETIRED it on both faces (the seat's answer B to round
  // 3's open question): `content` was the THIRD spelling of the label's text, which the
  // `label` renderer read last (`schema.text || schema.label || schema.content`). It is
  // `?: never` on the interface and a `retirementTombstone()` on the mirror now, and the
  // renderer's third read is dropped. A tombstone is a mirrored member, so the entry
  // went with its one key. No document authored it (once, in a components test, which
  // now authors `text`). Which of `text` / `label` is canonical was ⛔ not decided there.
  // `navigation.zod.ts#PaginationSchema` recorded `currentPage` here (LOCAL) — the
  // entry's ONLY key — until objectui#6152 round 3 MIRRORED it, on the ruling that
  // made it the canonical spelling (the seat's answer to round 1's open question,
  // confirmed by the director's contract review of PR #11125, ③). The same change
  // RETIRED its second spelling `page` on both faces (`?: never` on the interface,
  // `retirementTombstone()` on the mirror) and dropped the renderer's `page`
  // fallback, so `page` — mirrored before, and a tombstone on both faces now — never
  // entered this ledger. One key off a one-key entry, so the entry went with it.
  // `objectql.zod.ts#ObjectDataTableSchema` recorded `drillDown` here (LOCAL) as a
  // SEED — the pair was minted by objectui#6576 with its measured debt written down,
  // and the entry named its own remedy: "a paired `DrillDownConfigSchema` mirror,
  // which shrinks THIS entry and `ChartSchema`'s". objectui#7352 was that ruling and
  // did exactly that, so both rows are gone together. The pair keeps its `KnownDrift`
  // entry above (`onRowClick`, a runtime slot the mirror refuses by name) and records
  // nothing here.
  // `objectql.zod.ts#ObjectFormSchema` recorded `open` and `submitHandler` here
  // (SPEC-DERIVED by membership since objectui#10993) until objectui#6152 round 3
  // MOVED both to `RuntimeOnlyDeclared` below, on the ruling that answered this
  // entry's two open routes (the seat's answer A on objectui#6152, confirmed by the
  // director's contract review of PR #11125, ③): each is a runtime slot, filed there
  // by NAME on `RuntimeOnlyNamedAllowList`, with its reason. ⛔ Neither was
  // mirrored, and no declaration moved — a reclassification like objectui#6152's
  // first one, so the entry left this ledger and the measurement did not change.
  // It was 21 keys until round 1 MIRRORED nineteen of them (the ledger's largest
  // single shrink by REPAIR), and 26 before that: the five `on*` keys went to
  // `RuntimeOnlyDeclared` at objectui#6152's reclassification and left it by
  // objectui#7804's named refusals.
  // `objectql.zod.ts#ObjectGridSchema` recorded `resizableColumns` here (SPEC-DERIVED by
  // membership since objectui#7762, as a plain hand-written omission) until objectui#6152
  // round 7 RETIRED it on both faces, on the seat's answer that `resizable` is canonical
  // and the alias retires with no window: `?: never` on the interface, a
  // `retirementTombstone()` on the mirror naming `properties.resizable`, and `ObjectGrid`'s
  // `resizable ?? resizableColumns` fallback read dropped. It waited on the spec half:
  // once objectui#11276 made the authored node's `properties` bag the spec row by
  // reference, a local retirement alone would have left that bag accepting a key nothing
  // read, so round 6 STOPPED at it, and round 7 ran only once `@objectstack/spec` 17.7.0
  // (objectstack#21445), which objectui resolves since objectui#11717, refused it in the
  // row. ⛔ Nothing was mirrored: a tombstone is a mirrored member, so one key off a
  // one-key entry took the entry with it. It was 11 keys until round 6 MIRRORED ten, each
  // measured READ; 14 until objectui#11068; 15 until objectui#7762; and 17 until
  // `onNavigate` went to `RuntimeOnlyDeclared` (objectui#6152) and objectui#6639 MIRRORED
  // `title`.
  // `reports.zod.ts#ReportComponentSchema` recorded three keys here (LOCAL). objectui#6152
  // round 3 MIRRORED `conditionalFormatting`, which `ReportViewer` reads per cell, and
  // round 4 RETIRED the other two on both faces under ADR-0049 enforce-or-remove:
  // `chartConfig` and `reportType`, re-measured ZERO-READ by a type-checker census (no
  // typed read, no untyped read of either name off a report) with no authored document.
  // Each is `?: never` on the interface and a `retirementTombstone()` on the mirror, and
  // `reportType`'s one in-code producer — `specReportToPresentation` in `../spec-report.ts`,
  // whose output nothing read it from — stopped writing it in the same change. Tombstones
  // are mirrored members, so the entry went.
  // `views.zod.ts#DetailViewSchema` recorded fourteen keys here (LOCAL). The three `on*`
  // keys went to `RuntimeOnlyDeclared` at objectui#6152's reclassification; round 3
  // MIRRORED the six configuration keys `DetailView` reads (`primaryField`,
  // `summaryFields`, `autoTabs`, `defaultTab`, `sectionGroups`, `highlightFields`); and
  // round 4 emptied the entry by two routes that must not be read as one. It MOVED
  // `activities`, `comments`, `history` and `recordNavigation` to `RuntimeOnlyDeclared`
  // below BY NAME (the seat's answer A), each with its reason on
  // `RuntimeOnlyNamedAllowList` — host-fetched runtime data, and a value carrying a
  // required callback — ⛔ none mirrored. And it RETIRED `autoDiscoverRelated` on both
  // faces under ADR-0049 enforce-or-remove, re-measured ZERO-READ by a type-checker
  // census with no authored document and no producer; a tombstone is a mirrored member.
}

/* ── The runtime-only / non-authorable ledger (objectui#6152) ─────────────── */

/**
 * Callback-shaped declared keys that are RUNTIME SLOTS rather than authorable
 * metadata: kept on the declaration, deliberately never mirrored, separately pinned.
 * Since objectui#6152 round 3 it also holds the NON-callback runtime slots that
 * `RuntimeOnlyNamedAllowList` names, each by a ruling and with its reason — the
 * sections below were written about the callback-shaped set, and still describe it.
 *
 * ## ⚠️ THIS IS WHERE 23 KEYS WENT — a RECLASSIFICATION, not a fix
 *
 * `UnmirroredDeclared` above was seeded at **121 keys** by objectui#6058, and — on
 * ONE line, because the pin below reads this sentence off disk —
 * `UnmirroredDeclared` records **5 keys** today.
 * These 23 moved here whole. Keys have since left that ledger by MIRRORING and by
 * RETIREMENT, but the move recorded HERE is neither and repaired nothing. ⛔ Nothing
 * was mirrored by it, no declaration was removed, no defect was repaired and nothing was
 * waived: the same 23 facts are still measured, still declared-but-unmirrored, still
 * reconciled against the same measurement — under a different remedy.
 *
 * ⚠️ **23 is a HISTORICAL figure and this ledger no longer holds exactly those 23.**
 * It counts what objectui#6152 RECLASSIFIED, which is a past event and cannot change;
 * objectui#6150's `TreeViewSchema.onNodeClick` arrived afterwards, so the live total is
 * larger. ⛔ Do not "correct" the 23 to match it, and ⛔ do not restate the live total
 * here — it is written down once, in the file header, where objectui#8222 pins it.
 *
 * ⛔ The decomposition of "121" is NOT restated here. ONE site owns it — the
 * `UnmirroredDeclared` docstring above, where it is written as a reading at named
 * revisions and therefore cannot rot. objectui#8222 removed the file header's copy
 * for the same reason and deferred to that site; a second copy standing beside a
 * corrected one is how this figure rotted in the first place (objectui#8243: this
 * paragraph and the one above it both read 94 for a day after objectui#7779 took the
 * ledger to 87, and every pin in the file was green). objectui#6141 is the standing
 * example of what a silently moved count costs — and the pair count in the file
 * header is the second, re-derived at objectui#7352 contract review.
 *
 * ## Why mirroring is the wrong remedy for these (the objectui#6152 ruling)
 *
 * Measured on the SHIPPED `dist/*.d.ts`, all 23 are already function-only —
 * `((row: any) => void) | undefined` and the like, with no string alternative:
 *
 *   - ⛔ **Mirroring them enforces nothing.** The only available spelling is
 *     `z.function()`, which **no serialized authored document can satisfy**. It would
 *     move 23 rows off a ledger while adding validator surface no authored payload
 *     can ever populate — converting VISIBLE debt into INVISIBLE non-enforcement,
 *     which is the "declared ≠ enforced" shape this whole file exists to close.
 *   - ⛔ **Narrowing the declaration is not available.** objectui#4453's precedent
 *     narrowed a key that accepted `string | function` to `typeof === 'function'`;
 *     there is no string branch left here to remove.
 *   - ⛔ **Removing the declaration would break shipped renderers.** 21 of the 23 are
 *     read off `schema.*` in renderer source. ⭐ Measured by AST, because a plain
 *     `schema.onX` grep UNDERCOUNTS — `renderers/complex/data-table.tsx` DESTRUCTURES
 *     four of them (`const { onPageChange, … } = schema`) and a grep reads those as
 *     unread. The values reach the renderer by a third channel that is neither
 *     authored metadata nor a React prop: a sibling component SYNTHESISING a
 *     schema-shaped object in code and rendering it through `SchemaRenderer`
 *     (`ObjectGrid.tsx:2937` builds `const dataTableSchema: any`, rendered at
 *     `:3735`; `ListView`, `ObjectView`, `RelatedList`, `ObjectKanban`,
 *     `ObjectCalendar`, `ObjectGantt` and `ObjectGallery` all do the same).
 *
 * Authored anywhere: **zero of 23**, positive-controlled — a planted `"onRowClick"`
 * value in a schema-catalog fixture made the same search return exactly that line.
 *
 * ## ⚠️ The 16/7 split — these 23 did NOT all arrive the same way
 *
 * Read as "the mirrors omit callbacks by policy" this ledger would be wrong about two
 * thirds of itself. Measured across `../zod/`: **73 `on*` keys are ALREADY mirrored**
 * (56 `z.function()`, 11 `z.string()`, 3 `z.any()`, 3 named schemas).
 *
 *   - **16 were OVERSIGHTS.** `DataTableSchema`'s own mirror already declares four
 *     callbacks (`onRowEdit`, `onRowDelete`, `onSelectionChange`, `onColumnsReorder`),
 *     `FormSchema`'s three (`onSubmit`, `onChange`, `onCancel`), `DetailViewSchema`'s
 *     one (`onBack` — and in the OTHER dialect, `z.string()`). The omitted keys sit in
 *     the same object literals as the included ones.
 *   - **7 are POLICY.** `objectql.zod.ts` carries zero `on*` and zero `z.function()`
 *     in the entire file, and says so in passing at `:164`, where `successMessage` is
 *     described as what applies "when no `onSuccess` handler is given" — the mirror
 *     naming the authored alternative to a runtime callback it deliberately does not
 *     model. Those seven are `ObjectFormSchema`'s 5, `ObjectGridSchema`'s 1 and
 *     `ObjectViewSchema`'s 1.
 *
 * Reclassifying all 23 is still right — the remedy is the same for both groups — but
 * they are not the same fact, and a later reader must not infer uniform intent from
 * uniform treatment.
 *
 * ## Standing prior art, reached independently for 3 of the 23
 *
 * `docs/audits/2026-07-objectview-detailview-schema.md` ruled this before either
 * ledger existed. At `:148`, on `onNavigate`: "A function. Non-serializable; cannot
 * live in a JSON protocol." — filed under **Keep local**. At `:237-241`: `onNavigate`,
 * `onTabChange` and `onAddComment` are "live state and callbacks, not metadata", they
 * "must never enter a serializable protocol", and "their existence on a schema is
 * itself the smell: they are why this 'schema' cannot be validated, persisted, or
 * authored — it is a props bag wearing a schema's clothes". objectui#4650 is the same
 * split expressed in types: `ObjectFormPropsSchema` is "serialisable authoring keys
 * only", `ObjectFormComponentProps` is the renderer's props, "none of which can exist
 * in authored metadata".
 *
 * ⭐ And one piece of evidence that the declaration was ALREADY not trusted:
 * `DetailView.tsx:1402` reads `onTabChange` through an `(schema as any)` cast — at its
 * ONLY read site, for a key that IS declared on the type.
 *
 * ## ⛔ What this category is NOT
 *
 * Not a waiver, not a bucket. Three pins hold it to its meaning, and none of them is
 * prose: `assertionUnmirroredMatchesLedger` reconciles ONE measurement against the
 * UNION of both ledgers (`RecordedUnmirrored`), so a NEW callback-shaped unmirrored
 * key reddens until it is filed here and a recorded one that leaves the measurement
 * fails as STALE naming its own pair — both directions pinned on synthetic pairs at
 * `assertionSplitLedgerRejectsFreshCallback` and `…RejectsStaleRuntimeOnly`;
 * `assertionRuntimeOnlyIsCallbackShapedOrNamed` refuses a non-callback key here
 * unless `RuntimeOnlyNamedAllowList` names it with its reason; and
 * `assertionNoCallbackShapedKeyInUnmirroredDeclared` refuses a callback key over
 * there. The move is one-way and shape-checked. ⚠️ The shape pin read "a non-callback
 * key here" with no exception until objectui#6152 round 3: that round filed
 * `ObjectFormSchema`'s `open` and `submitHandler` here BY NAME, on the ruling its
 * allow-list docblock cites — a named widening of the pin, ⛔ not a bucket.
 *
 * ⚠️ The end state is objectui#4650's two-layer split — an authored-metadata type and
 * a renderer-props type per pair, mirroring only the authored half. This ledger is its
 * first honest step: it RECORDS what these keys are without pretending they are fixed.
 * If objectui#6152's escalated second question is ever answered "an authored handler
 * EXPRESSION is a supported dialect" (the 11 `z.string()` mirrors), an `on*` key can
 * become genuinely authorable — that is a RULING, and it moves the key back with the
 * shape pin relaxed deliberately, never by quietly refiling it.
 */
interface RuntimeOnlyDeclared {
  /**
   * ⭐ 5 of `DataTableSchema`'s former 29, down from 12 with objectui#7804's
   * `DataTableSchema` slice: `onAddRecord`, `onBatchSave`, `onCellChange`,
   * `onColumnResize`, `onRowActionDef`, `onRowClick` and `onRowSave` are now
   * DECLARED on the mirror as named refusals and moved to `KnownDrift` above.
   * The entry survives because the five below are not that class — four of them
   * (`onPageChange`, `onPageSizeChange`, `onSearchChange`, `onSortChange`) are
   * host-driven pagination/sort/search slots the grid forwards, and
   * `onColumnReorder` is read nowhere at all, which is the open ruling recorded
   * below. ⛔ Draining the rest of this entry is NOT a follow-on of that slice.
   *
   * OVERSIGHT group — this mirror already
   * declares four callbacks. ⚠️ `onColumnReorder` is still read NOWHERE, and
   * deliberately so. objectui#6175 repaired the persistence half this entry used to
   * describe: `onColumnResize` is now invoked by `data-table.tsx` (at the end of a
   * resize drag), and ObjectGrid now emits the MIRRORED near-duplicate
   * `onColumnsReorder` — the spelling the renderer already invoked — instead of the
   * singular `onColumnReorder` it used to write and nothing read. So column-state
   * persistence DOES fire now, and `onColumnReorder` is left declared, mirrored by
   * nothing, and wired to nothing.
   *
   * That residue is the open question, not an oversight: one event, two declared
   * spellings, different signatures. objectui#6175 wired persistence WITHOUT
   * retiring anything, because retiring either spelling is a declared-surface change
   * and that ruling is still OPEN. Nothing about this entry's membership changed.
   *
   * ⭐ GREW by fourteen NON-callback keys with objectui#6152 round 4, each filed BY
   * NAME with its reason on `RuntimeOnlyNamedAllowList` below, and each come from
   * `UnmirroredDeclared` above, whose `DataTableSchema` entry kept three. ⛔ None was
   * mirrored and no declaration moved: one reclassification seen from both sides. They
   * are what a HOST sets in code on the `data-table` node it builds — `ObjectGrid`'s
   * in-code node for twelve, `RelatedList`'s for `rowActionDefs` (and `manualSorting` /
   * `sort` as well) — and no document authors any of them: the server-mode controlled
   * state that pairs with the four `on*` slots above, two FUNCTION slots
   * (`rowClassName`, `rowStyle`), and host-composition flags.
   *
   * ⭐ GREW by two more NON-callback keys with objectui#6152 round 5 (the seat's answer
   * B to round 4's first open question, under that round's own class rule): `editable`
   * and `singleClickEdit`, the inline-edit flags `ObjectGrid` sets in code beside the
   * save path it supplies (`onRowSave` / `onBatchSave`), each filed BY NAME with its
   * reason on `RuntimeOnlyNamedAllowList` below. Both came from `UnmirroredDeclared`
   * above, emptying its `DataTableSchema` entry together with `selectionStyle`'s
   * retirement. ⛔ Neither was mirrored and no declaration moved.
   *
   * ⭐ GREW by one more with objectui#11068's `keyboardNavigation` build:
   * `keyboardNavigation`, DECLARED on the TypeScript interface in the same change
   * (it is new there, not reclassified), because `ObjectGrid` resolves the
   * `object-grid` node's own key and sets the answer in code on the `data-table`
   * node it builds, beside `editable`, whose value its default follows. Filed BY
   * NAME with its reason on `RuntimeOnlyNamedAllowList` below; ⛔ not mirrored,
   * since no document authors it on a `data-table` node.
   */
  'data-display.zod.ts#DataTableSchema':
    | 'onColumnReorder'
    | 'onPageChange' | 'onPageSizeChange'
    | 'onSearchChange' | 'onSortChange'
    | 'disableInnerScroll' | 'editable' | 'keyboardNavigation' | 'manualPagination' | 'manualSearch' | 'manualSorting'
    | 'page' | 'rowActionDefs' | 'rowClassName' | 'rowCount' | 'rowStyle'
    | 'search' | 'selectionResetKey' | 'showAddRow' | 'showSelectionCount' | 'singleClickEdit' | 'sort';
  /**
   * 1 of `FormSchema`'s former 9. OVERSIGHT group — `onSubmit`, `onChange` and
   * `onCancel` are mirrored beside it. Read at `renderers/form/form.tsx:997`, by
   * destructuring, which is why the AST census and not a grep found it.
   */
  'form.zod.ts#FormSchema': 'onDirtyChange';
  /**
   * ⭐ THREE `objectql.zod.ts` entries LEFT this ledger with objectui#7804's
   * `objectql.ts` slice, and they left the way this ledger is meant to drain —
   * by the mirror DECLARING each key as a named refusal, never by refiling:
   *
   *   - `ObjectFormSchema` — all five (`onCancel`, `onError`, `onOpenChange`,
   *     `onStepChange`, `onSuccess`), so the entry was gone, not shortened (it is
   *     back, with two OTHER keys, since objectui#6152 round 3 — see the entry
   *     below);
   *   - `ObjectGridSchema` — `onNavigate`, the key the 2026-08-19 ruling on
   *     objectui#5234 kept declared for programmatic callers and off the
   *     authoring surface; the mirror now says on this face what
   *     `@objectstack/spec`'s `strictObject` already said on the other;
   *   - `ObjectViewSchema` — `onNavigate`, a DIFFERENT key of the same name:
   *     different signature, different supplier, judged separately.
   *
   * ⚠️ The pairs are gone from this ledger and present in `KnownDrift` above,
   * which is ONE move seen from both sides. And `KnownDrift` gained NINE keys
   * where this one lost SEVEN: the other two are `ObjectGallerySchema`'s
   * `onCardClick` / `onRowClick`, which were in NEITHER ledger because they
   * were declared on NEITHER face — they reached the renderer through
   * `SchemaRenderer`'s props spread while `BaseSchema`'s index signature
   * admitted them untyped. ⛔ Read the two bullets together or the arithmetic
   * looks like growth from nowhere.
   */
  /**
   * ⭐ The first entry here whose keys are NOT callback-shaped — filed by NAME,
   * under objectui#6152 round 3 (the seat's answer A to round 1's open question,
   * confirmed by the director's contract review of PR #11125, ③). Both keys came
   * from `UnmirroredDeclared` above, whose `ObjectFormSchema` entry they emptied;
   * ⛔ neither was mirrored and neither declaration moved.
   *
   * They are here because each is a runtime slot a host fills in code, and
   * mirroring would bless an authored value nothing honours as authored — the
   * reason this ledger exists. They are NOT `on*` spellings, so the shape pin below
   * admits them only because `RuntimeOnlyNamedAllowList` names each one with its
   * reason; a third non-callback key filed here without a row there is red.
   * The per-key reasons live on that allow-list, ⛔ not restated here.
   */
  'objectql.zod.ts#ObjectFormSchema': 'open' | 'submitHandler';
  /**
   * ⭐ `data-display.zod.ts#TreeViewSchema` WAS HERE and is GONE — objectui#7804's
   * `TreeViewSchema` slice. Its one key `onNodeClick` is now DECLARED on the
   * mirror as a named refusal and sits in `KnownDrift` above; the entry had
   * nothing else in it, so the entry went with the key.
   *
   * ⚠️ THIS REMOVAL CHANGED THE SHAPE OF A CROSS-LEDGER FIGURE, which is why it
   * is recorded here rather than only as a smaller digit in the header.
   * `TreeViewSchema` was the ONE pair in this ledger that was not also in
   * `UnmirroredDeclared` — the whole reason the union of the two unmirrored
   * ledgers was one pair LARGER than `UnmirroredDeclared` itself. With it gone
   * this ledger is a SUBSET of that one, the union equals it exactly, and the
   * header sentence plus the two pin legs that read it were rewritten to state
   * the containment instead of a difference. ⛔ Do not "restore" a difference
   * figure here: the pin now reads the containment, and a re-seeded
   * runtime-only-only pair has to move both together.
   *
   * ⚠️ AMENDED by objectui#6152 round 3, whose reclassification and mirroring left
   * two pairs runtime-only and nothing else (`ObjectFormSchema` above, and
   * `FormSchema`): that is the "re-seeded runtime-only-only pair" case, and both
   * moved together. The header sentence now carries the difference in a spelling
   * that holds at any size, and the pin reads it; the guidance above ("the pin now
   * reads the containment") is no longer true, while its record of #7804 stands.
   */
  /**
   * What is LEFT of the three `DetailViewSchema` keys the 2026-07 audit named.
   *
   * ⭐ `onNavigate` and `onAddComment` LEFT this ledger with objectui#9447, and
   * they left the way this ledger is meant to drain — by the mirror DECLARING
   * each key as a named refusal, never by refiling. Both are in `KnownDrift`
   * above, which is ONE move seen from both sides; read the two entries together
   * or this one looks like it simply shrank.
   *
   * `onTabChange` is the one of the three that could NOT go with them: it is
   * read through an `(schema as any)` cast rather than a plain member access,
   * its disposition is still open on objectui#7804, and objectui#9447's rows
   * were the two keys whose twin on `crud.zod.ts#DetailSchema` already refused
   * them. This is also the pair where the audit wrote "a props bag wearing a
   * schema's clothes".
   *
   * ⭐ GREW by four NON-callback keys with objectui#6152 round 4 (the seat's answer A
   * to round 3's open question), each filed BY NAME with its reason on
   * `RuntimeOnlyNamedAllowList` below: `activities`, `comments` and `history` carry
   * host-fetched RUNTIME DATA, and `recordNavigation`'s value carries a REQUIRED
   * callback. All four came from `UnmirroredDeclared` above, whose `DetailViewSchema`
   * entry they emptied together with `autoDiscoverRelated`'s retirement — so this pair
   * is now recorded ONLY here, one of the pairs the cross-ledger sentence in the file
   * header counts. ⛔ None was mirrored and no declaration moved. objectui#4650's
   * two-layer split stays the end state.
   */
  'views.zod.ts#DetailViewSchema':
    | 'onTabChange'
    | 'activities' | 'comments' | 'history' | 'recordNavigation';
  /**
   * ⭐ objectui#11355 round 2 — the seat's ruling A on that card: a NEW entry, and
   * its one key is NOT callback-shaped, so it is admitted BY NAME through
   * `RuntimeOnlyNamedAllowList` below, with its reason there.
   *
   * ⚠️ Unlike every other entry here, this one is NOT a reclassification out of
   * `UnmirroredDeclared`: `isAnimationActive` was declared on NEITHER face. Code
   * composed it onto the node and `ChartRenderer` honoured it, while the TS face
   * admitted it only through `BaseSchema`'s index signature. The TS face now
   * declares it as a host-composed member, and the mirror deliberately does not,
   * so it is not offered as an authored key. ⛔ Not new mirroring debt: the ruling
   * is that it stays unmirrored.
   */
  'objectql.zod.ts#ObjectChartSchema': 'isAnimationActive';
}

/**
 * Every entry in EITHER unmirrored ledger names a REGISTERED pair.
 *
 * A misspelled pair key would otherwise be ignored by the `[K in MirrorKey]` map
 * below and the real pair would read as having no entry — still red, but pointing at
 * the wrong thing. This names it directly.
 */
export type assertionUnmirroredLedgerKeysAreRegistered =
  Expect< Equal< Exclude< keyof UnmirroredDeclared | keyof RuntimeOnlyDeclared, MirrorKey >, never > >;

/* ── Classification: what keeps the split from being a bucket ───────────────── */

/**
 * `on` followed by an uppercase letter.
 *
 * Spelled as the 26 letters rather than `` `on${string}` `` so the TYPE and the
 * `/^on[A-Z]/` census that MEASURED the 23 cannot drift apart: the loose spelling
 * also matches `only`, `once` and `onboarding`, and would quietly refuse an ordinary
 * declared key from `UnmirroredDeclared` on a name collision.
 */
type CallbackShapedKey = `on${
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M'
  | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z'}${string}`;

/**
 * A callback-shaped key recorded as an ORDINARY mirroring debt.
 *
 * Refused: objectui#6152 ruled that mirroring is never the remedy for one, so filing
 * it here would record a remedy the ruling rejects. This is also the pin that shows
 * the 23 actually LEFT `UnmirroredDeclared` — it would be red if any had stayed.
 */
export type CallbackShapedInUnmirrored = {
  [K in keyof UnmirroredDeclared]: Extract< UnmirroredDeclared[K], CallbackShapedKey >;
}[keyof UnmirroredDeclared];

export type assertionNoCallbackShapedKeyInUnmirroredDeclared =
  Expect< Equal< CallbackShapedInUnmirrored, never > >;

/**
 * The NAMED allow-list: every NON-callback-shaped key `RuntimeOnlyDeclared` may hold,
 * one row per key, each carrying its REASON as a string-literal type (objectui#6152
 * round 3).
 *
 * The ruling it implements is the seat's answer A to round 1's open question on
 * objectui#6152, confirmed by the director's contract review of PR #11125 (③): widen
 * the shape pin from the `/^on[A-Z]/` spelling to that spelling PLUS a named list of
 * exactly these keys, each with its reason written into the pin. ⛔ It is NOT an
 * exemption in the comparison: `assertionUnmirroredMatchesLedger` still reconciles the
 * ONE measurement against the union of both ledgers, so these keys are measured, and
 * recorded, exactly like the rest. What the list relaxes is the SHAPE pin, and only by
 * name.
 *
 * Three pins below hold it to that:
 *
 *   - `assertionRuntimeOnlyIsCallbackShapedOrNamed` — a non-callback key in
 *     `RuntimeOnlyDeclared` without a row here is red, so the category cannot become a
 *     place to move an inconvenient key to;
 *   - `assertionNamedAllowListRowsAreFiled` — a row here whose key has LEFT
 *     `RuntimeOnlyDeclared` (mirrored, retired, or moved back by a later ruling) is
 *     red and names itself, so the list is shrink-only in the same sense the ledgers
 *     are; a callback-shaped row is red too, because the spelling rule already covers
 *     it and a row for it would be an unexplained duplicate;
 *   - `assertionEveryNamedAllowListRowHasAReason` — a row whose reason is `string` or
 *     empty is red, so a row cannot be added without its reason.
 *
 * ⛔ A row is added by RULING, never to turn a red reconciliation green — the same
 * discipline the ledger's own header states for its callback exception.
 */
interface RuntimeOnlyNamedAllowList {
  'objectql.zod.ts#ObjectFormSchema': {
    /**
     * Host-driven dialog state. `ObjectForm` reads it for its drawer and modal
     * variants (`open: schema.open`), and every writer is a host that builds the node
     * in code — `AppContent`, `useActionModal`, `ObjectManager`, `FieldDesigner`, and
     * the `byo-backend-console` example — pairing it with the `onOpenChange` slot the
     * mirror refuses by name. No document authors it (the authored census found none
     * in any tracked JSON file or Markdown JSON fence), and the spec's
     * `ComponentPropsMap['object-form']` does not declare it.
     */
    open: 'host-driven dialog state: set in code by the host that opens the form, with its onOpenChange slot; authored in no document';
    /**
     * A FUNCTION slot: `ObjectForm` calls `await schema.submitHandler(writePayload)` in
     * place of the data source's write, and `MasterDetailForm` is its only supplier.
     * objectui#6182 ruled the handler dialect runtime-only, so it is never mirrored as
     * a string, and `z.function()` is no remedy — no serialized document can satisfy
     * it. Handler-shaped, but not an `on*` spelling, which is why it needs a row.
     */
    submitHandler: 'a function slot the form calls instead of the data source write, supplied in code by MasterDetailForm; objectui#6182 rules handlers runtime-only';
  };
  /**
   * objectui#6152 round 4 — `DataTableSchema`'s code-produced keys (the round-3 class
   * the seat named for keys a host produces in code and no document authors). Each was
   * measured READ by `data-table` and PRODUCED only in code by a type-checker census,
   * and found in no document by an authored census over every tracked JSON file,
   * Markdown JSON fence and `type: 'data-table'` object literal. ⛔ Not a waiver: the
   * comparison still reconciles each key, and a row whose key leaves the ledger is red.
   *
   * objectui#6152 round 5 added `editable` and `singleClickEdit` under the same class
   * rule (the seat's answer B), re-measured the same way on that round's base. What
   * had stopped round 4 at them was a docs page teaching both on an authored node; the
   * same change corrected that page (`content/docs/components/complex/data-table.mdx`),
   * because an authored `editable: true` stages edits that no callback persists.
   */
  'data-display.zod.ts#DataTableSchema': {
    disableInnerScroll: 'host-composition flag: set in code by ObjectGrid on the one grouped table so it overflows into the grid scroll container; authored in no document';
    editable: 'host-paired flag: set in code by ObjectGrid beside the onRowSave / onBatchSave save path it supplies; an authored value stages edits that nothing persists, and no document authors it';
    keyboardNavigation: 'host-resolved flag: set in code by ObjectGrid from the keyboardNavigation key of the object-grid node, defaulting to the editable it hands down beside it; authored in no document';
    manualPagination: 'host-driven server paging: set in code by ObjectGrid with rowCount, page and the onPageChange slot; authored in no document';
    manualSearch: 'host-driven server search: set in code by ObjectGrid with search and the onSearchChange slot; authored in no document';
    manualSorting: 'host-driven server sort: set in code by ObjectGrid and RelatedList with sort and the onSortChange slot; authored in no document';
    page: 'controlled current page for manualPagination: set in code by ObjectGrid from its own paging state; authored in no document';
    rowActionDefs: 'host row actions: set in code by RelatedList and rendered only beside its onRowActionDef slot; authored in no document';
    rowClassName: 'a function slot the table calls per row, supplied in code by ObjectGrid from rowColor; JSON has no function value';
    rowCount: 'server match total for manualPagination: set in code by ObjectGrid from its query result; authored in no document';
    rowStyle: 'a function slot the table calls per row, supplied in code by ObjectGrid from conditionalFormatting; JSON has no function value';
    search: 'controlled search term for manualSearch: set in code by ObjectGrid from its own search state; authored in no document';
    selectionResetKey: 'imperative reset token: ObjectGrid bumps it in code to clear the checkboxes after a bulk action; authored in no document';
    showAddRow: 'host-paired flag: set in code by ObjectGrid from create permission, beside the onAddRecord slot the row calls; authored in no document';
    showSelectionCount: 'host-composition flag: set false in code by ObjectGrid, whose BulkActionBar shows the selection instead; authored in no document';
    singleClickEdit: 'host-paired flag: set in code by ObjectGrid with editable, choosing how a cell enters inline edit; authored in no document';
    sort: 'controlled sort for manualSorting: set in code by ObjectGrid and RelatedList from their own sort state; authored in no document';
  };
  /**
   * objectui#6152 round 4 — the seat's answer A to round 3's open question: runtime data
   * a host fetches, and a value carrying a required callback. Each is READ by
   * `DetailView` and no document authors any of them; the one in-tree producer outside
   * tests is `RecordDetailView`'s `history`, built in code. objectui#4650's split (an
   * authored-metadata type beside a renderer-props type) stays the end state.
   */
  'views.zod.ts#DetailViewSchema': {
    activities: 'runtime data a host fetches (activity rows) and passes in code; authored in no document, and no in-tree producer writes it';
    comments: 'runtime data a host fetches (comment rows), read beside the onAddComment slot; authored in no document, and no in-tree producer writes it';
    history: 'host-fetched runtime data: audit-log entries with a loading flag, built in code by RecordDetailView; authored in no document';
    recordNavigation: 'runtime result-set state whose onNavigate member is a REQUIRED function, so no JSON document can supply it';
  };
  /**
   * objectui#11355 round 2 — the seat's ruling A: a render flag hosts compose in code.
   * `DashboardRenderer` and `DashboardGridLayout` set it `false` on the `object-chart`
   * nodes they build, and `ObjectChart` spreads the node into the schema it hands
   * `ChartRenderer`, which honours it. `DatasetWidget` and `DatasetReportRenderer`
   * write the same flag onto bare `chart` nodes, which `ChartRenderer` renders
   * directly, its own `schema` prop declaring it, not through this pair's type.
   * No tracked JSON, YAML or Markdown document authors it.
   */
  'objectql.zod.ts#ObjectChartSchema': {
    isAnimationActive: 'host-composed render flag: set false in code by the dashboard and report renderers for a deterministic first paint, honoured by ChartRenderer; authored in no document';
  };
}

/** The allow-listed key names for one pair — `never` for a pair with no row. */
type NamedAllowListKeys< K > =
  K extends keyof RuntimeOnlyNamedAllowList ? Extract< keyof RuntimeOnlyNamedAllowList[K], string > : never;

/**
 * A NON-callback key recorded as runtime-only WITHOUT a row on the named allow-list.
 *
 * Refused, and this is the load-bearing half: without it the new category is a place
 * to move any inconvenient key to, and the reclassification becomes the waiver it is
 * not. `RuntimeOnlyDeclared` can only ever hold what its header claims it holds: a
 * callback-shaped key, or a key `RuntimeOnlyNamedAllowList` names with its reason.
 * (objectui#6152 round 3 added the second arm; until then this read
 * `assertionRuntimeOnlyIsCallbackShapedOnly` and admitted the spelling alone.)
 */
export type NonCallbackInRuntimeOnly = {
  [K in keyof RuntimeOnlyDeclared]: Exclude< RuntimeOnlyDeclared[K], CallbackShapedKey | NamedAllowListKeys< K > >;
}[keyof RuntimeOnlyDeclared];

export type assertionRuntimeOnlyIsCallbackShapedOrNamed =
  Expect< Equal< NonCallbackInRuntimeOnly, never > >;

/**
 * An allow-list row that is not FILED — its key is absent from that pair's
 * `RuntimeOnlyDeclared` entry — or that names a callback-shaped key. Spelled
 * `pair::key` so a failure names the row.
 */
export type UnfiledNamedAllowListRow = {
  [K in keyof RuntimeOnlyNamedAllowList]:
    | `${K}::${Exclude< NamedAllowListKeys< K >, K extends keyof RuntimeOnlyDeclared ? RuntimeOnlyDeclared[K] : never >}`
    | `${K}::${Extract< NamedAllowListKeys< K >, CallbackShapedKey >}`;
}[keyof RuntimeOnlyNamedAllowList];

export type assertionNamedAllowListRowsAreFiled =
  Expect< Equal< UnfiledNamedAllowListRow, never > >;

/** A row whose reason is not a non-empty string literal. */
type BlankReason< R > = R extends string ? (string extends R ? R : R extends '' ? R : never) : R;

export type NamedAllowListRowWithoutReason = {
  [K in keyof RuntimeOnlyNamedAllowList]: {
    [P in keyof RuntimeOnlyNamedAllowList[K]]: [BlankReason< RuntimeOnlyNamedAllowList[K][P] >] extends [never] ? never : `${K}::${P & string}`;
  }[keyof RuntimeOnlyNamedAllowList[K]];
}[keyof RuntimeOnlyNamedAllowList];

export type assertionEveryNamedAllowListRowHasAReason =
  Expect< Equal< NamedAllowListRowWithoutReason, never > >;

/*
 * Recognition, on synthetic ledgers: each of the three pins above FIRES on the case
 * it exists for, so a green run is a verdict and not a blind one. Spelled over local
 * stand-ins of the same shapes, because the pins read the real interfaces.
 */
type SyntheticRuntimeOnly = { p: 'onX' | 'open' | 'stray' };
type SyntheticAllowList = { p: { open: 'host state'; gone: 'left the ledger'; onY: 'a callback row'; blank: string } };
type SyntheticAllowKeys< K > = K extends keyof SyntheticAllowList ? Extract< keyof SyntheticAllowList[K], string > : never;

/** A non-callback key without a row (`stray`) is reported; the named one (`open`) is not. */
export type assertionShapePinReportsAnUnnamedNonCallbackKey = Expect< Equal<
  { [K in keyof SyntheticRuntimeOnly]: Exclude< SyntheticRuntimeOnly[K], CallbackShapedKey | SyntheticAllowKeys< K > > }[keyof SyntheticRuntimeOnly],
  'stray'
> >;

/** A row whose key is not filed (`gone`), and a callback-shaped row (`onY`), are reported. */
export type assertionAllowListReportsUnfiledAndCallbackRows = Expect< Equal<
  { [K in keyof SyntheticAllowList]:
      | `${K}::${Exclude< SyntheticAllowKeys< K >, K extends keyof SyntheticRuntimeOnly ? SyntheticRuntimeOnly[K] : never >}`
      | `${K}::${Extract< SyntheticAllowKeys< K >, CallbackShapedKey >}` }[keyof SyntheticAllowList],
  'p::gone' | 'p::onY' | 'p::blank'
> >;

/** A row whose reason is bare `string` (`blank`) is reported; the literal reasons are not. */
export type assertionReasonPinReportsABlankReason = Expect< Equal<
  { [K in keyof SyntheticAllowList]: {
      [P in keyof SyntheticAllowList[K]]: [BlankReason< SyntheticAllowList[K][P] >] extends [never] ? never : `${K}::${P & string}`;
    }[keyof SyntheticAllowList[K]] }[keyof SyntheticAllowList],
  'p::blank'
> >;

/**
 * The two ledgers are DISJOINT per pair.
 *
 * The union reconciliation below cannot see a double-filing — `'a' | 'a'` is `'a'` —
 * so a key recorded in both halves would reconcile green while making "97 + 23" the
 * wrong arithmetic and leaving two contradictory remedies on record. Named here
 * instead of assumed.
 */
export type DoubleFiledKey = {
  [K in keyof RuntimeOnlyDeclared]: K extends keyof UnmirroredDeclared
    ? Extract< RuntimeOnlyDeclared[K], UnmirroredDeclared[K] >
    : never;
}[keyof RuntimeOnlyDeclared];

export type assertionLedgerHalvesAreDisjoint = Expect< Equal< DoubleFiledKey, never > >;

/* ── The measured mirror-WIDER-than-declared ledger (objectui#7069) ─────────── */

/**
 * Exact WIDER key set per pair, measured against `origin/main`: keys whose mirror
 * admits a spelling the declaration refuses. Pinned exactly, like the ledgers
 * above — a new widening on a listed mirror fails, and so does a listed one that
 * has been repaired.
 *
 * ## Two classes, and only one of them is an accept-set gap
 *
 * **CONCRETE** — both faces are concrete, so the comparison means what it says: an
 * author can write the spelling, `safeParse` returns green, and `tsc` refuses it.
 * `FormSchema.layout` is the plainest instance. `SliderSchema.defaultValue` stood
 * beside it — the shape objectui#7069 was filed about, alive on a pair nobody had
 * looked at — until objectui#10280 widened its declaration to the single-or-list its
 * renderer normalizes.
 *
 * **SCHEMA-NODE** — the mirror's face carries `unknown` NESTED inside an array
 * element or a property, from a recursion-breaking `z.ZodType< any >` annotation
 * (see `Unconstrained`, which excludes such a face at the top level and one array
 * deep but not deeper). These entries record the ANNOTATION, not an accept-set
 * gap: at runtime the lazy union does validate. ⛔ They are not defects to repair
 * one by one, and repairing one would not move this ledger — only re-annotating the
 * const the reading comes from would. They are seeded so the ratchet still covers
 * those pairs: a CONCRETE widening appearing on one of them changes its key set and
 * reddens the invariant.
 *
 * ⭐ That last sentence was tested in full by objectui#7760, which re-annotated seven
 * of the ten consts and took this class from 24 keys to 6 in one commit. ⛔ The class
 * is therefore not a permanent residency: read it as "the instrument cannot see this
 * key YET", and the way a key leaves it is that someone makes the face readable. The
 * three keys that ENTERED this ledger under that card were SCHEMA-NODE readings the
 * day before and are CONCRETE divergences today, with no mirror and no declaration
 * touched.
 *
 * The runtime leg at the bottom of this file is what keeps the second class from
 * silently spreading: it pins the SOURCES — every lazy node under the registered
 * mirrors is one of the named consts — so a new annotated recursive mirror cannot
 * enlarge the region unnoticed.
 *
 * ## Seeded, and why that is a floor and not a waiver
 *
 * Seeded at the debt this direction was already carrying, the shape every ledger in
 * this file landed with (objectui#6058 for the unmirrored direction, objectui#6124
 * for the runtime-slot class). ⛔ No mirror and no declaration was moved to make it
 * green: every entry here is a disposition still to be made, and each is its own
 * card. `assertionRatchetRejectsFreshDrift` above is what makes the floor hold —
 * a widening on a pair this ledger does not name reddens immediately.
 *
 * ## Overlap with `KnownDrift` is expected, not a double-filing
 *
 * A pair can be narrower on one key and wider on another, and a single key can be
 * DISJOINT — each face refusing something the other admits — in which case it is
 * recorded in both ledgers, measured from both sides. That is not the double-filing
 * `assertionLedgerHalvesAreDisjoint` refuses: that one is about the two UNMIRRORED
 * ledgers, which record one measurement between them. This ledger records a
 * SECOND, independent measurement.
 *
 * ## When it fires
 *
 *   1. the message names the pair;
 *   2. resolve `WiderOf< 'THE PAIR' >`, and for each key in the difference resolve
 *      `MirrorInputOf< 'THE PAIR', 'THE KEY' >` beside
 *      `DeclaredTypeOf< 'THE PAIR', 'THE KEY' >` — the two faces side by side are
 *      the whole diagnosis;
 *   3. a key APPEARED — the mirror now accepts a spelling the declaration refuses.
 *      ⛔ Widening the declaration to match is not the default remedy: the mirror is
 *      the authoring boundary, so the contract-first move is to NARROW THE MIRROR
 *      unless the declaration is the face that is wrong;
 *   4. a key DISAPPEARED — the faces agree again; correct or delete the entry.
 */
interface WiderThanDeclared {
  /**
   * SCHEMA-NODE `areas`. (`actions` left under objectui#7760: its element is a
   * schema-node slot, and once `SchemaNodeSchema` carried its input face the key
   * measured clean.)
   *
   * `label` LEFT under objectui#9092, the INLINE-LOCALE class: the mirror spelled
   * the key `I18nLabelSchema` — a plain string OR an inline locale map — while the
   * declaration restated `label?: string` and refused the map its own mirror
   * accepted. The declaration now states `string | I18nLabel`, the form
   * objectui#4580's revised Q1 ruling (option A) put on `BaseSchema.label`, so the
   * pair measures clean and this entry would be STALE if it stayed.
   */
  'app.zod.ts#AppComponentSchema': 'areas';
  /**
   * SCHEMA-NODE `schema` (objectui#11515: the pair was REGISTERED here, born
   * ledgered). The mirror's member IS `app.zod.ts#AppComponentSchema`, the same
   * schema object, and the TS twin's is that pair's declaration, so the
   * document's own WIDER reading is measured here one level up: the
   * `app.zod.ts#AppComponentSchema` entry above, through the
   * `z.ZodType< any >` annotation `NavigationItemSchema` carries. Same cause,
   * not a separate finding; it leaves when that entry does.
   */
  'app.zod.ts#AppSchemaRendererNodeSchema': 'schema';
  // `complex.zod.ts#DashboardWidgetSchema` (`component`) and, inherited through the
  // element, `complex.zod.ts#DashboardComponentSchema` (`widgets`) LEFT this ledger under
  // objectui#12163 (ruling C, comment 6121298298). Both were CONCRETE: the slot's
  // second arm was passthrough `BaseSchema`, which admitted any `type` string, so the
  // mirror accepted a `component` node the declaration's `DeclaredNode` refused. The arm
  // is now a refusal by name, and the declaration narrowed in the same change to the
  // component arm alone, so the mirror accepts nothing here that the declaration
  // refuses and both entries measured clean, as clause 4 above said they would.
  // `complex.zod.ts#ChatbotSchema` recorded `body` here (CONCRETE, and DISJOINT rather
  // than strictly wider — the pair carried a `KnownDrift` entry for the same key, one of
  // the measured cases where each face refuses something the other admits: the mirror
  // restated `body` as an arbitrary record, the declaration inherited the base's
  // schema-node-or-list). objectui#8572 ruled the collision — the record arm is retired on
  // both faces and the chat API's params stay at `requestBody` — so the mirror accepts
  // nothing the declaration refuses and the entry is GONE, per clause 4 of this ledger's
  // "when it fires" note. The pair keeps its `KnownDrift` entry above, which records the
  // ruling beside the two runtime slots that remain.
  // `complex.zod.ts#DashboardComponentSchema` LEFT this ledger WHOLE under objectui#7759
  // group A. Its last two keys were `header` and `globalFilters`, both CONCRETE and both
  // DISJOINT (each also had a `KnownDrift` entry). This entry's docblock called them "the
  // inline-locale widening one level down"; measured, that was true of `header` alone.
  // `header`'s mirror (the spec's, by reference) took an inline per-locale action label
  // the hand-written declaration refused. `globalFilters` read wider for a different
  // reason: the mirror's local `options` / `optionsFrom` restatement took the bare-string
  // option shorthand, an option with no `label` and an `optionsFrom` with no
  // `labelField`, all of which the spec (and so the declaration) refuses; its locale arm
  // ran the OTHER way, on the `KnownDrift` side. Both keys are spec-declared, so both
  // faces now state the spec's member (ruling 5617465269, principle 1) and the pair
  // measures clean in this direction. Before them, `dateRange` left under objectui#10334,
  // and `widgets` — the only MIXED key this ledger ever held — under objectui#8252 and
  // objectui#7760.
  // `complex.zod.ts#FilterBuilderSchema` (`fields`) and `complex.zod.ts#FilterFieldSchema`
  // (`operators`) LEFT under objectui#10286: the second was the operator vocabulary, each
  // face refusing a spelling the other accepted, and the first inherited it through the
  // element. Both faces now take the spec's `VIEW_FILTER_OPERATORS` by reference, so the
  // mirror accepts nothing the declaration refuses and both entries would be STALE.
  // ⭐ The FUNCTION-SLOT class (objectui#7759 group E) is GONE from this ledger:
  // `DataTableSchema.renderCellEditor`, `TableColumnSchema.cell`,
  // `FieldConstraintsSchema.validate` and `FieldConditionSchema.custom` were bare
  // `z.function()` arms — zod 4 gives those an opaque input brand no concrete
  // signature equals, so the mirror accepted ANY callable. They are now
  // `handlerKeyRefusal()` arms (the objectui#6124 shape), whose `z.input` is
  // `undefined`, and the three runtime slots among them moved to `KnownDrift`
  // above. ⚠️ Four OTHER rows left with them, and the measurement — not this
  // note — is why: `DataTableSchema.columns`, `FormFieldSchema.validation`,
  // `FormFieldSchema.condition` and `FormSchema.fields` each read wider ONLY
  // because of the function arm nested beneath them; once it went, `WiderOf`
  // resolved to `never` on the first three pairs and dropped `fields` on the
  // fourth. ⛔ Do not re-add them for the class labels they carried (F,
  // "inline shape against a named declaration"; D, "disjoint") — a row this
  // ledger records must be a measured widening.
  // `form.zod.ts#FormSchema` LEFT this ledger WHOLE under objectui#11168 slice 3
  // (objectui#7759 group C). Its last key was `layout`, CONCRETE: the mirror was
  // `z.enum(['vertical', 'horizontal', 'grid'])` while the declaration stated the
  // first two. `@objectstack/spec` 17.5.0 retired `grid` (and `inline`) from the
  // form layout enum, the `form` renderer reads only `layout === 'horizontal'` —
  // measured, `grid` drew exactly what `vertical` draws — so the mirror narrowed to
  // the declaration's two and the entry would be STALE if it stayed. (`fields` left
  // under objectui#7759 group E; `mode` under objectui#10286.)
  // `form.zod.ts#SliderSchema` recorded `defaultValue` and `value` here (CONCRETE, the class
  // objectui#7069 was filed for: a single-or-list mirror against a list-only declaration).
  // objectui#10280 (objectui#7759 group B) resolved both by the read site, per the director's
  // rule that an objectui-own key follows its read site: `defaultValue`'s renderer wraps a
  // scalar on purpose, so the DECLARATION widened to `number | number[]`; `value` has no read
  // site, so it was RETIRED on both faces. The entry is GONE, per clause 4 of this ledger's
  // "when it fires" note.
  // `layout.zod.ts#ContainerSchema` (`maxWidth`) LEFT under objectui#10286. The mirror's
  // arm was `z.boolean()` while the declaration admits the false literal alone, so `true`
  // parsed green and `tsc` refused it. The key is not in the spec, so the read site
  // decides: `container` maps `false` to `max-w-none` and `true` to NO class at all, so
  // the mirror narrowed to `z.literal(false)` and now states what the declaration states.
  /**
   * SCHEMA-NODE `slots`. (`regions` left under objectui#7760 — its element's content
   * is a schema-node list, so its reading WAS the annotation. `slots` did not move, so
   * the unconstrained position on ITS path is not one of the ten consts that card
   * filled.)
   *
   * `aria` LEFT under objectui#9092: it carried the inline-locale widening one level
   * down, on `ariaLabel`. The mirror receives the spec's own `AriaPropsSchema` BY
   * REFERENCE through `SpecPageFields` (the spec's `PageSchema` declares `aria` at its
   * top level), and that schema spells `ariaLabel` as `z.union([z.string(),
   * InlineLocaleMapSchema])`; the declaration restated the string arm alone. It now
   * states `string | I18nLabel` — the NESTED slot's vocabulary, not the FLAT
   * `BaseSchema.ariaLabel`'s KEYED one, which objectui#4580 Q2-B deliberately left
   * narrow.
   */
  'layout.zod.ts#PageNodeSchema': 'slots';
  /**
   * CONCRETE. `objectName` ENTERED under objectui#11117: the mirror waives it
   * beside a `dataSource.object` binding, as the spec and `ElementDataSourceGate`
   * do (the member is `z.string().optional()`, and the shared record-source
   * refinement refuses a node with neither), so `{ type: 'object-grid',
   * dataSource: { object: 'product' } }` parses green and `tsc` refuses it for the
   * missing member. The declaration is the face that is wrong here, not the
   * mirror — but it is also the type `ObjectGrid` reads after the gate has run,
   * and `@object-ui/plugin-grid` passes it as a `string`
   * (`translateOptions(schema.objectName, …)`), so widening it is a
   * renderer-typing change that card left out of its file surface. The entry
   * leaves when the declaration states `objectName?: string`.
   */
  'objectql.zod.ts#ObjectGridSchema': 'objectName';
  // `navigation.zod.ts#HeaderBarSchema` recorded `logo` here (CONCRETE, two arms; ENTERED
  // under objectui#7760): the mirror spelled it single-or-list `SchemaNode` and the
  // declaration a bare `string`. The `header-bar` renderer reads no `logo` at all — through
  // the real `SchemaRenderer` a URL, a node and a node list each drew the header
  // byte-identical to its absence — and the spec does not declare the key, so objectui#10387
  // RETIRED it on both faces (`?: never` beside a `retirementTombstone`). The entry is GONE.
  // `overlay.zod.ts#TooltipSchema` recorded `content` here (CONCRETE; ENTERED under
  // objectui#7760): the mirror spelled it single-or-list and the declaration the single arm.
  // The renderer places `schema.content` RAW in a React child position, so the list arm parsed
  // green and then failed to render. objectui#10280 NARROWED the MIRROR to the declaration, and
  // the entry is GONE.
  // `views.zod.ts#DetailViewFieldSchema` recorded `options` here (CONCRETE; objectui#10296,
  // ruling F1), and its two containers `views.zod.ts#DetailViewSchema` (`fields`, `sections`)
  // and `views.zod.ts#DetailViewSectionSchema` (`fields`) SCHEMA-NODE: the mirror is the spec's
  // authoring `SelectOptionSchema`, whose `visibleWhen` envelope admitted an object with no
  // `source` through `@objectstack/spec` 17.4.0, which the read model's wire refuses. The
  // spec-version gate `SpecEnvelopeAdmitsSourceless` held the three entries on 17.4.0 and
  // withheld them on objectstack `main`. `@objectstack/spec` 17.5.0 requires a non-blank
  // `source`, so the mirror is no longer wider, and the entries, their `WIDER_ARMS` rows and
  // the gate LEFT together at that pin bump, as the gate's docblock instructed
  // (objectui#11073). The `KnownDrift` entry for the pair (`dialect` required) holds on both.
}

/**
 * Every entry in this ledger names a REGISTERED pair — the same guard
 * `assertionUnmirroredLedgerKeysAreRegistered` puts on the two unmirrored ledgers,
 * and for the same reason: a misspelled pair key is ignored by the map below while
 * the real pair reads as having no entry, so the failure points at the wrong thing.
 */
export type assertionWiderLedgerKeysAreRegistered =
  Expect< Equal< Exclude< keyof WiderThanDeclared, MirrorKey >, never > >;

/* ── The same ledger at ARM granularity (objectui#8252) ─────────────────────── */

/**
 * One arm of one ledgered key, classified on the axis objectui#7759 sorted on.
 *
 * `SCHEMA-NODE` — the arm's input face still carries an `unknown` from a
 * recursion-breaking `z.ZodType< any >` annotation nested under it, so the WIDER
 * reading on it is the ANNOTATION, not an accept-set gap.
 * `CONCRETE` — everything else: the arm states a shape an author can write, so
 * `safeParse` returns green and the declaration alone decides whether `tsc` agrees.
 *
 * ⚠️ The SCHEMA-NODE clause named `SchemaNodeSchema` until objectui#7760, and after
 * that card the name would be a wrong reason attached to a right verdict: that const
 * carries its declaration now, so an arm spelled through it is CONCRETE — which is why
 * the three keys that ENTERED this ledger there are CONCRETE despite being schema-node
 * slots. The six SCHEMA-NODE rows that remain each reach an annotation still standing
 * (this file's other three consts, or one outside this package). ⛔ The class is about
 * the READING; do not re-attach it to a const.
 * The INLINE-LOCALE, FUNCTION-SLOT and structural sub-classes the docblocks above
 * name are all CONCRETE here — this axis asks only whether the instrument produced
 * the reading, and those finer names stay where they are. ⛔ OPEN-RECORD is NOT in
 * that list and its absence is deliberate: objectui#8517's clause can read the
 * class but no row carries it today (see the header bullet), and a sub-class named
 * here with no docblock above naming a row is the rot this file is about.
 */
type WiderArmClass = 'SCHEMA-NODE' | 'CONCRETE';

/**
 * `WiderThanDeclared` at ARM granularity — one verdict per union arm of the
 * mirror's slot, keyed `<pair>::<key>` (objectui#8252).
 *
 * ## The per-KEY verdict was a verdict over a per-ARM fact
 *
 * The ledger above records a class per ENTRY, in prose, and its clause for
 * `complex.zod.ts#DashboardComponentSchema.widgets` was three words — "`widgets` is
 * SCHEMA-NODE". True of the widget-envelope arm; false of the other, a
 * `BaseSchema.extend({ type: z.enum(DASHBOARD_COMPONENT_WIDGET_TYPES) })` component
 * node the TypeScript face was missing WHOLE, so the maintainer-ruled `metric-card`
 * node parsed green and `tsc` refused it with no annotation an author could write
 * (objectui#7952, ruled under objectstack#8593 and declared by PR #8296, `c842594`).
 * ⭐ One key, two arms, and the artifact in one absorbed the real divergence in the
 * other. objectui#7759 sorted its whole SCHEMA-NODE bucket out of its disposition
 * lane on verdicts of that shape, which is what objectui#8252 re-judged.
 *
 * ## What is measured here and what is judged
 *
 * The ARM ENUMERATION is a MEASUREMENT — `measureMirrorArms` walks the mirror VALUE,
 * for the same reason the blind-region leg at the bottom of this file is at runtime:
 * at the type level every unconstrained face looks alike. The per-arm VERDICT is a
 * judgement, and this table is where it lives so that three things can be pinned
 * that prose could not carry: every ledgered key names one verdict PER MEASURED ARM
 * (a mirror that grows an arm reddens until someone judges it), the row set is
 * exactly the ledger's key set, and objectui#7952's key cannot collapse back to a
 * single verdict.
 *
 * ⛔ The verdicts are NOT derived. At runtime BOTH of `widgets`' arms reach
 * `SchemaNodeSchema` — the component arm through `BaseSchema`'s own `body` /
 * `children` slots — so "reaches a lazy node" separates neither arm from the other
 * and would classify every component-node arm in this repo as an artifact.
 * ⚠️ objectui#7952 describes that arm as having "no schema-node recursion in it at
 * all"; measured, it has, through the base. Its conclusion survives the correction,
 * because what makes the arm CONCRETE is its own `type` enum and passthrough shape,
 * not the absence of the artifact underneath it.
 *
 * ## The census objectui#8252 ran, on `c842594`
 *
 * Every key in the ledger, arms enumerated from the mirror and judged. Most keys are
 * single-arm, and for those the arm verdict IS the key verdict — a single-arm key
 * has no sibling to hide behind, which is the entire mechanism, so they are recorded
 * rather than reasoned about. Of the keys that ARE unions, exactly one sits in the
 * SCHEMA-NODE bucket and it is objectui#7952's own; the rest were already CONCRETE
 * in objectui#7759's lane, arm by arm, so nothing was re-filed. ⇒ Measured, the
 * shape does not recur. The header bullet carries the figures and they are pinned.
 *
 * ⚠️ Two bounds, stated because a census that does not state them reads as wider
 * than it is. It looked ONE LEVEL DOWN as well — each arm's own shape properties,
 * for a union mixing a schema-node arm with a concrete one — and found none. It does
 * ⛔ NOT answer whether a single-arm SCHEMA-NODE key's reading has a SECOND, concrete
 * cause underneath the artifact: that is a different mechanism from hiding behind a
 * sibling, and it needs a two-face comparison per key rather than an arm count.
 */
/**
 * The separator between a row's pair and its key.
 *
 * ⚠️ `::` and ⛔ not the `.` that `UNNAMED_LAZY_SLOTS` below uses for the same
 * pair-and-key shape. Measured while objectui#8252 landed: a dotted row for
 * `app.zod.ts#AppComponentSchema`'s handler-array key spells a PROPERTY READ of
 * that key, in a file that already names `AppComponentSchema` — which is anchor A
 * of the reader census in `handler-keys-string-any-mirrors-7344.test.ts`. That
 * census then reads this file as a THIRD reader of a key whose reader set it pins
 * at one file, and fails, correctly and on its own terms. The two repairs are not
 * equal: adding this file to that census's prose allow-list would blunt it here
 * permanently, so the separator moved instead. ⛔ Do not "unify" it with the dotted
 * spelling — `UNNAMED_LAZY_SLOTS` happens to name no key that any census anchors
 * on, which is the only reason the collision is one-sided rather than absent.
 * ⛔ And do not spell the colliding key literally in this docblock: doing so
 * reproduces the very match this separator exists to avoid (it did, once).
 */
const WIDER_ARM_ROW_SEPARATOR = '::';

const WIDER_ARMS: Readonly< Record< string, readonly WiderArmClass[] > > = {
  'app.zod.ts#AppComponentSchema::areas': ['SCHEMA-NODE'],
  // objectui#11515: the one arm is the app document, read wider through the
  // annotation the `areas` row above reaches (the ledger entry says so).
  'app.zod.ts#AppSchemaRendererNodeSchema::schema': ['SCHEMA-NODE'],
  // `complex.zod.ts#DashboardComponentSchema::widgets` and
  // `complex.zod.ts#DashboardWidgetSchema::component` left with their ledger entries
  // (objectui#12163).
  'layout.zod.ts#PageNodeSchema::slots': ['SCHEMA-NODE'],
  'objectql.zod.ts#ObjectGridSchema::objectName': ['CONCRETE'],
};

/* ── The invariant ──────────────────────────────────────────────────────────── */

/**
 * Every pair's TYPE drift equals what `KnownDrift` records for it — `never` for every
 * pair with no entry, which is the population minus that ledger's size. ⛔ That
 * difference is derived by the runtime census (objectui#7433), not written down here.
 *
 * Routed through `ReconcileAgainstLedger` rather than spelling the conditional
 * inline. That is a semantics-preserving refactor and nothing else — the type is
 * literally `Equal< Measured, Recorded > extends true ? never : K`, exactly what
 * stood here — and it buys one thing: the recognition pins at `assertionRatchet…`
 * now cover THIS assertion's reconciliation as well as the new one's.
 */
export type LedgerMismatch = {
  [K in MirrorKey]: ReconcileAgainstLedger<
    K,
    DriftOf< K >,
    K extends keyof KnownDrift ? KnownDrift[K] : never
  >;
}[MirrorKey];

/**
 * Fails when any pair's drift differs from its ledger entry, IN EITHER DIRECTION.
 *
 * Written as an assignment to `never` rather than `Expect< Equal< …, never > >`
 * so the compiler prints the OFFENDING PAIR in the failure — `Type
 * '"complex.zod.ts#DashboardComponentSchema"' is not assignable to type 'never'`.
 * The `Expect<…>` spelling has identical teeth but reports only `Type 'false'
 * does not satisfy the constraint 'true'`, which names neither the pair nor the
 * key and sent one CI failure to the compiler API to diagnose.
 *
 * When it fires, fix it by MEASURING, never by editing the assertion:
 *   1. the message names the pair;
 *   2. re-measure that pair's drift (resolve `DriftOf< '<pair>' >`);
 *   3. correct its `KnownDrift` entry to the measured set — or delete the entry
 *      if the drift is gone, which is the whole point of the ratchet.
 *
 * If the named pair is in `SPEC_DERIVED_PAIRS` below, one side of its comparison
 * comes from `@objectstack/spec`, so a spec bump is a candidate cause and the
 * lockfile is the thing to check first. (It was NOT the cause of the firing
 * described below: the lockfile pinned one spec version across every commit
 * involved and the merge did not touch it.)
 *
 * Its first real firing was direction (3): objectui#5855 retired
 * `DashboardComponentSchema.aria` on `main` while this branch was open, so a key
 * this ledger recorded as drifted had been corrected elsewhere and the entry went
 * stale. CI sees the PR's MERGE with `main`, not the branch head, so a ledger can
 * go stale under a branch without anything on the branch changing.
 */
export const assertionDriftMatchesLedger: never = 0 as unknown as LedgerMismatch;

/**
 * The SECOND half of the forward comparison: every pair's declared-but-unmirrored
 * key set equals what the two ledgers TOGETHER record for it — `never` for every pair
 * with no entry in either, which is the population minus the union of the two ledgers
 * and is derived by the runtime census (objectui#7433), not written down here.
 * Six of `RuntimeOnlyDeclared`'s seven
 * pairs are a measured subset of `UnmirroredDeclared`'s 14, so objectui#6152's
 * reclassification left the clean population unchanged; objectui#6150 then added
 * `TreeViewSchema`, whose only entry was runtime-only, which is why the union was for
 * a time one pair larger than `UnmirroredDeclared` itself. (objectui#6576 took the
 * union to 18;
 * objectui#7129 brought it back to 17 by retiring `DetailViewSectionSchema`'s only
 * ledgered key, objectui#7623 to 16 by retiring `DashboardComponentSchema`'s,
 * objectui#7352 to 14 by MIRRORING both `drillDown` entries — each leaving its
 * pair with no entry in either half — and objectui#7655 to 15 by registering
 * `ChatbotFloatingSchema` born ledgered. ⚠️ Two of those pairs still carry a
 * `KnownDrift` entry: "no entry in either" is about the two UNMIRRORED ledgers.)
 * ⭐ objectui#7804's `TreeViewSchema` slice closed that gap: the key was MIRRORED as
 * a named refusal, the pair's runtime-only entry went with it, and the union is
 * `UnmirroredDeclared` exactly — ⛔ so the present-tense clause this paragraph used
 * to carry ("which is why the union is one pair larger") is now history, and the
 * live figure lives in the file header where it is pinned. (objectui#6152 round 3
 * made the union LARGER than `UnmirroredDeclared` again, by two runtime-only pairs;
 * the header states and pins it, and ⛔ this paragraph does not restate it.)
 *
 * ⚠️ **The discriminating signal is the PER-PAIR set, not this file's exit code.**
 * The exit code is a whole-file verdict, so it moves only while the rest of the
 * file is green — and objectui#6058 measured the state where it does not move at
 * all. On the un-seeded tree the comparison was already red on 23 pairs, so
 * `tsc -p tsconfig.test.json` returned 2 BEFORE and AFTER the card's ablation while
 * the ablated pair went from clean to ten drifted keys. Seeding this ledger is what
 * restored the exit code as a usable signal, and it stays usable only while it is
 * green at rest. To read a change of state, resolve
 * `UnmirroredOf< '<the named pair>' >` on each side and compare the SETS.
 *
 * ⚠️ And it is a COMPILE-TIME assertion. The `describe` block at the bottom of this
 * file is a population census — it checks that the registry is closed and that
 * `SPEC_DERIVED_PAIRS` re-derives, and it never compares keys at all. Its passing
 * test count does not move when this half reddens, correctly, and
 * it did not move under the ablation either. (It read `5 passed (5)` until
 * objectui#6705 added the seven-fixture suite pinning the re-check's scanner.) Reading the runtime half for evidence
 * about drift measures the wrong instrument and concludes the guard does nothing.
 *
 * ⛔ The count this clause used to RESTATE is GONE, not refreshed (objectui#9603 —
 * a GUIDANCE clause, so the header's LIVE / HISTORICAL split obliges a later card to
 * amend it and to name itself doing so; the two RECORD clauses beside it are left
 * byte-identical). It said 12, true when objectui#6705 wrote it; the card measured
 * 32 on `origin/main` when it was filed; `vitest run` printed `37 passed (37)` at
 * `4b577229` two days later when it was worked. ⭐ Refreshing it would have bought
 * about one merge, and the reason generalises: this suite grows whenever a pin is
 * added, which is this file WORKING, so a restated case count rots ON GOOD NEWS and
 * nothing short of deleting it makes the sentence durable. ⛔ Do not put a number
 * back — the figure-free spelling is already here, in `WiderLedgerMismatch` below
 * ("their passing test counts do not move when this reddens"), which never rotted.
 *
 * When it fires, fix it by MEASURING (the compiler-API recipe and the
 * error-printing trap are in the ledger's header above):
 *   1. the message names a pair, possibly with `... N more ...` after it;
 *   2. resolve `UnmirroredOf< '<pair>' >`;
 *   3. a key APPEARED — that is a new defect on a published surface; mirror it, or
 *      narrow the declaration. ⛔ Adding it to `UnmirroredDeclared` is not a supported
 *      route: that ledger is SHRINK-ONLY. The ONE exception is a callback-shaped key,
 *      which objectui#6152 ruled can never be mirrored: it is recorded in
 *      `RuntimeOnlyDeclared` instead, and `assertionRuntimeOnlyIsCallbackShapedOrNamed`
 *      is what stops that exception from widening into a waiver — a NON-callback key
 *      goes there only by a ruling that adds its row, with its reason, to
 *      `RuntimeOnlyNamedAllowList` (objectui#6152 round 3 is the one such ruling);
 *   4. a key DISAPPEARED — good news, and the entry must be corrected or deleted, in
 *      whichever of the two ledgers holds it. That is the ratchet doing its job.
 */
/**
 * What the TWO unmirrored ledgers together record for one pair (objectui#6152).
 *
 * One measurement, one reconciliation, two ledgers on the recorded side. Splitting
 * the RECORD by remedy while keeping the MEASUREMENT whole is what makes the
 * reclassification a bookkeeping change and not a hole: a declared-but-unmirrored key
 * must appear in one of the two halves or the pair reddens.
 */
export type RecordedUnmirrored< K extends MirrorKey > =
  | (K extends keyof UnmirroredDeclared ? UnmirroredDeclared[K] : never)
  | (K extends keyof RuntimeOnlyDeclared ? RuntimeOnlyDeclared[K] : never);

export const assertionUnmirroredMatchesLedger: never = 0 as unknown as {
  [K in MirrorKey]: ReconcileAgainstLedger< K, UnmirroredOf< K >, RecordedUnmirrored< K > >;
}[MirrorKey];

/**
 * What `WiderThanDeclared` records for a pair — `never` for a pair with no entry.
 *
 * It applied a SPEC-VERSION GATE until `@objectstack/spec` 17.5.0
 * (`SpecEnvelopeAdmitsSourceless`, objectui#10296): on 17.4.0 the `visibleWhen`
 * envelope of `views.zod.ts#DetailViewFieldSchema::options` admitted an object with no
 * `source`, so that row and its two containers had to measure WIDER there and absent on
 * objectstack `main`. 17.5.0 requires `source`, the gate read `false` for good, and the
 * rows and the gate were deleted together at that pin bump, as the gate's docblock
 * instructed (objectui#11073).
 */
export type WiderRecorded< K extends MirrorKey > =
  K extends keyof WiderThanDeclared ? WiderThanDeclared[K] : never;

/**
 * The THIRD direction: every pair's WIDER key set equals what `WiderThanDeclared`
 * records for it — `never` for the pairs with no entry.
 *
 * Routed through `ReconcileAgainstLedger` like the two above, so the recognition
 * pins at `assertionRatchet…` cover this reconciliation too, and written as an
 * assignment to `never` for the same reason the other two are: the compiler then
 * prints the OFFENDING PAIR instead of `Type 'false' does not satisfy the
 * constraint 'true'`.
 *
 * ⚠️ Like `assertionUnmirroredMatchesLedger`, this is a COMPILE-TIME assertion. The
 * `describe` blocks at the bottom are a population census and a runtime scan; their
 * passing test counts do not move when this reddens. `pnpm --filter
 * @object-ui/types type-check` is the gate that reads it.
 */
export type WiderLedgerMismatch = {
  [K in MirrorKey]: ReconcileAgainstLedger< K, WiderOf< K >, WiderRecorded< K > >;
}[MirrorKey];

export const assertionWiderMatchesLedger: never = 0 as unknown as WiderLedgerMismatch;

/**
 * The same reconciliation, reported by KEY instead of by pair.
 *
 * Not a duplicate: the assignment above resolves to the PAIR, which is what makes a
 * failure locatable, and it says nothing about which key moved. This one resolves
 * to the symmetric difference between the measured set and the recorded one, so the
 * compiler prints the key names — `Type '"variant"' is not assignable to type
 * 'never'` — and the two messages together are the diagnosis, without anyone having
 * to resolve a type by hand first. Both are needed and neither is sufficient: a key
 * name alone does not say which of the pairs it appears on has moved.
 */
export type WiderLedgerKeyDrift = {
  [K in MirrorKey]:
    | Exclude< WiderOf< K >, WiderRecorded< K > >
    | Exclude< WiderRecorded< K >, WiderOf< K > >;
}[MirrorKey];

export const assertionWiderLedgerRecordsEveryKey: never = 0 as unknown as WiderLedgerKeyDrift;

/* ── The FOURTH direction's ledger (objectui#9711) ──────────────────────────── */

/**
 * Exact MIRRORED-BUT-UNDECLARED key set per pair — the seed of the direction
 * objectui#9711 opened, measured on the tree this ledger landed on.
 *
 * `this ledger seeds **3 entries** carrying **4 keys**` — and ⛔ read that off the
 * census at the bottom of this file, not off this sentence: both figures are pinned
 * to this ledger's own AST by 'the fourth direction is enumerated and sized at test
 * time', so an entry or an arm added here moves them or the file reddens.
 *
 * ⭐ Both figures moved UP when objectui#12736 (triage scoping B, comment
 * 6220534234) added the `form.zod.ts#SelectOptionSchema` row: one entry, two keys.
 * That is a growth in SHAPE only, and the accept set moved the other way — the two
 * keys are named REFUSALS, which is how the `operators` row below reads too. Its
 * docblock says why the row exists and why the twin does not declare the keys.
 *
 * ⭐ Both figures moved DOWN by one when objectui#9738 retired the
 * `views.zod.ts#DetailViewFieldSchema` row — the ratchet's only permitted
 * direction, and the first time this seed has shrunk. The comment left where that
 * row stood says which ruling took it and why the neighbouring `operators` row
 * stayed after a ruling of its own.
 *
 * ⭐ Then by three entries at once, when objectui#9736 executed ruling batch #167
 * item 4 (letter 甲): the SPEC-OWNED INFLOW rows — App, Dashboard, Page — left
 * because the three TypeScript twins now take the spec by reference over the SAME
 * exclusion arrays their mirrors read. That is not the "declare the keys one by
 * one" remedy the next section refuses: no key was hand-declared, the twin and the
 * mirror were put on one derivation, and the ruling named the mechanism.
 *
 * ⭐ Then by two entries and 58 keys, when objectui#9256 executed parameter 3 of the
 * ruling on objectui#8284 (Q2 A): the `Omit` COLLAPSE rows — the `email` / `password`
 * and `ui:calendar` twins — left because their heritage clauses stopped collapsing
 * into `BaseSchema`'s index signature. ⚠️ That is NOT the "declare the keys" remedy
 * the next section refuses, and the direction is the reason: a collapsed face
 * accepted EVERY key at `any`, so restoring the named members NARROWED those faces
 * (`label: 42` and `body` stopped type-checking on `email`) rather than enlarging an
 * accept set. No key was hand-declared; the members are inherited from the very
 * declarations the mirrors `.omit()` / `.extend()`.
 *
 * ## ⛔ What this ledger is NOT
 *
 * ⛔ It is NOT a worklist to be drained by DECLARING the keys it names. Declaring a
 * key on a published TypeScript face ENLARGES AN ACCEPT SET — a contract decision,
 * at-tier, per key, and deliberately outside the card that built this instrument.
 * ⛔ It is NOT drained by narrowing a mirror either: that removes a key an author can
 * write today and is the same decision pointing the other way. Either remedy is a
 * separate card with a separate review; this ledger is the MEASUREMENT that makes
 * either one arguable.
 *
 * ## It is a FLOOR, not a waiver — the same ratchet the other three carry
 *
 * A NEW mirrored-but-undeclared key on any pair reddens the reconciliation
 * immediately, seeded pair or not (`assertionRatchetRejectsFreshDrift` and
 * `assertionRatchetRejectsGrowth` pin both shapes). A key that LEAVES the
 * measurement — mirrored key removed, or the declaration widened to state it —
 * reddens it as STALE until the entry is corrected (`assertionRatchetRejectsStaleKey`,
 * `assertionRatchetRejectsStaleEntry`). So the seed can only shrink.
 *
 * ## The two CLASSES this seed holds, because they call for different remedies
 *
 * ⚠️ Stated as a reading of the entries below, ⛔ not as a rule the instrument
 * applies: nothing here classifies, and the split is re-derivable from
 * `SPEC_DERIVED_PAIRS` plus each declaration's own shape.
 *
 *   - **SPEC-OWNED INFLOW.** The mirror is built `.extend(SpecXFields.shape)`, so
 *     every spec-owned key flows in BY REFERENCE while the hand-written TypeScript
 *     interface restates only the subset objectui's renderers read. The remedy axis
 *     is the same one objectstack#4115 opened when it made the keys flow in at all,
 *     and it is a spec-alignment decision, not a typo.
 *   - **`Omit` COLLAPSE — EMPTIED by objectui#9256.** The declaration was
 *     `Omit< Base, K >` over an interface that carried `BaseSchema`'s index
 *     signature, so `Exclude< keyof Base, K >` resolved through `string` and the
 *     `Pick` collapsed EVERY member into the index signature; the mirror propagated
 *     because zod `.extend()` carries the shape. Both instances (the `email` /
 *     `password` and `ui:calendar` twins) were repaired on the DECLARATION side and
 *     their rows deleted. ⭐ The class is still why the operator must not be "fixed"
 *     to read fewer keys: it reported a real property of the published declaration,
 *     loudly, which is precisely what a degenerate `DeclaredKeys< D >` should do. A
 *     vacuous reading here over-reports and is caught; the naive `keyof D` spelling
 *     under-reports to `never` and would never be caught at all.
 */
interface MirroredUndeclared {
  // `app.zod.ts#AppComponentSchema` HAD a row here — 20 keys of SPEC-OWNED INFLOW
  // (the package-lock envelope, `protection`, `isDefault`, `_unpublished`,
  // `defaultAgent`, the spec's tombstones, and the LOCAL `contextSelectors` arm) —
  // and its DELETION is the ratchet moving in its only permitted direction.
  // objectui#9736 (ruling batch #167 item 4, letter 甲) made the TypeScript twin take
  // the spec BY REFERENCE the way its mirror does: `AppComponentSchema extends
  // BaseSchema, Omit< App, … >` over `APP_SPEC_EXCLUDED`, the one `as const` array the
  // mirror's `specFieldsExcept` call also reads, and `contextSelectors` declared on
  // the twin over the mirror's own element schema. The pair now measures `never`;
  // re-adding the row without re-adding the defect reddens the reconciliation below.


  // `complex.zod.ts#DashboardComponentSchema` HAD a row here — 11 keys (the envelope,
  // `protection`, and the tombstones `aria` / `refreshInterval` / `performance`) —
  // deleted by objectui#9736 for the reason the App note above gives: the twin
  // extends `Omit< Dashboard, … >` over `DASHBOARD_SPEC_EXCLUDED`. Its `header`
  // member was withheld from that projection on the TypeScript face only until
  // objectui#7759 group A, which dropped the withholding: the twin inherits the
  // spec's `header`, and the key left `KnownDrift` / `WiderThanDeclared` with it.


  /**
   * LOCAL, and a single key: the mirror states `aria` and the declaration does not.
   * The smallest entry in this ledger, and the shape the direction was filed to make
   * visible — one key, on one pair, invisible to all three operators that stood
   * before the fourth.
   */
  "complex.zod.ts#DashboardConfigSchema":
    | "aria";

  // `form.zod.ts#InputShorthandSchema` and `form.zod.ts#UiCalendarSchema` HAD rows
  // here — the whole `Omit` COLLAPSE class (32 and 26 keys): both TypeScript twins
  // were spelled `Omit< Base, K >` over an interface carrying `BaseSchema`'s index
  // signature, so each face declared only what it wrote itself. objectui#9256 (the E3
  // residual the ruling on objectui#8284 moved there) repaired the FACES, not this
  // measurement: both heritage clauses are now `OmitDeclared`, a key-remapping `Omit`
  // that keeps the named members, and both pairs measure `never`. Re-adding either row
  // without re-adding the collapse reddens the reconciliation below.


  // `layout.zod.ts#PageNodeSchema` HAD a row here — 10 keys (the envelope, `source`,
  // `interfaceConfig`, `requires`) — deleted by objectui#9736 for the same reason:
  // the twin extends `Omit< Page, … >` over `PAGE_SPEC_EXCLUDED`. Its `slots` member
  // is withheld from that projection on the TypeScript face only, and stays in
  // `KnownDrift` / `WiderThanDeclared` where it was.


  /**
   * LOCAL, one key — and the row STAYS after its ruling, which is the thing to
   * read here before assuming it should have gone.
   *
   * `operators` was mirrored with a comment on its own line saying it was missing
   * from an earlier TypeScript scan — so the gap was NOTICED at authoring time,
   * written down in a comment, and then measured by nothing for as long as the
   * fourth direction did not exist. That was objectui#9729's thesis in one key.
   *
   * ⭐ objectui#9739 (maintainer, 2026-09-18, letter C) ruled it: the mirror no
   * longer ACCEPTS the key, it REFUSES it by name and prints the spelling
   * `@objectstack/spec` declares on `object-grid` — `operations`, re-derived
   * against the installed pin by `object-grid-operators-tombstone-9739.test.ts`,
   * not copied from prose. The twin is deliberately untouched (declaring the key
   * was the refused option); `BaseSchema`'s index signature absorbed an authored
   * `operators` as `any` until objectui#8347, and the twin refuses it as an
   * undeclared key now.
   *
   * ⚠️ WHY THE ROW DOES NOT LEAVE THIS LEDGER. This direction measures "the zod
   * mirror STATES a key the TypeScript twin does not", and a retirement tombstone
   * is still a stated member — that is precisely what lets it refuse rather than
   * be passed through unexamined. The same is true of the `aria` entry above,
   * which has been a tombstone all along. ⇒ ⛔ Do not read a row here as an
   * unrepaired defect; the ledger reports SHAPE, and the per-key consequence —
   * silently absorbed, or loudly refused — is measured elsewhere and differs
   * between rows that look identical from here.
   */
  "objectql.zod.ts#ObjectGridSchema":
    | "operators";

  /**
   * LOCAL, two keys, both REFUSALS — added by objectui#12736 (triage scoping B,
   * comment 6220534234), the same shape as the `operators` row above.
   *
   * The SDUI form-option face narrowed to the spec's FORM-VIEW option
   * (`FormSelectOptionSchema`), which leaves out the object-field option's
   * `default` and `kind`. The TypeScript twin `SelectOption` simply does not
   * declare them (its spec-owned keys are exactly the form-view option's). The
   * mirror is a bare `z.object`, which would STRIP an undeclared key and report
   * success, so it states each key as an unwritable tombstone and refuses a value
   * there by name. The keys are derived (the set difference of the two spec
   * shapes), not listed; this row is their measurement.
   *
   * ⛔ Declaring either key on the twin, even as `?: never`, is the refused option:
   * the twin's key set is pinned equal to the form-view option's plus the named
   * divergences by `select-option-form-view-boundary-12736.test.ts`.
   */
  "form.zod.ts#SelectOptionSchema":
    | "default"
    | "kind";

  // `views.zod.ts#DetailViewFieldSchema` HAD a row here, for `dueLike`, and its
  // DELETION is the ratchet moving in the only direction this seed may move in
  // — ⛔ not an entry lost in an edit. objectui#9738 (maintainer, 2026-09-18,
  // letter A) declared `dueLike?: boolean` on the `DetailViewField` twin, so the
  // mirror no longer states a key the twin does not and the pair measures
  // `never`. Re-adding the row without re-adding the defect reddens the
  // reconciliation below, which is the guard against exactly that.
  //
  // ⚠️ Read this beside the `objectql.zod.ts#ObjectGridSchema` row above, which
  // STAYED after its own ruling: a retirement tombstone is still a stated
  // member, a declaration on the twin is not. The two rulings landed the same
  // day and moved this ledger in opposite directions.
  //
  // The per-key consequences — that the mirror judges the key rather than merely
  // passing it, and that objectui's own detail-view path READS it at runtime —
  // are measured by `mirror-only-published-keys-9729.test.ts` and by the two
  // probes objectui#9729 landed beside the renderers that read it.
}

/**
 * Every ledgered pair names a REGISTERED pair — the same guard the other three
 * ledgers carry, for the same reason: a misspelled pair key is ignored by the map
 * below while the real pair reads as having no entry, so the failure points at the
 * wrong thing.
 */
export type assertionMirroredUndeclaredLedgerKeysAreRegistered =
  Expect< Equal< Exclude< keyof MirroredUndeclared, MirrorKey >, never > >;

/**
 * The FOURTH direction reconciled: every pair's mirrored-but-undeclared key set
 * equals what `MirroredUndeclared` records for it — `never` for every pair with no
 * entry, which is the population minus that ledger's size. ⛔ That difference is
 * derived by the census at the bottom of this file, never written down here.
 *
 * Spelled INLINE rather than through a named alias, for the reason the header's
 * measurement section gives: through a named alias TypeScript prints the ALIAS NAME
 * and elaborates exactly ONE member with no ellipsis, so a failure on many pairs
 * reads as a failure on one.
 *
 * When it fires, fix it by MEASURING, never by editing the assertion:
 *   1. the message names a pair, possibly with `... N more ...` after it;
 *   2. resolve `MirroredUndeclaredOf< '<pair>' >`;
 *   3. a key APPEARED — a mirror now accepts a spelling the published TypeScript does
 *      not declare. ⛔ Declaring it is NOT the local fix: that enlarges an accept set
 *      and is an at-tier contract decision. File it, and record it here only with that
 *      decision's card named in its docblock;
 *   4. a key DISAPPEARED — the entry must be corrected or deleted. That is the
 *      ratchet doing its job, and it is the only direction this seed may move in.
 */
export const assertionMirroredUndeclaredMatchesLedger: never = 0 as unknown as {
  [K in MirrorKey]: ReconcileAgainstLedger<
    K,
    MirroredUndeclaredOf< K >,
    K extends keyof MirroredUndeclared ? MirroredUndeclared[K] : never
  >;
}[MirrorKey];

/**
 * The same reconciliation, reported by KEY instead of by pair — the pairing
 * `assertionWiderLedgerRecordsEveryKey` established, and not a duplicate: the
 * assignment above resolves to the PAIR, which is what makes a failure locatable,
 * and says nothing about which key moved. This resolves to the symmetric difference,
 * so the compiler prints the key names. Both are needed and neither is sufficient.
 */
export type MirroredUndeclaredLedgerKeyDrift = {
  [K in MirrorKey]:
    | Exclude< MirroredUndeclaredOf< K >, K extends keyof MirroredUndeclared ? MirroredUndeclared[K] : never >
    | Exclude< K extends keyof MirroredUndeclared ? MirroredUndeclared[K] : never, MirroredUndeclaredOf< K > >;
}[MirrorKey];

export const assertionMirroredUndeclaredRecordsEveryKey: never =
  0 as unknown as MirroredUndeclaredLedgerKeyDrift;

/**
 * No pair's FOURTH-direction measurement has degenerated to `any`.
 *
 * `any` is assignable to `never`, so a measurement that collapsed to `any` would
 * reconcile SILENTLY GREEN against any entry at all — the sibling
 * `assertionNoVacuousWiderMeasurement` exists because that was observed once on the
 * third direction, and this half of the file does not get to assume it cannot happen.
 */
export type VacuousMirroredUndeclaredMeasurement = {
  [K in MirrorKey]: IsAny< MirroredUndeclaredOf< K > > extends true ? K : never;
}[MirrorKey];

export type assertionNoVacuousMirroredUndeclaredMeasurement =
  Expect< Equal< VacuousMirroredUndeclaredMeasurement, never > >;

/**
 * No pair's WIDER measurement has degenerated to `any`.
 *
 * This is not a hypothetical. `any` is assignable to `never`, so a pair whose
 * measurement collapses to `any` reconciles SILENTLY GREEN against any ledger entry
 * at all — the assignment above cannot report it, and neither can the ledger. It
 * was observed while this direction was being built: a recursive spelling of
 * `Unconstrained` that descended into object properties drove exactly the deepest
 * pairs to `any`, and the invariant stayed green while measuring nothing on them.
 * `assertionNoVacuousEntry` guards the shape side of vacuity; this guards the
 * measurement side, which the same file did not previously need.
 */
export type VacuousWiderMeasurement = {
  [K in MirrorKey]: IsAny< WiderOf< K > > extends true ? K : never;
}[MirrorKey];

export type assertionNoVacuousWiderMeasurement = Expect< Equal< VacuousWiderMeasurement, never > >;

/**
 * Non-vacuity for every registered entry at once.
 *
 * `NarrowerThanDeclared` is `never` — green — for an entry whose mirror exposes no
 * `.shape`, and also for one whose key union has degenerated to bare `string` (the
 * `.passthrough()` failure mode #5680 measured: every literal is `Exclude`d by
 * `string`, so a guard written over it stays green while keys are demonstrably
 * narrow). Both are pinned out here rather than per entry.
 */
type VacuousEntry = {
  [K in MirrorKey]: [MirroredKeys< (typeof MIRRORS)[K] >] extends [never]
    ? K
    : string extends MirroredKeys< (typeof MIRRORS)[K] > ? K : never;
}[MirrorKey];

export type assertionNoVacuousEntry = Expect< Equal< VacuousEntry, never > >;

/**
 * A pairing whose two sides share NO key compares nothing and is green forever —
 * the shape a wrong pairing takes. (It is not a complete defence against a wrong
 * pairing, only against the vacuous one; the pairings themselves are reviewed.)
 */
export type NonOverlappingPair = {
  [K in MirrorKey]: [MirroredKeys< (typeof MIRRORS)[K] > & keyof Declared[K]] extends [never] ? K : never;
}[MirrorKey];

export type assertionEveryPairOverlaps = Expect< Equal< NonOverlappingPair, never > >;

/**
 * The six keys objectui#4605 was filed and re-measured against, pinned as really
 * reachable through `BaseSchema`'s own `.shape`.
 *
 * `assertionNoVacuousEntry` above catches shape degeneration for EVERY entry;
 * this is the one entry where the degenerate shape was actually observed — #5680
 * measured `.passthrough()` collapsing `keyof z.input<typeof Mirror>` to bare
 * `string`, with a pin written over it resolving `never` while five keys were
 * demonstrably narrow. So that card's explicit key pin is kept here by name
 * rather than folded into the generic check.
 */
export type assertionBaseSchemaKeysResolve = Expect<
  Equal<
    Exclude<
      'type' | 'label' | 'description' | 'visible' | 'disabled' | 'ariaLabel',
      MirroredKeys< (typeof MIRRORS)['base.zod.ts#BaseSchema'] >
    >,
    never
  >
>;

/* ── Exclusions ─────────────────────────────────────────────────────────────── */

/**
 * Every exported const in `../zod/` that is NOT a registered pair, with the reason.
 * An entry here is a declared decision; the census below refuses a const that is
 * in neither map.
 */
const EXCLUSIONS: Readonly<Record<string, string>> = {
  // objectui#8802 — the RETIRED `kanban` node type key's refusal arm. It is not
  // a mirror of anything and cannot drift: `retiredNodeType()` builds an object
  // whose only member is the `type` literal it refuses on, so there is no TS
  // declaration for it to restate. The arm exists purely so
  // `AnyComponentSchema`'s discriminator routes a `{ "type": "kanban" }`
  // document to a message naming `object-kanban`, instead of the union's own
  // remedy-free `Invalid input`. Pinned in
  // `./bare-kanban-node-key-retired-8802.test.ts`.
  'complex.zod.ts#RetiredKanbanNodeSchema':
    'a RETIRED node type refusal arm (objectui#8802), not a mirror — its only member is the `type` literal it refuses on, and the TS half of that retirement is the ABSENCE of an arm in `ComplexSchema`',
  // objectui#12954 — the same kind of arm for the retired `cloud:plan-status`
  // literal, pinned in `./cloud-plan-status-retired-12954.test.ts`. Its
  // former pair `cloud.zod.ts#CloudPlanStatusSchema` left `MIRRORS` with it.
  'cloud.zod.ts#RetiredCloudPlanStatusNodeSchema':
    'a RETIRED node type refusal arm (objectui#12954), not a mirror — its only member is the `type` literal it refuses on, and the TS half of that retirement is the ABSENCE of a `cloud:plan-status` member in `AnySchema`',
  // objectui#13449 — the same kind of arm for the retired `html` literal,
  // pinned in `./html-node-retired-13449.test.ts`. Its former pair
  // `data-display.zod.ts#HtmlSchema` left `MIRRORS` with it.
  'data-display.zod.ts#RetiredHtmlNodeSchema':
    'a RETIRED node type refusal arm (objectui#13449), not a mirror — its only member is the `type` literal it refuses on, and the TS half of that retirement is the ABSENCE of an `html` member in `DataDisplaySchema`',
  'ai.zod.ts#AIComponentSchema':
    "a union OVER the mirrors, not an object of its own — its members are checked individually above",
  'product-blocks.zod.ts#ProductBlockComponentSchema':
    "a union OVER the mirrors (objectui#12197), not an object of its own — its members are checked individually above",
  // objectui#10872 — the ADR-0080 public-block arms. Each is `BaseSchema` plus a
  // `type` literal plus `properties`, which is the block's
  // `@objectstack/spec` `ComponentPropsMap` row by reference (through the
  // objectui#8317 boundary). No TS declaration in this package restates any of
  // these nodes — the spec's row types are re-exported under `Spec…` names by
  // `../index.ts`, which is the spec's declaration, not a second one — so there
  // is no pair to register, and the arm-to-row agreement is measured against
  // the installed spec by `./public-block-arms-10872.test.ts` instead.
  // objectui#9256 then added the content-channel refusals as members on every
  // arm here but the four `page:` containers (`record:alert`: `children` only),
  // pinned in `./content-channel-public-blocks-9256.test.ts`; each entry below
  // names them where they apply.
  'public-blocks.zod.ts#PageHeaderBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `page:header` literal + `properties`, which IS `ComponentPropsMap['page:header']`, + the objectui#9256 `body` / `children` refusals (its renderer reads neither channel); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#PageTabsBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `page:tabs` literal + `properties`, which IS `ComponentPropsMap['page:tabs']`, + the `onTabChange` runtime-slot refusal (objectui#6124) its renderer's read requires, + the objectui#9256 `body` / `children` refusals (its renderer reads neither channel); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#PageCardBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `page:card` literal + `properties`, which IS `ComponentPropsMap['page:card']`, + the objectui#10872 batch-6 `body` / `children` refusals (its renderer reads the child list, whose home is the row's `properties.children`); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#PageAccordionBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `page:accordion` literal + `properties`, which IS `ComponentPropsMap['page:accordion']`, + the objectui#9256 `body` / `children` refusals (its renderer reads neither channel); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#PageSectionBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `page:section` literal + `properties`, which IS `ComponentPropsMap['page:section']`, + the objectui#10872 batch-6 `body` / `children` refusals (its renderer reads the child list, whose home is the row's `properties.children`); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#PageFooterBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `page:footer` literal + `properties`, which IS `ComponentPropsMap['page:footer']`, + the objectui#10872 batch-6 `body` / `children` refusals (its renderer reads the child list, whose home is the row's `properties.children`); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#PageSidebarBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `page:sidebar` literal + `properties`, which IS `ComponentPropsMap['page:sidebar']`, + the objectui#10872 batch-6 `body` / `children` refusals (its renderer reads the child list, whose home is the row's `properties.children`); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#RecordDetailsBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `record:details` literal + `properties`, which IS `ComponentPropsMap['record:details']`, + `dataSource`, which IS the spec's `ElementDataSourceSchema` (objectui#12294), + the objectui#9256 `body` / `children` refusals (its renderer reads neither channel); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#RecordHighlightsBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `record:highlights` literal + `properties`, which IS `ComponentPropsMap['record:highlights']`, + `dataSource`, which IS the spec's `ElementDataSourceSchema` (objectui#12294), + the objectui#9256 `body` / `children` refusals (its renderer reads neither channel); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#RecordRelatedListBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `record:related_list` literal + `properties`, which IS `ComponentPropsMap['record:related_list']`, + `dataSource`, which IS the spec's `ElementDataSourceSchema` (objectui#12302; the binding of the CHILD rows the list shows), + the objectui#9256 `body` / `children` refusals (its renderer reads neither channel); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#RecordPathBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `record:path` literal + `properties`, which IS `ComponentPropsMap['record:path']`, + the objectui#9256 `body` / `children` refusals (its renderer reads neither channel); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#RecordActivityBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `record:activity` literal + `properties`, which IS `ComponentPropsMap['record:activity']`, + the objectui#11321 `items` / `loading` host-feed-slot refusals (the host's channel, never authored), + the objectui#9256 `body` / `children` refusals (its renderer reads neither channel); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#RecordDiscussionBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `record:discussion` literal + `properties`, which IS `ComponentPropsMap['record:discussion']` (the spec's shared `record:chatter` row), + the objectui#9256 `body` / `children` refusals (its renderer reads neither channel); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#RecordHistoryBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `record:history` literal + `properties`, which IS `ComponentPropsMap['record:history']`, + the objectui#11321 `entries` / `loading` host-feed-slot refusals (the host's channel, never authored), + the objectui#9256 `body` / `children` refusals (its renderer reads neither channel); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#RecordQuickActionsBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `record:quick_actions` literal + `properties`, which IS `ComponentPropsMap['record:quick_actions']`, + `dataSource`, which IS the spec's `ElementDataSourceSchema` (objectui#12294), + the objectui#9256 `body` / `children` refusals (its renderer reads neither channel); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#RecordReferenceRailBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `record:reference_rail` literal + `properties`, which IS `ComponentPropsMap['record:reference_rail']`, + the objectui#9256 `body` / `children` refusals (its renderer reads neither channel); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#RecordAlertBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `record:alert` literal + `properties`, which IS `ComponentPropsMap['record:alert']`, + the objectui#9256 `children` refusal, + the objectui#10872 `body` alias refusal naming `properties.body` (its `body` is a text prop, so no neither-channel tombstone); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#RecordLineItemsBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `record:line_items` literal + `properties`, which IS `ComponentPropsMap['record:line_items']`, + `dataSource`, which IS the spec's `ElementDataSourceSchema`, + the objectui#9256 `body` / `children` refusals (its renderer reads neither channel); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#ElementTextBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `element:text` literal + `properties`, which IS `ComponentPropsMap['element:text']`, + the objectui#9256 `body` / `children` refusals (its renderer reads neither channel); no TS declaration in this package restates the node",
  // objectui#10872 batch 2 — the first arm with a node-level refinement: the
  // spec's `dataSource` waiver on the row's required `object`
  // (`ElementRepeaterBlockSchema` mirrors the same waiver since objectui#12056).
  'public-blocks.zod.ts#ElementNumberBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `element:number` literal + `properties`, which IS `ComponentPropsMap['element:number']` with `object` alone made optional (`.partial({ object: true })`), + `dataSource`, which IS the spec's `ElementDataSourceSchema`, + the refinement that restores `object`'s requiredness wherever the spec gate's `dataSource` waiver does not apply, + the objectui#9256 `body` / `children` refusals (its renderer reads neither channel); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#ElementButtonBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `element:button` literal + `properties`, which IS `ComponentPropsMap['element:button']`, + the objectui#9256 `body` / `children` refusals (its renderer reads neither channel); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#ElementDividerBlockSchema':
    "spec-owned, RESTATED — `BaseSchema` + the `element:divider` literal + a member-less strict `properties`, because `@objectstack/spec/ui` exports `ComponentPropsMap['element:divider']` under no name to read by reference; its key set and accept set are pinned to the row's in `./public-block-arms-10872.test.ts`, and no TS declaration in this package restates the node",
  // objectui#10872 batch 4 — the six blocks held until `@objectstack/spec`
  // 17.5.0 carried their rows. Same shape as the rows above;
  // `action:button` / `action:icon` add the two handler keys their renderers
  // read off the node. `action:group` / `action:menu` have renderer-side
  // interfaces in `@object-ui/components`, outside this package. The
  // objectui#9256 channel refusals reached them in objectui#10872 batch 5,
  // pinned in `./held-block-content-channels-10872.test.ts`.
  'public-blocks.zod.ts#ElementDefinitionListBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `element:definition-list` literal + `properties`, which IS `ComponentPropsMap['element:definition-list']`, + the objectui#9256 `body` / `children` refusals (objectui#10872 batch 5; its renderer reads neither channel); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#ElementRepeaterBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `element:repeater` literal + `properties`, which IS `ComponentPropsMap['element:repeater']` with `object` alone made optional (`.partial({ object: true })`, objectui#12056), + `dataSource`, which IS the spec's `ElementDataSourceSchema` (objectui#11880: the renderer reads the binding first, the flat query keys as the fallback), + the refinement that restores `object`'s requiredness wherever the spec gate's `dataSource` waiver does not apply (objectui#12056), + the objectui#9256 `body` / `children` refusals (objectui#10872 batch 5; its renderer reads neither channel); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#ActionButtonBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `action:button` literal + `properties`, which IS `ComponentPropsMap['action:button']`, + the `onClick` runtime-slot refusal (objectui#6124) and the flat-`onSuccess` alias refusal naming `properties.onSuccess`, the two handler keys its renderer reads off the node, + the objectui#9256 `body` / `children` refusals (objectui#10872 batch 5; its renderer reads neither channel); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#ActionIconBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `action:icon` literal + `properties`, which IS `ComponentPropsMap['action:icon']`, + the `onClick` runtime-slot refusal (objectui#6124) and the flat-`onSuccess` alias refusal naming `properties.onSuccess`, the two handler keys its renderer reads off the node, + the objectui#9256 `body` / `children` refusals (objectui#10872 batch 5; its renderer reads neither channel); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#ActionGroupBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `action:group` literal + `properties`, which IS `ComponentPropsMap['action:group']`, + the objectui#9256 `body` / `children` refusals (objectui#10872 batch 5; its renderer reads neither channel); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#ActionMenuBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `action:menu` literal + `properties`, which IS `ComponentPropsMap['action:menu']`, + the objectui#9256 `body` / `children` refusals (objectui#10872 batch 5; its renderer reads neither channel); no TS declaration in this package restates the node",
  'public-blocks.zod.ts#PublicBlockComponentSchema':
    "a union OVER the public-block arms, not an object of its own — its members are accounted for individually above",
  // objectui#10872 batch 8 — the node-level envelope every public-block arm
  // above (and the three ObjectQL public-block arms) spreads beside
  // `properties`: today `responsiveStyles` alone, the spec's
  // `ResponsiveStylesSchema` by reference. The arm reasons above describe the
  // members each arm adds of its own; this fragment is shared by all of them.
  // Pinned in `./public-block-responsive-styles-10872.test.ts`. Batch 9 spread
  // it into three registered pairs as well (`layout.zod.ts#FlexSchema`,
  // `objectql.zod.ts#ObjectGridSchema`, `objectql.zod.ts#ObjectChartSchema`),
  // whose TS twins declare the member as the spec's `ResponsiveStyles`, and
  // renamed it from `PUBLIC_BLOCK_ENVELOPE`. Pinned in
  // `./flat-arm-responsive-styles-10872.test.ts`.
  'public-blocks.zod.ts#NODE_ENVELOPE':
    "a shape FRAGMENT, not a schema and not a mirror — `{ responsiveStyles }`, the spec's `ResponsiveStylesSchema` by reference (the schema `PageComponentSchema.responsiveStyles` declares), spread into every public-block arm and into the `flex`, `object-grid` and `object-chart` mirrors so the one declaration is shared; no TS declaration restates the fragment itself, and each of those three pairs' TS twins declares the member as the spec's `ResponsiveStyles` type",
  // Renamed from `StylePropsSchema` by objectui#5928. Under the old name the
  // like-named `StyleProps` (../base.ts) — the Tailwind-scale vocabulary, sharing
  // ZERO keys with this `{ className, style }` object — read as its declaration, and
  // a name-derived pairing duly compared two unrelated key sets. Named for its own
  // two keys, it has no like-named declaration left to be paired with.
  'base.zod.ts#ClassNameStylePropsSchema':
    'no TS declaration in this package restates it — the `{ className, style }` passthrough attributes are declared inline on each schema, never as one shared interface',
  'app.zod.ts#NavigationItemTypeSchema':
    "a bare vocabulary with no `.shape`; it is checked where a mirrored KEY declares it",
  'app.zod.ts#NavigationItemSchema':
    "recursive; declared `z.ZodType<any>`, which exposes no `.shape` to read — and accepts `any`, so it cannot be narrower than any declaration. One of the three consts that REFUSED the objectui#7760 type argument (the mirror accepts more than the declaration states), so this reason is still literally true here",
  'app.zod.ts#MenuItemSchema':
    "recursive; a `z.lazy` exposes no `.shape` to read, so there is no key set for the per-key comparison. Since objectui#7760 it carries its TS declaration as BOTH type arguments, so the pair IS compared — as a whole type, by `tsc`, at the annotation itself",
  'app.zod.ts#AppContextSelectorSchema':
    "spec-owned BY REFERENCE — the local `.extend(…)` adds renderer props that no TS declaration in this package restates",
  'base.zod.ts#SchemaNodeSchema':
    "recursive; a `z.lazy` exposes no `.shape` to read, so there is no key set for the per-key comparison. Since objectui#7760 it carries its TS declaration as BOTH type arguments, so the pair IS compared — as a whole type, by `tsc`, at the annotation itself",
  'base.zod.ts#ComponentInputControlTypeSchema':
    "a bare vocabulary with no `.shape`; it is checked where a mirrored KEY declares it",
  'base.zod.ts#HTMLAttributesSchema':
    "an index signature, not a declared key set — there are no keys to compare",
  'complex.zod.ts#CalendarViewModeSchema':
    "a bare vocabulary with no `.shape`; it is checked where a mirrored KEY declares it",
  'complex.zod.ts#DashboardWidgetTypeSchema':
    "a bare vocabulary with no `.shape`; it is checked where a mirrored KEY declares it — `DashboardWidgetSchema.type` (objectui#4600), whose TS twin `DashboardWidgetTypeName` is a union, not a key set",
  'complex.zod.ts#FilterOperatorSchema':
    "a bare vocabulary with no `.shape`; it is checked where a mirrored KEY declares it",
  'complex.zod.ts#FilterBuilderConditionSchema':
    "recursive; declared `z.ZodType<any>`, which exposes no `.shape` to read — and accepts `any`, so it cannot be narrower than any declaration. One of the three consts that REFUSED the objectui#7760 type argument (the mirror accepts more than the declaration states), so this reason is still literally true here",
  'complex.zod.ts#FilterGroupSchema':
    "a `z.lazy` declared `z.ZodType<any>`, which exposes no `.shape` to read — and accepts `any`, so it cannot be narrower than any declaration. No longer recursive since objectui#9306 made `conditions` flat (a nested sub-group is refused by name), but still one of the three consts that REFUSED the objectui#7760 type argument, transitively: every `conditions` entry is judged by `FilterBuilderConditionSchema`, which accepts more than the declaration states",
  'complex.zod.ts#GlobalFilterSchema':
    "no TS declaration in this package restates it — there is no second definition to drift from",
  'complex.zod.ts#ComplexSchema':
    "a union OVER the mirrors, not an object of its own — its members are checked individually above",
  'crud.zod.ts#ActionExecutionModeSchema':
    "a bare vocabulary with no `.shape`; it is checked where a mirrored KEY declares it",
  'crud.zod.ts#ActionSchema':
    "recursive; a `z.lazy` exposes no `.shape` to read, so there is no key set for the per-key comparison. Since objectui#7760 it carries its TS declaration as BOTH type arguments, so the pair IS compared — as a whole type, by `tsc`, at the annotation itself",
  'crud.zod.ts#CRUDComponentSchema':
    "a union OVER the mirrors, not an object of its own — its members are checked individually above",
  'data-display.zod.ts#TreeNodeSchema':
    "recursive; a `z.lazy` exposes no `.shape` to read, so there is no key set for the per-key comparison. Since objectui#7760 it carries its TS declaration as BOTH type arguments, so the pair IS compared — as a whole type, by `tsc`, at the annotation itself",
  'data-display.zod.ts#ChartTypeSchema':
    "spec-owned BY REFERENCE — the local `.extend(…)` adds renderer props that no TS declaration in this package restates",
  'data-display.zod.ts#DataDisplaySchema':
    "a union OVER the mirrors, not an object of its own — its members are checked individually above",
  // objectui#10859 batch 7 — the six `@object-ui/plugin-designer` node arms.
  'designer.zod.ts#DesignerComponentSchema':
    "recursive; a `z.lazy` exposes no `.shape` to read, so there is no key set for the per-key comparison. It carries its TS declaration (`DesignerComponent`) as BOTH type arguments, the objectui#7760 construct, so the pair IS compared — as a whole type, by `tsc`, at the annotation itself",
  'designer.zod.ts#DesignerUnionSchema':
    "a union OVER the mirrors, not an object of its own — its members are checked individually above",
  'disclosure.zod.ts#DisclosureSchema':
    "a union OVER the mirrors, not an object of its own — its members are checked individually above",
  'feedback.zod.ts#FeedbackSchema':
    "a union OVER the mirrors, not an object of its own — its members are checked individually above",
  'form.zod.ts#FormComponentSchema':
    "a union OVER the mirrors, not an object of its own — its members are checked individually above",
  'layout.zod.ts#PageRegionWidthSchema':
    "a bare vocabulary with no `.shape`; it is checked where a mirrored KEY declares it",
  'layout.zod.ts#PageVariableSchema':
    "spec-owned BY REFERENCE — the local `.extend(…)` adds renderer props that no TS declaration in this package restates",
  'layout.zod.ts#PageTypeSchema':
    "spec-owned BY REFERENCE — the local `.extend(…)` adds renderer props that no TS declaration in this package restates",
  'layout.zod.ts#LayoutSchema':
    "a union OVER the mirrors, not an object of its own — its members are checked individually above",
  // objectui#11440 — the spec page kinds `record` / `home` / `utility` as node
  // types, served by the `page` node's renderer and `pageMeta`. Pinned by
  // `./passing-keys-arms-11440.test.ts`.
  'layout.zod.ts#PageKindNodeSchema':
    "mirror-owned BY REFERENCE — every member is `layout.zod.ts#PageNodeSchema`'s own (the same schema objects, the spec's `PageSchema` fields among them through `SpecPageFields`), under the spec's own `PageTypeSchema` narrowed to the three kinds `@object-ui/components` registers on `PageRenderer`; no TS declaration in this package restates the node (the `page` node's TS twin is `type: 'page'`, paired with `PageNodeSchema`)",
  // objectui#11276 (the `flex` batch, the maintainer's ruling A on
  // objectui#11300) — the authored `flex` arm, built as the `object-chart` arm
  // with NO spec row: its bag is the flat mirror's own members. Its TS twin is
  // paired with that FLAT mirror (`FlexSchema`), which stays the renderer's
  // post-hoist reading. objectui#11564 — the arm's TypeScript authoring face,
  // `FlexBlockNode` (`../authoring-nodes.ts`), DIVERGES from it on one member:
  // the bag's `children` list. The reason's last clause records it, and
  // `./flex-bag-children-list-11564.test.ts` re-derives it on both sides.
  'layout.zod.ts#FlexBlockSchema':
    "mirror-owned BY REFERENCE — `BaseSchema` + the `flex` literal + `NODE_ENVELOPE` + `properties`, whose `direction` / `justify` / `align` / `gap` / `wrap` ARE the flat `layout.zod.ts#FlexSchema` mirror's own members (the same schema objects; `@objectstack/spec` has no `ComponentPropsMap['flex']` row) and whose `children` is the mirror's single-node-or-list slot with the list's entries left to the spec page walk's judgment, + `flatPropRefusals` over the bag (one `aliasKeyRefusal` per bag member, pointed at `properties.KEY`; the key set is read off the bag), + a `body` refusal pointed at `properties.children`; the TS declaration of the node, `FlexSchema` (`../layout.ts`), is the renderer's post-hoist reading and is paired with the flat mirror, not with this arm; TS/zod DIVERGENCE (objectui#11564): the arm's authoring face, `FlexBlockNode` (`../authoring-nodes.ts`), is read off this arm's shape except for the bag's `children`, which it reads off the flat mirror's own `children` member (one node or a list of nodes), because this arm's list is `z.array(z.unknown())` and only the page walk judges its entries — so the TS face judges each object entry as a node of its own `type`, as the walk does, admits a primitive entry, as the walk does, and refuses a nested-array entry, which the walk passes through unvisited",
  'navigation.zod.ts#NavLinkSchema':
    "recursive; a `z.lazy` exposes no `.shape` to read, so there is no key set for the per-key comparison. Since objectui#7760 it carries its TS declaration as BOTH type arguments, so the pair IS compared — as a whole type, by `tsc`, at the annotation itself",
  'navigation.zod.ts#NavigationMenuItemSchema':
    "recursive; a `z.lazy` exposes no `.shape` to read, so there is no key set for the per-key comparison. Since objectui#7760 it carries its TS declaration as BOTH type arguments, so the pair IS compared — as a whole type, by `tsc`, at the annotation itself",
  'navigation.zod.ts#NavigationSchema':
    "a union OVER the mirrors, not an object of its own — its members are checked individually above",
  'objectql.zod.ts#HttpMethodSchema':
    "spec-owned BY REFERENCE — the local `.extend(…)` adds renderer props that no TS declaration in this package restates",
  'objectql.zod.ts#HttpRequestSchema':
    "spec-owned BY REFERENCE — the local `.extend(…)` adds renderer props that no TS declaration in this package restates",
  'objectql.zod.ts#ViewDataSchema':
    "spec-owned BY REFERENCE — the local `.extend(…)` adds renderer props that no TS declaration in this package restates",
  'objectql.zod.ts#ListColumnSchema':
    "spec-owned BY REFERENCE — the local `.extend(…)` adds renderer props that no TS declaration in this package restates",
  'objectql.zod.ts#SelectionConfigSchema':
    "spec-owned BY REFERENCE — the local `.extend(…)` adds renderer props that no TS declaration in this package restates",
  'objectql.zod.ts#PaginationConfigSchema':
    "spec-owned BY REFERENCE — the local `.extend(…)` adds renderer props that no TS declaration in this package restates",
  'objectql.zod.ts#UserActionsSchema':
    "spec-owned BY REFERENCE — a plain `stripImportedDefaults(Spec…)` re-export since objectui#8992 collapsed its `.extend(…)` (the protocol declares `group` / `hideFields` / `rowColor` itself from 17.3.0), and the TS name for it, `UserActionsConfig`, is re-exported FROM `@objectstack/spec/ui` by `../index.ts` rather than restated here — so there is no second definition to drift from",
  'objectql.zod.ts#ListViewSchema':
    "the DECLARATION is derived FROM this mirror — `ListViewSchema = ListViewInferred & ListViewRuntimeProps`, and `ListViewInferred = z.input<typeof ListViewSchema>` (`../objectql.ts`). Asserting parity here would be true no matter what either side said: a phantom assertion, not a check.",
  'objectql.zod.ts#ObjectQLComponentSchema':
    "a union OVER the mirrors, not an object of its own — its members are checked individually above",
  // objectui#10859 batch 2 — the two ADR-0080 public blocks of this family,
  // built the objectui#10872 way: `BaseSchema` + a `type` literal +
  // `properties`, which is the block's `ComponentPropsMap` row by reference.
  'objectql.zod.ts#ObjectMetricBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `object-metric` literal + `properties`, which IS `ComponentPropsMap['object-metric']`, + the node's `dataSource` binding, which IS the spec's `ElementDataSourceSchema` (objectui#10859 batch 3), + the objectui#9256 `body` / `children` refusals (its renderer reads neither channel); no TS declaration in this package restates the node",
  'objectql.zod.ts#ObjectMasterDetailFormBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `object-master-detail-form` literal + `properties`, which IS `ComponentPropsMap['object-master-detail-form']`, + the node's `dataSource` binding, which IS the spec's `ElementDataSourceSchema` (objectui#10859 batch 3), + three `handlerKeyRefusal` runtime slots, + the objectui#9256 `body` / `children` refusals (its renderer reads neither channel); no TS declaration in this package restates the node (`@object-ui/plugin-form`'s `MasterDetailFormSchema` is the type of `MasterDetailForm`'s `schema` prop, the renderer's post-hoist reading)",
  // objectui#10859 batch 3 — the third, built the same way from its 17.5.0 row.
  'objectql.zod.ts#ObjectTimelineBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `object-timeline` literal + `properties`, which IS `ComponentPropsMap['object-timeline']`, + the node's `dataSource` binding, which IS the spec's `ElementDataSourceSchema` (`PageComponentSchema.dataSource`), + the objectui#9256 `body` / `children` refusals (its renderer reads neither channel); no TS declaration in this package restates the node (`@object-ui/plugin-timeline`'s `ObjectTimelineProps` are the component's React props)",
  // objectui#10859 batch 4 — the authored `object-form` arm, from its row. Its
  // TS twin is paired with the FLAT mirror above (`ObjectFormSchema`), which
  // stays the renderer's post-hoist reading.
  'objectql.zod.ts#ObjectFormBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `object-form` literal + `properties`, which IS `ComponentPropsMap['object-form']`, + the node's `dataSource` binding, which IS the spec's `ElementDataSourceSchema`, + one `aliasKeyRefusal` per member of the row (the flat spelling, refused by name and pointed at `properties.KEY`; the key set is read off the row), + five `handlerKeyRefusal` runtime slots, + the objectui#9256 `body` / `children` refusals; the TS declaration of the node, `ObjectFormSchema` (`../objectql.ts`), is the renderer's post-hoist reading and is paired with the flat `objectql.zod.ts#ObjectFormSchema` mirror, not with this arm",
  // objectui#10859 batch 5 — the authored `object-map` arm, from its row, built
  // as batch 4's above. Its TS twin is paired with the FLAT mirror above
  // (`ObjectMapSchema`), which stays the renderer's post-hoist reading.
  'objectql.zod.ts#ObjectMapBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `object-map` literal + `properties`, which IS `ComponentPropsMap['object-map']`, + the node's `dataSource` binding, which IS the spec's `ElementDataSourceSchema`, + one `aliasKeyRefusal` per member of the row (the flat spelling, refused by name and pointed at `properties.KEY`; the key set is read off the row) plus two for the flat mirror's `locationField` / `titleField` (pointed at `properties.map.KEY`), + the objectui#9256 `body` / `children` refusals; the TS declaration of the node, `ObjectMapSchema` (`../objectql.ts`), is the renderer's post-hoist reading and is paired with the flat `objectql.zod.ts#ObjectMapSchema` mirror, not with this arm",
  // objectui#11276 — the authored `object-chart` arm, built as batches 4 and 5's
  // above but with NO spec row: its bag is the flat mirror's own members. Its TS
  // twin is paired with that FLAT mirror (`ObjectChartSchema`), which stays the
  // renderer's post-hoist reading.
  'objectql.zod.ts#ObjectChartBlockSchema':
    "mirror-owned BY REFERENCE — `BaseSchema` + the `object-chart` literal + `NODE_ENVELOPE` + `properties`, whose members ARE the flat `objectql.zod.ts#ObjectChartSchema` mirror's own members (the same schema objects; `@objectstack/spec` has no `ComponentPropsMap['object-chart']` row), + one `aliasKeyRefusal` per bag member (the flat spelling, refused by name and pointed at `properties.KEY`; the key set is read off the bag), + the mirror's own objectui#10608 tombstones and objectui#9256 `body` / `children` refusals; the TS declaration of the node, `ObjectChartSchema` (`../objectql.ts`), is the renderer's post-hoist reading and is paired with the flat mirror, not with this arm",
  // objectui#10859 batch 6 — the authored `object-gantt` arm, from its row, built
  // as batch 5's above. Its TS twin is paired with the FLAT mirror above
  // (`ObjectGanttSchema`), which stays the renderer's post-hoist reading.
  'objectql.zod.ts#ObjectGanttBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `object-gantt` literal + `NODE_ENVELOPE` + `properties`, which IS `ComponentPropsMap['object-gantt']`, + the node's `dataSource` binding, which IS the spec's `ElementDataSourceSchema`, + one `aliasKeyRefusal` per member of the row but the node-level `label` (the flat spelling, refused by name and pointed at `properties.KEY`; the key set is read off the row) plus one per member of the row's `gantt` block and one for the flat mirror's `dependencyField` alias (pointed at `properties.gantt.KEY`), + the objectui#9256 `body` / `children` refusals; the TS declaration of the node, `ObjectGanttSchema` (`../objectql.ts`), is the renderer's post-hoist reading and is paired with the flat `objectql.zod.ts#ObjectGanttSchema` mirror, not with this arm",
  // objectui#11276 (the `object-grid` batch) — the authored `object-grid` arm,
  // from its row, built as batch 6's above. Its TS twin is paired with the FLAT
  // mirror above (`ObjectGridSchema`), which stays the renderer's post-hoist
  // reading and still builds the `object-view` `table` slot.
  'objectql.zod.ts#ObjectGridBlockSchema':
    "spec-owned BY REFERENCE — `BaseSchema` + the `object-grid` literal + `NODE_ENVELOPE` + `properties`, which IS `ComponentPropsMap['object-grid']`, + the node's `dataSource` binding, which IS the spec's `ElementDataSourceSchema`, + `flatPropRefusals` over the row (one `aliasKeyRefusal` per member but the node-level `label`, pointed at `properties.KEY`, and the row's own `defaultSort` retirement; the key set is read off the row), + the flat mirror's own objectui#9739 / objectui#11068 tombstones and objectui#9256 `body` / `children` refusals, by reference, + its objectui#6124 `onNavigate` runtime slot, declared as the mirror declares it; the TS declaration of the node, `ObjectGridSchema` (`../objectql.ts`), is the renderer's post-hoist reading and is paired with the flat `objectql.zod.ts#ObjectGridSchema` mirror, not with this arm",
  // objectui#11440 — two Tier A public blocks with NO spec row and no flat
  // mirror: each bag is built from the block's registration `inputs`. Pinned by
  // `./passing-keys-arms-11440.test.ts`.
  'objectql.zod.ts#ObjectPivotBlockSchema':
    "registration-owned — `BaseSchema` + the `object-pivot` literal + `NODE_ENVELOPE` + a required `properties` bag of the registration's `inputs` (its cross-tab members ARE the `data-display.zod.ts#PivotTableSchema` mirror's own, by reference; `drillDown` is `DrillDownConfigSchema` with `mode` refused) + `flatPropRefusals` over that bag + the node's `dataSource` binding, which IS the spec's `ElementDataSourceSchema`, + the objectui#9256 `body` / `children` refusals; no TS declaration in this package restates the node (`@object-ui/plugin-dashboard`'s `ObjectPivotTableProps` is the component's prop type)",
  'objectql.zod.ts#EmbeddableFormBlockSchema':
    "registration-owned — `BaseSchema` + the `embeddable-form` literal + `NODE_ENVELOPE` + a required `properties` bag of exactly the registration's `inputs` + `flatPropRefusals` over that bag + the node's `dataSource` binding, which IS the spec's `ElementDataSourceSchema`, + the objectui#9256 `body` / `children` refusals; no TS declaration in this package restates the node (`@object-ui/plugin-form`'s `EmbeddableFormConfig` is the component's config type)",
  // objectui#12670 — the authored page `list-view` arm, built as `object-chart`'s
  // above with NO spec row: its bag is the flat mirror's own members. Its TS twin
  // is paired with that FLAT mirror (`ListViewSchema`), which stays the `ListView`
  // component's props.
  'objectql.zod.ts#ListViewBlockSchema':
    "mirror-owned BY REFERENCE — `BaseSchema` + the `list-view` literal + `NODE_ENVELOPE` + `properties`, whose members ARE the flat `objectql.zod.ts#ListViewSchema` mirror's own members (the same schema objects; `@objectstack/spec` has no `ComponentPropsMap['list-view']` row) with `type` as the spec's view kind and `objectName` / `viewType` refused by name, + `flatPropRefusals` over that bag (one `aliasKeyRefusal` per member but the spec page component's node-level keys, pointed at `properties.KEY`; the key set is read off the bag), + the mirror's `dataSource` binding by reference, + its five objectui#6124 runtime slots, declared as the mirror declares them, + the objectui#9256 `body` / `children` refusals; the TS declaration of the node's props, `ListViewSchema` (`../objectql.ts`), is the `ListView` component's props and is derived FROM the flat mirror, not paired with this arm",
  'objectql.zod.ts#ObjectQLPublicBlockComponentSchema':
    "a union OVER the public-block arms above, not an object of its own — its members are checked individually",
  'overlay.zod.ts#MenuItemSchema':
    "recursive; a `z.lazy` exposes no `.shape` to read, so there is no key set for the per-key comparison. Since objectui#7760 it carries its TS declaration as BOTH type arguments, so the pair IS compared — as a whole type, by `tsc`, at the annotation itself",
  'overlay.zod.ts#OverlaySchema':
    "a union OVER the mirrors, not an object of its own — its members are checked individually above",
  'reports.zod.ts#ReportExportFormatSchema':
    "a bare vocabulary with no `.shape`; it is checked where a mirrored KEY declares it",
  'reports.zod.ts#ReportScheduleFrequencySchema':
    "a bare vocabulary with no `.shape`; it is checked where a mirrored KEY declares it",
  'reports.zod.ts#ReportAggregationTypeSchema':
    "a bare vocabulary with no `.shape`; it is checked where a mirrored KEY declares it",
  'reports.zod.ts#ReportScheduleSchema':
    "no TS declaration in this package restates it — there is no second definition to drift from",
  // objectui#11440 — the AUTHORED `report` node: the record's members plus the
  // `report` wrapper the retired `spec-report` alias carried. Pinned by
  // `./passing-keys-arms-11440.test.ts`.
  'reports.zod.ts#ReportNodeSchema':
    "mirror-owned BY REFERENCE — `reports.zod.ts#ReportComponentSchema`'s own members (`.extend()`), plus `report`, which IS the spec's `ReportSchema` (through the import boundary); no TS declaration in this package restates the node — the TS twin `ReportComponentSchema` is the report RECORD a `report-viewer` / `report-builder` holds, paired with `ReportComponentSchema`, which declares no wrapper",
  'reports.zod.ts#ReportUnionSchema':
    "a union OVER the mirrors, not an object of its own — its members are checked individually above",
  'views.zod.ts#ViewTypeSchema':
    "a bare vocabulary with no `.shape`; it is checked where a mirrored KEY declares it",
  'views.zod.ts#ViewComponentSchema':
    "a union OVER the mirrors, not an object of its own — its members are checked individually above",
  'index.zod.ts#AnyComponentSchema':
    "the barrel union OVER the mirrors, not an object of its own — its members are checked individually above",
  'expression.zod.ts#ExpressionWireSchema':
    "a union (`string | { dialect?, source }`) with no `.shape` of its own — the predicate WIRE shape `BaseSchema`'s `visible` / `hidden` / `disabled` and the form predicate keys carry (objectui#7530); its TS twin `ExpressionWire` (`../expression.ts`) is a type alias, not a key set, and the two faces are pinned equal in `base-schema-predicate-envelope-7530.test.ts`",
  'index.zod.ts#SCHEMA_VERSION':
    "a version string, not a schema",
  // objectui#9736 — the three exclusion lists each spec-derived mirror's
  // `specFieldsExcept` call reads, hoisted to one `as const` array so the
  // TypeScript twin can `Omit` over the SAME list. Key-name tuples, not schemas;
  // what they govern is measured on the pairs they feed
  // (`app.zod.ts#AppComponentSchema` / `complex.zod.ts#DashboardComponentSchema` /
  // `layout.zod.ts#PageNodeSchema`), pinned in `./twins-spec-by-reference-9736.test.ts`.
  'app.zod.ts#APP_SPEC_EXCLUDED':
    "a key-name tuple, not a schema — the exclusion list `SpecAppFields` and the `AppComponentSchema` twin both read (objectui#9736)",
  'complex.zod.ts#DASHBOARD_SPEC_EXCLUDED':
    "a key-name tuple, not a schema — the exclusion list `SpecDashboardFields` and the `DashboardComponentSchema` twin both read (objectui#9736)",
  'layout.zod.ts#PAGE_SPEC_EXCLUDED':
    "a key-name tuple, not a schema — the exclusion list `SpecPageFields` and the `PageNodeSchema` twin both read (objectui#9736)",
  // objectui#11522 — no longer a union of two dialects: the spec list view's own
  // rule, by reference, plus the retired keys as tombstones. The TS twin is
  // compared where it is pinned, the way `ExpressionWireSchema` above is.
  'objectql.zod.ts#KanbanConditionalFormattingRuleSchema':
    "the spec list view's `{ condition, style }` rule BY REFERENCE (`ListViewSchema.conditionalFormatting`'s element, `.extend()`-ed), with the condition the list view's own arm reads and the six retired keys of the native and flat-colour dialects as tombstones (objectui#11522) — not a hand-written key set; its TS twin `KanbanConditionalFormattingRule` (`../objectql.ts`) extends `SpecConditionalFormattingRule`, the same reference, and the two faces' key sets and values are pinned equal in `kanban-conditional-formatting.test.ts`; `ObjectKanbanSchema`'s `conditionalFormatting` key is compared where it is declared",
};

/* ── Which pairs depend on @objectstack/spec ────────────────────────────────── */

/**
 * Registered mirrors built FROM a spec schema (`Spec…` appears in the definition),
 * so one side of their comparison moves when `@objectstack/spec` moves.
 *
 * This is a real property of the ledger and it is written down rather than left to
 * be rediscovered: for these pairs a spec bump can change the measured drift set
 * with nothing in this repo changing, and `assertionDriftMatchesLedger` will fire.
 * That is correct behaviour — a vocabulary the spec widened or withdrew is exactly
 * what wants triage — but the failure should not read as a mystery. Three of the
 * ledgered pairs are in here: `DashboardComponentSchema`, `DashboardWidgetSchema`
 * and `PageNodeSchema`.
 *
 * Kept honest by the test below, which re-derives this set from the mirror sources
 * instead of trusting the list.
 */
const SPEC_DERIVED_PAIRS: readonly string[] = [
  'app.zod.ts#AppComponentSchema',
  'app.zod.ts#NavigationAreaSchema',
  // `base.zod.ts#BaseSchema` and `objectql.zod.ts#ObjectViewSchema` used to stand
  // here and were removed by objectui#6705 — NOT because either mirror changed,
  // but because the re-check below stopped mis-reading them. Neither referenced a
  // spec schema THEN (`ObjectViewSchema` does since objectui#7779 — see the end of
  // this list); each was held here by one of the two defects that card names:
  //   - `BaseSchema` — its file's ONLY `Spec…` token is in a COMMENT
  //     (`base.zod.ts`, "rather than calling `SpecSchema.omit(…)`"). Prose.
  //   - `ObjectViewSchema` — `BaseSchema.extend({…})` with every member a local
  //     literal. Its declaration ends ~50 lines above the next `export const`, and
  //     the old text window ran on to that boundary, swallowing the private
  //     `KanbanConfig = SpecKanbanConfigSchema…` block that belongs to no export.
  // ⚠️ The `ObjectViewSchema` removal had a consequence #6705 did NOT settle: the
  // objectui#6058 split in this file's header routed its unmirrored declared keys
  // as SPEC-DERIVED — a routing that rested on the false positive. objectui#7279
  // re-derived that side on the tree and through the spec pin and moved the entry
  // to the split's LOCAL half (its `UnmirroredDeclared` docblock carries the
  // per-key reading). The split's counts now derive from THIS list's membership
  // and are pinned against the header by 'objectui#7279' below.
  // objectui#8347: `BaseSchema` is back, for a real reference this time —
  // `visibleWhen` is the spec's `EvaluatedExpressionSchema` (the envelope arm)
  // with `EvaluatedExpressionInputSchema`'s verdict, so a spec bump that moves
  // the evaluated-slot input moves ONE side of this pair.
  'base.zod.ts#BaseSchema',
  'complex.zod.ts#DashboardComponentSchema',
  'complex.zod.ts#DashboardWidgetSchema',
  // ⛔ `complex.zod.ts#KanbanSchema` removed with the retired `kanban` arm
  // (objectui#8802) — it was listed here because `grouping` was
  // `SpecGroupingConfigSchema` by reference, the way `ObjectGallerySchema` below
  // still spells it.
  // objectui#7690: `xAxis` / `yAxis` are the spec's `ChartAxisSchema` by
  // reference (the axis config object `ChartConfigSchema` declares), so a spec
  // bump that moves the axis vocabulary moves ONE side of this pair.
  'data-display.zod.ts#ChartSchema',
  // objectui#11506: the inline arm of `report` is the spec's `ReportSchema` by
  // reference (`DrillDownReportSchema`, the same member `ReportNodeSchema`
  // declares on the `report` node the drill drawer wraps it in), so a spec bump
  // that moves the report vocabulary moves ONE side of this pair.
  'data-display.zod.ts#DrillDownConfigSchema',
  // objectui#11070: nine of the field-metadata members a hand-authored form
  // writes on the entry itself are the spec's `FieldSchema` members by
  // reference (`multiple`, `rows`, `accept`, `dimensions`, `reference`, `min`,
  // `max`, `minLength`, `maxLength`), so a spec bump that moves one of those field
  // keys moves ONE side of this pair. The first spec reference in this mirror.
  // Round 3 added `returnType` / `summaryOperations`, and round 7 the `grid`
  // widget's `columns` (the spec's `inlineColumns` list, so a spec bump that
  // moves the inline grid column moves ONE side too). Round 10 added the `grid`
  // widget's eight field-level keys (`minRows` … `sortField` since
  // objectui#11610, whose snake_case spellings stay as alias refusals paired
  // with `?: never` tombstones); those are LOCAL on both sides (the TS twin is
  // `GridFieldMetadata`'s member by reference, and the spec declares none of
  // them), so they add no spec crossing and leave this membership resting on
  // the members above.
  'form.zod.ts#FormFieldSchema',
  'form.zod.ts#SelectOptionSchema',
  'layout.zod.ts#PageNodeSchema',
  // ⭐ ONE entry, SIX spec crossings over FIVE spec symbols — three cards put
  // them there and every ground is recorded, because any one alone is enough to
  // keep this membership and deleting the entry needs all of them to be gone.
  //   - objectui#7946 (rework round): `aggregate` is `SpecChartAggregateSchema` by
  //     reference rather than the local near-copy the first cut declared, so a
  //     spec bump that widens or narrows the object-bound aggregation vocabulary
  //     moves ONE side of this pair.
  //   - objectui#8885: the three keys `ObjectChart.tsx` reads that neither
  //     published face declared are each the SPEC's own schema at the crossing —
  //     `SpecChartDrillDownSchema`, `SpecI18nLabelSchema`, and
  //     `SpecDashboardWidgetSchema.shape.compareTo` by reference (the producer's
  //     own declaration: `DashboardRenderer` forwards `widget.compareTo`
  //     verbatim). So a spec bump that moves the chart drill vocabulary, the
  //     i18n label union, or the widget's comparison directive moves ONE side too.
  //   - objectui#10518: `xAxis` / `yAxis` are the spec's `ChartAxisSchema` by
  //     reference — one object and a LIST, as `ChartConfigSchema` declares them
  //     and the spec's `ObjectChart` react block (`schemaType: 'object-chart'`)
  //     publishes them — so a spec bump that moves the axis vocabulary moves ONE
  //     side of this pair, as it does for `data-display.zod.ts#ChartSchema` above.
  // Either way it is exactly what this list exists to make legible rather than
  // mysterious.
  // objectui#8651: the `calendar` CONTAINER is the spec's own
  // `SpecCalendarConfigSchema` — spec-derived, extended with objectui's single
  // local knob (`allDayField`, the lane objectui#8466 took for the flat spelling
  // of the same vocabulary) and kept `.passthrough()`. So a spec bump that moves
  // the four-key calendar config vocabulary moves ONE side of this pair, which
  // is exactly what this list exists to make legible rather than mysterious.
  'objectql.zod.ts#ObjectCalendarSchema',
  'objectql.zod.ts#ObjectChartSchema',
  // objectui#10993: `title`, `description`, `submitText`, `cancelText` and
  // `successMessage` are the spec's `I18nLabelSchema` by reference, the union
  // `ComponentPropsMap['object-form']` declares on them, so a spec bump that
  // moves the i18n label union moves ONE side of this pair. The first spec
  // reference in this mirror, so it re-derives the pair's `UnmirroredDeclared`
  // entry (21 keys, none of them touched) into the split's SPEC-DERIVED half.
  'objectql.zod.ts#ObjectFormSchema',
  'objectql.zod.ts#ObjectGallerySchema',
  'objectql.zod.ts#ObjectGanttSchema',
  // objectui#7762: `exportOptions` is the spec's OBJECT ARM by reference — peeled out of
  // `SpecListViewSchema.shape.exportOptions` (the two-arm union) so the bare-array arm,
  // which LIFTS, is left behind and refused by name on this node instead.
  'objectql.zod.ts#ObjectGridSchema',
  // objectui#11070: `dataSource` is the spec's `ElementDataSourceSchema` by
  // reference (the per-element binding `PageComponentSchema.dataSource`
  // declares) — the first spec reference in this mirror. `ObjectGridSchema`,
  // `ObjectFormSchema`, `ListViewSchema`, `ObjectGanttSchema`,
  // `ObjectMapSchema`, `ObjectCalendarSchema` and (round 7) `ObjectChartSchema`
  // gained the same member and were already spec-derived.
  'objectql.zod.ts#ObjectKanbanSchema',
  'objectql.zod.ts#ObjectMapSchema',
  // objectui#11168 slice 3: `tree` and `navigation` are the spec's `TreeConfigSchema`
  // and `NavigationConfigSchema` by reference — the two blocks the `object-tree` row
  // declares — the first spec references in this mirror. So a spec bump that moves
  // either vocabulary moves ONE side of this pair.
  'objectql.zod.ts#ObjectTreeSchema',
  // objectui#7779: BACK, by a real code reference this time — `navigation`,
  // `searchableFields` and `filterableFields` are `SpecListViewSchema.shape.*`
  // by reference (identity-pinned in `object-view-unmirrored-keys-7779.test.ts`).
  // Membership here is what re-derived the pair's last `UnmirroredDeclared` key
  // (`listViews`) into the split's SPEC-DERIVED half, until objectui#7928 mirrored
  // it by reference to `ViewSchema.shape.listViews` and the entry left the ledger.
  'objectql.zod.ts#ObjectViewSchema',
  // objectui#12197: every copy member is the spec's `I18nLabelSchema` by
  // reference, and each block's `dataSource` is `ElementApiDataSourceSchema`, so
  // a spec bump that moves either moves ONE side of these pairs.
  'product-blocks.zod.ts#ChecklistBlockItemSchema',
  'product-blocks.zod.ts#ChecklistBlockSchema',
  'product-blocks.zod.ts#HeroBlockSchema',
  'product-blocks.zod.ts#StatBlockSchema',
  'product-blocks.zod.ts#TileGridBlockAddTileSchema',
  'product-blocks.zod.ts#TileGridBlockItemSchema',
  'product-blocks.zod.ts#TileGridBlockSchema',
  'product-blocks.zod.ts#UsageBarBlockSchema',
  // objectui#10296: `options` is the spec's authoring `SelectOptionSchema` by
  // reference (ruling F1 on objectui#7759).
  'views.zod.ts#DetailViewFieldSchema',
];

/* ── Runtime: the population is closed ──────────────────────────────────────── */

const ZOD_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'zod');

/**
 * The pair population as ONE written-down number — the only count in this file a
 * human edits, and the base every figure the header used to quote derives from.
 *
 * objectui#6141 wrote down, in 2026-08, that correcting the prose "rots again the next
 * time an entry lands". Four hand-corrections of this same figure followed. One was
 * false the day it was written (`4ca30d044` wrote 160 while `MIRRORS` held 163); one
 * was a careful maintainer who correctly updated the ledger counts they were looking
 * at, correctly propagated them into a subtraction, and could not see that the
 * MINUEND under it had moved. Nothing failed on any of those days, because nothing
 * compared the registry to a number. objectui#7433 is that absence, not the digits.
 */
const EXPECTED_MIRROR_PAIRS = 204;

/**
 * A ledger this file can size from its own AST. `WiderThanDeclared` joined at
 * objectui#8252 — one union arm, no new code, the way `KnownDrift` joined at
 * objectui#8222 — so the fifth ledger is sized by the SAME instrument as the other
 * four rather than by a second definition of the word "key".
 *
 * ⭐ `MirroredUndeclared` joined the same way at objectui#9711 — one union arm again,
 * no new code again. That sentence above RECORDS objectui#8252's move and is left
 * byte-identical; this one records the next move, which is how this list grows.
 */
type LedgerName =
  | 'KnownDrift' | 'RuntimeOnlyDeclared' | 'UnmirroredDeclared' | 'WiderThanDeclared' | 'MirroredUndeclared';

/** This file, so the census can read its own type-level ledgers. */
const SELF = fileURLToPath(import.meta.url);

let selfAst: ts.SourceFile | undefined;

/**
 * Entry keys of one of this file's ledgers, read from its own AST.
 *
 * The ledgers are `interface`s — type-level, with no runtime value to count — so
 * parsing the source is the only way to size them at test time. The census already
 * runs the TypeScript parser for `specReferencingExports`, so this is the same
 * instrument rather than a second one, and it is a MEASUREMENT: an entry added or
 * removed moves it with no list to maintain, which is the whole point of the card.
 */
function ledgerEntryKeys(ledger: LedgerName): string[] {
  selfAst ??= ts.createSourceFile(
    SELF, readFileSync(SELF, 'utf8'), ts.ScriptTarget.ESNext, false, ts.ScriptKind.TS,
  );
  const decl = selfAst.statements.find(
    (s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === ledger,
  );
  if (!decl) throw new Error(`no top-level interface ${ledger} in ${SELF} — it was renamed, or the reader is reading the wrong file`);
  return decl.members
    .filter(ts.isPropertySignature)
    .map((m) => (ts.isStringLiteral(m.name) ? m.name.text : m.name.getText(selfAst)));
}

/** Every `export const` in the mirror directory, keyed the same way as the maps. */
function exportedConsts(): string[] {
  const out: string[] = [];
  for (const file of readdirSync(ZOD_DIR).sort()) {
    if (!file.endsWith('.zod.ts')) continue;
    const src = readFileSync(join(ZOD_DIR, file), 'utf8');
    for (const m of src.matchAll(/^export const ([A-Za-z0-9_]+)/gm)) out.push(`${file}#${m[1]}`);
  }
  return out;
}

/* ── Which exports reference a spec symbol (AST, not raw text) ───────────────── */

/**
 * The exported consts in ONE mirror source whose definition references a `Spec…`
 * symbol — the input to `SPEC_DERIVED_PAIRS`' re-check below.
 *
 * ## Why this parses instead of scanning text (objectui#6705)
 *
 * This used to slice the source between `export const` boundaries and test the
 * slice against a `\bSpec[A-Z]` word pattern. Raw text cannot tell a reference from a mention,
 * and the boundary is not the declaration's end, so the rule had two independent
 * defects that both fired on ONE docstring:
 *
 *   - **A comment counted as a reference.** A docstring naming `SpecGanttConfigSchema`
 *     in PROSE made this test red with nothing about the emitted types, the runtime
 *     or the mirror's actual spec dependency having moved.
 *   - **The window charged text to the wrong declaration.** The docstring sat above
 *     the PRIVATE `GanttConfigExtensionFields` const, which lives textually between
 *     the `ObjectTreeSchema` and `ObjectGanttSchema` exports — so the slice starting
 *     at `ObjectTreeSchema` ran on past its own end and the failure named
 *     `ObjectTreeSchema`, a mirror that references no spec schema at all. The person
 *     who edits a docstring gets a red naming an innocent neighbour several
 *     declarations away.
 *
 * The workaround that shipped (PR #6704) was a docstring reworded to dodge the
 * literal token plus a comment asking the next editor to remember — a convention
 * held by discipline, which is what a gate is supposed to replace.
 *
 * ## What it does instead
 *
 * `Spec…` identifiers are collected from the AST, so a mention inside a comment or
 * a string literal is not a reference — those are not `Identifier` nodes and never
 * reach the test. There is no comment-stripping regex to get wrong on a string that
 * contains `*` `/` sequences, because nothing strips anything.
 *
 * Attribution is by DECLARATION, not by text window: each top-level declaration
 * owns exactly its own initializer. A private const between two exports is charged
 * to neither — except through the one link that is a real dependency, which this
 * follows: a mirror that spreads a private const built from a spec schema IS spec
 * derived, so file-local references are resolved to a fixed point before the
 * exported names are read off. `ObjectGanttSchema`'s dependency survives whether it
 * extends `SpecGanttConfigSchema` inline or through a local field map.
 *
 * ⚠️ This is a precision fix, and the direction that must not be lost is the
 * POSITIVE one: a scanner that stopped seeing comments AND stopped seeing real
 * references would go green on the list below while checking nothing. The fixture
 * suite asserts both directions, and the re-check itself is the live positive
 * proof — every pair in `SPEC_DERIVED_PAIRS` is found by code reference alone.
 */
export function specReferencingExports(fileName: string, source: string): Set<string> {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.ESNext, false, ts.ScriptKind.TS);

  /** Per top-level declaration: does it name a `Spec…` symbol, and what else does it name? */
  const decls = new Map<string, { spec: boolean; refs: Set<string> }>();
  const exported = new Set<string>();

  const collect = (node: ts.Node | undefined, into: { spec: boolean; refs: Set<string> }): void => {
    if (!node) return;
    const walk = (n: ts.Node): void => {
      if (ts.isIdentifier(n)) {
        if (/^Spec[A-Z]/.test(n.text)) into.spec = true;
        else into.refs.add(n.text);
      }
      ts.forEachChild(n, walk);
    };
    walk(node);
  };

  const record = (name: string, isExported: boolean, ...bodies: (ts.Node | undefined)[]): void => {
    const rec = decls.get(name) ?? { spec: false, refs: new Set<string>() };
    for (const b of bodies) collect(b, rec);
    decls.set(name, rec);
    if (isExported) exported.add(name);
  };

  for (const stmt of sf.statements) {
    const isExported = (ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined)
      ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true;
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        record(d.name.text, isExported, d.initializer, d.type);
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      record(stmt.name.text, isExported, stmt.body, stmt.type);
    }
  }

  // File-local references resolved to a fixed point: a declaration built from one
  // that is spec-derived is itself spec-derived. Iterative, so a reference cycle
  // terminates instead of recursing.
  const specDerived = new Set<string>();
  for (const [name, rec] of decls) if (rec.spec) specDerived.add(name);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, rec] of decls) {
      if (specDerived.has(name)) continue;
      for (const r of rec.refs) {
        // Only through PRIVATE declarations. An exported mirror is a registered
        // pair with an entry of its own, so its spec sensitivity is already
        // recorded under its own key; hopping through it would re-attribute one
        // mirror's dependency to every mirror that merely names it. A private
        // const has no key of its own, so its dependency must be charged to the
        // export that uses it or it is lost.
        if (specDerived.has(r) && !exported.has(r)) {
          specDerived.add(name);
          changed = true;
          break;
        }
      }
    }
  }

  return new Set([...exported].filter((n) => specDerived.has(n)));
}

describe('zod mirror parity — the population is closed', () => {
  it('every exported const in ../zod/ is either a registered pair or an excluded one', () => {
    const registered = new Set(Object.keys(MIRRORS));
    const unaccounted = exportedConsts().filter((k) => !registered.has(k) && !(k in EXCLUSIONS));
    expect(unaccounted, `
New zod export(s) in packages/types/src/zod/ that this guard does not cover.
Add each to MIRRORS with the TS declaration it restates, or to EXCLUSIONS with the
reason it has nothing to drift from. Do not leave it out — an unlisted mirror is
exactly how objectui#4605 and #5186 stayed latent.`).toEqual([]);
  });

  it('no map entry names a const that no longer exists', () => {
    const onDisk = new Set(exportedConsts());
    const stale = [...Object.keys(MIRRORS), ...Object.keys(EXCLUSIONS)].filter((k) => !onDisk.has(k));
    expect(stale, 'stale entries — the const was renamed or removed').toEqual([]);
  });

  it('the census can actually see the directory (non-vacuity)', () => {
    // A broken reader returns [] and every assertion above passes while checking
    // nothing. Pin that it finds the directory and the mirror this guard grew from.
    const found = exportedConsts();
    expect(found.length).toBeGreaterThan(200);
    expect(found).toContain('base.zod.ts#BaseSchema');
  });

  it('SPEC_DERIVED_PAIRS matches what the mirror sources actually do', () => {
    // Re-derived, not trusted: a mirror that starts referencing a `Spec…` schema
    // joins the spec-sensitive set whether or not anyone updates the list.
    // Read from the AST — see `specReferencingExports` for why prose does not count.
    const derived: string[] = [];
    const byFile = new Map<string, Set<string>>();
    for (const key of Object.keys(MIRRORS)) {
      const [file, name] = key.split('#');
      let refs = byFile.get(file);
      if (!refs) {
        refs = specReferencingExports(file, readFileSync(join(ZOD_DIR, file), 'utf8'));
        byFile.set(file, refs);
      }
      if (refs.has(name)) derived.push(key);
    }
    expect(derived.sort(), 'a mirror gained or lost a spec dependency — update SPEC_DERIVED_PAIRS')
      .toEqual([...SPEC_DERIVED_PAIRS].sort());
  });

  it('every exclusion carries a reason', () => {
    const empty = Object.entries(EXCLUSIONS).filter(([, why]) => why.trim().length < 20);
    expect(empty.map(([k]) => k), 'an exclusion without a reason is an oversight').toEqual([]);
  });
});

describe('the population and its two differences are derived, not prose (objectui#7433)', () => {
  it('the registry population matches EXPECTED_MIRROR_PAIRS', () => {
    const actual = Object.keys(MIRRORS).length;
    expect(actual, `
The pair population moved: MIRRORS holds ${actual}, EXPECTED_MIRROR_PAIRS says ${EXPECTED_MIRROR_PAIRS}.

WHICH SIDE TO CHANGE — decide by what your diff touched, not by which number looks
right (git diff -- packages/types/src/__tests__/zod-mirror-parity.test.ts):

  * you added or removed a MIRRORS entry, taking the registry ${EXPECTED_MIRROR_PAIRS} -> ${actual}
    => update EXPECTED_MIRROR_PAIRS from ${EXPECTED_MIRROR_PAIRS} to ${actual}, and nothing else.
    The header quotes no digit for the population or for either difference any more,
    so there is no prose to hand-correct alongside it.

  * you edited EXPECTED_MIRROR_PAIRS itself, or carried a figure in from a card, a
    review comment or this file's own header
    => put it back to ${actual}. The registry is the measurement; this constant only
    records it, and a figure quoted anywhere else is evidence about that place only.

⛔ Do not reconcile the two by editing prose. That is route 1, which objectui#6141
predicted would recur before objectui#7433 measured it recurring four more times.`)
      .toBe(EXPECTED_MIRROR_PAIRS);
  });

  it('both differences the header speaks of derive from the pin and the live ledgers', () => {
    const registered = Object.keys(MIRRORS);
    const drift = new Set(ledgerEntryKeys('KnownDrift'));
    const unmirrored = new Set([
      ...ledgerEntryKeys('UnmirroredDeclared'),
      ...ledgerEntryKeys('RuntimeOnlyDeclared'),
    ]);

    // Each difference is derived TWICE and the derivations compared: once by walking
    // the registry for pairs that ledger does not name, once by the subtraction the
    // header used to state as a digit. They part company only if a ledger records a
    // key MIRRORS does not register — `assertionUnmirroredLedgerKeysAreRegistered`
    // pins that at the type level for the unmirrored half; this is its runtime twin,
    // and it covers the drift half too.
    const why = (label: string, size: number): string => `
${label}: the two derivations disagree — walking MIRRORS gives one answer, subtracting
from the pinned population gives another. Population ${EXPECTED_MIRROR_PAIRS}, ledger ${size} entries.
A ledger entry names a pair MIRRORS does not register: fix the ledger key.
If 'the registry population matches EXPECTED_MIRROR_PAIRS' failed too, fix THAT first —
this derivation subtracts from the pinned population, so it fails as a consequence.
⛔ Never "fix" either one by writing the difference down.`;

    expect(
      registered.filter((k) => !drift.has(k)).length,
      why('pairs with no KnownDrift entry', drift.size),
    ).toBe(EXPECTED_MIRROR_PAIRS - drift.size);

    expect(
      registered.filter((k) => !unmirrored.has(k)).length,
      why('pairs with no entry in either unmirrored ledger', unmirrored.size),
    ).toBe(EXPECTED_MIRROR_PAIRS - unmirrored.size);
  });

  it('the ledger reader can actually see the ledgers (non-vacuity)', () => {
    // A reader that returned [] would make both differences above equal the whole
    // population and both assertions pass while measuring nothing — the same failure
    // mode 'the census can actually see the directory' guards for the mirror scan.
    const registered = new Set(Object.keys(MIRRORS));
    for (const ledger of ['KnownDrift', 'UnmirroredDeclared', 'RuntimeOnlyDeclared'] as const) {
      const keys = ledgerEntryKeys(ledger);
      expect(keys.length, `${ledger} read as EMPTY — the reader is not seeing the ledger`)
        .toBeGreaterThan(0);
      expect(keys.filter((k) => !registered.has(k)), `${ledger} entries MIRRORS does not register`)
        .toEqual([]);
    }
  });
});

/* ── The SPEC-DERIVED / LOCAL split is derived, and the header is pinned to it ── */

/**
 * Entry → declared-key members of one of the two unmirrored ledgers, read from this
 * file's own AST the way `ledgerEntryKeys` reads the entry names. Each property
 * signature's type is a union of string literals (or one literal); the literals ARE
 * the keys, so this is the instrument that sizes a ledger in keys, not just entries.
 *
 * A member that is not a string literal is a hard error rather than a skipped row:
 * a ledger that quietly grew a `string` or `never` arm would otherwise read as fewer
 * keys, and every count below would still pass.
 *
 * `KnownDrift` joined the parameter type at objectui#8222 — one union arm, no new
 * code — so the header's `KnownDrift` key total is sized by the SAME instrument that
 * already sizes the other two. That matters for more than tidiness: objectui#7279's
 * pin derives `UnmirroredDeclared`'s 87 keys through this function and is green, so
 * the union-arm semantics used here are the ones this file already treats as
 * authoritative, and a `KnownDrift` reading of 63 is a reading rather than a second
 * definition of the word "key".
 */
function ledgerEntryMembers(ledger: LedgerName): Map<string, string[]> {
  selfAst ??= ts.createSourceFile(
    SELF, readFileSync(SELF, 'utf8'), ts.ScriptTarget.ESNext, false, ts.ScriptKind.TS,
  );
  const decl = selfAst.statements.find(
    (s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === ledger,
  );
  if (!decl) throw new Error(`no top-level interface ${ledger} in ${SELF} — it was renamed, or the reader is reading the wrong file`);
  const out = new Map<string, string[]>();
  for (const m of decl.members) {
    if (!ts.isPropertySignature(m) || !m.type) continue;
    const entry = ts.isStringLiteral(m.name) ? m.name.text : m.name.getText(selfAst);
    const arms = ts.isUnionTypeNode(m.type) ? m.type.types : [m.type];
    out.set(entry, arms.map((arm) => {
      if (ts.isLiteralTypeNode(arm) && ts.isStringLiteral(arm.literal)) return arm.literal.text;
      throw new Error(`${ledger}['${entry}'] has a member that is not a string literal: ${arm.getText(selfAst)}`);
    }));
  }
  return out;
}

/**
 * One figure the file header writes down, read off disk. The spelling must occur
 * EXACTLY once: a second copy — a stale figure left standing beside a corrected one —
 * would let the pin pass on whichever copy the regex met first.
 */
function headerFigures(spelling: RegExp): number[] {
  const hits = [...readFileSync(SELF, 'utf8').matchAll(new RegExp(spelling.source, 'gu'))];
  expect(hits.length, `the header spelling ${spelling} must occur exactly once in ${SELF}; it occurs ${hits.length} times`)
    .toBe(1);
  return hits[0].slice(1).map(Number);
}

describe('the SPEC-DERIVED / LOCAL split is derived, and the header is pinned to it (objectui#7279)', () => {
  /** The split, derived: `UnmirroredDeclared` entries by `SPEC_DERIVED_PAIRS` membership. */
  const derive = () => {
    const rows = Array.from(ledgerEntryMembers('UnmirroredDeclared'));
    const size = (subset: typeof rows) => ({
      entries: subset.length,
      keys: subset.reduce((n, [, keys]) => n + keys.length, 0),
    });
    return {
      specDerived: size(rows.filter(([entry]) => SPEC_DERIVED_PAIRS.includes(entry))),
      local: size(rows.filter(([entry]) => !SPEC_DERIVED_PAIRS.includes(entry))),
      total: size(rows),
    };
  };

  it('the split figures and the totals the header writes down equal the ledger', () => {
    // objectui#6058 wrote the split as prose with counts; objectui#7623, #7129, #7352
    // and #7655 each moved the ledger and corrected the counts by hand, and #7279
    // found the SPEC-DERIVED half still carrying an entry `SPEC_DERIVED_PAIRS` had
    // dropped at #6705. Nothing compared the two — this does. Every figure is read
    // off the header's OWN spelling, so a rewording that drops the digit is red too.
    const [specEntries, specKeys] = headerFigures(/\*\*SPEC-DERIVED \((\d+) entr(?:y|ies), (\d+) keys?\)\*\*/);
    const [localEntries, localKeys] = headerFigures(/\*\*LOCAL \((\d+) entr(?:y|ies), (\d+) keys?\)\*\*/);
    const [totalEntries, totalKeys, tSpecEntries, tSpecKeys, tLocalEntries, tLocalKeys] = headerFigures(
      /\*\*(\d+) entries \/ (\d+) keys\*\* — (\d+) \/ (\d+) spec-derived, (\d+) \/ (\d+) local\./,
    );
    const [topEntries, topKeys] = headerFigures(/\*\*(\d+) entries\*\* in `UnmirroredDeclared`, \*\*(\d+) keys\*\* across them/);

    const header = {
      specDerived: { entries: specEntries, keys: specKeys },
      local: { entries: localEntries, keys: localKeys },
      total: { entries: totalEntries, keys: totalKeys },
      totalsLine: { specDerived: { entries: tSpecEntries, keys: tSpecKeys }, local: { entries: tLocalEntries, keys: tLocalKeys } },
      topOfFile: { entries: topEntries, keys: topKeys },
    };
    const ledger = derive();
    expect(header, `
The header's SPEC-DERIVED / LOCAL split figures disagree with the ledger.

WHICH SIDE TO CHANGE — decide by what your diff touched, not by which number looks
right (git diff -- packages/types/src/__tests__/zod-mirror-parity.test.ts):

  * you moved an UnmirroredDeclared entry or key, or SPEC_DERIVED_PAIRS membership
    => correct the header's figures to the derived ones below, and ADD the history
    sentence the split keeps for every move (it is cumulative by design).
  * you edited a header figure by hand, or carried one in from a card or a comment
    => put it back. The ledger is the measurement; the header only records it.

⛔ Never reconcile the two by editing a ledger KEY SET or SPEC_DERIVED_PAIRS: both are
pinned elsewhere in this file against the mirrors themselves.`)
      .toEqual({
        specDerived: ledger.specDerived,
        local: ledger.local,
        total: ledger.total,
        totalsLine: { specDerived: ledger.specDerived, local: ledger.local },
        topOfFile: ledger.total,
      });
  });

  it('the member reader can actually see the unions (non-vacuity)', () => {
    // A reader that returned no members would derive 0 keys on both halves and a
    // header written as 0 / 0 would pass while measuring nothing — the same failure
    // mode 'the ledger reader can actually see the ledgers' guards for entry names.
    const members = ledgerEntryMembers('UnmirroredDeclared');
    expect(Array.from(members.keys()), 'the member reader and the entry reader disagree on the entry list')
      .toEqual(ledgerEntryKeys('UnmirroredDeclared'));
    const ledger = derive();
    expect(ledger.specDerived.entries, 'the SPEC-DERIVED half read as EMPTY — `DashboardWidgetSchema` is in both the ledger and SPEC_DERIVED_PAIRS')
      .toBeGreaterThan(0);
    expect(ledger.local.entries, 'the LOCAL half read as EMPTY').toBeGreaterThan(0);
    expect(ledger.total.keys, 'no entry read as a union of more than one literal — the reader is not walking union arms')
      .toBeGreaterThan(ledger.total.entries);
    for (const [entry, keys] of members) {
      expect(keys.length, `${entry} read as having no keys`).toBeGreaterThan(0);
    }
  });
});


/* ── The header's LEDGER ENTRY COUNTS are pinned to the ledgers (objectui#7733) ─ */

describe('the ledger entry counts the header states are derived, not prose (objectui#7733)', () => {
  it('every entry count the header writes down equals the ledger it describes', () => {
    // objectui#6141 named TWO stale figures in its own title — a pair population and a
    // ledger entry count — and route 1 (hand-correct the prose) was taken for both.
    // objectui#7433 built the pin for the population half; this is the other half.
    // `ReconcileAgainstLedger` and its siblings do NOT reach these figures: they pin
    // each entry's EXACT key set, so an entry added or removed moves no number they
    // compare, and until this test the file stayed green either way.
    //
    // Both instruments already exist. `ledgerEntryKeys` sizes a ledger from this
    // file's own AST, and `headerFigures` reads one figure off the header's OWN
    // spelling — so a rewording that drops the digit is red rather than quietly
    // unpinned, and a second copy of a spelling (a stale figure left standing beside
    // a corrected one) fails there rather than passing on whichever copy it met first.
    //
    // The last row is the RESTATEMENT, and it is why this pin is measured rather than
    // predicted: the ratchet section states the KnownDrift entry count a SECOND time,
    // ~120 lines below the first. objectui#7542 shrank that ledger by one entry, the
    // first site was corrected, the restatement was not — and the file was fully green
    // with a wrong figure carrying the parenthetical "measured, not assumed" for four
    // commits. Both sites read the one ledger here, so neither can outlive the other.
    const drift = ledgerEntryKeys('KnownDrift').length;
    const header = {
      knownDrift: headerFigures(/\*\*(\d+) entries\*\* in `KnownDrift`/)[0],
      unmirroredDeclared: headerFigures(/\*\*(\d+) entries\*\* in `UnmirroredDeclared`/)[0],
      runtimeOnlyDeclared: headerFigures(/\*\*(\d+) entries\*\* in `RuntimeOnlyDeclared`/)[0],
      knownDriftRestated: headerFigures(/(\d+) of the registered pairs carry TYPE drift TODAY/)[0],
    };

    expect(header, `
The header's ledger entry counts disagree with the ledgers they describe.

WHICH SIDE TO CHANGE — decide by what your diff touched, not by which number looks
right (git diff -- packages/types/src/__tests__/zod-mirror-parity.test.ts):

  * you added or removed a ledger entry
    => correct the header figure to the derived one below, and nothing else. If the
       KnownDrift figure moved, TWO sites move together: the bullet in the population
       section and its restatement under 'KNOWN_DRIFT is a ratchet, not a waiver'.
       They state one quantity; this pin reads both, because correcting only the
       first is the exact drift objectui#7733 was filed for.

  * you edited a header figure by hand, or carried one in from a card, a review
    comment or another file
    => put it back to the derived value. The ledger is the measurement; the header
       only records it, and a figure quoted anywhere else is evidence about that
       place only.

⛔ Never reconcile the two by moving a ledger ENTRY. The entry key sets are pinned
against the mirrors themselves elsewhere in this file, so an entry edited to satisfy a
sentence fails there instead — and that is route 1, which objectui#6141 predicted and
objectui#7433 measured recurring four more times.

⚠️ This pin covers the ENTRY counts only. The KEY totals beside them are pinned by
'the header key totals and cross-ledger figures are derived, not prose'
(objectui#8222) — the sibling block directly below. When this was written they were
not: nobody had measured them, and a number nobody measured gets no verdict. #8222
measured them, and found this header's KnownDrift key total one low since
objectui#7664. ⛔ Do not fold the two blocks together: they fail for different
reasons and each names the ledger movement that causes its own.`)
      .toEqual({
        knownDrift: drift,
        unmirroredDeclared: ledgerEntryKeys('UnmirroredDeclared').length,
        runtimeOnlyDeclared: ledgerEntryKeys('RuntimeOnlyDeclared').length,
        knownDriftRestated: drift,
      });
  });
});

/* ── The header's KEY TOTALS and cross-ledger figures are pinned (objectui#8222) ─ */

describe('the header key totals and cross-ledger figures are derived, not prose (objectui#8222)', () => {
  /** Keys across one ledger — the union arms, summed, from this file's own AST. */
  const keyTotal = (ledger: 'KnownDrift' | 'RuntimeOnlyDeclared' | 'UnmirroredDeclared'): number =>
    Array.from(ledgerEntryMembers(ledger).values()).reduce((n, keys) => n + keys.length, 0);

  it('every key total and cross-ledger figure the header writes down equals the ledgers', () => {
    // objectui#7733 pinned the ENTRY counts and said in as many words that the KEY
    // totals beside them were not pinned, because nobody had measured them. #8222
    // measured them — two independent instruments, and a positive control that fires
    // (`UnmirroredDeclared` reads 14 / 87 and `RuntimeOnlyDeclared` 7 / 24, both
    // agreeing with their prose, and the 87 is independently derived by objectui#7279's
    // own green pin through `ledgerEntryMembers`) — and found `KnownDrift`'s total one
    // low: the header said 62, the ledger holds 63. Bisected to objectui#7664, which
    // re-keyed the `kanban` arm from a 2-key entry to a 3-key one: one entry out, one
    // in, so the entry count objectui#7733 watches did not move while the key total
    // did. A figure with nothing looking at it is the whole subject of this file.
    //
    // ⭐ No new instrument and no new constant. `ledgerEntryMembers` already sized a
    // ledger in keys and gained one union arm; `headerFigures` reads each figure off
    // the header's OWN spelling, so a rewording that drops a digit is red rather than
    // quietly unpinned, and the count a human edits stays exactly one per site. A
    // `const EXPECTED_KNOWN_DRIFT_KEYS = 63` would be a THIRD place the number lives
    // and would reproduce this defect one level up.
    //
    // The last four rows are RESTATEMENTS, and they are why this block reads the
    // cross-ledger sentence and not just the two bullets: `6 of the 7` restates the
    // `RuntimeOnlyDeclared` entry count a second time and the `UnmirroredDeclared`
    // one a third and fourth. Every one of them was spelled as an English WORD or a
    // bare digit until objectui#8222, which is exactly why no instrument had ever
    // read them — the same shape as objectui#7733's ratchet restatement, one section
    // further down the page.
    const unmirrored = new Set(ledgerEntryKeys('UnmirroredDeclared'));
    const runtimeOnly = ledgerEntryKeys('RuntimeOnlyDeclared');

    // The entry counts these two spellings also carry are pinned by the block above;
    // read here only so the regexes stay anchored to the sentence they measure.
    const [, driftKeys] = headerFigures(/\*\*(\d+) entries\*\* in `KnownDrift`, \*\*(\d+) keys\*\* across them/);
    const [, runtimeKeys] = headerFigures(/\*\*(\d+) entries\*\* in `RuntimeOnlyDeclared`, \*\*(\d+) keys\*\* across them/);
    const [inBoth, ofRuntimeOnly, unmirroredPairs] = headerFigures(
      /\*\*(\d+) of the (\d+)\*\* are a subset of the \*\*(\d+)\*\* pairs above/,
    );
    // ⭐ RESHAPED by objectui#7804's `TreeViewSchema` slice. This spelling used to
    // read `is **15** pairs and not **14**` and carried TWO figures — the union and
    // a fourth restatement of `UnmirroredDeclared`'s entry count. Draining that
    // pair emptied the difference: the union now EQUALS `UnmirroredDeclared`, and
    // the old spelling would have had to read `is **14** pairs and not **14**`,
    // which is a sentence no reader can act on. So the header states the
    // containment and this reads ONE figure off it. ⛔ The restatement is not
    // "missing": `unmirroredEntriesRestated` above still reads that count from the
    // sentence beside it, so the figure is still pinned twice, not once.
    //
    // ⭐ RESHAPED AGAIN by objectui#6152 round 3, which made two pairs runtime-only and
    // nothing else (`ObjectFormSchema` by the named allow-list, `FormSchema` by
    // mirroring every other key it had) — the case the header's own sentence says is
    // the only way the difference returns. The spelling now carries THREE figures
    // and holds at ANY difference, zero included: the union, a restatement of
    // `UnmirroredDeclared`'s entry count, and the pairs recorded ONLY as
    // runtime-only. So a later drain moves digits here, ⛔ never the sentence's shape.
    const [unionPairs, unmirroredPairsAgain, runtimeOnlyOnly] = headerFigures(
      /the union of the two unmirrored ledgers is \*\*(\d+)\*\* pairs, being \*\*(\d+)\*\* from `UnmirroredDeclared` plus \*\*(\d+)\*\* recorded ONLY in `RuntimeOnlyDeclared`/,
    );

    expect({
      knownDriftKeys: driftKeys,
      runtimeOnlyKeys: runtimeKeys,
      runtimeOnlyAlsoUnmirrored: inBoth,
      runtimeOnlyEntriesRestated: ofRuntimeOnly,
      unmirroredEntriesRestated: unmirroredPairs,
      unmirroredEntriesRestatedInUnion: unmirroredPairsAgain,
      runtimeOnlyOnlyPairs: runtimeOnlyOnly,
      unionOfUnmirroredLedgers: unionPairs,
    }, `
The header's key totals or cross-ledger figures disagree with the ledgers.

WHICH SIDE TO CHANGE — decide by what your diff touched, not by which number looks
right (git diff -- packages/types/src/__tests__/zod-mirror-parity.test.ts):

  * you added or removed a ledger KEY (an arm of an entry's union), or an ENTRY that
    carries keys
    => correct the header figures to the derived ones below, and ADD the history
       sentence the bullet keeps for every move — it is cumulative by design, and a
       move recorded only as a corrected digit is the objectui#7664 shape: the
       arithmetic in the sentence above it stops adding up and nobody can see why.
       An entry moving usually moves BOTH its ledger's entry count and its key total,
       so expect the objectui#7733 block to fail alongside this one; if only one of
       the two failed, that asymmetry is information — read it before editing.

  * you edited a header figure by hand, or carried one in from a card, a review
    comment or another file
    => put it back to the derived value. The ledger is the measurement; the header
       only records it, and a figure quoted anywhere else is evidence about that
       place only.

⛔ Never reconcile the two by editing a ledger KEY SET. The key sets are pinned
against the mirrors themselves elsewhere in this file, so a key edited to satisfy a
sentence fails there instead — and that is route 1, which objectui#6141 predicted,
objectui#7433 measured recurring four more times, and objectui#8222 was filed to stop
being taken for the key totals specifically.

⚠️ ONE figure in the header is deliberately NOT here: the seed decomposition
under \`UnmirroredDeclared\` ("what 121 used to mean"). It needs each key's PROVENANCE
and no ledger in this file records that, so nothing here can derive it. It is
excluded in writing where it stands, which is the other half of objectui#8222 — every
live figure in that header is pinned or excluded with its reason, and ⛔ a new one
that is neither should not be added.

⚠️ AMENDED (objectui#8248; maintainer ruling, decision batch #71). This note called
that figure LIVE, which it was on the day the note was written. It is not one now:
objectui#8243 rewrote the deferred-to statement as a reading at NAMED REVISIONS, and a
statement anchored that way is HISTORICAL — nothing landing later can make it false.
So it carries none of a live figure's obligations, and the action the word "live"
sends you off to do — pin it, or exclude it afresh — is the WRONG one for a
historical reading. ⛔ Only that word moved. The clauses above are this note's
MEASUREMENT record — the header carries no copy of the decomposition, and no ledger
here records key provenance so nothing here can derive it — and they are untouched,
still exactly right, and ⛔ not rewritable by a later card. The rule that separates
the two is stated ONCE, in this file's header.`)
      .toEqual({
        knownDriftKeys: keyTotal('KnownDrift'),
        runtimeOnlyKeys: keyTotal('RuntimeOnlyDeclared'),
        runtimeOnlyAlsoUnmirrored: runtimeOnly.filter((pair) => unmirrored.has(pair)).length,
        runtimeOnlyEntriesRestated: runtimeOnly.length,
        unmirroredEntriesRestated: unmirrored.size,
        unmirroredEntriesRestatedInUnion: unmirrored.size,
        runtimeOnlyOnlyPairs: runtimeOnly.filter((pair) => !unmirrored.has(pair)).length,
        unionOfUnmirroredLedgers: new Set([...unmirrored, ...runtimeOnly]).size,
      });
  });

  it('the member reader can see KnownDrift and RuntimeOnlyDeclared (non-vacuity)', () => {
    // 'the member reader can actually see the unions' above guards `UnmirroredDeclared`
    // only, because that was the one ledger objectui#7279 read in keys. A reader that
    // returned no members for the two read HERE would derive 0 keys for both and the
    // check above would compare 0 against the header — red today, but green the moment
    // someone "fixed" it by writing 0 down, which is the failure mode these controls
    // exist for. Each leg below is a fact about the ledger, not about the reader.
    for (const ledger of ['KnownDrift', 'RuntimeOnlyDeclared'] as const) {
      const members = ledgerEntryMembers(ledger);
      expect(Array.from(members.keys()), `${ledger}: the member reader and the entry reader disagree on the entry list`)
        .toEqual(ledgerEntryKeys(ledger));
      for (const [entry, keys] of members) {
        expect(keys.length, `${ledger}['${entry}'] read as having no keys`).toBeGreaterThan(0);
      }
      expect(keyTotal(ledger), `${ledger}: no entry read as a union of more than one literal — the reader is not walking union arms`)
        .toBeGreaterThan(members.size);
    }

    // The cross-ledger figures are only meaningful if the reader really reads both
    // ledgers: an EMPTY `RuntimeOnlyDeclared`, or an empty intersection, would make
    // the subset and union figures pass while measuring a degenerate case.
    //
    // ⭐ RESHAPED by objectui#7804's `TreeViewSchema` slice, and this is the one
    // leg in this file whose DIRECTION the slice inverted. It used to assert that
    // `RuntimeOnlyDeclared` is NOT a subset of `UnmirroredDeclared`, because a
    // subset would make the old header figure (`15 pairs and not 14`) vacuous —
    // `TreeViewSchema` was the single member outside the overlap and the entire
    // content of that difference. Draining it made the containment TRUE, so the
    // old leg is not a guard that got weakened: it is a claim about the ledgers
    // that stopped holding, and keeping it would have forced a real key back onto
    // a ledger to satisfy a sentence — route 1, the thing this file exists to
    // refuse. The header now states the containment, and this asserts it, with the
    // two non-vacuity legs the old shape relied on kept explicit.
    //
    // ⭐ And objectui#6152 round 3 turned it back, for the reason #7804 predicted:
    // two pairs (`ObjectFormSchema`, `FormSchema`) became runtime-only and nothing
    // else, so the containment leg that stood third here — "RuntimeOnlyDeclared holds
    // no pair UnmirroredDeclared does not" — stopped being a fact about the ledgers.
    // It is DELETED, not inverted: the header sentence it guarded is now spelled to
    // hold at any difference, and 'every key total and cross-ledger figure …' above
    // reads that difference off the header and derives it from these same two
    // ledgers, so no direction needs asserting here, and the next drain moves a digit
    // rather than this leg. ⛔ Do not restore a direction leg of either sign. The two
    // non-vacuity legs below are the ones both shapes relied on.
    //
    // ⭐ objectui#6152 round 5 made the second of them FALSE as a fact about the
    // ledgers: `DataTableSchema`, the last pair in both, left `UnmirroredDeclared`
    // whole, so the two unmirrored ledgers ARE disjoint now and the shared figure in
    // the header reads `0`. Asserting a non-empty intersection here would have forced a
    // key back onto a ledger to satisfy a test — route 1 again. What that leg guarded
    // is kept, measured another way: an intersection of ZERO is only a reading if the
    // entry reader spells one pair the same way in every ledger it reads — a reader
    // that normalised names differently per ledger would return 0 for every
    // intersection and the `0` would pass blind. So the lit control is an intersection
    // that is NOT empty, read by the same reader: `KnownDrift` shares pairs with each
    // of the two unmirrored ledgers (`ChatbotSchema` with one, `DataTableSchema` with
    // the other, on this change's tree). ⛔ If a later drain empties BOTH of those
    // intersections too, pick another non-empty one — never delete the control.
    const unmirrored = new Set(ledgerEntryKeys('UnmirroredDeclared'));
    const runtimeOnly = ledgerEntryKeys('RuntimeOnlyDeclared');
    const knownDrift = new Set(ledgerEntryKeys('KnownDrift'));
    expect(runtimeOnly.length, 'RuntimeOnlyDeclared read as EMPTY — the subset and union figures are then vacuous')
      .toBeGreaterThan(0);
    expect(
      [...unmirrored].filter((pair) => knownDrift.has(pair)).length,
      'UnmirroredDeclared and KnownDrift read as DISJOINT — the entry reader may not spell one pair the same way in two ledgers, so a 0 intersection would be blind',
    ).toBeGreaterThan(0);
    expect(
      runtimeOnly.filter((pair) => knownDrift.has(pair)).length,
      'RuntimeOnlyDeclared and KnownDrift read as DISJOINT — the entry reader may not spell one pair the same way in two ledgers, so a 0 intersection would be blind',
    ).toBeGreaterThan(0);
  });
});

/* ── The LEDGER DOCSTRINGS' key total is pinned, their seed history anchored (objectui#8243) ─ */

describe("the ledger docstrings' key total is derived, not prose (objectui#8243)", () => {
  /** Keys across `UnmirroredDeclared` — the union arms, summed, from this file's own AST. */
  const unmirroredKeys = (): number =>
    Array.from(ledgerEntryMembers('UnmirroredDeclared').values()).reduce((n, keys) => n + keys.length, 0);

  it('both ledger docstrings state the key total the ledger actually holds', () => {
    // objectui#7279 pinned this ledger's four split figures and its totals line;
    // objectui#8222 pinned the file header's key totals. Both were green, and both
    // stayed green, while the two LEDGER DOCSTRINGS — the paragraph above
    // `UnmirroredDeclared` and the one above `RuntimeOnlyDeclared` — each said the
    // ledger records 94 and two independent instruments read 87. The figures sat in
    // DIFFERENT PARAGRAPHS of those docstrings, outside every spelling either pin
    // reaches: #7279's regexes are anchored to the split's own sentences and #8222's
    // to the top-of-file header. A figure with nothing looking at it is the whole
    // subject of this file, and this is the fifth link in the chain objectui#6141 →
    // #7433 → #7733 → #8222 that has left its remainder behind each time.
    //
    // 87 is not new: objectui#7779 took the ledger 96 → 87 and correctly moved every
    // PINNED figure. These two restatements were not pinned, so they did not move.
    //
    // ⭐ No new instrument and no new constant. `ledgerEntryMembers` already sizes this
    // ledger in keys for objectui#7279 and objectui#8222, and `headerFigures` reads
    // each figure off the prose's OWN spelling — so a rewording that drops a digit is
    // red rather than quietly unpinned, and the count a human edits stays exactly one
    // per site. A `const EXPECTED_UNMIRRORED_KEYS = 87` would be a THIRD place the
    // number lives and would reproduce this defect one level up.
    //
    // ⚠️ This reads a KEY total, not an entry count, and that is the objectui#7664
    // shape rather than a detail: re-keying one entry from N arms to N+1 moves the key
    // total while the entry count objectui#7733 watches holds still. That is exactly
    // how the header's `KnownDrift` total stood one low and fully green for four
    // commits, and it is the leg this pin is proven against.
    const [inUnmirroredDocstring] = headerFigures(/\*\*(\d+) keys\*\* is what this ledger records today/);
    const [inRuntimeOnlyDocstring] = headerFigures(/`UnmirroredDeclared` records \*\*(\d+) keys\*\* today/);

    expect({ inUnmirroredDocstring, inRuntimeOnlyDocstring }, `
A ledger docstring's key total disagrees with the ledger it describes.

WHICH SIDE TO CHANGE — decide by what your diff touched, not by which number looks
right (git diff -- packages/types/src/__tests__/zod-mirror-parity.test.ts):

  * you added or removed a ledger KEY (an arm of an entry's union), or an ENTRY that
    carries keys
    => correct BOTH docstring figures to the derived one below, and ADD the history
       sentence the narrative keeps for every move. Expect objectui#7279's split pin
       to fail alongside this one; if it did NOT, the entry count held while the key
       total moved (the objectui#7664 shape) and that asymmetry is information.
  * you edited a docstring figure by hand, or carried one in from a card or a comment
    => put it back to the derived value. The ledger is the measurement; the docstring
       only records it.

⛔ Never reconcile the two by editing a ledger KEY SET: the key sets are pinned against
the mirrors themselves elsewhere in this file, so a key edited to satisfy a sentence
fails there instead — and that is route 1, which objectui#6141 predicted and
objectui#8243 was filed to stop being taken for these two paragraphs specifically.

⚠️ Both sites are read, deliberately. Correcting one and leaving the other is how a
stale copy survives beside a corrected one, which is the shape objectui#8243 records.`)
      .toEqual({ inUnmirroredDocstring: unmirroredKeys(), inRuntimeOnlyDocstring: unmirroredKeys() });
  });

  it('the seed decomposition is a reading at NAMED REVISIONS and reconciles with itself', () => {
    // The other half of objectui#8243, and the half that must NOT be pinned to the
    // ledger. A decomposition of the 121 into survivors + departures needs each key's
    // PROVENANCE — which of today's keys descend from the seed — and no ledger in this
    // file records provenance; they record entry → key set as it stands. objectui#8222
    // hit the identical figure in the file header and REMOVED it rather than refreshing
    // the digit, deferring to the `UnmirroredDeclared` docstring as the site that owns
    // the statement. So that site could not simply delete it too: the provenance
    // narrative would have left the repo.
    //
    // ⚠️ objectui#8222's own exclusion note calls that deferred-to statement a LIVE
    // figure, which it was when the note was written. It is not one any more — read it
    // as the historical reading described below. That note was left exactly as it
    // stood: it is an assertion message objectui#8243 has no business editing, and
    // what it says about the FILE HEADER (no copy there, and none to be added back)
    // is unchanged. ⭐ objectui#8248 later amended the one stale WORD in it, under the
    // maintainer ruling now written in this file's header: a clause that RECORDS a
    // measurement is never rewritten, a clause that GIVES GUIDANCE is live and must be
    // amended when the world moves. The record clauses this comment names are still
    // byte-identical there; ⛔ that ruling is not licence to edit them.
    //
    // ⭐ objectui#8243 took neither route. The statement was rewritten as a reading at
    // NAMED REVISIONS — 98 keys at `beccf1c6b`, of which 85 survive and 13 have left at
    // `ed7178bf3` — which cannot rot, because nothing landing later can make a claim
    // about those two commits false. It therefore needs no pin against the ledger and
    // no hand re-derivation at the next repair, which was the cost the card flagged.
    //
    // ⛔ Nothing in this test reads the live ledger, and nothing in it may start to.
    // The moment a historical figure is compared with `unmirroredKeys()` the statement
    // is live again and the maintenance cost is back. What IS checked is the
    // statement's INTERNAL arithmetic, so a historical digit "refreshed" by hand to
    // chase a moved ledger — the most likely way this paragraph gets damaged — is red.
    //
    // ⚠️ The 10 MIRRORED / 3 RETIRED split of those 13 departures is deliberately NOT
    // read here. The 13 is measured (a set intersection on entry → key pairs); the
    // 10 / 3 is PROSE-DERIVED from the cards that moved them. Asserting it would dress
    // a prose reading as a measurement, and keeping the two visibly apart is the point.
    const [atGraft] = headerFigures(/this ledger held \*\*(\d+) keys\*\*\./);
    const [survived, departed] = headerFigures(
      /\*\*(\d+)\*\* of those keys were still in the ledger and \*\*(\d+)\*\* had left/,
    );
    const [sumSurvived, sumDeparted, reclassified, seed] = headerFigures(/\*\*(\d+) \+ (\d+) \+ (\d+) = (\d+)\*\*/);

    expect({
      survivorsPlusDepartures: survived + departed,
      sumLineSurvivors: sumSurvived,
      sumLineDepartures: sumDeparted,
      sumLineTotal: sumSurvived + sumDeparted + reclassified,
    }, `
The HISTORICAL seed decomposition no longer adds up.

Every figure it names is a reading at a NAMED REVISION (\`beccf1c6b\`, \`ed7178bf3\`), so
none of them moves when the ledger moves. If you got here:

  * you "refreshed" one of them to chase a ledger movement => put it back. That is the
    live/historical confusion objectui#8243 rewrote this paragraph to remove, and the
    live figure it belongs on is pinned by the sibling test above.
  * you re-measured the walk and got different numbers => that is a FINDING, not a
    prose edit. File it: the two commits are fixed, so a different reading means the
    instrument changed, not the history.

⛔ Do not repair this by pointing a figure at the live ledger — that reintroduces the
hand re-derivation on every future repair that objectui#8243 removed, and it cannot be
pinned anyway (no ledger here records key provenance).`)
      .toEqual({
        survivorsPlusDepartures: atGraft,
        sumLineSurvivors: survived,
        sumLineDepartures: departed,
        sumLineTotal: seed,
      });

    // Non-vacuity: all-zero figures would satisfy every equation above while stating
    // nothing. Each of these is a fact about the historical reading, not about the reader.
    for (const [name, value] of Object.entries({ atGraft, survived, departed, reclassified, seed })) {
      expect(value, `the historical figure ${name} read as 0 — the spelling matched something that is not the reading`)
        .toBeGreaterThan(0);
    }
  });

  it('the member reader can size UnmirroredDeclared in keys (non-vacuity)', () => {
    // A reader returning no members would derive 0 keys, and a docstring written as 0
    // would then pass while measuring nothing — the failure mode every control in this
    // file exists for. These are facts about the ledger, not about the reader.
    const members = ledgerEntryMembers('UnmirroredDeclared');
    expect(members.size, 'UnmirroredDeclared read as EMPTY').toBeGreaterThan(0);
    expect(unmirroredKeys(), 'no entry read as a union of more than one literal — the reader is not walking union arms')
      .toBeGreaterThan(members.size);
  });
});

describe('the spec-reference scan reads code, not prose (objectui#6705)', () => {
  const scan = (src: string): string[] => [...specReferencingExports('fixture.zod.ts', src)].sort();

  it('a `Spec…` token mentioned only in a COMMENT is not a reference', () => {
    // The exact shape that flipped this file red: prose, nothing else moved.
    expect(
      scan(`
/**
 * Extends the spec's SpecGanttConfigSchema — mentioned in prose only.
 */
export const ObjectTreeSchema = z.object({ objectName: z.string() });
`),
    ).toEqual([]);
  });

  it('a `Spec…` token referenced in CODE still fires — the direction that must not be lost', () => {
    // ⚠️ The whole risk of this fix: a scanner that stops seeing comments AND
    // stops seeing real references goes green while checking nothing.
    expect(
      scan(`
export const ObjectGanttSchema = SpecGanttConfigSchema.extend({ lockField: z.string() });
`),
    ).toEqual(['ObjectGanttSchema']);
  });

  it('a `Spec…` token inside a STRING LITERAL is not a reference either', () => {
    // Including one carrying comment-like sequences, which is the hazard a
    // regex-based comment stripper would have had. Nothing is stripped here.
    expect(
      scan(`
export const TextSchema = z.string().describe('SpecFooSchema */ // not a reference');
`),
    ).toEqual([]);
  });

  it('a PRIVATE const between two exports charges its prose to NEITHER neighbour', () => {
    // The live misattribution: the docstring sat above the private const, and the
    // text window starting at the preceding export ran on past its own end.
    expect(
      scan(`
export const ObjectTreeSchema = z.object({ objectName: z.string() });

/** Everything beyond the spec's SpecGanttConfigSchema. */
const GanttConfigExtensionFields = { lockField: z.string() };

export const ObjectGanttSchema = z.object({ ...GanttConfigExtensionFields });
`),
    ).toEqual([]);
  });

  it('a PRIVATE const with a REAL spec reference is charged to its USER, not its neighbour', () => {
    // Attribution by declaration plus file-local resolution: `ObjectGanttSchema`
    // really is spec-derived through the field map; `ObjectTreeSchema` is not, and
    // the text window used to blame exactly it.
    expect(
      scan(`
export const ObjectTreeSchema = z.object({ objectName: z.string() });

const GanttConfigExtensionFields = SpecGanttConfigSchema.shape;

export const ObjectGanttSchema = z.object({ ...GanttConfigExtensionFields });
`),
    ).toEqual(['ObjectGanttSchema']);
  });

  it("the NEXT export's docstring is not charged to the previous export", () => {
    expect(
      scan(`
export const ObjectTreeSchema = z.object({ objectName: z.string() });

/** Built from SpecGanttConfigSchema. */
export const ObjectGanttSchema = SpecGanttConfigSchema.extend({});
`),
    ).toEqual(['ObjectGanttSchema']);
  });

  it('the scanner can actually see a real mirror source (non-vacuity)', () => {
    // A broken parser returns an empty set and every negative case above passes
    // while checking nothing. Pin it against the file this bug was found in.
    const src = readFileSync(join(ZOD_DIR, 'objectql.zod.ts'), 'utf8');
    expect([...specReferencingExports('objectql.zod.ts', src)]).toContain('ObjectGanttSchema');
  });
});

/* ── Runtime: bounding the region the type level cannot see (objectui#7069) ─── */

type ZodInternals = { _zod?: { def?: Record<string, unknown> } };

const defOf = (schema: unknown): Record<string, unknown> | undefined =>
  (schema as ZodInternals | undefined)?._zod?.def;

/** Every schema node reachable from one slot, through the shapes zod 4 nests. */
function reachableNodes(schema: unknown, seen = new Set<unknown>()): unknown[] {
  const def = defOf(schema);
  if (!def || seen.has(schema)) return [];
  seen.add(schema);
  const found: unknown[] = [schema];
  for (const key of ['innerType', 'element', 'valueType', 'keyType', 'schema', 'in', 'out'] as const) {
    found.push(...reachableNodes(def[key], seen));
  }
  for (const list of [def.options, def.items]) {
    if (Array.isArray(list)) for (const arm of list) found.push(...reachableNodes(arm, seen));
  }
  const shape = def.shape as Record<string, unknown> | undefined;
  if (shape) for (const key of Object.keys(shape)) found.push(...reachableNodes(shape[key], seen));
  return found;
}

/** Every lazy node reachable from a registered mirror, with one slot that reaches it. */
function measureReachableLazyNodes(): Map<unknown, string> {
  const nodes = new Map<unknown, string>();
  for (const [pair, mirror] of Object.entries(MIRRORS)) {
    const shape = defOf(mirror)?.shape as Record<string, unknown> | undefined;
    if (!shape) continue;
    for (const key of Object.keys(shape)) {
      for (const node of reachableNodes(shape[key])) {
        if (defOf(node)?.type === 'lazy' && !nodes.has(node)) nodes.set(node, `${pair}.${key}`);
      }
    }
  }
  return nodes;
}

/**
 * `WiderThanDeclaredKeys` is blind wherever a mirror slot's input face is
 * `unknown`, and that face has ONE producing spelling: a recursive mirror annotated
 * `z.ZodType< any >` to break the cycle in its own `z.lazy`, which zod 4 reads as an
 * `unknown` INPUT parameter. So the exclusion is only as bounded as that population
 * is — and the population is exactly what the type level cannot report.
 *
 * ⚠️ Seven of the nine below no longer PRODUCE that face: objectui#7760 gave six of them
 * their TypeScript declaration as both type arguments, and
 * `designer.zod.ts#DesignerComponentSchema` (objectui#10859 batch 7) was born carrying it,
 * so their slots are measured now. They
 * stay in this list unchanged, and the list's name is still right, because what this
 * leg pins is the set of RECURSION-BREAKING SOURCES — every lazy node reachable from a
 * registered mirror — not the set of erased faces. A `z.lazy` is what the walk can see;
 * an annotation is not. ⇒ A future card that fills the remaining two ⛔ still may not
 * shorten this list: it would stop being able to detect the tenth. (The list held ten
 * until objectui#10825: `complex.zod.ts#FilterBuilderConditionSchema` LEFT it with its
 * annotation still standing. Neither `FilterBuilderSchema.value` nor `defaultValue`
 * names it any more (the bare-condition arm was retired, and `defaultValue` became a
 * tombstone), and the only path left to it runs through
 * `FilterGroupSchema`'s getter, which the walk does not enter — so it is no longer a
 * source by this leg's definition, and the no-dead-entries case below removed the row.
 * objectui#11465 removed `navigation.zod.ts#NavLinkSchema` the same way: its one
 * carrier, `SidebarSchema.nav`, became a tombstone, so no registered mirror reaches it.
 * That is a change in what is REACHABLE, not a filled annotation.) At the type
 * level every unconstrained face looks alike, so a NEW recursive mirror enlarges
 * the blind region without changing one character the compiler reads. At runtime
 * the mirrors are values and the lazy nodes are reachable, so the region can be
 * enumerated and pinned. That is the whole reason this leg is at runtime.
 *
 * ⚠️ The first spelling of this leg asserted the region had a SINGLE source,
 * `SchemaNodeSchema`. The walk refuted it on the first run — the navigation, menu,
 * tree, action and filter-condition mirrors each carry the same annotation — and
 * the claim was replaced by the measurement rather than repaired. It is recorded
 * here because the wrong version is the intuitive one: the card, the triage and the
 * dispatch all describe the producer as if it were one const.
 *
 * ⛔ Not a count of affected slots: that moves with every `.extend()`, since every
 * component mirror inherits the base's schema-node slots. What is pinned is the set
 * of SOURCES, which moves only when someone writes a new recursive mirror.
 */
const RECURSION_BREAKING_MIRRORS: readonly (readonly [string, unknown])[] = [
  ['base.zod.ts#SchemaNodeSchema', SchemaNodeSchema],
  ['app.zod.ts#NavigationItemSchema', NavigationItemSchema],
  ['app.zod.ts#MenuItemSchema', AppMenuItemSchema],
  ['complex.zod.ts#FilterGroupSchema', FilterGroupSchema],
  ['crud.zod.ts#ActionSchema', ActionSchema],
  ['data-display.zod.ts#TreeNodeSchema', TreeNodeSchema],
  ['designer.zod.ts#DesignerComponentSchema', DesignerComponentSchema],
  ['navigation.zod.ts#NavigationMenuItemSchema', NavigationMenuItemSchema],
  ['overlay.zod.ts#MenuItemSchema', OverlayMenuItemSchema],
];

/**
 * Lazy nodes with no exported const to name, recorded by a slot that reaches them:
 * an inline `z.lazy` written in the slot itself, or one inside a PRIVATE mirror.
 * They are part of the blind region on the same terms as the named ones; they are
 * listed separately only because there is no identity to compare against.
 */
const UNNAMED_LAZY_SLOTS: readonly string[] = [
  'complex.zod.ts#DashboardComponentSchema.widgets',
  // objectui#11070 round 3: `FormFieldSchema.summaryOperations` is the spec's
  // `FieldSchema` member by reference, and its optional `filter` is the spec's
  // recursive filter condition. That `z.lazy` sits inside an IMPORTED schema
  // (rebuilt by `stripImportedDefaults`), so no local const names it either.
  'form.zod.ts#FormFieldSchema.summaryOperations',
  'objectql.zod.ts#ObjectViewSchema.form',
  'objectql.zod.ts#ObjectViewSchema.table',
];

describe('the blind region of the wider direction is bounded (objectui#7069)', () => {
  it('the walk can actually see a lazy node (non-vacuity)', () => {
    // A walk that stopped following zod's nesting would report an empty region and
    // pass the case below while measuring nothing — the failure mode objectui#6133
    // names, here on the instrument rather than on a ledger.
    expect(measureReachableLazyNodes().size).toBeGreaterThan(0);
  });

  it('every recursion-breaking mirror in the region is named or recorded', () => {
    // Fails when a new recursive mirror joins the region, which is precisely the
    // event that widens what `Unconstrained` excludes and what the ledger's
    // SCHEMA-NODE class covers — and the event nothing else in this file can see.
    const unnamed = [...measureReachableLazyNodes().entries()]
      .filter(([node]) => !RECURSION_BREAKING_MIRRORS.some(([, schema]) => schema === node))
      .map(([, slot]) => slot);
    expect([...new Set(unnamed)].sort()).toEqual([...UNNAMED_LAZY_SLOTS].sort());
  });

  it('every recorded source is really reachable — no dead entries', () => {
    // The other direction of the same ratchet: a mirror that stops being recursive,
    // or stops being reachable from the registry, leaves a row here asserting a
    // region that no longer exists.
    const live = new Set(measureReachableLazyNodes().keys());
    const dead = RECURSION_BREAKING_MIRRORS.filter(([, schema]) => !live.has(schema)).map(([name]) => name);
    expect(dead).toEqual([]);
  });
});

/* ── Per-ARM granularity: the derivation and its pins (objectui#8252) ────────── */

/**
 * Wrappers that carry no arm of their own. Unwrapping them is what makes
 * `widgets` — `z.array(z.union([...]))` — read as a two-arm key rather than a
 * one-arm array, which is the shape objectui#7952 measured and the reason the
 * enumeration cannot simply read `def.options` off the slot.
 */
const ARMLESS_WRAPPERS: readonly string[] = [
  'optional', 'nullable', 'default', 'prefault', 'catch', 'readonly', 'nonoptional',
];

/**
 * The union arms of one mirror slot, measured from the mirror VALUE.
 *
 * `undefined` when the pair has no such slot — a ledger key that does not exist on
 * its mirror. That is a hard failure below rather than a skipped row: a row read as
 * "no arms" would satisfy nothing and pass everything.
 */
function measureMirrorArms(pair: MirrorKey, key: string): unknown[] | undefined {
  const shape = defOf(MIRRORS[pair])?.shape as Record<string, unknown> | undefined;
  const slot = shape?.[key];
  if (slot === undefined) return undefined;
  const unwrap = (node: unknown): unknown => {
    const def = defOf(node);
    if (!def) return node;
    const type = def.type as string;
    if (ARMLESS_WRAPPERS.includes(type)) return unwrap(def.innerType);
    if (type === 'array') return unwrap(def.element);
    if (type === 'pipe') return unwrap(def.in);
    return node;
  };
  const node = unwrap(slot);
  const def = defOf(node);
  return def?.type === 'union' ? (def.options as unknown[]) : [node];
}

/** The arm ledger's rows, split back into the pair and key they judge. */
function widerArmRows(): { row: string; pair: MirrorKey; key: string; arms: readonly WiderArmClass[] }[] {
  return Object.entries(WIDER_ARMS).map(([row, arms]) => {
    const cut = row.lastIndexOf(WIDER_ARM_ROW_SEPARATOR);
    return {
      row,
      pair: row.slice(0, cut) as MirrorKey,
      key: row.slice(cut + WIDER_ARM_ROW_SEPARATOR.length),
      arms,
    };
  });
}

/** A key's class, DERIVED from its arm verdicts — never stored beside them. */
const widerKeyClass = (arms: readonly WiderArmClass[]): 'SCHEMA-NODE' | 'CONCRETE' | 'MIXED' =>
  arms.every((arm) => arm === 'SCHEMA-NODE') ? 'SCHEMA-NODE'
    : arms.every((arm) => arm === 'CONCRETE') ? 'CONCRETE' : 'MIXED';

describe('the WIDER ledger is judged per ARM, not per key (objectui#8252)', () => {
  it('the enumeration can tell a union slot from a plain one (non-vacuity)', () => {
    // Both directions, because both failure modes are silent. An unwrapper that
    // stopped at `z.array` would report ONE arm for every key and every arity row
    // below would pass while measuring nothing; one that walked into object shapes
    // would report many arms everywhere and the ledger would be rewritten to match
    // an instrument rather than the mirrors. Neither is visible from the arity pin.
    //
    // The union direction reads a FIXED control slot beside the ledger's own rows:
    // objectui#10387 retired the ledger's last two-arm key (`HeaderBarSchema::logo`),
    // and a non-vacuity check that needs the LEDGER to hold a union would have gone
    // red on a shrinking ledger rather than on a broken unwrapper. `SidebarSchema`'s
    // `children` is the single-or-list spelling, two arms, outside the ledger — the
    // channel the node reads. (The control was its `content` until objectui#11465
    // retired that key to a one-arm tombstone.)
    const measured = widerArmRows().map(({ pair, key }) => measureMirrorArms(pair, key)?.length);
    measured.push(measureMirrorArms('navigation.zod.ts#SidebarSchema', 'children')?.length);
    expect(measured.filter((n) => n === 1).length).toBeGreaterThan(0);
    expect(measured.filter((n) => n !== undefined && n > 1).length).toBeGreaterThan(0);
  });

  it('every ledgered key has exactly one arm row, and every row a ledgered key', () => {
    // The coverage both ways, and the answer to "a key with no union arms still
    // needs a verdict": there is no third state. A single-arm key is a one-verdict
    // row, not an absence — so it lands in the new granularity instead of falling
    // through the per-arm framing the way it fell through the per-entry prose.
    const ledgered = [...ledgerEntryMembers('WiderThanDeclared')]
      .flatMap(([pair, keys]) => keys.map((key) => `${pair}${WIDER_ARM_ROW_SEPARATOR}${key}`));
    expect(Object.keys(WIDER_ARMS).sort(), `
WIDER_ARMS and WiderThanDeclared disagree about which keys exist.

  * a key entered or left the type-level ledger => add or remove its arm row, with a
    verdict per arm measured by measureMirrorArms(). ⛔ Never delete a row to make
    this green: the ledger above is pinned against the mirrors themselves, so a key
    removed there for the wrong reason fails at assertionWiderMatchesLedger.
  * a row is misspelled => the pair half is checked by
    assertionWiderLedgerKeysAreRegistered, the key half only here.`)
      .toEqual([...ledgered].sort());
  });

  it('every row names one verdict per MEASURED arm', () => {
    // ⭐ The pin objectui#8252 exists for. A MIXED key can no longer be filed
    // SCHEMA-NODE wholesale, because "wholesale" has no spelling left: the row must
    // hold as many verdicts as the mirror has arms, and a mirror that GROWS an arm
    // reddens here until someone judges the new one. That is the event that produced
    // objectui#7952 — the component arm was added to the mirror under
    // objectstack#8593 and the key's one-word class never moved.
    const wrong = widerArmRows()
      .map(({ row, pair, key, arms }) => ({ row, judged: arms.length, measured: measureMirrorArms(pair, key)?.length }))
      .filter(({ judged, measured }) => judged !== measured);
    expect(wrong, `
An arm row does not name one verdict per arm of its mirror slot.

  * measured LARGER => the mirror grew an arm. Judge it: SCHEMA-NODE only if the
    arm IS the recursion-breaking slot, CONCRETE if it states a shape an author can
    write. If it is CONCRETE and the TypeScript face lacks it, that is a real
    divergence — objectui#7759's lane, or its own card when it carries a ruling.
  * measured SMALLER => an arm left. Drop its verdict.
  * measured UNDEFINED => the key is not on the mirror at all.`)
      .toEqual([]);
  });

  it('a concrete arm cannot hide behind a schema-node sibling (objectui#7952)', () => {
    // The positive control for the collapse that IS the defect: a concrete arm filed
    // under its sibling's verdict. The arity pin above cannot catch it —
    // ['SCHEMA-NODE', 'SCHEMA-NODE'] has the right length — so the shape is pinned
    // here.
    //
    // ⚠️ It was pinned on objectui#7952's own row, `DashboardComponentSchema::widgets`,
    // until objectui#7760. That row is GONE: its concrete arm was declared by PR #8296
    // and its schema-node arm stopped reading wider once `SchemaNodeSchema` carried its
    // input type argument, so the key measures clean and left this ledger. ⛔ Do not
    // re-point this at whichever row happens to be MIXED today — there is none, and a
    // control that has to be re-aimed every time the ledger moves is a control that
    // will one day be deleted instead. The derivation is the invariant, so the
    // derivation is what is asserted: a mixed pair of verdicts must NOT reduce to
    // either of its members.
    expect(widerKeyClass(['CONCRETE', 'SCHEMA-NODE'])).toBe('MIXED');
    expect(widerKeyClass(['SCHEMA-NODE', 'CONCRETE'])).toBe('MIXED');
    expect(widerKeyClass(['SCHEMA-NODE', 'SCHEMA-NODE'])).toBe('SCHEMA-NODE');
    expect(widerKeyClass(['CONCRETE', 'CONCRETE'])).toBe('CONCRETE');
    // …and no live row is MIXED today, which is the fact the header's `0` records.
    expect(widerArmRows().filter(({ arms }) => widerKeyClass(arms) === 'MIXED')).toEqual([]);
  });
});

describe("the WIDER ledger's header figures are derived from its ARMS (objectui#8252)", () => {
  it('every figure the header writes down for WiderThanDeclared equals the ledger and the mirrors', () => {
    // objectui#7733 pinned three ledgers' entry counts and objectui#8222 their key
    // totals; both blocks name the ledgers they reach, and `WiderThanDeclared` was in
    // neither — it had no figure in the header at all. That is why "27 SCHEMA-NODE
    // keys" could be quoted by objectui#7759, inherited by objectui#8252's card body,
    // and be two out by the time anyone re-derived it, with this file green
    // throughout. ⛔ Do not fold this block into either of those: it fails for a
    // different movement (an ARM appearing under an existing key moves nothing they
    // read) and it is the only one that reaches the mirrors as well as the ledger.
    const rows = widerArmRows();
    const classes = rows.map(({ arms }) => widerKeyClass(arms));

    const [entries, keys, arms] = headerFigures(
      /\*\*(\d+) entries\*\* in `WiderThanDeclared`, \*\*(\d+) keys\*\* across them, and \*\*(\d+) arms\*\*/,
    );
    const [schemaNode, concrete, mixed, unions] = headerFigures(
      /split \*\*(\d+)\*\* SCHEMA-NODE, \*\*(\d+)\*\* CONCRETE, \*\*(\d+)\*\* MIXED, \*\*(\d+)\*\* unions/,
    );

    expect({ entries, keys, arms, schemaNode, concrete, mixed, unions }).toEqual({
      entries: ledgerEntryKeys('WiderThanDeclared').length,
      keys: rows.length,
      arms: rows.reduce((n, { arms: judged }) => n + judged.length, 0),
      schemaNode: classes.filter((c) => c === 'SCHEMA-NODE').length,
      concrete: classes.filter((c) => c === 'CONCRETE').length,
      mixed: classes.filter((c) => c === 'MIXED').length,
      // Read off the MIRRORS, not off the ledger: the one figure here that fails when
      // a mirror moves and the ledger does not.
      unions: rows.filter(({ pair, key }) => (measureMirrorArms(pair, key)?.length ?? 0) > 1).length,
    });
  });
});

/* ── The objectui#7760 MOVEMENT figures reconcile with themselves (objectui#8458) ── */

describe("the objectui#7760 movement figures reconcile with themselves (objectui#8458)", () => {
  it('the pairs that move touched equal its emptied entries plus its reduced ones', () => {
    // The one figure in that paragraph no instrument reached. Its neighbours — the
    // ledger's entry / key / arm totals either side of the move and the arm split —
    // are pinned by the blocks above and all moved correctly with objectui#7760;
    // `16 pairs` sat between them unpinned, and a reader cannot tell by looking which
    // digits in a checked paragraph are the checked ones. That is the whole shape:
    // the header's authority rests on the others being derived, so an unwatched digit
    // inherits an authority nothing gave it.
    //
    // ⛔ This is a HISTORICAL reading and nothing here may compare it to the live
    // ledger. `WiderThanDeclared` today is NEITHER of the two trees the sentence
    // describes (objectui#8338 moved it again afterwards), and the moment a figure
    // here is derived from it the statement is live, rots on the next ledger move, and
    // costs a hand re-derivation at every future repair — which is exactly what
    // objectui#8243 removed for the seed decomposition. What IS checked is the
    // statement's INTERNAL arithmetic, so a digit "refreshed" by hand — the way `16`
    // got here — is red.
    //
    // ⭐ Re-derived, not inherited. objectui#8458's card carried the figure 18 from a
    // contract reviewer and said in as many words not to adopt it, because adopting an
    // unchecked figure is the defect the card is about. It was measured again by
    // running THIS FILE'S `ledgerEntryMembers('WiderThanDeclared')` — the same
    // instrument the pins above use, sliced out of the file rather than retyped — over
    // the file at `645ecb98c` and at `a480f797a` (PR #8354's parent and its merge) and
    // diffing entry -> key pairs: 19 rows left and 3 entered, across 18 distinct
    // entries of which 13 lost their whole content and 5 kept keys. Both movements
    // close against figures ALREADY pinned at those two revisions — 52 - 19 + 3 = 36
    // keys and 34 - 13 + 2 = 23 entries — so the reading is anchored on both sides
    // instead of asserted. The 5 reduced entries are `AppComponentSchema`,
    // `DashboardComponentSchema`, `PageNodeSchema`, `ObjectViewSchema` and
    // `DetailViewSchema`.
    //
    // ⚠️ The DEFINITION is the other half of this pin and it lives in the prose beside
    // the figure: "pairs" counts every entry the move TOUCHED, not the emptied subset.
    // ⛔ Do not write the figure back as a bare digit — `16` was wrong under BOTH
    // readings (13 emptied, 18 touched), and a number with no definition forks again.
    const [keysLeft, pairsTouched] = headerFigures(/(\d+) keys across \*\*(\d+)\*\* pairs LEFT/);
    const [emptied, reduced, decomposed] = headerFigures(/\*\*(\d+) emptied \+ (\d+) reduced = (\d+)\*\*/);

    expect({
      decomposition: emptied + reduced,
      restatedTotal: decomposed,
      everyTouchedPairLostAKey: pairsTouched <= keysLeft,
    }, `
The objectui#7760 movement sentence no longer adds up.

Every figure in it is a reading of two FIXED trees (\`645ecb98c\` and \`a480f797a\`), so
none of them moves when the ledger moves. If you got here:

  * you "refreshed" one of them to chase a ledger movement => put it back. The current
    ledger is neither of those trees, and the live figures for it are the entry / key /
    arm totals at the top of that bullet, pinned by the objectui#8252 block above.

  * you re-derived the movement and got different numbers => that is a FINDING, not a
    prose edit. The two commits are fixed, so a different reading means the INSTRUMENT
    changed, not the history. Re-run \`ledgerEntryMembers('WiderThanDeclared')\` against
    the file at both revisions and diff entry -> key pairs before touching a digit.

  * you reworded the sentence => the spellings this pin reads are
    \`N keys across **M** pairs LEFT\` and \`**E emptied + R reduced = M**\`, each exactly
    once. A reword that drops one is red here rather than quietly unpinned, which is
    the objectui#7733 principle; ⛔ do not "fix" it by deleting the pin.

⛔ Never reconcile this by pointing a figure at the live ledger. That reintroduces the
hand re-derivation on every future repair (objectui#8243), and it cannot be pinned
that way anyway: no ledger in this file records what it held at a past revision.`)
      .toEqual({
        decomposition: pairsTouched,
        restatedTotal: pairsTouched,
        everyTouchedPairLostAKey: true,
      });

    // Non-vacuity: a spelling that matched something other than the reading — or an
    // all-zero rewrite — would satisfy `0 + 0 = 0` while stating nothing. Each leg is
    // a fact about the movement, not about the reader.
    for (const [name, value] of Object.entries({ keysLeft, pairsTouched, emptied, reduced })) {
      expect(value, `the historical movement figure ${name} read as 0 — the spelling matched something that is not the reading`)
        .toBeGreaterThan(0);
    }
    // Both halves of the decomposition are non-empty: a move with no reduced entries
    // would make "pairs" and "emptied" the same quantity, and the ambiguity that
    // produced objectui#8458 could not be seen from the sentence.
    expect(reduced, 'the reduced half read as 0 — then "pairs" and "emptied" state one quantity twice')
      .toBeGreaterThan(0);
  });
});


/* ── The FOURTH direction is enumerated and sized at test time (objectui#9711) ── */

describe('the fourth direction is enumerated and sized at test time (objectui#9711)', () => {
  const members = (): Map< string, string[] > => ledgerEntryMembers('MirroredUndeclared');
  const keyTotal = (): number =>
    Array.from(members().values()).reduce((n, keys) => n + keys.length, 0);

  it('the ledger docstring states the entry count and key total the ledger actually holds', () => {
    // The card that opened this direction asked for what it catches ON TODAY'S TREE,
    // BY NAME, with the count DERIVED AT TEST TIME. The names are the ledger's own
    // union arms — `assertionMirroredUndeclaredMatchesLedger` is what makes them the
    // measurement rather than a list — and this is the derivation: both figures are
    // read off the ledger's AST here and compared to the ONE place a human writes
    // them down. A `const EXPECTED_MIRRORED_UNDECLARED_KEYS` would be a second place
    // the number lives and would reproduce the defect objectui#7433, #7733, #8222 and
    // #8243 each repaired one level up.
    //
    // ⛔ The spelling is read off the docstring's OWN words, so a reword that drops a
    // digit is red rather than quietly unpinned.
    const [entries, keys] = headerFigures(/this ledger seeds \*\*(\d+) entries\*\* carrying \*\*(\d+) keys\*\*/);

    expect({ entries, keys }, `
The MirroredUndeclared docstring's figures disagree with the ledger it describes.

WHICH SIDE TO CHANGE — decide by what your diff touched, not by which number looks
right (git diff -- packages/types/src/__tests__/zod-mirror-parity.test.ts):

  * you added or removed a ledger KEY (an arm of an entry's union), or an ENTRY
    => correct the docstring figures to the derived ones below. An arm added is a NEW
       mirrored-but-undeclared key on a published pair, and
       \`assertionMirroredUndeclaredMatchesLedger\` will have named the pair first;
       read that message before this one.

  * you edited a figure by hand, or carried one in from a card or a review comment
    => put it back to the derived value. The ledger is the measurement; the docstring
       only records it.

⛔ Never reconcile the two by editing a ledger KEY SET: the key sets are reconciled
against the mirrors themselves by the compile-time assignment above, so a key edited
to satisfy a sentence fails there instead — route 1, which objectui#6141 predicted and
this file has watched recur ever since.

⛔ And never reconcile a GROWTH by DECLARING the new key on the TypeScript face. That
enlarges a published accept set and is an at-tier contract decision, deliberately
outside the card that built this instrument.`)
      .toEqual({ entries: members().size, keys: keyTotal() });
  });

  it('every ledgered pair is a REGISTERED pair, and the ledger is not empty', () => {
    const registered = new Set(Object.keys(MIRRORS));
    const unregistered = Array.from(members().keys()).filter((pair) => !registered.has(pair));
    expect(unregistered, 'a MirroredUndeclared entry names a pair MIRRORS does not register — the compile-time half ignores it while the real pair reads as clean')
      .toEqual([]);
    // Non-vacuity for the line above: an EMPTY ledger has no unregistered entry
    // either, and would pass it while checking nothing.
    expect(members().size, 'MirroredUndeclared read as EMPTY — then the registration check above is vacuous')
      .toBeGreaterThan(0);
  });

  it('the member reader can see MirroredUndeclared (non-vacuity)', () => {
    // The same control the other ledgers carry: a reader that returned no members
    // would derive 0 for both figures above, red today but green the moment someone
    // "fixed" it by writing 0 down. Each leg is a fact about the ledger, not about
    // the reader.
    const read = members();
    expect(Array.from(read.keys()), 'MirroredUndeclared: the member reader and the entry reader disagree on the entry list')
      .toEqual(ledgerEntryKeys('MirroredUndeclared'));
    for (const [entry, keys] of read) {
      expect(keys.length, `MirroredUndeclared['${entry}'] read as having no keys`).toBeGreaterThan(0);
    }
    // The union-arm leg needs an entry with more than one arm to be a fact about
    // THIS ledger. objectui#9256 emptied the last multi-arm entries here (the two
    // `Omit` COLLAPSE rows), leaving single-key entries only — so, while that holds,
    // the leg is taken on `KnownDrift`, which this SAME reader sizes above and which
    // does hold multi-arm entries. It re-arms on this ledger the moment a multi-arm
    // entry lands here; ⛔ it is never dropped, because a reader that stopped walking
    // arms would still pass both legs above.
    const armWitness = keyTotal() > read.size ? read : ledgerEntryMembers('KnownDrift');
    const armKeys = Array.from(armWitness.values()).reduce((n, keys) => n + keys.length, 0);
    expect(armKeys, 'no entry read as a union of more than one literal — the reader is not walking union arms')
      .toBeGreaterThan(armWitness.size);
  });

  it('the seed spans BOTH mirror-construction styles — it is not an artefact of one', () => {
    // A seed drawn entirely from spec-derived mirrors would be evidence about
    // `.extend(SpecXFields.shape)` and nothing else; one drawn entirely from LOCAL
    // mirrors would be evidence about hand-written shapes and nothing else. Both
    // halves non-empty is what makes the direction a property of the FILE PAIRING
    // rather than of one authoring habit. Derived from `SPEC_DERIVED_PAIRS`, which
    // is itself re-derived from the mirror sources by the census above — ⛔ so this
    // is not a second hand-kept classification.
    const entries = Array.from(members().keys());
    const specDerived = entries.filter((pair) => SPEC_DERIVED_PAIRS.includes(pair));
    const local = entries.filter((pair) => !SPEC_DERIVED_PAIRS.includes(pair));
    expect(specDerived.length, 'no SPEC-DERIVED pair in the seed — then the ledger says nothing about spec inflow')
      .toBeGreaterThan(0);
    expect(local.length, 'no LOCAL pair in the seed — then the ledger says nothing about hand-written mirrors')
      .toBeGreaterThan(0);
    expect(specDerived.length + local.length, 'the two halves do not account for every entry')
      .toBe(entries.length);
  });

  it('the fourth direction is a DIFFERENT measurement from the three before it', () => {
    // ⭐ The lit control for the whole card, at ledger granularity. If this ledger's
    // pair set were a subset of an existing one, the new operator could be reporting
    // the same facts under a new name. It is not: at least one pair is in this
    // ledger and in NONE of the other three, so the fourth direction sees something
    // no prior direction records.
    //
    // ⚠️ Overlap is EXPECTED and is not a finding — the four directions are
    // independent measurements of one pair, and a pair can owe on several at once.
    // The claim under test is only that the new set is not CONTAINED in the old ones.
    const others = new Set([
      ...ledgerEntryKeys('KnownDrift'),
      ...ledgerEntryKeys('UnmirroredDeclared'),
      ...ledgerEntryKeys('RuntimeOnlyDeclared'),
      ...ledgerEntryKeys('WiderThanDeclared'),
    ]);
    const onlyHere = Array.from(members().keys()).filter((pair) => !others.has(pair));
    expect(onlyHere.length, 'every pair this direction reports is already reported by another ledger — then it may be measuring nothing new')
      .toBeGreaterThan(0);
    // Non-vacuity: the union of the other three ledgers must be non-empty, or
    // `onlyHere` is just the whole ledger and the comparison is trivially satisfied.
    expect(others.size, 'the other ledgers read as EMPTY — the comparison above is then vacuous')
      .toBeGreaterThan(0);
  });
});
