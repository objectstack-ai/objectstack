/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ⭐ WHAT `ObjectGrid` COPIES OFF AN OBJECT-SCHEMA FIELD DEF ONTO A COLUMN'S
 * `fieldMeta` — objectui#6875.
 *
 * ## The defect this file exists to make unrepeatable
 *
 * `RELATIONAL_META_KEYS` used to be a bare array literal inside `ObjectGrid.tsx`,
 * governed by a rule stated in prose: *every key here has to have a measured
 * reader on this grid's own render path*. The rule was right; nothing enforced
 * it in the OTHER direction. The list was a strict SUBSET of what its own
 * consumers read, and had been for as long as anyone had looked:
 *
 *   copied, never read   — none (objectui#6711 and objectui#6874 closed that half)
 *   read, never copied   — `displayField`, `descriptionField`, `lookupColumns`,
 *                          `reference_field`, `lookup_columns`
 *
 * The list was also internally inconsistent about spelling, which is the tell
 * that it was assembled from defect reports rather than derived: `lookupFilters`
 * (camel) sat in it next to `lookup_filters`, while `displayField` and
 * `descriptionField` did NOT sit next to their snake twins. Same fallback
 * chains, same file, opposite outcomes.
 *
 * So the fix is not a longer literal. {@link RELATIONAL_META_READ_SET} below
 * classifies EVERY key the consumers read off this bag, and
 * `__tests__/relationalMetaCopySet.derivation.test.ts` re-derives that read set
 * from the consumer sources on every run. A spelling added to any consumer
 * chain lands in neither column of the table and turns the gate red; it cannot
 * silently become a sixth never-copied key.
 *
 * ## The consumers, and why they are exactly these three
 *
 * `generateColumns()` hands `fieldMeta` to `CellRenderer` as the `field` prop,
 * and `getCellRenderer` dispatches a relational column into
 * `LookupCellRenderer` (`@object-ui/fields/src/index.tsx`). The grid's inline
 * editor renders `LookupField` and `UserField`
 * (`@object-ui/fields/src/widgets/`); `UserField` reads a few keys itself and
 * then spreads its whole meta into `LookupField` — so its own read set is a
 * subset and it adds nothing; it is swept anyway, because a key it read and
 * did NOT forward would otherwise be invisible here.
 *
 * ## ⚠️ Only the FIRST of those three is fed by this bag — objectui#7154
 *
 * This docblock used to say the inline editor "dispatches the same bag" into
 * the two widgets. It does not, and the correction matters because it is what
 * a whole class of card is filed against: `ObjectGrid.renderCellEditor` looks
 * the field up in the object schema and spreads the WHOLE def into the widget
 * (`{ name: ctx.column.accessorKey, ...fieldDef }`), so every key a def carries
 * reaches `LookupField` regardless of this table. `fieldMeta` goes to
 * `<CellRenderer>` and nowhere else.
 *
 * Both halves read `objectSchema?.fields?.[name]` — the same object — so there
 * is no shape where copying could rescue an editor the schema read did not
 * already serve: when that lookup misses, `renderCellEditor` returns `null` and
 * `applyRelationalMeta` copies nothing, together.
 *
 * ⇒ A key whose only reader is one of the two EDITOR widgets gains nothing from
 * being copied here, and copying it would write a member onto a bag its
 * consumer does not read — the shape objectui#6711 and objectui#6874 retired.
 * The four keys objectui#7154 asked about are measured arriving at the picker
 * with this table unchanged, in
 * `__tests__/lookupPickerKeys-7154.test.tsx`.
 *
 * ## ⭐ THREE KEYS LEFT THIS COPY SET BY THAT RULE — objectui#7166
 *
 * objectui#7154 stated the rule for keys that had never been copied. Applied
 * BACKWARDS, to keys already on the list, the same rule retires three of them:
 * `descriptionField`, `lookupColumns` and `lookupFilters`. Each is read off a
 * field meta only by `LookupField` (and `lookupFilters` also by `UserField`) —
 * the two EDITOR widgets — so on the cell path each write landed on a bag whose
 * consumer never looks at it. Re-measured on `47035ce79`, and stated as
 * receivers rather than as a count: `packages/fields/src/index.tsx`, the file
 * that holds EVERY `CellRenderer`, contains zero occurrences of any of the
 * three, against a control of 22 occurrences of the `display_field` /
 * `displayField` / `reference_to` spellings the cell read then (since
 * objectui#7155 and objectui#11070 round 4 it reads `displayField` and
 * `reference` only).
 *
 * ⇒ The retirement is behaviour-preserving, and that is the half worth pinning:
 * all three still take effect in the inline picker with them OFF this table,
 * because `renderCellEditor` hands the widget the whole schema def.
 * `__tests__/relationalMetaCopySet-7166.test.tsx` renders both halves.
 *
 * ## ⭐ THE TWO POPULATIONS — settled by objectui#7155, not by a reader sweep
 *
 * Six copied keys had no reader on this bag; three left in objectui#7166. The
 * other three — `description_field`, `lookup_filters`, `id_field` — were held
 * back as `legacy-alias`, on a PRODUCER-side argument no reader measurement
 * could answer: a host `DataSource` outside these two repos might hand-feed
 * them.
 *
 * That question is now CLOSED, and the answer was not the expected one. The
 * host feeding snake_case was THIS REPO: `@object-ui/types` declared the snake
 * spellings on `LookupFieldMetadata` / `UserFieldMetadata` and REFUSED the
 * camelCase ones, `content/docs/fields/lookup.mdx` taught that dialect as
 * normative, and CI compiled those snippets on every run. Two published
 * contracts disagreed about one concept, and the read chains here served both.
 *
 * objectui#7155 converged them on the spec's camelCase in one payment: the
 * widget contract was renamed, the docs and all seven in-repo producers moved
 * with it, and the snake legs left the chains. So the four spellings are not
 * "retired on reader evidence" — the dialect that produced them no longer
 * exists.
 *
 * ## ⭐ THE DERIVATION IS SCOPED TO THE CELL — objectui#7187
 *
 * That gap is closed. Until objectui#7187 the gate extracted ONE set, the UNION
 * over the three consumers, and a copy-set entry was licensed by membership in
 * it. Membership there means "some consumer reads this key" and never "this bag
 * is how that consumer gets it" — different claims, and only the second
 * justifies a copy. Reading the first as the second is what put
 * `descriptionField` and `lookupColumns` on this table (objectui#6875) and what
 * objectui#7166 then had to undo.
 *
 * So the reader axis is now recorded PER CONSUMER on every entry
 * ({@link RelationalMetaEntry.readers}), and the gate checks each declared list
 * against that consumer's own source in BOTH directions. The copy set is
 * derived from {@link CONSUMERS_FED_THIS_BAG} alone. A key only the editor
 * widgets read can no longer be copied by editing a verdict, because no verdict
 * says "copy this" any more — copying follows the measured cell reader, and
 * the one deliberate exception has to name itself per key
 * ({@link RelationalMetaEntry.copiedWithoutCellReader}).
 *
 * ⇒ Putting any of the three retired keys back now turns the gate red on a
 * DERIVED assertion. The named-key pin in
 * `__tests__/relationalMetaCopySet.derivation.test.ts` and the rendering test
 * `__tests__/relationalMetaCopySet-7166.test.tsx` are kept so a regression is
 * reported by name — they are no longer the only hold.
 *
 * ## ⭐ Why a key can be READ and still not be worth copying
 *
 * `@objectstack/spec` 17.2.0's `FieldSchema` is a **strict** object of 71
 * properties. A key it does not declare parses to `unrecognized_keys` — the
 * same code a nonsense key gets — so `PUT /api/v1/meta/object/:name` refuses
 * it and no spec-compliant producer can put it on a field def. Measured on the
 * installed package, with `name` / `type` / `label` as the positive control.
 *
 * Nothing manufactures one on the way in, either. `getObjectSchema` in
 * `@object-ui/data-objectstack` is the choke point every schema read passes
 * through, and its only key rewrite is `normalizeSchemaReferenceKeys` (a
 * legacy `reference_to` / `referenceTo` folded onto `reference`). Whatever the
 * server serves for every
 * other property arrives verbatim.
 *
 * ⇒ Copying a key that is not spec-declared writes a member from the def on
 * every column build that no producer can ever fill.
 * That is precisely what objectui#6711 (`reference_to_field`), objectui#6625
 * (`decimals`) and objectui#6597 (`referenceTo`) retired, and what
 * objectui#6531 removed from `getRecordDisplayName` on the same reasoning. So
 * `reference_field` and `lookup_columns` — two of the five keys objectui#6875
 * named — are deliberately NOT copied, and the gate proves their absence from
 * `FieldSchema` rather than taking this docblock's word for it.
 *
 * ## ⭐ The asymmetry this file used to record — RESOLVED by objectui#7155
 *
 * Four keys in the copy set — `display_field`, `description_field`,
 * `lookup_filters`, `id_field` — failed that same producer test and were kept
 * as `legacy-alias`, because retiring a shipped key is its own adjudication
 * (objectui#6711 and objectui#6874 each were one).
 *
 * That adjudication happened: the maintainer ruled to converge the two
 * contracts rather than to sweep the reader. `display_field`,
 * `description_field` and `lookup_filters` are gone in favour of the spec
 * spellings they shadowed; `idField` stayed under a new verdict, because
 * objectstack#3508's machine-name hydration is a picker capability with no
 * object-metadata twin and none owed. The `legacy-alias` verdict itself is
 * retired — the class is empty and unrepresentable, and the gate below proves
 * the four spellings reach no consumer rather than trusting this paragraph.
 *
 * ## ⛔ Two keys were in this list and are RETIRED — do not re-add them
 *
 * Both were measured out under the same rule this file now enforces
 * mechanically: a key belongs here only when a consumer on THIS grid's render
 * path reads it off a FIELD meta. Under the derivation they can no longer be
 * re-added by hand at all — neither appears in the read set the gate extracts,
 * so adding either to the table below turns the gate red as an "extra".
 *
 * ### `reference_to_field` — objectui#6711
 *
 * Swept across `packages/` and `apps/` (and again across the producer repo),
 * the only occurrences of the identifier anywhere were the array literal — the
 * write — and prose recording that nothing reads it. No member access, no
 * destructuring, no bracket read. `FieldSchema` does not declare it either, so
 * nothing authorable produces it.
 *
 * ### `titleFormat` — objectui#6874
 *
 * A zero of a different kind, and a stronger one. `titleFormat` is a real, live
 * key with plenty of readers — it simply has no FIELD-meta reader. The sweep
 * found every member read of the identifier across `packages/` and `apps/`
 * (tests included) and classified each by receiver: `objectDef` /
 * `objectSchema` (`core/utils/record-title.ts`, `containers.tsx`,
 * `plugin-detail/DetailView.tsx`, `ObjectKanban.tsx`, `ObjectCalendar.tsx`,
 * `react/hooks/useRecordSearch.ts`) — OBJECT schema, every one;
 * `refObjectSchema?.titleFormat` in `LookupField.tsx` — the REFERENCED object's
 * schema, fetched by `getSchema(referenceTo)`, and the one that matters here;
 * `param.titleFormat` in `app-shell/utils/paramToField.ts`, off a resolved
 * `ActionParamDef`. ⇒ copying the target (`reference_to` then, `reference`
 * since objectui#11070 round 4) is what makes `titleFormat` work on this path;
 * copying `titleFormat` onto the meta reached nothing.
 * `plugin-dashboard/src/recordFields.tsx` recorded the same measurement first.
 *
 * Both absences stay pinned behaviourally at all three of `generateColumns`'s
 * call sites — `__tests__/relationalMetaCopySet-6711.test.tsx` and
 * `__tests__/relationalMetaCopySet-6874.test.tsx`.
 *
 * ⚠️ Every sweep quoted above bounds these two repos. A host application
 * outside them could still be reading any of these keys off `fieldMeta`; the
 * repo's own contract is what these verdicts are about.
 */

/**
 * What the grid does with a key its consumers read off the field meta.
 *
 * ⚠️ This enum records the PRODUCER axis — who can put the key on a field def
 * — plus one mechanism verdict. It deliberately does NOT record the READER
 * axis; that lives on {@link RelationalMetaEntry.readers}, measured per
 * consumer. objectui#7187 removed a `deferred` member that meant "read only by
 * an editor widget", because a hand-written verdict restating a measurable fact
 * is exactly the shape this table's own history warns about: read-set
 * membership was taken for a licence to copy (objectui#6875) and had to be
 * undone (objectui#7166). Those seven keys are `spec` now — which is what they
 * are — and they stay off the copy set because no consumer fed this bag reads
 * them, which is measured rather than declared.
 */
export type RelationalMetaVerdict =
  /** Spec-declared on `FieldSchema`. The spelling a live `getObjectSchema` serves. */
  | 'spec'
  // ⭐ `adapter-stamped` — "not spec-declared, but stamped onto every def by
  // the adapter's choke point" — left this union with its one member,
  // `reference_to` (objectui#11070 round 4): the choke point no longer stamps
  // it and no consumer reads it, so the verdict names nothing.
  /**
   * Picker configuration declared on `@object-ui/types`' form entry
   * (`FormField`) and emitted by in-repo producers, with no twin on
   * `FieldSchema` — and none needed. objectui#7155 created this category when
   * it converged the two dialects: `idField` carries objectstack#3508's
   * machine-name hydration, which is a picker capability and not an
   * object-metadata one. It was declared on the field metadata types
   * (`LookupFieldMetadata`) until objectui#12242 moved it off that authoring
   * face; the verdict is unchanged.
   */
  | 'widget-contract'
  /** Read, but no producer can emit it — copying it would reach nothing. */
  | 'no-producer'
  /** Producible and read, but written onto the meta by another block already. */
  | 'handled-elsewhere';

/**
 * The three consumers the gate sweeps, as this table names them.
 *
 * `cell` is `LookupCellRenderer` in `@object-ui/fields/src/index.tsx`, reached
 * through `<CellRenderer field={fieldMeta}>`. `lookup-editor` and `user-editor`
 * are the inline-edit widgets in `@object-ui/fields/src/widgets/`, which
 * `ObjectGrid.renderCellEditor` feeds from the object schema instead.
 */
export type RelationalMetaConsumer = 'cell' | 'lookup-editor' | 'user-editor';

/**
 * ⭐ THE ASYMMETRY THIS WHOLE TABLE TURNS ON, as data rather than as prose.
 *
 * `applyRelationalMeta` writes onto the `fieldMeta` that `generateColumns`
 * hands to `<CellRenderer>`, and nowhere else. The two editor widgets are fed
 * `{ name: ctx.column.accessorKey, ...fieldDef }` straight off the object
 * schema (`ObjectGrid.renderCellEditor`), so a key only they read gains nothing
 * from being copied here. The gate asserts that bound against
 * `ObjectGrid.tsx`'s own source rather than trusting this comment.
 */
export const CONSUMERS_FED_THIS_BAG: readonly RelationalMetaConsumer[] = Object.freeze([
  'cell',
]);

/**
 * The four reader shapes the sweep actually finds. Naming them keeps the table
 * scannable; the gate checks every entry's list against the consumer sources in
 * both directions, so an alias can no more drift than a literal could.
 */
const ALL_THREE: readonly RelationalMetaConsumer[] = Object.freeze(['cell', 'lookup-editor', 'user-editor']);
const CELL_AND_LOOKUP_EDITOR: readonly RelationalMetaConsumer[] = Object.freeze(['cell', 'lookup-editor']);
const BOTH_EDITORS: readonly RelationalMetaConsumer[] = Object.freeze(['lookup-editor', 'user-editor']);
const LOOKUP_EDITOR_ONLY: readonly RelationalMetaConsumer[] = Object.freeze(['lookup-editor']);

/**
 * Verdicts under which a key MAY be copied — the producer half of the licence.
 *
 * ⚠️ Necessary, never sufficient: a key is copied only if a consumer that is
 * actually handed this bag reads it, or it names a reason not to need one. See
 * {@link RELATIONAL_META_KEYS}.
 */
const PRODUCER_LICENSED_VERDICTS: ReadonlySet<RelationalMetaVerdict> = new Set([
  'spec',
  'widget-contract',
]);

export interface RelationalMetaEntry {
  readonly verdict: RelationalMetaVerdict;
  /**
   * Which consumers read this key off a field meta. MEASURED — the gate
   * re-extracts each consumer's set from its own source and requires this list
   * to match, per consumer and in both directions.
   */
  readonly readers: readonly RelationalMetaConsumer[];
  /**
   * Present ONLY on a key copied although NO consumer fed this bag reads it —
   * the one exit from the cell-reader rule, and it has to state its own reason.
   *
   * ⛔ NO entry takes this exit any more. It existed for the `legacy-alias`
   * class — the snake_case spellings kept on a producer-side argument — and
   * objectui#7155 retired that class by converging the contracts. The field is
   * kept, and the gate asserts it is UNUSED, so re-opening the exit is a
   * deliberate act with a stated reason rather than a quiet re-entry.
   */
  readonly copiedWithoutCellReader?: string;
  readonly note: string;
}

/**
 * Every key the three consumers read off this bag, each with a verdict.
 *
 * ⛔ Do not add a key here to "restore symmetry" with the field def, and do not
 * remove one because it looks unused — the gate reads the consumer sources, and
 * this table has to match what it finds, exactly and in both directions.
 */
export const RELATIONAL_META_READ_SET: Readonly<Record<string, RelationalMetaEntry>> = {
  // ── The relational target ────────────────────────────────────────────────
  reference: { verdict: 'spec', readers: ALL_THREE, note: "FieldSchema.reference — the served spelling for a lookup's target object, and since objectui#11070 round 4 the only one any consumer reads." },
  // ⭐ objectui#11070 round 4 removed the `reference_to` row. It is not a
  // verdict change: the key left this table because the three consumers
  // stopped reading it and the choke point stopped stamping it, and a row here
  // states that a swept consumer reads the key.
  reference_field: { verdict: 'no-producer', readers: ALL_THREE, note: 'Third leg of the display-field chain. Not on FieldSchema; zero occurrences in the producer repo (control: `displayField`, 68 files). objectui#6875.' },

  // ── The display value ───────────────────────────────────────────────────
  displayField: { verdict: 'spec', readers: ALL_THREE, note: 'FieldSchema.displayField. ⭐ Added by objectui#6875 as the only display spelling a spec-compliant producer can emit; objectui#7155 made it the ONLY one read, retiring the `display_field` leg that used to outrank it.' },

  // ── The picker's secondary line ─────────────────────────────────────────
  // objectui#7166 took the camel spelling off the COPY SET (no reader on this
  // bag) while its snake twin stayed on the producer-side argument.
  // objectui#7155 settled that argument the other way — see this file's
  // docblock — so only the spec spelling remains, still uncopied.
  descriptionField: { verdict: 'spec', readers: LOOKUP_EDITOR_ONLY, note: "FieldSchema.descriptionField. Added by objectui#6875, RETIRED from the copy set by objectui#7166: its only reader is LookupField, which the inline editor feeds from the schema def, so the copy reached nothing. Measured by rendering — the picker's secondary line still appears with this table unchanged." },

  // ── The picker's table ──────────────────────────────────────────────────
  lookupColumns: { verdict: 'spec', readers: LOOKUP_EDITOR_ONLY, note: "FieldSchema.lookupColumns. Added by objectui#6875, RETIRED from the copy set by objectui#7166 on the same measurement as `descriptionField`. Measured by rendering — the declared columns still shape the picker with this table unchanged." },
  // ⭐ objectui#12157 removed the `lookup_columns` row here, and the
  // `allow_create` / `lookup_page_size` rows of the no-producer group below.
  // It is not a verdict change: `LookupField` reads the declared spellings
  // alone now, and a row states that a swept consumer reads the key (the
  // derivation test's orphan check fails on one that does not).

  // ── The picker's base scoping ───────────────────────────────────────────
  lookupFilters: { verdict: 'spec', readers: BOTH_EDITORS, note: "FieldSchema.lookupFilters. RETIRED from the copy set by objectui#7166: read off a field meta only by LookupField and UserField, both fed by the editor's schema spread. Measured by rendering — the declared filter still scopes the picker's candidates with this table unchanged." },

  // ── The picker's id column ──────────────────────────────────────────────
  // ⭐ The one key with NO spec twin, and none owed: `idField` commits a record
  // field other than the id as a lookup's stored VALUE (objectstack#3508's
  // machine-name hydration), which is picker behaviour, not object metadata.
  // objectui#7155 kept the capability and moved it onto the widget contract.
  idField: { verdict: 'widget-contract', readers: LOOKUP_EDITOR_ONLY, note: "FormField.idField — the picker's id column (on LookupFieldMetadata until objectui#12242). Absent from FieldSchema, and `id_field` was too: this is a widget-contract key by construction, not a spelling gap. Read only by LookupField, which the inline editor feeds from the schema def, so it stays off the copy set (objectui#7166's measurement, unchanged by the rename)." },

  // ── Read by the EDITOR widgets, producible, and NOT copied ──────────────
  // Found by objectui#6875's re-sweep. objectui#7154 measured WHY copying them
  // would reach nothing: their only reader is `LookupField`, which the grid's
  // inline editor feeds from the schema def directly (see this file's
  // docblock). All four already take effect in the picker with this table
  // unchanged — pinned in `__tests__/lookupPickerKeys-7154.test.tsx`.
  // ⭐ objectui#7187: they carried a `deferred` verdict until that fact became
  // measurable. `readers` states it now, the gate checks it against the widget
  // sources, and the copy set follows from it — so `spec` is free to mean what
  // it says (the producer can emit this), and the exclusion is no longer a word.
  multiple: { verdict: 'spec', readers: LOOKUP_EDITOR_ONLY, note: 'FieldSchema.multiple — picker cardinality. Read only by LookupField, which the grid feeds from the schema def, not from this bag: measured accumulating two picks in the inline picker with this table unchanged (objectui#7154).' },
  allowCreate: { verdict: 'spec', readers: LOOKUP_EDITOR_ONLY, note: 'FieldSchema.allowCreate — picker quick-create affordance. Same route as `multiple`: `allowCreate: false` measured removing the create entry the control column offers (objectui#7154).' },
  lookupPageSize: { verdict: 'spec', readers: LOOKUP_EDITOR_ONLY, note: 'FieldSchema.lookupPageSize — picker page size. Same route: a declared 3 measured scoping the picker dialog to 3 rows against a control of 10 (objectui#7154).' },
  // ⚠️ This note used to end "The grid supplies no dependent values, so that
  // gate is permanent". That was true when objectui#7154 measured it and is not
  // true now — objectui#7165 (finished by objectui#7188) gave `renderCellEditor`
  // the dependent record. Per AGENTS.md #5 §9 the corrected note points at the
  // instrument that re-derives the claim instead of restating its answer.
  dependsOn: { verdict: 'spec', readers: LOOKUP_EDITOR_ONLY, note: 'FieldSchema.dependsOn — cascading picker filter. Same route, and it ARRIVES: the declared column renders the trigger, gated while a named parent is empty. Whether that gate can LIFT here is re-derived by `__tests__/gridDependentValues-7165.test.tsx`, not asserted in this sentence — the grid’s inline editor has supplied the dependent record since objectui#7165/#7188, closing objectui#2215’s grid-side residue (objectui#7154). The bulk action dialog’s half of that residue is objectui#8755.' },

  // ── Read on this path, no producer ──────────────────────────────────────
  // ⭐ objectui#7357 removed the `depends_on` row. It is NOT a verdict change:
  // the key left this table because `LookupField` stopped reading it — the
  // snake_case twin was retired under ADR-0049 enforce-or-remove — and a row
  // here states that a swept consumer reads the key. Keeping it would have made
  // the derivation test's own orphan check the thing that failed, and widening
  // the extractor to keep it alive would have asserted a read that is gone.
  picker: { verdict: 'no-producer', readers: BOTH_EDITORS, note: 'PeoplePicker variant opt-in. Not on FieldSchema.' },
  subtitle: { verdict: 'no-producer', readers: BOTH_EDITORS, note: 'PeoplePicker subtitle fields. Not on FieldSchema.' },
  avatarField: { verdict: 'no-producer', readers: BOTH_EDITORS, note: 'PeoplePicker avatar field. Not on FieldSchema.' },
  avatar_field: { verdict: 'no-producer', readers: BOTH_EDITORS, note: 'Runtime twin of `avatarField`. Not on FieldSchema.' },

  // ── Written by another block of the same column build ───────────────────
  options: { verdict: 'handled-elsewhere', readers: CELL_AND_LOOKUP_EDITOR, note: 'Written by generateColumns as `translateOptions(...)`, which localises the labels; a raw copy would undo that.' },
  dataSource: { verdict: 'handled-elsewhere', readers: LOOKUP_EDITOR_ONLY, note: 'Not a schema key — LookupField reads its own `props.dataSource` fallback off the meta bag.' },
};

/** Does a consumer that is actually handed this bag read this key? */
function readByAFedConsumer(entry: RelationalMetaEntry): boolean {
  return entry.readers.some((consumer) => CONSUMERS_FED_THIS_BAG.includes(consumer));
}

/**
 * The copy set, DERIVED from {@link RELATIONAL_META_READ_SET} on TWO conditions
 * — objectui#7187.
 *
 * 1. the PRODUCER half: the verdict licenses a copy at all, and
 * 2. the READER half: a consumer fed this bag reads the key — or the entry
 *    names why it is copied without one.
 *
 * ⭐ (2) is the condition objectui#6875's mechanism did not have, and its
 * absence is what let two keys onto this table whose only reader is an editor
 * widget the bag never reaches. It is checked against the consumer sources, so
 * no verdict edit can manufacture it.
 *
 * Order is the table's, which groups a chain's spellings together — it does not
 * matter to `applyRelationalMeta` (each key is written independently), but it
 * keeps a diff of this file readable.
 */
export const RELATIONAL_META_KEYS: readonly string[] = Object.freeze(
  Object.entries(RELATIONAL_META_READ_SET)
    .filter(([, entry]) => PRODUCER_LICENSED_VERDICTS.has(entry.verdict)
      && (readByAFedConsumer(entry) || entry.copiedWithoutCellReader !== undefined))
    .map(([key]) => key),
);

/**
 * Copy the relational metadata a lookup / master_detail / user cell needs off
 * the object-schema field definition onto a column's built `fieldMeta`.
 *
 * A key is written only when the def actually carries it, so a non-relational
 * field's meta gains no keys at all and an absent key never lands as an
 * explicit `undefined` — the semantics `plugin-dashboard`'s sibling
 * `pickCellRelationalMeta` copies.
 */
export function applyRelationalMeta(
  fieldMeta: Record<string, any>,
  fieldDef: Record<string, any> | undefined | null,
): void {
  if (!fieldDef) return;
  for (const key of RELATIONAL_META_KEYS) {
    if (fieldDef[key] !== undefined) fieldMeta[key] = fieldDef[key];
  }
}
