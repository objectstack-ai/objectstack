// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { retiredKey } from '../shared/retired-key';
import { FieldType } from '../data/field.zod';
// #6970 — the authoring gate on `defaultValue` runs the SAME value contract the
// dispatcher runs at submit. Imported file-directly (never via a barrel):
// `field-value.zod` reaches only `shared/` + `data/`, and `action-params.zod`
// only `data/` + `api/` + `shared/`, so neither can close a cycle back to `ui/`.
import { MULTI_CAPABLE_TYPES, isMultiValueField, valueSchemaFor } from '../data/field-value.zod';
import { isActionParamValuePresent } from './action-params.zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { ExpressionInputSchema } from '../shared/expression.zod';
import { I18nLabelSchema, AriaPropsSchema } from './i18n.zod';
import { HookBodySchema } from '../data/hook-body.zod';
// Imported file-directly (not via the kernel barrel): the module is
// deliberately import-free, so this cannot introduce a cycle.
import { PUBLIC_AUTH_FEATURE_NAMES, lowerRequiresFeature } from '../kernel/public-auth-features';
import { strictUnknownKeyError } from '../shared/suggestions.zod';
import { strictObject } from '../shared/strict-object';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';

/**
 * Action Parameter Schema
 *
 * Defines inputs required before executing an action.
 *
 * Two declaration modes:
 *
 * 1. **Field-backed** (preferred) — reference an existing object field; the
 *    runtime resolves the field's label (i18n), type, validation rules,
 *    options, placeholder, help text, and widget mapping from object
 *    metadata. Cross-object references use `objectOverride`.
 *
 *    ```ts
 *    params: [
 *      { field: 'email' },                                 // same object
 *      { field: 'role', objectOverride: 'sys_member' },    // different object
 *    ]
 *    ```
 *
 * 2. **Inline** (legacy / bespoke) — declare `name`, `label`, `type` etc.
 *    inline when no matching object field exists. Inline values may also be
 *    used alongside `field` to override individual properties. A `lookup` /
 *    `master_detail` param declared this way MUST name its target object via
 *    `reference` — there is no field to inherit it from:
 *
 *    ```ts
 *    params: [
 *      { name: 'inspector', label: 'Inspector', type: 'lookup', reference: 'sys_user' },
 *    ]
 *    ```
 *
 * `name` is required unless `field` is provided (in which case it defaults
 * to the field name and is used as the request-body key).
 */
import { lazySchema } from '../shared/lazy-schema';

/**
 * Semantic near-misses — a different **word** for the same intent, usually
 * borrowed from a neighbouring schema where that word is correct. Edit distance
 * cannot reach these (`visibleWhen` → `visible` is 4 apart), so they are named
 * explicitly; plain case/underscore slips (`help_text` → `helpText`) are left to
 * the factory's edit-distance fallback. Mirrors the `FIELD_TYPE_ALIASES`
 * pattern in `shared/suggestions.zod.ts`.
 *
 * Keys are matched case-insensitively with separators removed (see
 * {@link strictUnknownKeyError}).
 */
const ACTION_PARAM_KEY_ALIASES: Readonly<Record<string, string>> = {
  // The objectql/runtime field shape spells a lookup target `reference_to`, and
  // objectui's resolved param calls it `referenceTo`. Dropping either is the
  // exact #3405 failure: a targetless picker degrades to a raw-UUID text box.
  referenceto: 'reference',
  referenceobject: 'reference',
  referencedobject: 'reference',
  targetobject: 'reference',
  // ADR-0089 made `visibleWhen` the canonical predicate on view/page schemas.
  // An author who learned it there would silently lose a param's capability
  // gate here — the param would render unconditionally.
  visiblewhen: 'visible',
  visibleon: 'visible',
  visibility: 'visible',
  description: 'helpText',
  help: 'helpText',
  default: 'defaultValue',
};

/**
 * Custom zod `error` for the `.strict()` {@link ActionParamSchema} (#3405 part 3).
 *
 * Before this, the schema was zod-default `.strip`: a key it does not declare was
 * **silently discarded**, and the param went on parsing. That is how a correctly
 * intended `reference: 'sys_user'` became a text box asking a human to paste a
 * UUID, with no error anywhere — the config was eaten and the UI lied about why
 * (ADR-0078 no-silently-inert-metadata, ADR-0049 enforce-or-remove).
 *
 * Built by {@link strictUnknownKeyError} — the shared factory this schema's
 * hand-rolled #3746 map was generalized into (#4001): it names the offending
 * key(s) and, when one is a recognisable spelling of a declared key, points at
 * the canonical one.
 */
/**
 * Guidance for `color` — declared one layer down on `SelectOptionSchema`
 * (`data/field.zod.ts`), and still not a key of THIS shape.
 *
 * `visibleWhen` shared this text until #5016. The two were separated on
 * measurement rather than on symmetry: both are declared on a FIELD's option
 * list, but only one of them has a consumer an ACTION PARAM's option list can
 * reach.
 *
 *  - `visibleWhen` is now declared below, because the reader is on this path.
 *    An inline param's `options` are lowered VERBATIM (objectui
 *    `resolveActionParam`'s inline branch → `paramToField` →
 *    `getLazyFieldWidget`), and every option widget narrows the offered set
 *    through `useCascadingOptions` → `resolveCascadingOptions`, which reads
 *    exactly this key (ADR-0058 / objectui#2284).
 *  - `color` has no reader here. It is consumed only where a STORED value is
 *    displayed — the grid cell / detail badge (`SelectCellRenderer`) and the
 *    state-machine viewer. An action param's option list never reaches those:
 *    the dialog builds an input from it, submits the picked value, and drops
 *    the list. The select / multiselect / radio / checkboxes INPUT widgets read
 *    `label`, `value` and `visibleWhen`, and nothing else.
 *
 * So `color` here is not "not yet, pending #5016" — #5016 measured it and the
 * answer is no. Declaring it would add exactly the key that parses clean and
 * changes nothing (ADR-0078), and would delete the only sentence telling an
 * author where the vocabulary IS real.
 */
const actionParamOptionColorGuidance =
  '`color` is a per-option key of a FIELD\'s option list (`SelectOptionSchema` in '
  + '`data/field.zod.ts`), read where a STORED value is displayed — the grid cell and the '
  + 'detail badge. An action param\'s options are never rendered that way: the dialog builds '
  + 'an INPUT from them, submits the picked value and discards the list, so no renderer would '
  + 'read `color` here even if this shape declared it (#5016 measured this). Drop the key — to '
  + 'colour the value once it is stored, declare the option list on the FIELD.';

/**
 * Guidance for per-option keys that no spec shape declares at all.
 *
 * `icon` / `disabled` exist only in objectui's internal `SelectOptionMetadata`
 * interface, which nothing populates from metadata and no widget reads — so
 * unlike `color` / `visibleWhen` there is no "one layer down" to point at, and
 * saying there was would be the false-prescription class this campaign has
 * already shipped four times (ledger finding 18).
 *
 * #5016 re-measured both before deciding whether to converge the spec on
 * objectui's interface (its option C) and found the same thing the batch-14
 * pass did: `SelectOptionMetadata.icon` has no reader anywhere in objectui, and
 * every `disabled` in the four option widgets is the FIELD-level `props.disabled`,
 * never a per-option one. C was therefore not taken.
 */
const actionParamOptionUndeclaredAnywhere = (key: 'icon' | 'disabled'): string =>
  `no option shape in the spec declares \`${key}\` — not this one, and not the field-level `
  + `\`SelectOptionSchema\`. It exists only inside objectui's own `
  + `\`SelectOptionMetadata\` type, which no metadata path populates and no widget reads. An `
  + `action param's options are \`{ label, value, visibleWhen }\`; drop the key.`;

export const ActionParamSchema = lazySchema(() => strictObject(
  {
    surface: 'this action param',
    aliases: ACTION_PARAM_KEY_ALIASES,
    history:
      'Until #3405 these were dropped silently — the param still parsed, so a mis-spelled ' +
      'config shipped as a control that quietly ignored it.',
  },
  {
  /** Request-body key. Defaults to `field` when `field` is set. */
  name: z.string().optional(),
  /** Reference an existing object field for label/type/validation/options. */
  field: SnakeCaseIdentifierSchema.optional(),
  /** Object that owns the referenced field (defaults to the action's parent object). */
  objectOverride: SnakeCaseIdentifierSchema.optional(),
  /** Overrides the resolved field label (or sets it for inline params). */
  label: I18nLabelSchema.optional(),
  /** Overrides the resolved field type (or sets it for inline params). */
  type: FieldType.optional(),
  /**
   * Required override; when omitted defaults to `false`. Consumers that wish
   * to inherit the underlying field's `required` flag should leave this
   * undefined in the source schema and resolve at runtime (the dialog
   * renderers check truthiness, so `false === undefined` for UI purposes).
   */
  required: z.boolean().optional().default(false),
  /**
   * Select/picklist options override.
   *
   * #4001 批 14 closed the OPTION ENTRY. `ActionParamSchema` has been strict
   * since #3405/#3746 — the file's template — but **strictness does not
   * recurse**, so the entries inside `options` were still zod-default strip:
   * the param was validated, its option list was not, and the shell reported
   * success either way.
   *
   * **`strictObject`, not `.passthrough()` — measured, not inherited from the
   * sibling.** `bulk-action.zod.ts`'s option entry went `.passthrough()`
   * (#4909) and the reasoning there was specific: an authored bulk-action def
   * is "left as-authored", reaches the grid VERBATIM, and objectui's
   * `BulkActionParam` declares an explicit `[key: string]: unknown` catch-all,
   * so `bulkParamToField`'s spread carries extras into a genuinely open widget
   * vocabulary. Neither half of that holds here, and both were re-measured on
   * 2026-08-03 rather than assumed:
   *
   * 1. **This surface has a parsing door, and the door already strips.** An
   *    action is a registered metadata type, so an authored param reaches
   *    objectui through `getMetadataTypeSchema('action')`
   *    (`MetadataManager.validate` / `GET /api/v1/meta` / the Studio form).
   *    Parsing a real action whose option carried
   *    `color` / `icon` / `disabled` / `visibleWhen` returned
   *    `{"label":"Overload","value":"overload"}` — every extra already gone,
   *    silently, before any renderer sees it. `.passthrough()` would therefore
   *    not be preserving a live flow; it would be *opening* one.
   * 2. **The consumer type here is CLOSED, not a catch-all.** The dialog lowers
   *    a param through `paramToField` into field metadata, where the option
   *    vocabulary is objectui's `SelectOptionMetadata` — an enumerable
   *    interface (`label` / `value` / `color` / `icon` / `disabled` /
   *    `visibleWhen`), not an index signature. A closed target vocabulary is
   *    exactly the case where declaring beats tolerating.
   *
   * So the answer legitimately differs from the sibling's. What that left was a
   * real, separable question — *should* an action param's option list speak the
   * per-option vocabulary that a FIELD's `options` (`SelectOptionSchema`,
   * `data/field.zod.ts`) already declares? That was filed as #5016 rather than
   * guessed at here, and #5016 answered it **per key, on measurement**:
   *
   * - **`visibleWhen` — opened.** The reader is on this exact path and it works
   *   today. An inline param's `options` are lowered VERBATIM (objectui
   *   `resolveActionParam`'s inline branch does `options: param.options`;
   *   `ActionParamDialog` re-spreads each entry to localise `label`;
   *   `paramToField` passes the array straight into the widget's field
   *   metadata), and `SelectField` / `MultiSelectField` / `RadioField` /
   *   `CheckboxesField` all narrow the offered set through
   *   `useCascadingOptions` → `resolveCascadingOptions`, which reads this key
   *   and accepts the `{ dialect, source }` envelope `ExpressionInputSchema`
   *   emits. The spec door was the ONLY thing between an author and a working
   *   per-option gate.
   * - **`color` / `default` — not opened**, and `icon` / `disabled` not added to
   *   `SelectOptionSchema` either (#5016's option C). None has a reader an
   *   action param's option list can reach; each keeps a `guidance` entry
   *   saying where the vocabulary IS real. Declaring them would be the
   *   parses-clean-changes-nothing key ADR-0078 exists to keep out — and for
   *   `default` it would actively mislead, since a dialog param defaults
   *   through `defaultValue` one level up.
   *
   * **What this does NOT fix**, deliberately, because it is objectui's and not
   * the spec's: a FIELD-BACKED param that inherits its list instead of declaring
   * one still loses the key. `resolveActionParam` reaches
   * `param.options ?? normaliseOptions(field.options, …)`, and `normaliseOptions`
   * rebuilds every inherited entry as `{ label, value }`. That drop predates
   * this change, is invisible to it (an authored `options` array wins over the
   * inherited one), and is tracked in objectui — so the guidance below still
   * refuses to prescribe "make it field-backed and inherit" (ledger finding 18:
   * a confidently wrong prescription is worse than none).
   *
   * The aliases are anchored on `SelectOptionSchema`'s own curated table (the
   * same idea, one layer down) rather than on edit distance, and deliberately
   * carry across ONLY the entries whose target this shape actually declares —
   * `never suggest a key the schema cannot accept` (ledger finding 12).
   */
  options: z.array(strictObject({
    surface: 'this action param option',
    history:
      'Until #4001 批 14 closed this shape these were dropped silently — the param still '
      + 'rendered its picker, minus whatever the key was meant to colour, gate or disable.',
    aliases: {
      // Carried over from `SelectOptionSchema`'s table — same idea, and these
      // five point at keys THIS shape declares.
      text: 'label',
      name: 'label',
      title: 'label',
      key: 'value',
      id: 'value',
      // objectql/import-export spell the stored side this way.
      optionValue: 'value',
      optionLabel: 'label',
      displayName: 'label',
      // #5016 declared `visibleWhen` here, so `SelectOptionSchema`'s two
      // spellings for it now point at a key this shape accepts and can carry
      // across under the same finding-12 rule as the five above.
      visible: 'visibleWhen',
      showWhen: 'visibleWhen',
    },
    guidance: {
      // The per-option keys that are real one layer down but have no reader on
      // THIS path, plus the two that no spec shape declares at all. Each says
      // where the vocabulary lives and — critically — does NOT promise that a
      // field-backed param inherits it: `resolveActionParams`' `normaliseOptions`
      // rebuilds each inherited entry as `{ label, value }`, so that promise
      // would be false in exactly the way ledger finding 18 warns about.
      //
      // `visibleWhen` is deliberately absent: it is a declared key now, and
      // `guidance` is consulted only from the `unrecognized_keys` path, so an
      // entry for it would be dead prose (`shared/alias-integrity.test.ts`).
      color: actionParamOptionColorGuidance,
      icon: actionParamOptionUndeclaredAnywhere('icon'),
      disabled: actionParamOptionUndeclaredAnywhere('disabled'),
      default: '`default` on an OPTION is the field-level picklist default (`SelectOptionSchema.default`). A dialog param defaults through `defaultValue` on the PARAM itself, one level up — write `defaultValue: \'<value>\'` there.',
    },
  }, {
    label: I18nLabelSchema,
    value: z.string(),
    /**
     * Per-option visibility predicate (CEL) — the option is offered only when
     * this evaluates TRUE. Omit = always available (#5016).
     *
     * Same key, same engine and same binding environment as
     * `SelectOptionSchema.visibleWhen` one layer down, so one vocabulary covers
     * both surfaces: it expresses dependent options (`record.country == 'cn'`)
     * AND role/context gating (`'admin' in current_user.positions`). In a
     * dialog `record` is the live param bag overlaid on the row, so a param can
     * gate its options on a SIBLING param the user has already filled.
     *
     * ⚠️ Client-side hiding is UX, not authorization. `enforceActionParams`
     * validates the submitted value against this param's option VALUES
     * (ADR-0104 D2) — it does not evaluate per-option `visibleWhen` — so an
     * option gated for access-control reasons must also be refused by the
     * action's own body or a permission check. Hiding it in the dropdown is
     * bypassable.
     */
    visibleWhen: ExpressionInputSchema.optional().describe("Per-option visibility predicate (CEL) — option is offered only when TRUE (else omitted). Same env as the field-level per-option visibleWhen (record + current_user). e.g. P`record.tier == 'gold'`"),
  })).optional(),
  /** Placeholder override. */
  placeholder: z.string().optional(),
  /** Help/description override. */
  helpText: z.string().optional(),
  /**
   * Default value for the dialog input — prefilled into the control when the
   * dialog opens, and SUBMITTED VERBATIM if the user does not touch the field
   * (objectui `ActionParamDialog` seeds its state with `p.defaultValue` and
   * resolves no tokens against it).
   *
   * Because it is submitted verbatim it must satisfy this param's own value
   * contract — the shape checked below through the SAME `valueSchemaFor` the
   * dispatcher runs at submit. This is a LITERAL, not an expression surface:
   * unlike a FIELD's `defaultValue`, which the ObjectQL engine resolves for
   * runtime tokens (`current_user`, CEL `today()`; ROADMAP §M9.9b), nothing on
   * the action-param path interprets this value.
   */
  defaultValue: z.unknown().optional(),
  /**
   * Widget config for inline params (field-backed params inherit these from
   * the referenced field at runtime; inline values override). The param
   * dialog renders every param through the same field-widget renderer the
   * object form uses (objectui ADR-0059), so these mirror the corresponding
   * `FieldSchema` knobs.
   */
  /** Allow multiple values (file/image/lookup/user params → array value). */
  multiple: z.boolean().optional().describe('Allow multiple values (array value shape); mirrors FieldSchema.multiple.'),
  /** Accepted upload types (MIME types / extensions) for `file`/`image` params. */
  accept: z.array(z.string()).optional().describe('Accepted upload types (MIME types / extensions) for file/image params.'),
  /** Max upload size in bytes for `file`/`image` params. */
  maxSize: z.number().int().positive().optional().describe('Max upload size in bytes for file/image params.'),
  /**
   * Reference target for an inline `lookup` / `master_detail` param — the
   * object whose records the picker searches. Field-backed params inherit it
   * from the referenced field, so it is only needed inline.
   *
   * Without it the dialog cannot query anything and degrades to a plain text
   * input asking for a raw record id, which is unusable for a human — hence
   * the `.refine()` below rejects a targetless lookup param at parse time.
   *
   * Key name deliberately mirrors `FieldSchema.reference` so the same spelling
   * works in both places.
   */
  reference: SnakeCaseIdentifierSchema.optional().describe('Reference target object for inline lookup/master_detail params; mirrors FieldSchema.reference.'),
  /**
   * When true, the param's default value is pulled from the current row record
   * (key = the resolved field name) when the action runs from a list_item
   * context. Useful for edit dialogs that pre-fill from the selected row.
   */
  defaultFromRow: z.boolean().optional(),
  /**
   * Visibility predicate (CEL) — same scope as the action-level `visible`
   * (`current_user` / `app` / `data` / `features`). When it evaluates false the
   * dialog omits this param entirely. Use it to hide a param that the backend
   * only accepts under an opt-in capability, e.g. the create-user `phoneNumber`
   * param gated on `features.phoneNumber` so the form never offers a field the
   * default backend rejects. Absent = always visible.
   */
  visible: ExpressionInputSchema.optional().describe('Param visibility predicate (CEL); omits the param when false.'),
  /**
   * Declarative capability gate (#2874): name a public auth feature flag
   * (see `PUBLIC_AUTH_FEATURES` in `@objectstack/spec/kernel`) and the schema
   * lowers it at parse time into the canonical `visible` predicate —
   * `features.X == true` (opt-in flag) or `features.X != false` (default-on),
   * AND-composed with any explicit `visible`. The sugar key is stripped from
   * the parsed output, so renderers/lint only ever see `visible`. Prefer this
   * over a hand-written `features.*` predicate: the flag name is
   * enum-checked and the gate/registry stay in lockstep.
   */
  requiresFeature: z.enum(PUBLIC_AUTH_FEATURE_NAMES).optional().describe('Public auth feature flag gating this param; lowered into `visible` at parse time.'),
}).refine(
  (p) => Boolean(p.name) || Boolean(p.field),
  { message: 'ActionParam requires either "name" or "field"' },
).refine(
  // An INLINE record-picker param must name its target object. Only inline
  // params are checked: a field-backed one inherits the target from the
  // referenced field's metadata, which is not visible at parse time.
  (p) => !(!p.field && (p.type === 'lookup' || p.type === 'master_detail') && !p.reference),
  {
    path: ['reference'],
    message:
      'ActionParam with type "lookup"/"master_detail" requires "reference" (the target object) when declared inline — without it the param dialog degrades to a raw record-id text input. Set `reference: \'<object>\'`, or use a field-backed param (`{ field: \'<lookup_field>\' }`) to inherit it.',
  },
).superRefine((p, ctx) => {
  // #6970 — an authored `defaultValue` is checked against the param's OWN
  // declared value contract, through the SAME `valueSchemaFor` the dispatcher
  // runs at submit (ADR-0104 D2, `validateActionParams`). One rule set, two
  // moments: whatever the dispatcher would refuse from a user is refused from
  // an AUTHOR, at the moment it is written.
  //
  // The gap this closes: `defaultValue` was `z.unknown()`, so a default that
  // can never satisfy its own param parsed clean, prefilled the control, and
  // 400'd at submit on a field the user never touched — with a message naming
  // the param but not the author's default as the cause. `datetime` is the
  // loudest instance (a human-readable wall clock, `2026-08-10T15:00`, which
  // `datetime-local` happily displays and `InstantValueSchema` refuses) but the
  // hole was every type: `number` + `'abc'`, `select` + a non-member, a
  // `multiple` param + a scalar. That is the "AI writes it wrong in bulk and
  // nothing says so" shape ADR-0078 / ADR-0049 exist to prevent.
  //
  // Checked ONLY where the declaration can answer the question — see the two
  // skips below. An authoring gate that guessed at what a field-backed param
  // inherits would reject valid metadata, which is worse than the silence it
  // replaces.
  if (!isActionParamValuePresent(p.defaultValue)) return;
  // `type` is the param's own override; absent it is inherited from the
  // referenced field at runtime and is not visible here (the same "leaves the
  // value shape open" default `validateActionParams` applies to an
  // unresolvable type).
  if (!p.type) return;

  const def = { type: p.type, multiple: p.multiple, options: p.options };
  const result = valueSchemaFor(def, 'stored').safeParse(p.defaultValue);
  if (result.success) return;

  // ARITY is knowable only when the param states it. A field-backed param
  // inherits `multiple` from its field, so `{ field: 'owners', type: 'user',
  // defaultValue: ['a','b'] }` is a legal declaration whose array default this
  // gate must not call wrong. When the param is field-backed AND silent on
  // `multiple` AND the type is one whose arity `multiple` decides, accept
  // either arity and check only the ELEMENT shape.
  if (p.field && p.multiple === undefined && MULTI_CAPABLE_TYPES.has(p.type)) {
    const flipped = valueSchemaFor({ ...def, multiple: !isMultiValueField(def) }, 'stored');
    if (flipped.safeParse(p.defaultValue).success) return;
  }

  const detail = result.error.issues[0]?.message ?? 'invalid value';
  const key = p.name ?? p.field ?? '<unnamed>';
  ctx.addIssue({
    code: 'custom',
    path: ['defaultValue'],
    message:
      `Action param "${key}" (${p.type}): the default ${JSON.stringify(p.defaultValue)} cannot `
      + `satisfy this param's own value contract — ${detail}. The dialog would PREFILL this value `
      + 'and the submit would then be refused with that same message (ADR-0104 D2), for a field the '
      + 'user never touched — so the 400 names the param but not this default, which is the real '
      + "cause. Write the default in the param's declared value shape, or drop `defaultValue`.",
  });
}).transform((p, ctx) => lowerRequiresFeature(p, ctx)));

/**
 * Action type enum values.
 */
export const ActionType = z.enum(['script', 'url', 'modal', 'flow', 'api', 'form']);
export type ActionType = z.input<typeof ActionType>;

/**
 * Action types that require a `target` field.
 * Derived from ActionType, excluding 'script' which allows inline handlers.
 * These types reference an external resource (URL, flow, modal, or API endpoint)
 * and cannot function without a target binding.
 */
const TARGET_REQUIRED_TYPES: ReadonlySet<string> = new Set(
  ActionType.options.filter((t) => t !== 'script'),
);

/**
 * Action Schema
 * 
 * **NAMING CONVENTION:**
 * Action names are machine identifiers used in code and must be lowercase snake_case.
 * 
 * **TARGET BINDING:**
 * The `target` field is the canonical way to bind an action to its handler.
 * - `type: 'script'` — `target` is recommended (references a script/function name).
 * - `type: 'url'`    — `target` is **required** (the URL to navigate to).
 * - `type: 'flow'`   — `target` is **required** (the flow name to invoke).
 * - `type: 'modal'`  — `target` is **required** (the modal/page name to open).
 * - `type: 'api'`    — `target` is **required** (the API endpoint to call).
 * - `type: 'form'`   — `target` is **required** (the FormView name to open, routed to `/console/forms/:name`).
 * 
 * The `execute` alias was **removed in protocol 17** (#3855). `target` is the
 * only handler slot, so no consumer has a second slot to disagree about. An
 * authored `execute` is rejected with the rename prescription rather than
 * silently stripped; `os migrate meta --from 16` rewrites it for you.
 * 
 * @example Good action names
 * - 'on_close_deal'
 * - 'send_welcome_email'
 * - 'approve_contract'
 * - 'export_report'
 * 
 * @example Bad action names (will be rejected)
 * - 'OnCloseDeal' (PascalCase)
 * - 'sendEmail' (camelCase)
 * - 'Send Email' (spaces)
 * 
 * Note: The action name is the configuration ID. JavaScript function names can use camelCase,
 * but the metadata ID must be lowercase snake_case.
 */
/**
 * Action Location — where an action is allowed to surface in the UI.
 *
 * Canonical list (single source of truth for the whole platform). Renderers,
 * the ActionEngine, the Studio designer dropdowns, and `objectui` consumers
 * MUST import from this constant rather than re-declaring their own enum —
 * adding a new location should require touching this one file only.
 *
 * Semantics:
 * - `list_toolbar`    — header/toolbar of a list view (bulk actions, "New", export).
 * - `list_item`       — per-row action on a list/grid row (Salesforce row-level menu).
 * - `record_header`   — primary actions in the record-detail title bar.
 * - `record_more`     — overflow menu under the "More" / ⋯ button on a record.
 * - `record_related`  — actions on a related list section inside a record.
 * - `record_section`  — actions surfaced inside a body section/tab of a record
 *                       (e.g. a Security tab grouping change-password, 2FA, etc.).
 * - `global_nav`      — global navigation/command-palette level actions.
 */
export const ACTION_LOCATIONS = [
  'list_toolbar',
  'list_item',
  'record_header',
  'record_more',
  'record_related',
  'record_section',
  'global_nav',
] as const;

export const ActionLocationSchema = z.enum(ACTION_LOCATIONS);
export type ActionLocation = z.input<typeof ActionLocationSchema>;

/**
 * Tool category values for {@link ActionAiSchema.category}.
 *
 * **Canonical.** This was a hand-copy of `ToolCategorySchema` in
 * `../ai/tool.zod`, kept inline rather than imported to avoid a `ui → ai`
 * cycle, under a comment telling the next author to update both sides. #3896
 * removed `ToolCategorySchema` along with the inert `tool.category` key it
 * typed — which left that instruction pointing at a source that no longer
 * exists, and a reader hunting for a second side there is none of. This enum
 * is now the only declaration of the vocabulary: change it here, nowhere
 * else. (#3786 — comments are not a mechanism, and they rot silently.)
 */
const ActionAiCategorySchema = z.enum([
  'data',
  'action',
  'flow',
  'integration',
  'vector_search',
  'analytics',
  'utility',
]);

/**
 * AI exposure block (ADR-0011 "Actions as AI Tools").
 *
 * **Opt-in, default off.** An action becomes an AI-callable tool only when
 * `exposed: true`. This is a deliberate governance gate: in an AI-authoring
 * world the platform's value is that a human can govern exactly which
 * capabilities the agent fleet is allowed to invoke — a half-finished or
 * unreviewed action must never be silently armed.
 *
 * When exposed, `description` is **required** — it is the LLM-facing contract
 * (when/why to call), authored explicitly rather than derived from the
 * UI `label`. The bridge in `@objectstack/service-ai` translates this block
 * into an `AIToolDefinition`.
 */
/**
 * Shared history for this file (#4001).
 *
 * `ActionParamSchema` has been strict since #3746 — the campaign's own template,
 * where `visibleWhen` → `visible` proved that the most valuable alias entry is
 * rarely a typo but a key that reads as a control and silently is not one. The
 * action AROUND the param stayed open for three more releases.
 */
const ACTION_HISTORY =
  'Until #4001 closed this shape these were dropped silently — the action still registered '
  + 'and still ran, without whatever the key was meant to configure or gate.';

export const ActionAiSchema = strictObject({
  surface: "this action's AI exposure block",
  history: ACTION_HISTORY,
  aliases: {
    enabled: 'exposed', enable: 'exposed', aiEnabled: 'exposed', expose: 'exposed', visible: 'exposed',
    prompt: 'description', toolDescription: 'description', summary: 'description',
    type: 'category', kind: 'category', toolCategory: 'category',
    hints: 'paramHints', parameterHints: 'paramHints', params: 'paramHints',
    returns: 'outputSchema', responseSchema: 'outputSchema', output: 'outputSchema',
    confirm: 'requiresConfirmation', requireConfirmation: 'requiresConfirmation', hitl: 'requiresConfirmation', humanInTheLoop: 'requiresConfirmation',
  },
  guidance: {
    // This block IS the governance gate — the doc above says a half-finished or
    // unreviewed action must never be silently armed. A near-miss here is
    // therefore the worst kind on this surface: the author believes they set a
    // gate, and the gate does not exist. Name the two people reach for.
    permissions:
      'AI invocation is not gated by a key here — an agent reaches this action only if a '
      + "surface-compatible SKILL declares it (ADR-0064), and who may talk to that agent is "
      + "gated by the agent's `access` / `permissions` (enforced at the chat route since #1884). "
      + 'For a human-approval step on the call itself, use `requiresConfirmation: true`.',
    approval:
      'there is no approval workflow key here — `requiresConfirmation: true` forces a '
      + 'human-in-the-loop gate on the AI call. A multi-step business approval is an `approval` '
      + 'metadata item, not an action field.',
  },
}, {
  /**
   * Expose this action to AI agents as a callable tool. Default `false`.
   * Setting `true` REQUIRES `description`.
   */
  exposed: z.boolean().default(false).describe('Expose this action to AI agents. Requires `description` when true.'),

  /**
   * LLM-facing description: tells the model when and why to call this action.
   * Distinct from the UI `label`. Plain English, ≥ 40 chars for useful tool
   * selection. Required whenever `exposed` is true.
   */
  description: z.string().min(40).optional().describe('LLM-facing description (≥40 chars). Required when exposed.'),

  /**
   * Override the derived tool category. Defaults to `action` (side-effect).
   * Use `data` for read-only actions, `analytics` for aggregations, etc.
   */
  category: ActionAiCategorySchema.optional().describe('Tool category override (defaults to "action").'),

  /**
   * Per-parameter AI hints, keyed by param name (or the injected `recordId`).
   * Tightens the JSON Schema the LLM sees (e.g. add `enum`, override
   * `description`, supply `examples`) WITHOUT changing the UI-facing field
   * metadata. Keys must match a declared `params[].name` (or `recordId`).
   */
  paramHints: z.record(z.string(), strictObject({
    surface: 'this AI parameter hint',
    history: ACTION_HISTORY,
    aliases: { desc: 'description', hint: 'description', values: 'enum', options: 'enum', choices: 'enum', allowed: 'enum', example: 'examples', sample: 'examples' },
  }, {
    description: z.string().optional(),
    enum: z.array(z.union([z.string(), z.number()])).optional(),
    examples: z.array(z.unknown()).optional(),
  })).optional().describe('Per-parameter AI hints keyed by param name.'),

  /**
   * Output JSON Schema for the action's return value. Enables structured
   * downstream tool chaining (one action's output feeds another's input) and
   * is summarised into the tool description so the model knows what it gets
   * back. Optional — when omitted the return value is treated as freeform.
   */
  outputSchema: z.record(z.string(), z.unknown()).optional().describe('JSON Schema for the action return value.'),

  /**
   * Override confirmation for AI calls. When unset, the bridge defaults to
   * `true` for actions that look destructive (`confirmText` set, `mode:'delete'`,
   * or `variant:'danger'`). Set explicitly to `false` to assert a destructive-
   * looking action is safe to run without human approval, or `true` to force a
   * human-in-the-loop gate on an otherwise-safe action.
   */
  requiresConfirmation: z.boolean().optional().describe('Override HITL confirmation for AI invocations.'),
});

export type ActionAi = z.input<typeof ActionAiSchema>;
/** Post-parse shape of {@link ActionAi} — defaults applied, transforms run (ADR-0122). */
export type ActionAiParsed = z.infer<typeof ActionAiSchema>;

/**
 * The shape both action-level condition keys speak — `visible` and `disabled`.
 *
 * Three arms for one meaning, cheapest first:
 *
 * | arm | example | meaning |
 * |:---|:---|:---|
 * | `boolean` | `visible: false` | the degenerate literal — a condition that is settled at authoring time |
 * | `string` | `disabled: "record.status == 'closed'"` | CEL shorthand, normalized to the envelope at parse time |
 * | `{ dialect, source }` | `{ dialect: 'cel', source: '…', meta: { rationale } }` | the full envelope, for authorship metadata or a non-default dialect |
 *
 * The two keys were asymmetric until #5970 — `visible` had no `boolean` arm, so
 * the very common `visible: true` was a parse error on the spec side while
 * objectui's `ActionDef` accepted it and stored metadata was already written
 * that way. An asymmetry between two keys that mean the same *kind* of thing is
 * a dialect nursery: it teaches each consumer to keep its own widening (the
 * `(action as any).disabled` cast in console's `DeclaredActionsBar` was exactly
 * that), and every one of those is a second de-facto contract (Prime Directive
 * #12). Unifying here is what lets #4075 step 3 derive `ActionDef` from this
 * schema and delete the casts.
 *
 * The boolean arm is deliberately NOT normalized into `{dialect:'cel',
 * source:'true'}`: a literal survives as a literal, so a renderer can branch on
 * it without standing up an evaluator, and `false` stays statically greppable.
 */
const ActionConditionInputSchema = z.union([z.boolean(), ExpressionInputSchema]);

/**
 * The object half of {@link ActionSchema}, before its refinements.
 *
 * A factory rather than a schema so `lazySchema`'s deferral still holds — the
 * fields are built on first use of whichever schema derives from them, not at
 * module load.
 *
 * It exists because `.pick()` is a `ZodObject` method and `ActionSchema` is
 * `z.object(…).refine(…).refine(…)`, so nothing can derive a subset from the
 * exported schema. {@link InlineActionSchema} derives from this instead of
 * restating a dozen field definitions and their `describe()` text, which is how
 * a second action vocabulary would start.
 */
const actionObject = () => strictObject({
  surface: 'this action',
  history: ACTION_HISTORY,
  aliases: {
    title: 'label', displayName: 'label', text: 'label',
    object: 'objectName', entity: 'objectName',
    actionType: 'type',
    url: 'target', endpoint: 'target', path: 'target', href: 'target',
    parameters: 'params', args: 'params', inputs: 'params', fields: 'params',
    confirm: 'confirmText', confirmation: 'confirmText', confirmMessage: 'confirmText',
    success: 'successMessage', successText: 'successMessage', toast: 'successMessage',
    visibleWhen: 'visible', showWhen: 'visible',
    disabledWhen: 'disabled',
    style: 'variant', color: 'variant', appearance: 'variant',
    placement: 'locations', location: 'locations', position: 'locations',
    verb: 'method', httpMethod: 'method',
    // #5013 — `body` is DECLARED on this schema (the `script` action's L1/L2
    // hook body), so an alias filed under it could never run; `payload` is the
    // live spelling that still needs pointing at `bodyExtra`.
    payload: 'bodyExtra',
    llm: 'ai', tool: 'ai',
    dialog: 'resultDialog', result: 'resultDialog',
    refresh: 'refreshAfter', reload: 'refreshAfter',
    // The capability gate on an action IS a declared key — `requiredPermissions`
    // (ADR-0066 D4), enforced with a 403 on the platform action route. So the
    // near-misses of it must RENAME onto it, never be told the gate lives
    // somewhere else.
    permissions: 'requiredPermissions', capabilities: 'requiredPermissions',
    requiresPermissions: 'requiredPermissions', requiredCapabilities: 'requiredPermissions',
    acl: 'requiredPermissions',
  },
  guidance: {
    // `visible` / `disabled` are the trap worth naming on this surface: they
    // look like access control and are not. The real gate is
    // `requiredPermissions`, which is why the near-misses above rename onto it
    // rather than pointing anywhere else.
    hidden:
      '`hidden` is not an action key, and hiding is not gating — `visible` and `disabled` are UI '
      + 'predicates that hide or grey a button, they do not stop a request. To actually gate '
      + 'invocation use `requiredPermissions` (ADR-0066 D4, enforced with a 403 on the platform '
      + 'action route). To declare an action with no UI surface at all, set `locations: []`.',
    // Two AI-block keys authors reach for at the top level. Silently stripping
    // either meant an action was armed for agents, or left ungated, in silence.
    exposed:
      'AI exposure lives under `ai` — write `ai: { exposed: true, description: … }`. The '
      + 'description is the LLM-facing contract and is REQUIRED (≥40 chars) whenever exposed.',
    requiresConfirmation:
      'the AI human-in-the-loop override lives under `ai` — write '
      + '`ai: { requiresConfirmation: true }`. `confirmText` is the separate UI confirm prompt.',
  },
}, {
  /** Machine name of the action */
  name: SnakeCaseIdentifierSchema.describe('Machine name (lowercase snake_case)'),
  
  /** Display label */
  label: I18nLabelSchema.describe('Display label'),

  /** Target object this action belongs to (optional, snake_case) */
  objectName: z.string().regex(/^[a-z_][a-z0-9_]*$/).optional().describe('Target object this action belongs to. When set, the action is auto-merged into the object\'s actions array by defineStack().'),
  
  /** Icon name (Lucide) */
  icon: z.string().optional().describe('Icon name'),

  /** Where does this action appear? */
  locations: z.array(ActionLocationSchema).optional().describe('Locations where this action is visible'),

  /** 
   * Visual Component Type
   * Defaults to 'button' or 'menu_item' based on location,
   * but can be overridden.
   */
  component: z.enum([
    'action:button', // Standard Button
    'action:icon',   // Icon only
    'action:menu',   // Dropdown menu
    'action:group'   // Button Group
  ]).optional().describe('Visual component override'),
  
  /** What type of interaction? */
  type: ActionType.default('script').describe('Action functionality type'),
  
  /** 
   * Payload / Target — the canonical binding for the action handler.
   * Required for url, flow, modal, and api types.
   * For `script` type: prefer `body` over `target`. `target` is kept only for
   * legacy bundle.functions[name] references.
   *
   * **Interpolation** (renderer responsibility, all action types):
   * `target` MAY contain `${param.X}` and `${ctx.X}` tokens. Renderers
   * resolve them just before invocation:
   * - `${param.X}` — value collected from the action's params dialog.
   * - `${ctx.X}` — values from the action context: `ctx.origin`
   *   (window.origin), `ctx.recordId`, `ctx.user.id`, `ctx.org.id`, etc.
   * Used by redirect-style actions like `link_social`, where the target is
   * e.g. `/api/v1/auth/sign-in/social?provider=${param.provider}&callbackURL=${ctx.origin}/_console/apps/account/sys_account`.
   * Renderers MUST `encodeURIComponent` interpolated values before
   * substituting them into URL query positions.
   */
  target: z.string().optional().describe('URL, Script Name, Flow ID, or API Endpoint. Supports ${param.X} and ${ctx.X} interpolation.'),

  /**
   * For `type:'url'` — where to open `target`. A simple, declarative new-tab
   * control for STATIC urls (no handler, no synchronous pre-open). objectui's
   * ActionRunner.executeUrl reads `openIn` with priority over the legacy
   * `params.newTab`/external-URL heuristic.
   *
   * - `'new-tab'` — opens `target` in a new browser tab.
   * - `'self'`    — navigates in place.
   * - omitted     — external/absolute URLs open in a new tab; relative URLs
   *                 navigate in place.
   *
   * Distinct from `opensInNewTab`/`newTabUrl`, which pre-open an about:blank
   * tab synchronously for ASYNC SSO-redirect handlers — do NOT use `openIn`
   * for those. This is a STATIC execution option: keep it OUT of `params`
   * (which is user-input-collection only).
   */
  openIn: z.enum(['self', 'new-tab']).optional().describe("For type:'url' — where to open `target`. 'new-tab' opens a new browser tab; 'self' navigates in place. When omitted, external/absolute URLs open in a new tab and relative URLs navigate in place. Static execution option — keep it OUT of `params` (which is user-input-collection only)."),

  /**
   * Action Body (L1 expression or L2 sandboxed JS).
   *
   * Only meaningful when `type === 'script'`. When set, the runtime invokes
   * the body inside the sandbox as `(input, ctx) => Promise<output>` and
   * ignores `target`.
   *
   * That condition is ENFORCED at both ends, not merely documented (#4352).
   * Authoring: the refinement on {@link ActionSchema} rejects `body` alongside
   * any other `type` — the publish gate resolves this same schema through
   * `getMetadataTypeSchema('action')`, so the contradiction cannot be stored.
   * Runtime: `actionBodyRunnerFactory` binds no handler unless the type is
   * `script`, which covers metadata published before that gate existed and
   * bundles that never parsed. Until #4352 only the sentence existed: the
   * runtime bound a handler from `body` alone, so flipping `type` from
   * `script` to `url` left the body running with nothing to say so.
   *
   * - `{ language: 'expression', source: '...' }` — pure formula (L1).
   * - `{ language: 'js', source: '...', capabilities: [...] }` — sandboxed JS (L2).
   *
   * Compiled-module bodies are not supported. Outbound IO (HTTP, etc.) goes
   * through Connector recipes (separate spec).
   *
   * `ctx.api.object(...)` is the ONLY way a body persists anything. `ctx.input`
   * is the action's params bag, and `ctx.record` is a snapshot the runtime
   * never writes back — assigning to it is discarded, declared field or not.
   *
   * Both are checked at author time by `validateActionBodyWrites` in
   * `@objectstack/lint`: a literal `ctx.api.object('y').update({ x })` naming a
   * field object `y` never declares warns with a did-you-mean, because nothing
   * downstream catches it — on a SQL driver the stray column fails the whole
   * call with a driver-level error far from the authoring site, and on a
   * schemaless driver it is persisted as an undeclared key (#4271); and a
   * provably dead `ctx.record.<field> = …` warns as discarded (#4345).
   * Advisory only, and blind to everything statically unknowable; see
   * `ScriptBodySchema` for the scope.
   *
   * The sandbox reports the discarded `ctx.record` writes at INVOCATION time as
   * well, covering the computed keys, aliases and Studio/API-authored bodies a
   * parse cannot reach.
   */
  body: HookBodySchema.optional().describe('Action body — expression (L1) or sandboxed JS (L2). Only used when type is `script`.'),

  /**
   * [REMOVED in protocol 17 — #3855] The deprecated alias of `target`.
   * Tombstoned rather than deleted: `ActionSchema` is not `.strict()`, so a
   * plain deletion would silently strip the key and the action would bind no
   * handler at all — the #2169 "Mark Done does nothing" shape, restored.
   */
  execute: retiredKey(
    '`execute` was removed in @objectstack/spec 17 (#3855) — use `target`. ' +
    'Rename the key; the value (a handler / flow / URL ref) is unchanged. ' +
    'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),
  
  /**
   * User Input Requirements — the **parameter DEFINITION array** rendered as a
   * dialog before the action runs. `ActionParam[]`, never a values map.
   *
   * The distinction is load-bearing and was, until #5777, only implicit. A
   * `type:'api'` author reaches for `params` expecting the REQUEST PAYLOAD —
   * `params: { name: '{{page.inquiryName}}' }` — because "params" reads like
   * "what I send". That is a different concept living under the same name:
   * definitions describe fields to COLLECT, a payload is data to SEND. The
   * static payload key is {@link bodyExtra}, and the two shapes are disjoint
   * (array vs object), which is exactly why the confusion survived — every
   * consumer could tell them apart with `Array.isArray`, so nobody had to.
   *
   * The maintainer's 2026-08-06 ruling on #5777 took direction A (a separate
   * key, no same-name union), so this key keeps ONE meaning and the object form
   * is REFUSED here — with a message that names `bodyExtra` rather than the
   * bare "expected array, received object" an author cannot act on. Sources
   * still carrying the object form are rewritten at load by the
   * `inline-action-api-params-to-body-extra` conversion (ADR-0087 D2).
   *
   * **The api prescription is not universal, which #6828 measured and the
   * maintainer's 2026-08-10 ruling closed.** On a `type:'url'` action the
   * object form meant a THIRD thing again — objectui's `ActionRunner` read a
   * non-array `params` as the `${param.X}` interpolation scope for `target`,
   * and `params.newTab` as a legacy new-tab flag. Sending that author to
   * `bodyExtra` is a wrong instruction: an api request-body key is not an
   * interpolation scope (the same asymmetry is why the conversion above guards
   * on `type === 'api'` — rewriting a url action's object `params` would be
   * lossy, and ADR-0087 D2 requires losslessness). The ruling **retired** the
   * url meaning rather than giving it a key: the scope is already expressible
   * as `target`-string interpolation, and the flag is already {@link openIn}.
   * So the refusal below prescribes per action type — `bodyExtra` for `api`,
   * the sanctioned url spellings for `url` — and nothing new enters the
   * vocabulary. A future authorable interpolation-scope key needs a spec
   * proposal that demonstrates pull, not a third arm of this one.
   *
   * The branch is stated IN THE TEXT rather than selected at runtime because
   * zod cannot see a sibling from a property-level error map: the map receives
   * only `{ code, expected, input, inst, path }` for the offending value, and
   * an object-level `.check()`/`.superRefine()` — which would see `type` — is
   * skipped once a property has already failed (probed on zod 4.4.3). Reading
   * `type` here would mean restructuring `ActionSchema` behind a
   * `z.preprocess`, which erases `z.input<typeof ActionSchema>` (the authoring
   * type `defineAction` publishes) — a far larger change than the guidance
   * defect warrants, and one that moves surfaces this issue must not move.
   */
  params: z.array(ActionParamSchema, {
    error: (iss) => (
      iss.code === 'invalid_type'
        && iss.input !== null
        && typeof iss.input === 'object'
        && !Array.isArray(iss.input)
        ? "`params` is the parameter DEFINITION array (fields collected from the user before the action runs), not a values map. "
          + "For a `type:'api'` action's static request body — including `{{page.<var>}}` tokens — use `bodyExtra: { … }` instead (#5777). "
          + "For a `type:'url'` action there is nowhere to move it to, by decision: put static values straight into the `target` string "
          + "(`${param.X}` interpolates a value collected by the params dialog, `${ctx.X}` one from the action context), and open a new tab with "
          + "`openIn: 'new-tab'`. The url-side readings of an object `params` — a static `${param.X}` scope, and `params.newTab` — are RETIRED, not renamed (#6828). "
          + 'Expected an array of ActionParam, received an object.'
        : undefined
    ),
  }).optional().describe('Input parameters required from user — an ActionParam[] DEFINITION array, never a payload map (a static request body goes in `bodyExtra`).'),
  
  /** Visual Style */
  variant: z.enum(['primary', 'secondary', 'danger', 'ghost', 'link']).optional().describe('Button visual variant for styling (primary = highlighted, danger = destructive, ghost = transparent)'),

  /**
   * Explicit sort order WITHIN a UI location group (lower = higher / more
   * prominent). Controls where the action lands in each `locations` group
   * instead of relying on cross-file `defineStack({ actions })` registration
   * order — which is fragile and couples unrelated features.
   *
   * In `record_header` the first visible action becomes the primary button, so
   * a low (or negative) `order` promotes an action into the primary slot and a
   * high `order` demotes it toward the `⋯` overflow menu. This is the
   * declarative lever a plugin (e.g. plugin-approvals) or app author uses to
   * make a decision like Approve/Reject stably outrank app actions, rather than
   * hiding the other actions to "make room".
   *
   * Honoured by a STABLE sort in `mergeActionsIntoObjects()` (see stack.zod):
   * actions that leave `order` unset are treated as `0` and keep their original
   * registration order, so setting `order` on nobody is a no-op — fully
   * backward compatible. Renderers MAY additionally prefer a `variant:'primary'`
   * action when two actions tie on `order` (see objectui record-header renderer).
   */
  order: z.number().optional().describe('Sort order within a location group (lower = higher). Promotes/demotes an action toward the record_header primary button; stable, so actions without `order` keep their registration order.'),

  /** UX Behavior */
  confirmText: I18nLabelSchema.optional().describe('Confirmation message before execution'),
  successMessage: I18nLabelSchema.optional().describe('Success message to show after execution'),
  // Runtime (ActionRunner) already honours this — declared here so authors can
  // set a friendly failure toast instead of surfacing the raw error string.
  errorMessage: I18nLabelSchema.optional().describe('Error message to show when the action fails (overrides the raw error).'),
  refreshAfter: z.boolean().default(false).describe('Refresh view after execution'),
  // Single-record update actions only. When true, the runtime captures the
  // record's prior field values and offers an "Undo" affordance on the success
  // toast (backed by the client UndoManager) to restore them.
  undoable: z.boolean().optional().describe('Offer an Undo affordance after this single-record update action succeeds.'),

  /**
   * Result Dialog — describe how to render the API response on success.
   *
   * When set and the action returns successfully, the renderer SHOULD open a
   * dialog showing the selected fields from `result.data` instead of the
   * `successMessage` toast. The dialog has an acknowledge button only — the
   * user must explicitly close it. Used for **one-shot reveals** of values
   * the user must copy now because they cannot be retrieved later:
   *
   * - TOTP enrollment URI + secret (`enable_two_factor`)
   * - Backup recovery codes (`regenerate_backup_codes`)
   * - Freshly minted OAuth `client_secret` (`rotate_client_secret`,
   *   `create_oauth_application`)
   *
   * `fields` selects what to render and how. Each entry's `path` is a dot
   * path into `result.data` (e.g. `'totpURI'`, `'backupCodes'`,
   * `'client.client_secret'`). When `fields` is omitted, the renderer falls
   * back to JSON-printing the whole response under a single block.
   *
   * `format` (dialog-level) is a default for fields that don't carry their
   * own `format`; the per-field `format` always wins.
   *
   * Renderer contract (objectui):
   * - `qrcode` — render the value as a QR code; also render the raw string
   *   underneath with a copy button (so the user can paste into apps that
   *   don't scan).
   * - `code-list` — value must be an array of strings; render each in a
   *   monospace row with per-row copy and a "Copy all" affordance.
   * - `secret` — render a single string masked by default with a reveal
   *   toggle and copy button.
   * - `text` — plain text with copy.
   * - `json` — pretty-printed JSON in a monospace block.
   *
   * The dialog SHOULD set `refreshAfter` to true on close (separate from
   * the existing `refreshAfter` flag, which fires immediately on success).
   */
  resultDialog: strictObject({
    surface: 'this result dialog',
    history: ACTION_HISTORY,
    aliases: { label: 'title', heading: 'title', message: 'description', body: 'description', ok: 'acknowledge', confirm: 'acknowledge', button: 'acknowledge', display: 'format', render: 'format', show: 'fields', reveal: 'fields' },
  }, {
    title: I18nLabelSchema.optional(),
    description: I18nLabelSchema.optional(),
    acknowledge: I18nLabelSchema.optional().describe('Acknowledge button label, e.g. "I have saved this"'),
    format: z.enum(['qrcode', 'code-list', 'secret', 'text', 'json']).optional().describe('Default format for fields without their own format. Defaults to json when omitted.'),
    fields: z.array(strictObject({
      surface: 'this result dialog field',
      history: ACTION_HISTORY,
      aliases: { key: 'path', field: 'path', name: 'path', title: 'label', display: 'format', render: 'format' },
    }, {
      path: z.string().describe('Dot path into result.data (e.g. "totpURI", "client.client_secret").'),
      label: I18nLabelSchema.optional(),
      format: z.enum(['qrcode', 'code-list', 'secret', 'text', 'json']).optional().describe('Per-field format override.'),
    })).optional().describe('Which fields from result.data to render. Omit to dump full JSON.'),
  }).optional().describe('Render API response in a one-shot reveal dialog (suppresses successMessage when set).'),
  
  /** Access */
  /**
   * Whether the action is offered at all. Three arms, one meaning — see
   * {@link ActionConditionInputSchema}: `false` parks the action, `true` is the
   * explicit default, and a predicate gates it per record/user/app/features.
   *
   * ⚠️ Client-side hiding is UX, not authorization — the button is gone, the
   * route is not. An action gated for access-control reasons must also be
   * refused server-side (`requiredPermissions`, or the action's own body).
   */
  visible: ActionConditionInputSchema.optional().describe('Visibility predicate — `true`/`false` literal, CEL string, or `{dialect, source}` envelope. The action is offered when it evaluates TRUE. Omit = always visible.'),
  /**
   * Declarative capability gate (#2874) — action-level twin of the param
   * `requiresFeature`. Lowered at parse time into `visible` (`== true` for
   * opt-in flags, `!= false` for default-on; AND-composed with an explicit
   * `visible`) and stripped from the output. See `PUBLIC_AUTH_FEATURES` in
   * `@objectstack/spec/kernel`.
   */
  requiresFeature: z.enum(PUBLIC_AUTH_FEATURE_NAMES).optional().describe('Public auth feature flag gating this action; lowered into `visible` at parse time.'),
  /**
   * Whether the action is offered but refused. Same three arms as `visible`
   * ({@link ActionConditionInputSchema}) — a disabled action stays on screen
   * (usually greyed, with the reason in a tooltip) where a non-visible one is
   * gone entirely.
   */
  disabled: ActionConditionInputSchema.optional().describe('Disabled predicate — `true`/`false` literal, CEL string, or `{dialect, source}` envelope. The action is shown but refused when it evaluates TRUE. Omit = never disabled.'),

  /**
   * [ADR-0066 D4] System capabilities required to INVOKE this action — a
   * dual-surface gate from ONE declaration: the PLATFORM ACTION ROUTE rejects
   * the call with 403 when the caller's systemPermissions don't cover these (the
   * source of truth), and the objectui action surfaces hide the button using the
   * same requirement. Independent of `visible` (CEL): this is the RBAC
   * capability contract, mirroring `App.requiredPermissions`.
   *
   * **Server enforcement covers the platform's own invocation paths only** —
   * `POST /api/v1/actions/<object>/<action>` (and the MCP/AI path), which is
   * where `type: 'script' | 'flow' | 'modal'` actions land. A `type: 'api'`
   * action whose `target` is a self-authored endpoint is called by the browser
   * DIRECTLY: the platform never sees the request, so nothing checks this
   * declaration server-side. Such an endpoint MUST re-check the capability
   * itself (framework#3923) — treat the UI gate there as a courtesy, not a
   * boundary.
   */
  requiredPermissions: z.array(z.string()).optional().describe('[ADR-0066 D4] Capabilities required to invoke this action. Enforced with 403 on the platform action route (script/flow/modal + MCP) and mirrored as a UI hide; a `type: api` action pointed at a custom endpoint must re-check it there.'),

  /** Keyboard Shortcut */
  // `shortcut` and `bulkEnabled` REMOVED by the 2026-07 #3896 audit close-out —
  // both were authorable capability claims nothing enforced (ledger: dead,
  // #3686 re-verification): ActionEngine registered them but no keydown path
  // ever dispatched a shortcut, and the multi-select toolbar reads the LIST
  // VIEW's bulkActions, never this flag. Tombstoned with the prescription;
  // `action-inert-keys-removed` strips them from authored sources.
  shortcut: retiredKey(
    '`action.shortcut` was removed in @objectstack/spec 17.0.0 (#3896 audit close-out) — ' +
    'it never triggered anything: no keydown listener feeds ActionEngine.getShortcuts(), and ' +
    "objectui's keyboard stack (useKeyboardShortcuts) is hand-registered and never consults " +
    'action metadata. Delete the key. For a real shortcut, register the key in the Console ' +
    'keyboard stack and have its handler invoke the action by name. ' +
    'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),
  bulkEnabled: retiredKey(
    '`action.bulkEnabled` was removed in @objectstack/spec 17.0.0 (#3896 audit close-out) — ' +
    'the multi-select toolbar is driven by the LIST VIEW\'s `bulkActions` / `bulkActionDefs`, ' +
    'never by this flag, so setting it changed nothing. Delete the key and declare the action ' +
    "in the view's `bulkActions` instead. " +
    'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),

  /**
   * AI exposure block (ADR-0011). Opt-in, default off: an action is exposed
   * to AI agents only when `ai.exposed === true`, in which case `ai.description`
   * is required. See {@link ActionAiSchema}.
   */
  ai: ActionAiSchema.optional().describe('AI exposure (opt-in). Set ai.exposed=true + ai.description to make this callable by agents.'),

  /**
   * Row-context: when the action runs from a list_item location, this body key
   * receives the row's id (or the field named by `recordIdField`). Defaults to
   * `id` when omitted but `recordIdField` is set; otherwise no injection.
   */
  recordIdParam: z.string().optional().describe('Body key to inject the row id into when running from a list_item context.'),
  /**
   * Row field whose value seeds `recordIdParam`. Defaults to `'id'` when
   * `recordIdParam` is set. Use this when the body key expects a non-id value
   * (e.g. `token` for `revoke-session`).
   */
  recordIdField: z.string().optional().describe('Row field whose value seeds recordIdParam. Defaults to "id".'),
  /**
   * Request-body shape. `'flat'` (default) sends collected params at the top
   * level. `{ wrap: 'data' }` nests the user-collected params under that key
   * (used by better-auth `organization/update`), while `recordIdParam` and
   * other top-level keys stay flat.
   */
  bodyShape: z.union([
    z.literal('flat'),
    strictObject({
      surface: 'this body shape',
      history: ACTION_HISTORY,
      aliases: { key: 'wrap', under: 'wrap', nest: 'wrap', root: 'wrap' },
    }, { wrap: z.string() }),
  ]).optional().describe('Body wrapping: flat (default) or { wrap: key } to nest user-collected params under a key.'),
  /**
   * HTTP method to use when `type: 'api'`. Defaults to `POST`. Use `PATCH` to
   * call data-API update endpoints (e.g. `/api/v1/sys_api_key/{id}` with
   * `bodyExtra: { revoked: true }`).
   */
  method: z.enum(['POST', 'PATCH', 'PUT', 'DELETE']).optional().describe('HTTP method for type:"api" actions. Defaults to POST.'),
  /**
   * Static body fragment merged into the outgoing request body for `type:'api'`
   * actions. Useful for constants the user shouldn't (or can't) edit, e.g.
   * `bodyExtra: { resend: true }` on a resend-invitation action that reuses
   * better-auth's `invite-member` endpoint. Applied after user-collected
   * params and `recordIdParam` so constants always win.
   *
   * **This is the static-payload key for `type:'api'`, on registered AND inline
   * actions alike** (#5777). `params` is the parameter DEFINITION array and
   * carries no payload; the ruled direction A gave the payload its own key
   * rather than unioning two meanings onto one name. The name is not new and is
   * deliberately not new: `body` is already taken on this schema (the `script`
   * action's L1/L2 hook body, and the #4352 refinement rejects it alongside any
   * other `type`, so it could never carry an api payload), and `payload` is
   * already an ALIAS pointing here — written in the table above by #5013 for
   * exactly that reason. So an author who writes `payload: {…}` is renamed onto
   * this key, and one who writes `body: {…}` on a `type:'api'` action is
   * rejected by the refinement that owns that name.
   *
   * Values are not required to be literals: objectui's console action runtime
   * runs `resolvePageVarTokens` over this record, so `{{page.<var>}}` tokens
   * resolve against the live page-variable snapshot the same way they do for a
   * collected-params body. That is what makes it the correct home for a
   * pure-SDUI form submit (`examples/app-showcase/.../contact-form.page.ts`).
   */
  bodyExtra: z.record(z.string(), z.unknown()).optional().describe('Static request-body fields for a type:"api" action, merged last (overrides user params). `{{page.<var>}}` tokens are resolved by the runtime. This — not `params` — is where a payload goes.'),
  /**
   * Semantic mode hint — UI / runtime can use this to pick confirm copy,
   * default variants, success messaging. Pure metadata; no runtime branching.
   */
  mode: z.enum(['create', 'edit', 'delete', 'custom']).optional().describe('Semantic mode of the action.'),

  /**
   * Open the action's result in a NEW TAB. The renderer pre-opens the tab
   * synchronously on click (preserving the user gesture so popup blockers
   * don't fire), paints a progress page, then drives the tab to the
   * handler's returned `redirectUrl` — or, when `newTabUrl` is set, straight
   * to that URL with no server round trip.
   */
  opensInNewTab: z.boolean().optional().describe('Open the action result in a new tab. The renderer pre-opens the tab synchronously on click (popup-blocker-safe) and navigates it to the handler\'s redirectUrl.'),

  /**
   * Zero-roundtrip new-tab target. A path template the renderer navigates
   * the pre-opened tab to IMMEDIATELY on click, skipping the action POST
   * entirely. Only valid together with `opensInNewTab`. The target endpoint
   * MUST perform all auth/authz itself (e.g. the cloud `/sso-open` endpoint,
   * which re-runs every check the POST half would have done). Supports the
   * `{recordId}` placeholder, URL-encoded on substitution.
   */
  newTabUrl: z.string().optional().describe('Direct new-tab URL template ({recordId} placeholder). When set with opensInNewTab, the renderer navigates the pre-opened tab here immediately — no action POST. The endpoint must enforce auth itself.'),

  /** ARIA accessibility attributes */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),

  // ADR-0010 — runtime protection envelope (internal — set by the loader).
  // `action` is a registered metadata type, so `MetadataPlugin`'s loader stamps
  // `_packageId` / `_provenance` on it. Undeclared, they were dropped on every
  // parse. This is the LAST name on the undeclared-envelope debt list the
  // structural walk opened with eight of.
  ...MetadataProtectionFields,
});

export const ActionSchema = lazySchema(() => actionObject().refine((data) => {
  // Require `target` for types that reference an external resource
  if (TARGET_REQUIRED_TYPES.has(data.type) && !data.target) {
    return false;
  }
  return true;
}, {
  message: "Action 'target' is required when type is 'url', 'flow', 'modal', 'api', or 'form'.",
  path: ['target'],
}).refine((data) => {
  // A `script` action must be *executable*: it needs either an inline `body`
  // (the runtime invokes it in the sandbox) or a `target` naming a registered
  // bundle function. With neither, AppPlugin registers no engine handler and
  // the action fails at runtime with `Action '<name>' on object '*' not found`
  // (the #2169 Mark Done bug) — a soft failure invisible to build & shape
  // tests. Reject it at author/compile time instead.
  if (data.type === 'script' && !data.body && !data.target) {
    return false;
  }
  return true;
}, {
  message:
    "A 'script' action requires either an inline `body` (sandboxed L1/L2 handler) or a `target` (a registered bundle function name).",
  path: ['body'],
}).refine((data) => {
  // The mirror image of the rule above: a `body` on a NON-script action never
  // runs. `type: 'modal' | 'url' | 'flow' | 'api' | 'form'` all dispatch on
  // `target` (the page to open, the URL, the flow, the endpoint), so the
  // renderer has no point at which it would invoke a body — the action opens
  // its target and the body is silently skipped.
  //
  // This is the same invisible-failure shape as #2169: it passes build, passes
  // shape tests, and only shows up as "the modal opened but nothing was
  // written" (#3530, where `type: 'modal'` + `params` + `body` was authored
  // expecting the body to run on submit). Reject it at author time and name the
  // fix — `type: 'script'` collects the same `params` and DOES run the body.
  if (data.type !== 'script' && data.body) {
    return false;
  }
  return true;
}, {
  message:
    "`body` only runs for `type: 'script'` — a non-script action dispatches on `target` and silently ignores its body. " +
    "To collect `params` and then run the body, use `type: 'script'`; to open a page/modal, drop the `body` and keep `type: 'modal'` with `target` naming the page.",
  path: ['body'],
}).refine((data) => {
  // ADR-0011: an exposed action must carry an LLM-facing description.
  if (data.ai?.exposed === true && !data.ai.description) {
    return false;
  }
  return true;
}, {
  message: 'ai.description is required (≥40 chars) when ai.exposed is true.',
  path: ['ai', 'description'],
}).refine((data) => {
  // ADR-0011: paramHints keys must reference a declared param (or the
  // auto-injected `recordId`), so a typo can't silently no-op.
  const hints = data.ai?.paramHints;
  if (!hints) return true;
  const known = new Set<string>(['recordId']);
  for (const p of data.params ?? []) {
    const key = p.name ?? p.field;
    if (key) known.add(key);
  }
  return Object.keys(hints).every((k) => known.has(k));
}, {
  message: 'ai.paramHints keys must match a declared param name (or "recordId").',
  path: ['ai', 'paramHints'],
}).transform((data, ctx) => lowerRequiresFeature(data, ctx)));

export type Action = z.input<typeof ActionSchema>;
/** Post-parse shape of {@link Action} — defaults applied, transforms run (ADR-0122). */
export type ActionParsed = z.infer<typeof ActionSchema>;
export type ActionParam = z.input<typeof ActionParamSchema>;
/** Post-parse shape of {@link ActionParam} — defaults applied, transforms run (ADR-0122). */
export type ActionParamParsed = z.infer<typeof ActionParamSchema>;

/**
 * Legacy spellings an inline action may carry, folded to canonical on parse.
 *
 * `navigation` is a `type` no spec enum ever declared, and `to` a `target` no
 * spec schema ever declared — yet both are what cloud's tenant pages actually
 * write on an `element:button` (`{ type: 'navigation', to: PRICING_ROUTE }`,
 * five sites across the billing and pricing funnel). They reached a real
 * dispatcher: objectui's `ActionRunner` has a `navigation` case reading
 * `nav.to ?? nav.target`.
 *
 * `url` + `target` is the canonical pair, and it is also the *better* one — the
 * runner's `url` path adds `${param.X}` / `${ctx.X}` interpolation, `apiBase`
 * promotion for `/api/…` paths, and popup-blocker-safe `openIn` handling, none
 * of which the `navigation` path has. So this is a bridge with an end state, not
 * a second vocabulary: authored `navigation`/`to` keep validating, parse output
 * is always `url`/`target`, and the aliases get a `retiredKey` tombstone once
 * the producers are migrated.
 *
 * Exported so a producer can normalize before writing, rather than inventing its
 * own fold. objectstack-ai/objectui#2997.
 */
export function normalizeInlineAction(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const v = value as Record<string, unknown>;
  const needsType = v.type === 'navigation';
  const needsTarget = v.target === undefined && typeof v.to === 'string';
  if (!needsType && !needsTarget && !('to' in v)) return value;
  const out: Record<string, unknown> = { ...v };
  if (needsType) out.type = 'url';
  if (needsTarget) out.target = v.to;
  delete out.to;
  return out;
}

/**
 * An action declared **inline** on a UI surface, rather than registered by name.
 *
 * The execution half of {@link ActionSchema} — `.pick()`ed from the same field
 * definitions, so the `describe()` text, the operator vocabulary and the
 * `target`-required rule are shared rather than restated — minus everything that
 * only means something for a *registered* action: `objectName`, `locations`,
 * `order`, `ai` exposure, `requiredPermissions`, `visible`/`disabled`
 * predicates, `resultDialog`.
 *
 * `name` and `label` are optional here, which is the substantive difference.
 * `ActionSchema` requires both because a registry entry needs an identity and a
 * menu label; an inline action has neither — the host supplies the label (an
 * `element:button` has its own `label` prop, and requiring `action.label` too
 * would mean writing it twice).
 *
 * Scoped deliberately to what a host actually honours. `element:button`'s
 * renderer forwards exactly these fields to the `ActionRunner`; `icon` and
 * `variant` are excluded because the button has its own, and `body` because a
 * page button running an inline sandboxed script is a separate decision. Widen
 * this when a renderer widens, not before — a declared field no renderer reads
 * is the failure this schema exists to stop.
 *
 * **`bodyExtra` is the one field picked AHEAD of its renderer, knowingly**
 * (#5777, maintainer ruling 2026-08-06). It is the only authorized way for an
 * inline `type:'api'` action to carry a static request payload: `params` is the
 * parameter DEFINITION array and the ruling refused a same-name union, so
 * without this pick the inline shape has no payload key at all — the cost the
 * issue's option C names. The pick is therefore what makes the ruled direction
 * A reachable from a page, and it is deliberately taken before objectui's half.
 *
 * The divergence that buys, stated rather than hidden: objectui's
 * `element:button` renderer builds an explicit forward list
 * (`packages/components/src/renderers/basic/elements.tsx`) that does not yet
 * include `bodyExtra`, so between this landing and that follow-up an inline
 * `bodyExtra` validates, publishes, and is dropped one hop before the runner.
 * The runner and the console `apiHandler` below it already read the key — the
 * missing hop is the forward list alone. Direction of the window: spec accepts
 * ahead of the renderer, never the reverse. Tracked as the objectui card the
 * ruling splits out under `Blocked-by:` this change; the general rule above is
 * unchanged for every other field.
 */
export const InlineActionSchema = lazySchema(() => z.preprocess(
  normalizeInlineAction,
  actionObject().pick({
    type: true,
    name: true,
    label: true,
    target: true,
    openIn: true,
    method: true,
    params: true,
    bodyExtra: true,
    confirmText: true,
    successMessage: true,
    errorMessage: true,
    refreshAfter: true,
    opensInNewTab: true,
  }).partial({
    name: true,
    label: true,
  }).refine((data) => {
    // The same rule ActionSchema's first refinement applies, for the same
    // reason: a `url`/`flow`/`modal`/`api`/`form` action with no `target` has
    // nothing to dispatch to and fails silently at click time.
    if (TARGET_REQUIRED_TYPES.has(data.type) && !data.target) return false;
    return true;
  }, {
    message: "Inline action 'target' is required when type is 'url', 'flow', 'modal', 'api', or 'form' (`to` is accepted as a legacy spelling).",
    path: ['target'],
  }),
));

export type InlineAction = z.input<typeof InlineActionSchema>;
/** Post-parse shape of {@link InlineAction} — defaults applied, transforms run (ADR-0122). */
export type InlineActionParsed = z.infer<typeof InlineActionSchema>;

/**
 * Action Factory Helper
 */
export const Action = {
  create: (config: z.input<typeof ActionSchema>): Action => ActionSchema.parse(config),
} as const;

/**
 * Type-safe factory for a global or object action. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: Action` literal.
 */
export function defineAction(config: z.input<typeof ActionSchema>): ActionParsed {
  return ActionSchema.parse(config);
}
