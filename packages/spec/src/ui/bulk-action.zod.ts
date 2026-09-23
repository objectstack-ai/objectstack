// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
import { EvaluatedExpressionInputSchema } from '../shared/expression.zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { FieldType } from '../data/field.zod';

// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS (#4457) — engineering rationale; the author-facing
// description is the JSDoc below, which is what the generated reference page
// renders.
//
// Until #4457 `bulkActionDefs` was `z.array(z.record(z.string(), z.any()))` — a
// selection-bar button with NO SHAPE AT ALL. The real contract lived only in
// objectui's `BulkActionDef` interface (`packages/types/src/objectql.ts`) and in
// the executor that reads it, so every authoring mistake landed as a silent
// runtime downgrade instead of a parse error:
//
//   - `opeartion: 'update'` → no `operation` at all → the executor's exhaustive
//     switch falls through to `Unknown operation: undefined`, PER ROW.
//   - `excution: 'aggregate'` → the def stays per-record, so the endpoint
//     written for ONE `_selectedIds` call gets N calls instead — the exact
//     defect objectui#3139 existed to make expressible.
//   - `actionDef: {...}` → a renderer-INTERNAL key (attached by
//     `resolveBulkActions` when it resolves a name) authored by hand: it looks
//     like it should work, and the executor will dispatch whatever is inside it,
//     bypassing the action registry, its permission gate and its param contract.
//
// That is ADR-0018's "second vocabulary" smell (an action surface sharing none
// of `ActionSchema`'s checks) crossed with ADR-0078's silently-inert metadata.
// The def gets the same treatment `ActionParamSchema` got in #3746/#4001: a
// strict shape whose unknown-key error names the offending key and the
// canonical spelling.
//
// THE RENDERER IS THE SOURCE OF TRUTH, AND THIS MIRRORS IT DELIBERATELY.
// Every key exists because objectui reads it, and each one's shape is the shape
// objectui's type declares — including the two places that is narrower or wider
// than the platform default:
//
//   - `label` and the param/option labels are `z.string()`, not
//     `I18nLabelSchema`. An authored def reaches the grid VERBATIM
//     (`app-shell/ObjectView.tsx` passes `bulkActionDefs` straight through;
//     `resolveBulkActions` documents that authored defs are "left as-authored"),
//     so nothing resolves an `{ en, zh }` map on this path — and the bar renders
//     `def.label` as a React child, so blessing the map form would trade a parse
//     error for a blank screen. Localizing means declaring a real action and
//     naming it in `bulkActions`: THAT path runs through the i18n resolver
//     (`toBulkActionDef`'s `localize`).
//   - `params[]` is STRICT (#18177, maintainer ruling batch #146 item 4,
//     letter A). It used to be `.passthrough()`, mirroring the
//     `[key: string]: unknown` catch-all on objectui's `BulkActionParam` — and
//     that made its accept a NULL READING: measured against installed spec
//     17.4.0 it took `zzz_nonsense_key_that_no_producer_emits_8755` in the same
//     run that it took `dependsOn`, while `ActionParamSchema` one surface over
//     refused both with `unrecognized_keys`. A shape that examines nothing can
//     license nothing, so the twins now carry the same strictness.
//     ⚠️ What that CHANGED, stated rather than buried: the widget-config keys
//     the catch-all forwarded (`min`/`max`/`step`/…) are keys of a FIELD, not
//     of a bulk param, and this shape declares none of them — they are refused
//     now, with the `BULK_PARAM_WIDGET_CONFIG_KEYS` prescription below naming
//     where the vocabulary IS real. A census of authored bulk params over the
//     two repos reachable from the landing session found ZERO carrying an
//     undeclared key, so no in-corpus configuration stops working; hotcrm was
//     NOT REACHABLE for that census and is recorded unmeasured, never clean.
//     The one key measured LIVE on this surface is DECLARED rather than
//     refused — `dependsOn`, below. Retiring it would delete a capability that
//     ships.
//   - `params[].options[]` is `.passthrough()` — and since the parent closed it
//     is the ONE open level left here. Still measured, never inherited from a
//     neighbour by symmetry. objectui's option TYPE is closed
//     (`Array<{ label; value }>`, `packages/types/src/objectql.ts:271`), but the
//     type is not what an authored option meets: `bulkParamToField` SPREADS each
//     entry — `options?.map(o => ({ ...o, value: String(o.value) }))`,
//     `packages/plugin-grid/src/components/bulkParamToField.ts:131` — so every
//     extra key survives verbatim into the field metadata, where the widget
//     vocabulary is `SelectOptionMetadata`
//     (`packages/types/src/field-types.ts:288`): `color` / `icon` / `disabled` /
//     `visibleWhen` beyond the pair, and read (`option?.color`,
//     `packages/fields/src/index.tsx:1089`). Stripping here therefore DELETES
//     authored widget config the renderer would have honoured — the silent
//     narrowing this file exists to stop. Until #4001's 2026-08-03 re-measure
//     this level was bare strip while the ledger prose called it open: one
//     intent, two postures. `passthrough` is that intent in machine-readable
//     form; the prose alone had already been proven able to drift.
//
// KNOWN DIVERGENCE, DELIBERATELY NOT FIXED HERE. A bulk param and an action
// param are the same idea under different spellings (`help`/`helpText`,
// `default`/`defaultValue`, `object`/`reference`, plus `labelField`, which
// `ActionParamSchema` has no counterpart for — `displayField` is the FIELD
// spelling of the same idea). Closing this shape turned those from keys that
// rode through and did nothing into RENAMES: each is an `aliases` row below, so
// an author who reaches for the neighbouring surface's word is told the one
// this surface takes. objectui already owns a converter
// for the PROMOTED direction (`toBulkParam` in `resolveBulkActions.ts`);
// converging the AUTHORED direction means teaching the renderer to run authored
// params through it and giving `ActionParamSchema` a `labelField` — a cross-repo
// change with its own migration, not a rider on typing the def. Typing them as
// they are is what makes the divergence visible instead of implied, which is the
// prerequisite for closing it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bulk Action Schemas
 *
 * The vocabulary of a list view's `bulkActionDefs` — one entry per button in
 * the multi-select toolbar. Use a def for a mass data-plane mutation that no
 * action expresses (`operation: 'update'` with a patch, or `'delete'`), or for
 * an `operation: 'custom'` + `execution: 'aggregate'` entry that dispatches the
 * action it NAMES once for the whole selection.
 *
 * For the per-record dispatch, name the action in the view's
 * `bulkActions: ['<name>']` instead — the bare-string form, promoted with the
 * action's own label, params and `visible`.
 */

/** How the executor mutates the selected records. */
export const BulkActionOperationSchema = z.enum(['update', 'delete', 'custom']);
export type BulkActionOperation = z.input<typeof BulkActionOperationSchema>;

/** How many dispatches a `custom` def makes for a selection of N records. */
export const BulkActionExecutionSchema = z.enum(['perRecord', 'aggregate']);
export type BulkActionExecution = z.input<typeof BulkActionExecutionSchema>;

/**
 * Keys a widget on this path really reads off the field bag — and which this
 * shape nevertheless does NOT declare, so their rejection has to carry the
 * reason rather than a bare "unknown key".
 *
 * Measured, not listed from memory: `bulkParamToField` destructures the eleven
 * declared keys out and spreads the REST onto the field metadata it hands
 * `getLazyFieldWidget`, so any of these reaches a widget that reads it —
 * `min`/`max`/`step` (NumberField / SliderField / CurrencyField / PercentField
 * / RatingField), `accept`/`maxSize`/`crop`/`capture` (FileField / ImageField),
 * `rows` (TextAreaField / RichTextField), `precision`/`scale`, `dimensions`
 * (VectorField), `defaultName` (AvatarField), and the picker family
 * `descriptionField` / `idField` / `allowCreate` / `lookupColumns` /
 * `lookupPageSize` / `lookupFilters` / `picker` / `subtitle` / `avatarField`
 * (LookupField, and UserField through it).
 *
 * ⛔ Reading that as "so declare them" is the move this file does not make. A
 * declared key is published contract whose removal costs a full retirement, and
 * the census that accompanied the close found NO authored bulk param writing
 * any of them — the evidence licenses a loud rejection, not twenty new members.
 * `format` earns its absence from the list the same way: the module header used
 * to name it beside min/max/step, and the sweep found no FORM widget reading it
 * at all.
 *
 * ⚠️ The prescription deliberately refuses the obvious-sounding remedy. There
 * is no field-backed param route on the bulk surface — `toBulkParam` never
 * consults the object's field definitions — so "declare it on the field and let
 * the dialog inherit" would be a confidently wrong answer, the shape this
 * campaign has already shipped more than once.
 */
const BULK_PARAM_WIDGET_CONFIG_KEYS = [
  'min', 'max', 'step', 'precision', 'scale', 'rows',
  'accept', 'maxSize', 'crop', 'capture', 'dimensions', 'defaultName',
  'descriptionField', 'idField', 'allowCreate',
  'lookupColumns', 'lookupPageSize', 'lookupFilters', 'picker', 'subtitle', 'avatarField',
] as const;

/**
 * One input collected ONCE by the bulk dialog before the run (never re-prompted
 * per record). For `operation: 'update'` the collected values ARE the patch
 * (merged over the def's static `patch`); for an aggregate `custom` def they
 * ride along as the action's params.
 *
 * STRICT since #18177 — see the module header. An unknown key is refused by
 * name, carrying either the rename or the prescription that fixes it, exactly
 * as on `ActionParamSchema`. The sentence this replaced said strictness "would
 * lie" at this level; the measurement said the opposite — the OPEN shape was
 * the lie, because it accepted a nonsense key and `dependsOn` in one breath and
 * could therefore license neither.
 */
export const BulkActionParamSchema = lazySchema(() => strictObject(
  {
    surface: 'this bulk action param',
    aliases: {
      // The KNOWN DIVERGENCE pairs from the module header, in the direction an
      // author actually slips: they are writing an ACTION param (or a FIELD)
      // and reaching for its word. `toBulkParam` maps the same three when it
      // promotes an action param, so the two directions now agree.
      helpText: 'help',
      description: 'help',
      defaultValue: 'default',
      reference: 'object',
      referenceTo: 'object',
      // `labelField` is this surface's name for the picker's option label;
      // `FieldSchema` and objectui's picker both spell it `displayField`.
      displayField: 'labelField',
      title: 'label',
    },
    guidance: {
      field:
        '`field` declares a FIELD-BACKED param, and the bulk surface has no such route: '
        + '`resolveActionParams` consults the object\'s field definitions for the single-record '
        + 'dialog, `resolveBulkActions`\'s `toBulkParam` never does. Declare the param inline '
        + 'instead — `name` + `type`, plus `object` (and optionally `labelField`) for a picker.',
      objectOverride:
        '`objectOverride` belongs to a field-backed ACTION param, which names the object owning '
        + 'the referenced field. A bulk param is always inline; the object a picker searches is '
        + '`object`.',
      visible:
        '`visible` on a bulk param has no reader — the dialog renders every param it is given. '
        + 'The per-record eligibility predicate belongs on the DEF (`bulkActionDefs[].visible`), '
        + 'where it gates the button and narrows the run; a per-OPTION rule goes on '
        + '`options[].visibleWhen`.',
      visibleWhen:
        '`visibleWhen` is a per-OPTION key, not a param one: write it inside `options[]`, where '
        + 'the select/multiselect/radio/checkbox widgets narrow the offered set against the '
        + 'dialog\'s own in-progress values. To gate the whole button, use the def\'s `visible`.',
      carryOver:
        '`carryOver` is an ACTION-param contract (seed from the current row, render read-only, '
        + 'submit verbatim). A bulk dialog runs over a SELECTION and holds no single row to seed '
        + 'from, so there is nothing for it to carry over. Put a fixed value in the def\'s '
        + '`patch` instead, which is merged under the collected params.',
      defaultFromRow:
        '`defaultFromRow` prefills an ACTION param from the current row. A bulk dialog has a '
        + 'selection, not a row — use `default` for a fixed prefill, or the def\'s `patch` for a '
        + 'value the user should not see.',
      requiresFeature:
        '`requiresFeature` is the ACTION param\'s capability sugar, lowered into `visible` at '
        + 'parse time. This shape has no `visible` to lower into; gate the whole button with the '
        + 'def\'s `visible` (`features.x`) or its `requiredPermissions`.',
    },
    guidanceSets: [{
      name: 'BULK_PARAM_WIDGET_CONFIG_KEYS',
      keys: BULK_PARAM_WIDGET_CONFIG_KEYS,
      prescription:
        'widget-config keys like `min` / `max` / `step` / `accept` / `lookupFilters` are keys of a '
        + 'FIELD (`FieldSchema`, `data/field.zod.ts`), not of a bulk action param — this shape '
        + 'declares none of them. Until it was closed they rode through onto the renderer\'s field '
        + 'bag and whichever widget read one honoured it; that door is shut, so the value is '
        + 'refused rather than silently forwarded. ⛔ Declaring the key on the object\'s FIELD does '
        + 'not reach this dialog either: the bulk surface has no field-backed param route. Remove '
        + 'the key, and open an issue if a bulk param genuinely needs it declared here.',
    }],
    history:
      'Until this shape was closed, `params[]` was `.passthrough()` — every unknown key rode through '
      + 'onto the renderer\'s field bag, so a mis-spelled widget config shipped as a control that '
      + 'quietly ignored it, and a nonsense key parsed exactly as cleanly as a real one.',
  },
  {
  name: z.string().min(1).describe('Param key — becomes params[name] in the patch / action params bag.'),
  label: z.string().optional().describe('Field label in the dialog. Plain string: an authored def is not i18n-resolved (see module header).'),
  help: z.string().optional().describe('Help text under the field. (An ActionParam spells this `helpText` — known divergence, module header.)'),
  type: FieldType.describe('Field widget to render, from the standard field-type vocabulary (text/number/select/lookup/date/…).'),
  required: z.boolean().optional().describe('Blocks the Confirm button until a value is present.'),
  default: z.unknown().optional().describe('Value applied when the dialog opens. (An ActionParam spells this `defaultValue`.)'),
  options: z.array(z.object({
    label: z.string().describe('Option label (plain string — not i18n-resolved on this path).'),
    value: z.union([z.string(), z.number(), z.boolean()]).describe('Stored value.'),
  }).passthrough()).optional().describe('Static options for select-style widgets. Each entry is `{ label, value }` plus any extra widget config — the entry is open (`.passthrough()`) because the renderer forwards unknown option keys to the field widget, which reads `color` / `icon` / `disabled` / `visibleWhen` beyond the declared pair.'),
  object: SnakeCaseIdentifierSchema.optional().describe("Target object for a `lookup` widget. (An ActionParam spells this `reference`.)"),
  labelField: z.string().optional().describe('Related-object field used as the option label for a `lookup` widget (defaults to name/full_name/email/id).'),
  multiple: z.boolean().optional().describe('Allow picking multiple values — the param value becomes an array and is written to the patch as-is.'),
  placeholder: z.string().optional().describe('Placeholder text.'),

  /**
   * Cascade binding — the ONE key this close DECLARES rather than refuses
   * (#18177, ruling batch #146 item 4 letter A).
   *
   * Shape and description mirror the single-record twin. ⚠️ That twin is
   * `FieldSchema.dependsOn` (`data/field.zod.ts`), NOT `ActionParamSchema`,
   * which declares no `dependsOn` at all: the single-record dialog reaches the
   * key through the FIELD-BACKED route (`resolveActionParams` resolves the
   * object's field definitions), which is the very route the bulk surface does
   * not have. So one vocabulary, two doors — and on this door the key has to be
   * written on the param itself.
   *
   * Live on BOTH widget families reachable from the bulk dialog, measured on
   * the renderer rather than inferred from this schema:
   *  - the OPTION family reads `field?.dependsOn` and gates/refreshes the
   *    offered set through `useCascadingOptions` (`SelectField`,
   *    `MultiSelectField`, `RadioField`, `CheckboxesField`);
   *  - the reference-bearing PICKER family reads the same key off the same bag
   *    as `cascadeMeta?.dependsOn` and lowers it into a hard candidate filter
   *    (`LookupField`, and `UserField` through it).
   *
   * It reaches them because `bulkParamToField` does not destructure it out — it
   * rides the `...extra` spread onto the field metadata. That was already true
   * while this shape was open, which is why the accept could not be read as a
   * licence and the key could not be retired either: an ablation removing it
   * from the spread reddened 7 of 12 cases in objectui.
   */
  dependsOn: z.array(z.union([z.string(), strictObject({
    surface: 'this dependsOn entry',
    history:
      'Until this shape was closed these were dropped silently — the entry still parsed, so a '
      + 'mis-spelled binding left the picker ungated and unscoped.',
    aliases: { name: 'field', fieldName: 'field', local: 'field', remote: 'param', remoteField: 'param', key: 'param' },
  }, {
    field: z.string(),
    param: z.string().optional(),
  })])).optional().describe("Declares that this param's available values depend on the value of other field(s) on the same record — the form gates the field until they are set and re-evaluates as they change. For `lookup`/`master_detail` it scopes the candidate query (string = same local/remote key; {field,param} when the remote filter key differs — the {field,param} form is lookup-only). For `select`/`multiselect`/`radio` the actual per-option rule lives in each option's `visibleWhen`; list the referenced fields here (string form) so the option list gates and refreshes with the parent. On a BULK param the record is the dialog's own in-progress param values — a bulk run holds a selection, not a row — so a binding names a SIBLING PARAM of the same def."),
}));
export type BulkActionParam = z.input<typeof BulkActionParamSchema>;

/**
 * Rich, schema-driven definition of one button in the multi-select bar.
 *
 * Two vocabularies reach that bar and they are not interchangeable:
 *
 *  - **`bulkActions: ['<action_name>']`** — names an action the object declares.
 *    The renderer promotes it to a def carrying the action's label, icon,
 *    `visible`, confirm text and params, and dispatches it ONCE PER selected
 *    record. This is the right form for "run this action on each of them".
 *  - **`bulkActionDefs: [{...}]`** (this schema) — a def authored in the view.
 *    Use it for a mass data-plane mutation (`update` / `delete`) that no action
 *    expresses, or for an `execution: 'aggregate'` custom action that must see
 *    the whole selection in ONE call.
 *
 * The refinements below reject the combinations the executor cannot honour.
 * Each one parsed before #4457 and produced a button that reports success while
 * doing nothing, or a key the executor silently drops (ADR-0078) — failure
 * modes invisible from the authoring side, which is why they are caught here
 * rather than written down and hoped for.
 */
export const BulkActionDefSchema = lazySchema(() => strictObject(
  {
    surface: 'this bulk action definition',
    aliases: {
      action: 'name',
      actionname: 'name',
      title: 'label',
      op: 'operation',
      mode: 'execution',
      confirm: 'confirmText',
      confirmmessage: 'confirmText',
      limit: 'maxRecords',
      max: 'maxRecords',
      batch: 'batchSize',
      // The capability gate IS a declared key here too — `requiredPermissions`
      // (ADR-0066 D4, #6257) — so its near-misses RENAME onto it, exactly as
      // they do on `ActionSchema`.
      permissions: 'requiredPermissions', capabilities: 'requiredPermissions',
      requiresPermissions: 'requiredPermissions', requiredCapabilities: 'requiredPermissions',
      acl: 'requiredPermissions',
    },
    guidance: {
      // Not a typo — a real key the RENDERER attaches, which is exactly why an
      // author reaching for it needs more than "did you mean".
      actionDef:
        '`actionDef` is attached by the renderer, not authored: `resolveBulkActions` looks the '
        + 'action up by `name` and inlines it. Writing it by hand smuggles an action definition '
        + 'past the action registry — no permission gate, no param contract, no lint. Declare the '
        + 'action normally and let this def name it.',
      bulkEnabled:
        '`action.bulkEnabled` was retired in spec 17: the selection bar is driven by the LIST '
        + "VIEW's `bulkActions` / `bulkActionDefs`, which is this array. There is nothing to set.",
      recordIdParam:
        '`recordIdParam` belongs on the ACTION, not on the def that names it — a per-record bulk '
        + "run reuses the action's own declaration, and an `execution: 'aggregate'` run carries "
        + 'the whole selection in `params._selectedIds` instead of a single record id.',
    },
    history:
      'Until this shape was closed, the whole array was `z.array(z.record(z.string(), z.any()))` — every key parsed, '
      + 'so a mis-spelled one shipped as a button that silently ran the DEFAULT behaviour (or none '
      + 'at all).',
  },
  {
  name: SnakeCaseIdentifierSchema.describe('Stable identifier — the audit-log action key, and (for an aggregate def) the name of the object action to dispatch.'),
  label: z.string().optional().describe('Button + dialog-header text. Plain string: an authored def is not i18n-resolved (declare a real action and name it in `bulkActions` to get localization).'),
  icon: z.string().optional().describe('Lucide icon name (e.g. "user-check", "trash-2").'),
  variant: z.enum(['primary', 'secondary', 'danger', 'ghost', 'outline']).optional().describe('Visual treatment of the button.'),
  operation: BulkActionOperationSchema.describe("What the executor does: 'update'/'delete' are data-plane mass mutations; 'custom' dispatches an object action (see `execution`)."),
  execution: BulkActionExecutionSchema.optional().describe("For `operation: 'custom'` — 'aggregate' dispatches the named action ONCE for the whole selection, carrying every id in `params._selectedIds`. Required on a custom def: the per-record form is declared as `bulkActions: ['<name>']` instead."),
  patch: z.record(z.string(), z.unknown()).optional().describe("For `operation: 'update'` — static field values applied to every selected record, merged UNDER the user-supplied params so a fixed value can be declared without exposing it in the dialog."),
  params: z.array(BulkActionParamSchema).optional().describe('Inputs collected once before the run. Omit to skip the params step and go straight to confirm.'),
  confirmText: z.string().optional().describe('Confirmation text shown above the affected-record summary.'),
  confirmLabel: z.string().optional().describe('Custom Confirm button label (default: "Run").'),
  visible: EvaluatedExpressionInputSchema.optional().describe('Eligibility predicate (CEL) — a string or a `{dialect, source}` envelope, i.e. `action.visible` without its boolean-literal arm: a per-record predicate has nothing to say as a constant. Evaluated once PER SELECTED RECORD with that record bound: the button is offered when at least one passes, the run covers only those, and the rest are reported as skipped. A record-free predicate (`features.x`, `current_user.y`) therefore behaves as a plain button-level gate. Fail-closed — a predicate that faults excludes the record.'),
  requiredPermissions: z.array(z.string()).optional().describe("[ADR-0066 D4] Capability gate on the button, `action.requiredPermissions` semantics verbatim: absent or empty always passes, several are AND-ed, and a client that cannot resolve the caller's capabilities fails OPEN (the server stays the authority). This key exists for INLINE defs — notably the `update`/`delete` data-plane forms, which dispatch no action and so have nothing to inherit a gate from; a def promoted from `bulkActions: ['<name>']` (or an aggregate def naming a declared action) inherits the action's own declaration instead. On a data-plane def the gate governs visibility only — the write itself is still authorized by the data API's object permissions and server hooks."),
  maxRecords: z.number().int().positive().optional().describe('Selection size above which the run is blocked. Set it on defs whose server work is expensive — an aggregate def carries every selected id in one request.'),
  batchSize: z.number().int().positive().optional().describe('Records per executor batch (default 200). Data-plane operations only — an aggregate run is a single call by definition.'),
})
  .superRefine((def, ctx) => {
    // ── `custom` without `aggregate` is the historical no-op ──────────────
    // `useBulkExecutor`'s custom branch dispatches only when the def carries a
    // renderer-attached `actionDef`, and `resolveBulkActions` attaches one for
    // exactly ONE authored shape: `execution: 'aggregate'`. Every other custom
    // def resolves to `Promise.resolve()` per row — N green ticks, zero work.
    if (def.operation === 'custom' && def.execution !== 'aggregate') {
      ctx.addIssue({
        code: 'custom',
        path: ['execution'],
        message:
          `Bulk action "${def.name}" declares \`operation: 'custom'\` without `
          + `\`execution: 'aggregate'\`, which the renderer treats as a no-op — the button runs, `
          + `reports success for every selected record, and does nothing. Pick the form you meant: `
          + `to run the action ONCE PER record, drop this def and name the action in the view's `
          + `\`bulkActions: ['${def.name}']\` (it is promoted with the action's label, params and `
          + `\`visible\`); to run it ONCE for the whole selection, add \`execution: 'aggregate'\` `
          + `(the handler reads \`params._selectedIds\`). For a mass field update or delete, use `
          + `\`operation: 'update'\` / \`'delete'\` instead.`,
      });
    }

    // ── The rest: keys that parse but the executor never reads ────────────
    if (def.execution !== undefined && def.operation !== 'custom') {
      ctx.addIssue({
        code: 'custom',
        path: ['execution'],
        message:
          `\`execution\` only applies to \`operation: 'custom'\` — a '${def.operation}' def is a `
          + `data-plane mass mutation, always batched per record. Remove it, or switch the def to `
          + `\`operation: 'custom'\` if you meant to dispatch an action.`,
      });
    }
    if (def.patch !== undefined && def.operation !== 'update') {
      ctx.addIssue({
        code: 'custom',
        path: ['patch'],
        message:
          `\`patch\` only applies to \`operation: 'update'\` — a '${def.operation}' def never `
          + `writes fields, so these values are silently dropped. Use \`operation: 'update'\`, or `
          + `move the constant into the action's own \`bodyExtra\`/\`params\` if this is a custom def.`,
      });
    }
    if (def.params !== undefined && def.operation === 'delete') {
      ctx.addIssue({
        code: 'custom',
        path: ['params'],
        message:
          `\`params\` on a \`delete\` def collects values the executor never reads — a bulk delete `
          + `takes ids only. Remove them, or use \`operation: 'update'\` if the dialog is meant to `
          + `write something.`,
      });
    }
    if (def.batchSize !== undefined && def.execution === 'aggregate') {
      ctx.addIssue({
        code: 'custom',
        path: ['batchSize'],
        message:
          `\`batchSize\` does not apply to an aggregate def — the whole selection goes out in ONE `
          + `call by definition, which is the point of \`execution: 'aggregate'\`. To bound how `
          + `much a single call may carry, use \`maxRecords\`.`,
      });
    }
  }));
export type BulkActionDef = z.input<typeof BulkActionDefSchema>;
/** Post-parse shape of {@link BulkActionDef} — defaults applied, transforms run (ADR-0122). */
export type BulkActionDefParsed = z.infer<typeof BulkActionDefSchema>;
