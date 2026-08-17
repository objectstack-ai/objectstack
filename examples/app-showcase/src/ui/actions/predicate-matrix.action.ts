// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **Action-gating matrix** — the live specimen for the two things that decide
 * whether a button is offered: `visible` (a CEL predicate over the record) and
 * `requiredPermissions` (the ADR-0066 D4 capability gate).
 *
 * Everything here hangs off `showcase_field_zoo`, the "one specimen of
 * everything" object, and off its two seeded records — **Specimen — Full**
 * (every field populated) and **Specimen — Minimal** (most fields `null`).
 * Those two records are what make each gate falsifiable in a browser: an
 * action gated on a populated field must appear on Full and vanish on Minimal,
 * and a mistake shows up as a button in the wrong place rather than as a
 * passing test.
 *
 * ## What this exists to catch
 *
 * A gate is evaluated by FOUR different surfaces, each of which filters its own
 * action list:
 *
 * | surface | where it renders |
 * |---|---|
 * | list toolbar | above the list — no record in scope |
 * | row kebab (`list_item`) | the `⋮` menu on each row |
 * | record header (`record_header` / `record_more`) | the detail page |
 * | selection bar | after ticking rows, from the view's `bulkActions` |
 *
 * They have drifted before, in both directions: the selection bar ignored
 * `requiredPermissions` entirely, so an action the row kebab hid from an
 * unentitled user reappeared the moment they ticked a checkbox
 * (objectui#3492); and a relation field bound as the expanded RECORD on one
 * surface and as its foreign KEY on another, so the same `record.<lookup> ==
 * <id>` was true on one and false on the next (objectui#3501). Both are
 * invisible to a unit test of any single surface. Declaring one action across
 * all four is what makes a disagreement visible.
 *
 * ## Authoring rules these specimens encode
 *
 * Measured against this runtime's CEL engine, not assumed:
 *
 *  - **Prefix with `record.`** A bare `f_boolean` is an undeclared variable on
 *    the record-header path and throws (fail-closed hide).
 *  - **Guard with `has(record.x) && record.x != null` before you traverse,
 *    call, order or subtract.** TWO failure modes are live on this face, and
 *    each half of that conjunction covers exactly one. `record.f_json.nested.k`
 *    and `record.f_tags.size()` FAULT where the field is `null` (`null` has no
 *    members and no methods) — the `!= null` half. And `record.f_json` FAULTS
 *    outright with `No such key` on a LIST ROW that never projected the column
 *    — the `has()` half — because this face binds whatever record the client
 *    already fetched and stays sparse by decision (#4953 clause 2). Neither
 *    half alone is a guard; both faults are fail-closed, so the button just
 *    silently is not there.
 *
 *    ⛔ Do not restate the rule here. The CANONICAL statement, with the
 *    measured three-binding table, lives in `materializeDeclaredFields`'s doc
 *    comment (`packages/objectql/src/declared-fields.ts`) — this file used to
 *    carry a second, differently worded version of it that said the opposite
 *    ("`record.f_json != null && …` is the portable form"), which is #8975.
 *
 *    This file is where both halves are falsifiable in a browser: the Minimal
 *    specimen exercises the NULL half, and the default list's `$select`
 *    projection — whose columns are `name` / `f_select` / `f_number` /
 *    `f_boolean` / `f_rating`, so every OTHER gated field is absent — exercises
 *    the ABSENT half on the very same records.
 *
 *    Every specimen below carries the guard as of #8990. What that changed is
 *    the FAULT, not the verdict: measured against the running app's own
 *    payloads, 40 of these 53 predicates aborted with `No such key` on a
 *    default-list row before the migration and 0 do after, while every verdict
 *    on a record-DETAIL binding (where the read projects all declared columns)
 *    is unchanged. So the Full-vs-Minimal contrast this fixture exists to show
 *    is exactly as it was, and the list surface now answers `false` where it
 *    used to silently drop the button.
 *
 *    ⚠️ That makes the guard itself the thing under test here: delete a `has()`
 *    and the action vanishes from the row kebab and the selection bar while
 *    staying correct on the detail page. That asymmetry IS the specimen —
 *    it is what no unit test of a single surface can see.
 *
 *    The MINIMAL form is per predicate, not a blanket: `has()` alone where the
 *    read is only compared by `==` / `!=` (CEL compares heterogeneously and
 *    answers `false` rather than faulting), the full conjunction only where an
 *    operand can fault — traversal, method call, ordering, arithmetic, `in`,
 *    or a bare `!`. Over-guarding is not the safe default; it is the pattern
 *    the next author copies.
 *  - **`contains()` / `matches()`, never `startsWith()` / `endsWith()`.** The
 *    latter two are not CEL — objectui routes them to its legacy JS evaluator
 *    with a deprecation warning, and the SERVER's engine has no answer for
 *    them at all, so a predicate using one silently stops being portable.
 *  - **A relation field is its FOREIGN KEY**, on every surface and on the
 *    server: `record.f_lookup == "<id>"`, never `record.f_lookup.id`.
 *  - **The RECORD HEADER does not speak CEL** (objectui#3521). It evaluates
 *    header-action predicates on objectui's legacy JS evaluator, so `.size()`,
 *    `.contains()`, `.matches()`, the `in` operator and stdlib calls like
 *    `today()` all THROW there and fail-closed hide the action, while the same
 *    predicate is correct in the row kebab and the selection bar. Every gate
 *    below that uses one of those is therefore absent from the `⋯` menu today
 *    and present in the list — see `ZooDialectSplitAction` for the one-screen
 *    comparison. Predicates built only from `==` / `!=` / `<` / `&&` / `||` /
 *    `!` agree on both.
 *
 * ## `visible` has three authoring forms, one meaning
 *
 * `ActionSchema.visible` is `ExpressionInput` — a bare CEL **string**, the
 * explicit **`{ dialect, source }` envelope**, or the **`P` tagged template**.
 * All three parse to the identical envelope, which is exactly why they are
 * worth pinning side by side: if the three specimens below ever disagree on
 * one record, a renderer is treating one form differently from the others.
 *
 * Note the form that is NOT here: a **boolean** `visible`. `ExpressionInput`
 * does not admit one, so `objectstack build` cannot emit it and no authored
 * app can reach that path — it is reachable only from hand-written view JSON
 * and in-process callers, and it is pinned by objectui's own unit tests
 * (objectui#3492) rather than faked here.
 */

import { defineAction, P } from '@objectstack/spec';

const zoo = 'showcase_field_zoo';

/**
 * Every specimen shares one inert body: the value of these actions is WHERE
 * they appear, never what they do, so clicking one must be safe to do
 * repeatedly on a demo record. It echoes the record it was invoked on so the
 * result dialog confirms the dispatch actually happened.
 */
const echo = {
  language: 'js' as const,
  source:
    "var id = ctx.recordId || (ctx.record && ctx.record.id) || input.recordId || null;"
    + "return { ok: true, record: id, selected: (input && input._selectedIds) || null };",
  capabilities: [],
};

/** The four record-scoped surfaces, so one action can be compared across them. */
const RECORD_SURFACES = ['list_item', 'record_header', 'record_more'] as const;

// ───────────────────────────────────────────────────────────────────────────
// 1 — Surface parity: ONE predicate over a relation field, on every surface
// ───────────────────────────────────────────────────────────────────────────

/**
 * **Relation == relation** — the sharpest specimen in this file, because both
 * operands are lookups and neither is a literal.
 *
 * `f_lookup` and `f_lookups[0]` hold the SAME account id on Specimen — Full.
 * The predicate is therefore true there and false on Minimal (both null) — but
 * only if both sides are bound as the stored foreign KEY. Expand either one and
 * the comparison is an object against a string, which is a clean, silent
 * `false`, on the record the author wrote it for.
 *
 * That asymmetry is not hypothetical: a view expands the relations it shows as
 * COLUMNS, so `gated_columns` (which shows `f_lookup` and not `f_lookups`)
 * expands exactly one side of this comparison while the default list expands
 * neither. Same records, same predicate, and before objectui#3501 two different
 * answers. Declared on all three record surfaces and named in both views'
 * `bulkActions`, so a disagreement shows up as a button in one place and not
 * another.
 *
 * Neither field is a column on the default list, which also puts the `$select`
 * projection under test: a list asks the server only for what it DISPLAYS, and
 * CEL treats an absent key as a FAULT rather than as null.
 */
export const ZooRelationGateAction = defineAction({
  name: 'showcase_zoo_relation_gate',
  label: 'Lookup == first of multi',
  icon: 'link',
  objectName: zoo,
  type: 'script',
  body: echo,
  successMessage: 'Both relations resolved to the same id.',
  visible:
    'has(record.f_lookup) && has(record.f_lookups) && record.f_lookups != null'
    + ' && record.f_lookups.size() > 0 && record.f_lookup == record.f_lookups[0]',
  locations: [...RECORD_SURFACES],
  refreshAfter: false,
});

/**
 * **The ownership gate every app writes first**, over the platform-injected
 * `owner_id` column. Both specimens are owned by the seeding user, so the
 * honest reading is: this appears on all four surfaces for whoever seeded the
 * workspace, and on none of them for anyone else.
 *
 * `owner_id` is injected by `applySystemFields` and is NOT among the object's
 * declared fields, which is what makes it worth a specimen of its own on two
 * counts. Author-time: it was rejected as `unknown field owner_id` until #5378
 * taught the linter to derive the injected set (`packages/spec/src/data/
 * injected-system-columns.ts`) — this predicate is the live proof that landed.
 * Run time: a list's `$select` is built from the object's declared fields, so
 * a consumer harvesting the fields a predicate reads has to know the platform
 * columns too, or drop this one as a typo and leave the predicate faulting on
 * an absent key (objectui#3501's `PLATFORM_RECORD_COLUMNS`).
 */
export const ZooOwnerGateAction = defineAction({
  name: 'showcase_zoo_owner_gate',
  label: 'Mine (owner_id)',
  icon: 'user-check',
  objectName: zoo,
  type: 'script',
  body: echo,
  successMessage: 'You own this specimen.',
  visible: 'has(record.owner_id) && record.owner_id == os.user.id',
  locations: [...RECORD_SURFACES],
  refreshAfter: false,
});

/**
 * The same idea over a DECLARED `user` relation. `f_user` is unseeded by design
 * — `sys_user` rows come from sign-up, not seeds (see the note on
 * field-zoo.object.ts) — so this is HIDDEN on both specimens out of the box and
 * becomes visible on whichever record you assign to yourself in the UI. That
 * makes it the manual half of the matrix, and the pair with `owner_id` above is
 * the point: an injected column and a declared field must gate identically.
 */
export const ZooUserIdentityGateAction = defineAction({
  name: 'showcase_zoo_user_gate',
  label: 'Assigned to me (user field)',
  icon: 'user-check',
  objectName: zoo,
  type: 'script',
  body: echo,
  successMessage: 'You are the assigned user on this specimen.',
  visible: 'has(record.f_user) && record.f_user == os.user.id',
  locations: [...RECORD_SURFACES],
  refreshAfter: false,
});

/**
 * **The dialect split.** One action, one predicate, two surfaces — and, as of
 * this writing, two different answers.
 *
 * `.contains()` is ordinary CEL and evaluates correctly wherever the canonical
 * engine runs: the row `⋮` menu, the selection bar, conditional formatting. The
 * RECORD HEADER does not run that engine — it evaluates header-action
 * predicates on objectui's legacy JS evaluator — so the same predicate throws
 * there (`.contains` is not a JS string method) and the action is fail-closed
 * hidden. Measured, not assumed: the browser console carries
 * `[page:header] action "…" hidden: its predicate threw`.
 *
 * The same split hides every CEL-only construct on that one surface —
 * `.size()`, `.matches()`, the `in` operator, and stdlib calls like `today()`
 * (`"today" is not a function`). Filed as objectui#3521; kept here as a LIVE
 * fixture rather than papered over, because "works in the list, silently gone
 * on the detail page" is invisible to any test that exercises one surface.
 *
 * Compare it against `ZooVisibleStringAction` above, whose predicate uses only
 * operators BOTH dialects share and therefore agrees on every surface. When
 * #3521 lands, this action should appear in the header too — that is the test.
 */
export const ZooDialectSplitAction = defineAction({
  name: 'showcase_zoo_dialect_split',
  label: 'CEL-only: contains()',
  icon: 'search',
  objectName: zoo,
  type: 'script',
  body: echo,
  visible: 'has(record.f_textarea) && record.f_textarea != null && record.f_textarea.contains("Line two")',
  locations: [...RECORD_SURFACES],
  refreshAfter: false,
});

/**
 * The toolbar twin. A `list_toolbar` action is evaluated with NO record in
 * scope — there is no row it belongs to — so a record-scoped predicate here
 * would be an authoring error, not a demo. This one gates on identity alone,
 * which is the only kind of predicate the toolbar can honestly answer.
 */
export const ZooToolbarGateAction = defineAction({
  name: 'showcase_zoo_toolbar_gate',
  label: 'Signed-in only (toolbar)',
  icon: 'shield-check',
  objectName: zoo,
  type: 'script',
  body: echo,
  successMessage: 'Toolbar gate passed.',
  visible: 'os.user.id != null',
  locations: ['list_toolbar'],
  refreshAfter: false,
});

// ───────────────────────────────────────────────────────────────────────────
// 2 — The three `visible` authoring forms, one meaning
// ───────────────────────────────────────────────────────────────────────────

/** Form 1 — a bare CEL **string**. Normalized to the envelope at build time. */
export const ZooVisibleStringAction = defineAction({
  name: 'showcase_zoo_visible_string',
  label: 'visible: string',
  icon: 'quote',
  objectName: zoo,
  type: 'script',
  body: echo,
  visible: 'has(record.f_boolean) && record.f_boolean == true',
  locations: [...RECORD_SURFACES],
  refreshAfter: false,
});

/** Form 2 — the `P` tagged template (the `cel` alias for predicates). */
export const ZooVisibleTaggedAction = defineAction({
  name: 'showcase_zoo_visible_tagged',
  label: 'visible: P`…`',
  icon: 'code',
  objectName: zoo,
  type: 'script',
  body: echo,
  visible: P`has(record.f_boolean) && record.f_boolean == true`,
  locations: [...RECORD_SURFACES],
  refreshAfter: false,
});

/** Form 3 — the explicit `{ dialect, source }` envelope. */
export const ZooVisibleEnvelopeAction = defineAction({
  name: 'showcase_zoo_visible_envelope',
  label: 'visible: { dialect, source }',
  icon: 'braces',
  objectName: zoo,
  type: 'script',
  body: echo,
  visible: { dialect: 'cel', source: 'has(record.f_boolean) && record.f_boolean == true' },
  locations: [...RECORD_SURFACES],
  refreshAfter: false,
});

/**
 * The `disabled` counterpart, for the same reason `visible` has three forms:
 * where `visible` HIDES, `disabled` keeps the button on screen and greys it.
 * Same scope, same dialect, same null rules — greyed on Minimal, live on Full.
 */
export const ZooDisabledAction = defineAction({
  name: 'showcase_zoo_disabled_gate',
  label: 'Disabled unless rated',
  icon: 'star',
  objectName: zoo,
  type: 'script',
  body: echo,
  disabled: 'has(record.f_rating) && record.f_rating != null && record.f_rating < 4',
  locations: ['record_header', 'record_section'],
  refreshAfter: false,
});

// ───────────────────────────────────────────────────────────────────────────
// 3 — `requiredPermissions` (ADR-0066 D4), on all four surfaces
// ───────────────────────────────────────────────────────────────────────────

/**
 * Requires a capability the Operations set GRANTS (`showcase.export_data`, see
 * security/capabilities.ts). Visible to a caller holding it, hidden otherwise
 * — and identically on all four surfaces.
 */
export const ZooPermHeldAction = defineAction({
  name: 'showcase_zoo_perm_held',
  label: 'Needs export capability',
  icon: 'download',
  objectName: zoo,
  type: 'script',
  body: echo,
  requiredPermissions: ['showcase.export_data'],
  locations: [...RECORD_SURFACES],
  refreshAfter: false,
});

/**
 * Requires a capability this app DEFINES but grants to nobody
 * (`showcase.restricted_ops`). It should therefore be invisible to every
 * caller, on every surface — the falsifiable half of the gate, and the case
 * that used to leak: the selection bar never read `requiredPermissions` at all,
 * so this button reappeared the moment a row was ticked (objectui#3492).
 */
export const ZooPermMissingAction = defineAction({
  name: 'showcase_zoo_perm_missing',
  label: 'Needs restricted capability',
  icon: 'lock',
  objectName: zoo,
  type: 'script',
  body: echo,
  requiredPermissions: ['showcase.restricted_ops'],
  locations: [...RECORD_SURFACES],
  refreshAfter: false,
});

/**
 * Two capabilities — the gate is an AND, not an OR. A caller holding
 * `showcase.export_data` but not `showcase.restricted_ops` must NOT see this,
 * which is what distinguishes an AND gate from an OR one in the browser.
 */
export const ZooPermAndAction = defineAction({
  name: 'showcase_zoo_perm_and',
  label: 'Needs BOTH capabilities',
  icon: 'shield',
  objectName: zoo,
  type: 'script',
  body: echo,
  requiredPermissions: ['showcase.export_data', 'showcase.restricted_ops'],
  locations: [...RECORD_SURFACES],
  refreshAfter: false,
});

/**
 * An EMPTY declaration always passes — "declares nothing" is not "denies
 * everything". Kept as a specimen because the empty array is the shape most
 * likely to be mishandled by a gate written as `required.length ? … : …`
 * inverted.
 */
export const ZooPermEmptyAction = defineAction({
  name: 'showcase_zoo_perm_empty',
  label: 'requiredPermissions: []',
  icon: 'circle-check',
  objectName: zoo,
  type: 'script',
  body: echo,
  requiredPermissions: [],
  locations: [...RECORD_SURFACES],
  refreshAfter: false,
});

// ───────────────────────────────────────────────────────────────────────────
// 4 — The field-type predicate zoo
// ───────────────────────────────────────────────────────────────────────────

/**
 * One action per field-type family, each gated on THAT type, all parked in the
 * record `⋯` menu so the Field Zoo detail page shows the whole matrix at once.
 * On **Specimen — Full** every one of these should be offered; on **Specimen —
 * Minimal** only the ones whose field is populated there
 * (`f_number` / `f_select` / `f_radio` / `f_multiselect` / `f_checkboxes` /
 * `f_time` / `f_master_detail` / `f_percent` / `f_rating` / `f_autonumber`).
 *
 * Every predicate here is guarded — see the authoring rules at the top of this
 * file. That is not defensive padding: the unguarded form FAULTS, and a fault
 * is fail-closed on the row and selection surfaces and fail-OPEN on the lenient
 * ones, so the same typo shows the button to everybody on one surface and to
 * nobody on the next.
 *
 * ⚠️ "Nullable non-scalar" is NOT the line, and this block used to say it was.
 * Measured on the canonical engine, a SCALAR faults just as readily the moment
 * the operator is not an equality: `record.f_slider > 50` aborts with
 * `no such overload: dyn<null> > int` on a projected NULL, and `!(record.f_boolean)`
 * with `no such overload: !null`. What decides the guard is the OPERATOR, not
 * the field's type — which is why the numeric, `in`, `!` and ternary specimens
 * below carry the same `!= null` half as the structured ones.
 */
const zooTypeGate = (name: string, label: string, visible: string) =>
  defineAction({
    name: `showcase_zoo_t_${name}`,
    label,
    objectName: zoo,
    type: 'script',
    body: echo,
    visible,
    locations: ['record_more'],
    refreshAfter: false,
  });

export const ZooTypeGates = [
  // ── Relational: the id, never the expanded record ────────────────────────
  zooTypeGate('lookup', 'lookup — set', 'has(record.f_lookup) && record.f_lookup != null'),
  zooTypeGate('lookup_multi', 'lookup multiple — >1', 'has(record.f_lookups) && record.f_lookups != null && record.f_lookups.size() > 1'),
  zooTypeGate('master_detail', 'master_detail — set', 'has(record.f_master_detail) && record.f_master_detail != null'),
  zooTypeGate('tree', 'tree — unset', 'has(record.f_tree) && record.f_tree == null'),
  zooTypeGate('user', 'user — unset', 'has(record.f_user) && record.f_user == null'),
  zooTypeGate('user_identity', 'user — is me', 'has(record.f_user) && record.f_user == os.user.id'),
  zooTypeGate('owner', 'owner_id (injected) — mine', 'has(record.owner_id) && record.owner_id == os.user.id'),

  // ── Text family: contains() / matches(), never startsWith() ──────────────
  zooTypeGate('text', 'text — name non-empty', 'has(record.name) && record.name != null && record.name.size() > 0'),
  zooTypeGate('textarea', 'textarea — contains', 'has(record.f_textarea) && record.f_textarea != null && record.f_textarea.contains("Line two")'),
  zooTypeGate('email', 'email — matches', 'has(record.f_email) && record.f_email != null && record.f_email.matches(".*@example[.]com")'),
  zooTypeGate('url', 'url — contains', 'has(record.f_url) && record.f_url != null && record.f_url.contains("objectstack")'),
  zooTypeGate('phone', 'phone — contains', 'has(record.f_phone) && record.f_phone != null && record.f_phone.contains("555")'),
  zooTypeGate('markdown', 'markdown — contains', 'has(record.f_markdown) && record.f_markdown != null && record.f_markdown.contains("Heading")'),
  zooTypeGate('html', 'html — contains', 'has(record.f_html) && record.f_html != null && record.f_html.contains("bold")'),
  zooTypeGate('code', 'code — contains', 'has(record.f_code) && record.f_code != null && record.f_code.contains("ok")'),

  // ── Numeric ──────────────────────────────────────────────────────────────
  zooTypeGate('number', 'number — > 100', 'has(record.f_number) && record.f_number != null && record.f_number > 100'),
  zooTypeGate('currency', 'currency — > 1000', 'has(record.f_currency) && record.f_currency != null && record.f_currency > 1000.0'),
  zooTypeGate('percent', 'percent — >= 75', 'has(record.f_percent) && record.f_percent != null && record.f_percent >= 75'),
  zooTypeGate('rating', 'rating — >= 4', 'has(record.f_rating) && record.f_rating != null && record.f_rating >= 4'),
  zooTypeGate('slider', 'slider — > 50', 'has(record.f_slider) && record.f_slider != null && record.f_slider > 50'),
  zooTypeGate('progress', 'progress — >= 80', 'has(record.f_progress) && record.f_progress != null && record.f_progress >= 80'),
  zooTypeGate('formula', 'formula — > 100', 'has(record.f_formula) && record.f_formula != null && record.f_formula > 100.0'),
  zooTypeGate('autonumber', 'autonumber — is 0001', 'has(record.f_autonumber) && record.f_autonumber == "0001"'),

  // ── Temporal: `today()` is the CEL stdlib's, evaluated identically here ───
  zooTypeGate('date', 'date — before today', 'has(record.f_date) && record.f_date != null && record.f_date < today()'),
  zooTypeGate('datetime', 'datetime — set', 'has(record.f_datetime) && record.f_datetime != null'),
  zooTypeGate('time', 'time — is 14:30', 'has(record.f_time) && record.f_time == "14:30:00"'),

  // ── Boolean / choice ─────────────────────────────────────────────────────
  zooTypeGate('boolean', 'boolean — true', 'has(record.f_boolean) && record.f_boolean == true'),
  zooTypeGate('toggle', 'toggle — true', 'has(record.f_toggle) && record.f_toggle == true'),
  zooTypeGate('select', 'select — high', 'has(record.f_select) && record.f_select == "high"'),
  zooTypeGate('radio', 'radio — yes', 'has(record.f_radio) && record.f_radio == "yes"'),
  zooTypeGate('multiselect', 'multiselect — has red', 'has(record.f_multiselect) && record.f_multiselect != null && "red" in record.f_multiselect'),
  zooTypeGate('checkboxes', 'checkboxes — has email', 'has(record.f_checkboxes) && record.f_checkboxes != null && "email" in record.f_checkboxes'),
  zooTypeGate('tags', 'tags — any', 'has(record.f_tags) && record.f_tags != null && record.f_tags.size() > 0'),

  // ── Structured ───────────────────────────────────────────────────────────
  zooTypeGate('json', 'json — nested key', 'has(record.f_json) && has(record.f_json.nested) && has(record.f_json.nested.k) && record.f_json.nested.k == "v"'),
  zooTypeGate('location', 'location — lat > 40', 'has(record.f_location) && has(record.f_location.lat) && record.f_location.lat != null && record.f_location.lat > 40.0'),
  zooTypeGate('address', 'address — US', 'has(record.f_address) && has(record.f_address.country) && record.f_address.country == "US"'),
  zooTypeGate('color', 'color — is #2563EB', 'has(record.f_color) && record.f_color == "#2563EB"'),
  zooTypeGate('composite', 'composite — width 10', 'has(record.f_composite) && has(record.f_composite.width) && record.f_composite.width == 10'),
  zooTypeGate('repeater', 'repeater — 2 rows', 'has(record.f_repeater) && record.f_repeater != null && record.f_repeater.size() == 2'),
  zooTypeGate('record', 'record-of-records — score 9', 'has(record.f_record) && has(record.f_record.primary) && has(record.f_record.primary.score) && record.f_record.primary.score == 9'),
  zooTypeGate('vector', 'vector — 4 dims', 'has(record.f_vector) && record.f_vector != null && record.f_vector.size() == 4'),

  // ── Operators, not field types: the shapes a real predicate combines ─────
  zooTypeGate('and', 'AND — boolean && number', 'has(record.f_boolean) && record.f_boolean == true && has(record.f_number) && record.f_number != null && record.f_number > 100'),
  zooTypeGate('or', 'OR — select || rating', '(has(record.f_select) && record.f_select == "high") || (has(record.f_rating) && record.f_rating != null && record.f_rating >= 4)'),
  zooTypeGate('not', 'NOT — !boolean', 'has(record.f_boolean) && record.f_boolean != null && !(record.f_boolean)'),
  zooTypeGate('ternary', 'ternary — rating ? :', 'has(record.f_rating) && record.f_rating != null && (record.f_rating >= 4 ? true : false)'),
];

export const allPredicateMatrixActions = [
  ZooRelationGateAction,
  ZooOwnerGateAction,
  ZooUserIdentityGateAction,
  ZooDialectSplitAction,
  ZooToolbarGateAction,
  ZooVisibleStringAction,
  ZooVisibleTaggedAction,
  ZooVisibleEnvelopeAction,
  ZooDisabledAction,
  ZooPermHeldAction,
  ZooPermMissingAction,
  ZooPermAndAction,
  ZooPermEmptyAction,
  ...ZooTypeGates,
];
