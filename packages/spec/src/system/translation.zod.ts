// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

// ────────────────────────────────────────────────────────────────────────────
// Locale
// ────────────────────────────────────────────────────────────────────────────

import { lazySchema } from '../shared/lazy-schema';
import { retiredKey } from '../shared/retired-key';
import { strictObject } from '../shared/strict-object';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { OverrideDeclarationFields } from '../kernel/override-declaration.zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { textSlotTemplateRefusal } from '../automation/flow-text-slot-template';

/**
 * The shape a locale tag must have: a 2–3 letter language subtag, then any
 * number of hyphen-separated 1–8 letter-or-digit subtags (`en`, `zh-CN`,
 * `zh-Hans-CN`, `es-419`, `yue-HK`). The same pattern as
 * `SYS_USER_LOCALE_TAG_PATTERN` (`@objectstack/platform-objects/identity`),
 * the shape a user's own `locale` column accepts, so a translation is stored
 * only under tags a session can ask for.
 *
 * Shape only, by decision: membership has no registry to check against
 * (`Intl.getCanonicalLocales('xx-YY')` succeeds, which is why
 * `shared/value-domain.zod.ts` dropped a `bcp47_locale` domain), and case is
 * not judged because the resolvers fold it (`zh-cn` resolves to `zh-CN`).
 * The primary subtag is held to the 2–3 letters of the ISO 639 codes every
 * tag in use starts with: BCP-47 reserves 4 letters and registers no 5–8
 * letter language, so the only values that wider grammar ever admitted were
 * words. What it refuses is what no resolver ever matches: an underscore
 * separator (`zh_CN`), whitespace, a language name (`Chinese`,
 * `Chinese (Simplified)`).
 */
const LOCALE_TAG_SHAPE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;

const LOCALE_TAG_REFUSAL =
  'must be a BCP-47 language tag such as `en`, `zh-CN` or `zh-Hans-CN`: a 2–3 letter language '
  + 'subtag, then hyphen-separated subtags. Refused since @objectstack/spec 18, because a translation '
  + 'stored under any other spelling (`zh_CN`, a trailing space, a language name such as `Chinese`) '
  + 'is under a locale no session ever asks for, so its strings never render. Separate subtags with '
  + '`-`, not `_`, and write the tag, not the name (`zh-CN`, not `Chinese`).';

export const LocaleSchema = lazySchema(() => z
  .string()
  .regex(LOCALE_TAG_SHAPE, LOCALE_TAG_REFUSAL)
  .describe('BCP-47 Language Tag (e.g. en-US, zh-CN)'));
export type Locale = z.input<typeof LocaleSchema>;

/**
 * Shared history sentence for every shape in this file.
 *
 * Translation data has the most literal version of the silent-strip failure in
 * the whole spec: a misspelled group or key is dropped, the bundle saves or
 * loads without complaint, and the string it was meant to translate renders in
 * the source language. There is no error, no log line, and no difference
 * between "not translated yet" and "translated into a key nothing reads" — so
 * the bug looks like missing coverage forever.
 */
const TRANSLATION_HISTORY =
  'Until these shapes were closed an unknown key was dropped silently — the bundle still '
  + 'loaded, and whatever it was meant to translate rendered in the source language with no '
  + 'diagnostic, indistinguishable from a translation nobody had written yet.';

/**
 * The measured exclusion on `objects.<o>._views.<v>.bulkActions.<def>.params.<p>`.
 *
 * Measured, not by symmetry: `BulkActionParamSchema.options[].value` is
 * `z.union([z.string(), z.number(), z.boolean()])`, so an option map keyed by
 * value — the shape `objects.<object>.fields.<field>.options` uses — cannot
 * address `true` and `"true"` apart. There is no right key to send the author
 * to, which is why this is `guidance` and not an alias.
 *
 * A screen field's options carried the same exclusion until the `flows` face
 * keyed them by `String(value)` and `ScreenFieldConfigSchema` began refusing
 * two options of one field that collide as text. This surface was not part of
 * that change and keeps its exclusion.
 */
const BULK_PARAM_NO_OPTIONS =
  'select-option labels are not translatable on a bulk-action param: '
  + '`BulkActionParamSchema.options[].value` is unconstrained (numbers and booleans are legal), so an '
  + 'option map keyed by value — the shape `objects.<object>.fields.<field>.options` uses — cannot '
  + 'address them unambiguously. Point the param at a declared field (`type` + the object\'s own '
  + 'options, which ARE translatable under `objects.<object>.fields.<field>.options`), or accept the '
  + 'authored option labels.';

/**
 * A translated flow TEXT SLOT — the one leaf every `{{ }}` template the flow
 * engine picks from the `flows` group is spelled with: a screen's `title` and
 * `description`, a refusing `end` node's `message`, and (#28054) the flow's
 * own `successMessage` and `errorMessage`.
 *
 * The engine picks each of them in the run's locale and renders it through
 * `renderTextSlot` (maintainer ruling A on #22507), so a translation is the
 * same text slot as the template it translates, and the one text-slot judge
 * (`textSlotTemplateRefusal`) refuses here exactly what `ScreenConfigSchema`
 * and `EndConfigSchema` refuse on the source, and what `registerFlow` refuses
 * on the flow's own two slots: a single-brace `{token}`, which would render as
 * literal text, and a hole over a `$` root the engine does not bind. One leaf
 * for all of them, so a slot cannot be judged in one place and drawn literally
 * in the slot beside it (#22627).
 *
 * No `.min(1)`, like every sibling leaf: an empty string is the untranslated
 * slot `os i18n extract` writes into a skeleton, the judge finds no token in
 * it, and the engine reads it as no translation (the authored template
 * renders). A factory rather than one shared instance, so each slot keeps a
 * schema node of its own, as it had before the three were folded into one
 * definition. ⛔ Package-internal: the judge's public answer is
 * `textSlotTemplateRefusal`, and an exported copy of this leaf would be a
 * second one.
 */
const flowTextSlotTranslation = () =>
  z.string().superRefine((value, ctx) => {
    const refusal = textSlotTemplateRefusal(value);
    if (refusal !== undefined) ctx.addIssue({ code: 'custom', message: refusal });
  });

// ────────────────────────────────────────────────────────────────────────────
// Object-level Translation (per-object file)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Field Translation Schema
 * Translation data for a single field.
 */
export const FieldTranslationSchema = lazySchema(() => strictObject({
  surface: 'this field translation',
  history: TRANSLATION_HISTORY,
  aliases: { helpText: 'help', hint: 'help', tooltip: 'help', picklist: 'options', values: 'options', choices: 'options' },
}, {
  label: z.string().optional().describe('Translated field label'),
  help: z.string().optional().describe('Translated help text'),
  placeholder: z.string().optional().describe('Translated placeholder text for form inputs'),
  options: z.record(z.string(), z.string()).optional().describe('Option value to translated label map'),
  /**
   * The field's own `inlineTitle` — the heading of the inline child grid a
   * `master_detail` / `lookup` field with `inlineEdit` draws on its PARENT's
   * form. The field lives on the child object, so the address is the child's:
   * `objects.<child>.fields.<field>.inlineTitle`. Overlaid by
   * `translateObject` on the served child object, which is what the console's
   * inline-subform pass copies the heading from.
   *
   * No fallback to the child object's translated plural label: an authored
   * `inlineTitle` with no entry here keeps its authored text, because a
   * bundle translates an attribute and never swaps another attribute in over
   * authored text. An absent `inlineTitle` already renders the child's
   * (translated) label.
   */
  inlineTitle: z.string().optional().describe("Translated inline master-detail grid title — overlays the field's own `inlineTitle`"),
}).describe('Translation data for a single field'));

export type FieldTranslation = z.input<typeof FieldTranslationSchema>;

/**
 * Action Result-Dialog Translation Schema
 *
 * Translations for an action's post-success `resultDialog` (the one-shot
 * reveal of secrets like temporary passwords, client secrets, or backup
 * codes). Shared by object `_actions` and `globalActions`.
 *
 * Convention:
 *   …_actions.<action_name>.resultDialog.title
 *   …_actions.<action_name>.resultDialog.description
 *   …_actions.<action_name>.resultDialog.acknowledge
 *   …_actions.<action_name>.resultDialog.fields.<path>
 *
 * `fields` is keyed by the **literal** `resultDialog.fields[].path` from the
 * action metadata (e.g. `"user.email"`, `"temporaryPassword"`). Keys may
 * contain dots — resolvers must index the record directly, not split on `.`.
 */
export const ActionResultDialogTranslationSchema = lazySchema(() => strictObject({
  surface: 'this action result dialog translation',
  history: TRANSLATION_HISTORY,
  aliases: { label: 'title', message: 'description', body: 'description', ok: 'acknowledge', confirm: 'acknowledge', acknowledgeLabel: 'acknowledge' },
}, {
  title: z.string().optional().describe('Translated result dialog title'),
  description: z.string().optional().describe('Translated result dialog description'),
  acknowledge: z.string().optional().describe('Translated acknowledge button label'),
  fields: z.record(z.string(), z.string()).optional()
    .describe('Result field labels keyed by the literal field path declared in the action metadata (keys may contain dots)'),
}).describe('Translations for an action result dialog'));

export type ActionResultDialogTranslation = z.input<typeof ActionResultDialogTranslationSchema>;

/**
 * Action translations — one shape, used at two addresses: an object's
 * `_actions.<name>` and the top-level `globalActions.<name>` (the same split
 * `resolveActionLabel` walks). Built by a factory rather than transcribed
 * twice so the two cannot drift, and so closing them is one edit.
 *
 * `surface` differs because the rejection should say which of the two the key
 * was written on — an author who put `confirm` under `globalActions` and one
 * who put it under `objects.account._actions` need different things next.
 */
const actionTranslationSchema = (surface: string) => strictObject({
  surface,
  history: TRANSLATION_HISTORY,
  aliases: {
    name: 'label', title: 'label',
    confirm: 'confirmText', confirmation: 'confirmText', confirmMessage: 'confirmText',
    success: 'successMessage', successText: 'successMessage', toast: 'successMessage',
    disabledMessage: 'disabledReason', disabledTooltip: 'disabledReason',
    disabledHint: 'disabledReason', disabledText: 'disabledReason',
    submitLabel: 'submitText', confirmLabel: 'submitText',
    parameters: 'params', args: 'params', inputs: 'params',
    result: 'resultDialog', dialog: 'resultDialog',
  },
}, {
  label: z.string().optional().describe('Translated action label'),
  // The address objectui's `actionDescription` resolver already reads —
  // `objects.{object}._actions.{action}.description` for an action bound to an
  // object, `globalActions.{action}.description` for an object-less one (read
  // points recorded in `liveness/action.json`, row `description`). Declared here with #7367's
  // `ActionSchema.description`: a bundle could not carry the string the
  // resolver was already looking for.
  description: z.string().optional().describe('Translated action description — the explanatory line under the title in the action\'s param dialog'),
  confirmText: z.string().optional().describe('Translated confirmation prompt'),
  successMessage: z.string().optional().describe('Translated success toast/message'),
  // `ActionSchema.disabledReason` (#26619) — the display-only reason a greyed
  // action shows; overlaid by `translateAction` like the copy keys above.
  disabledReason: z.string().optional().describe('Translated reason a greyed action shows (hover title and accessible description) while its `disabled` predicate is TRUE'),
  // `ActionSchema.submitText` (#27944) — the param dialog's submit button
  // label; overlaid by `translateAction` like `description`, the same
  // dialog's line under its title, for an action that declares `params`.
  submitText: z.string().optional().describe('Translated label of the submit button in the action\'s param dialog (the action must declare `params`)'),
  // `ActionSchema.outcomeMessages` (#21095) — one translated message per
  // declared outcome, keyed by the same snake_case outcome name, so a bundle
  // key that could never match a handler's `outcome` is refused here rather
  // than shipped as a translation nothing selects. Overlaid by
  // `translateAction` key by key, only for outcomes the action declares.
  outcomeMessages: z.record(SnakeCaseIdentifierSchema, z.string()).optional()
    .describe('Translated success copy per handler outcome, keyed by the snake_case outcome name the action\'s `outcomeMessages` declares'),
  params: z.record(z.string(), strictObject({
    surface: 'this action parameter translation',
    history: TRANSLATION_HISTORY,
    // `help` is the correct spelling on a FIELD translation and on a settings
    // key; on an action param it is `helpText`. Neighbouring-surface borrowing,
    // which edit distance reads as a legitimate word rather than a slip.
    aliases: { help: 'helpText', hint: 'helpText', tooltip: 'helpText', name: 'label', choices: 'options', values: 'options' },
  }, {
    label: z.string().optional().describe('Translated action parameter label'),
    helpText: z.string().optional().describe('Translated action parameter help/hint text'),
    placeholder: z.string().optional().describe('Translated action parameter placeholder'),
    options: z.record(z.string(), z.string()).optional().describe('Param select option value to translated label'),
  })).optional().describe('Action parameter translations keyed by parameter name'),
  resultDialog: ActionResultDialogTranslationSchema.optional()
    .describe('Translations for the action result dialog'),
});

/**
 * Object Translation Data Schema
 *
 * Translation data for a **single object** in a **single locale**.
 * Use this schema to validate per-object translation files.
 *
 * File convention: `i18n/{locale}/{object_name}.json`
 *
 * @example
 * ```json
 * // i18n/en/account.json
 * {
 *   "label": "Account",
 *   "pluralLabel": "Accounts",
 *   "fields": {
 *     "name": { "label": "Account Name", "help": "Legal name" },
 *     "type": { "label": "Type", "options": { "customer": "Customer" } }
 *   }
 * }
 * ```
 */
/**
 * A form's thank-you panel translation — one shape, used at two addresses: a
 * form view's `_views.<view>.submitBehavior` and a page `object-form`
 * component's `pages.<page>.components.<id>.submitBehavior` (the block
 * `ObjectFormPropsSchema.submitBehavior` takes from the form view by
 * reference). Built by a factory for {@link actionTranslationSchema}'s
 * reason: the two cannot drift, and `surface` says which of the two a
 * rejected key was written on.
 *
 * It carries the thank-you member's two strings only: the three other kinds
 * (`redirect`, `continue`, `next-record`) author no copy.
 */
const submitBehaviorTranslationSchema = (surface: string) => strictObject({
  surface,
  history: TRANSLATION_HISTORY,
  // Mirrors the thank-you member's own alias table in `ui/view.zod.ts`.
  aliases: { heading: 'title', text: 'message', body: 'message', description: 'message' },
  guidance: {
    url:
      "`url` is not display copy — a `redirect` submit behavior's path is the same in every "
      + 'locale. Only a `thank-you` panel authors copy: translate its `title` and `message`.',
    kind:
      '`kind` is not display copy — it selects the behavior and is the same in every locale. '
      + 'Translate the thank-you panel\'s `title` and `message` only.',
  },
}, {
  title: z.string().optional().describe('Translated thank-you panel heading (overlays `submitBehavior.title`)'),
  message: z.string().optional().describe('Translated thank-you panel message (overlays `submitBehavior.message`)'),
});

export const ObjectTranslationDataSchema = lazySchema(() => strictObject({
  surface: 'this object translation',
  history: TRANSLATION_HISTORY,
  aliases: {
    // The group prefixes are the whole point of the `_`-prefixed convention,
    // and the un-prefixed spelling is the one an author reaches for first.
    views: '_views', actions: '_actions', sections: '_sections', validations: '_validations',
    validationRules: '_validations', rules: '_validations',
    plural: 'pluralLabel', labelPlural: 'pluralLabel', name: 'label', title: 'label',
    columns: 'fields', properties: 'fields', attributes: 'fields',
  },
}, {
  /**
   * Translated singular label for the object.
   *
   * Optional because partial translation is the normal state — a bundle that
   * only renames two fields is valid, and every resolver already treats each
   * key as independently optional. Requiring it would force authors (and the
   * AI agents that scaffold bundles) to restate the source label just to pass
   * validation, filling bundles with fake translations that mask real
   * coverage gaps.
   */
  label: z.string().optional().describe('Translated singular label'),
  /** Translated plural label for the object */
  pluralLabel: z.string().optional().describe('Translated plural label'),
  /** Translated description shown in list/detail headings */
  description: z.string().optional().describe('Translated object description'),
  /** Field-level translations keyed by field name (snake_case) */
  fields: z.record(z.string(), FieldTranslationSchema).optional().describe('Field-level translations'),

  /**
   * View translations keyed by view name (snake_case).
   * Convention (auto-resolved by `resolveViewLabel`):
   *   objects.<object>._views.<view_name>.label
   *   objects.<object>._views.<view_name>.description
   *   objects.<object>._views.<view_name>.title   (a form view's heading)
   *   objects.<object>._views.<view_name>.submitBehavior.title / .message
   *                                                (a form's thank-you panel)
   *   objects.<object>._views.<view_name>.emptyState.title
   *   objects.<object>._views.<view_name>.emptyState.message
   *   objects.<object>._views.<view_name>.bulkActions.<def_name>.*
   */
  _views: z.record(z.string(), strictObject({
    surface: 'this view translation',
    history: TRANSLATION_HISTORY,
    aliases: {
      // `title` is a declared key below (a form view's heading), so it is no
      // longer named as a rename onto `label`; the heading-shaped neighbours
      // are named as renames onto it.
      name: 'label', heading: 'title', formTitle: 'title', empty: 'emptyState', emptyMessage: 'emptyState',
      // The authoring key is `bulkActionDefs`; the translation group drops the
      // `Defs` suffix the way `_actions` drops nothing and `_tabs` drops
      // `tabs[]`'s bracket — one address per surface, and the authoring
      // spelling is the one an author reaches for first.
      bulkActionDefs: 'bulkActions', bulkActionDef: 'bulkActions', bulk: 'bulkActions',
      // The panel's everyday name; the address mirrors the authoring key.
      thankYou: 'submitBehavior',
    },
    guidance: {
      rowActions:
        '`rowActions` names actions the OBJECT declares — a row-action label is translated where the '
        + "action lives: 'objects.<object>._actions.<action_name>.label' (or 'globalActions.<name>.label' "
        + 'for an object-less action). Only a `bulkActionDefs` entry, which is authored inside the view '
        + "and is not an action document, is addressed here — under 'bulkActions'.",
    },
  }, {
    label: z.string().optional().describe('Translated view label'),
    description: z.string().optional().describe('Translated view description'),
    /**
     * A FORM view's heading — overlays `FormViewSchema.title`, which a served
     * form item carries at `config.title` (the title an anonymous public form
     * shows above its sections).
     *
     * **Its own key, not the view's `label` key.** They are two authored
     * strings on two layers: a view item's `label` names the view, and a
     * form-family container entry (`formViews.<key>`, the default `form`)
     * carries no `label` at all, while `title` is the heading the form itself
     * draws. One translation cannot stand for two source strings, so the key
     * mirrors the authored one, the way `emptyState.title` does.
     *
     * Applied by `translateView` only where the form AUTHORS a title: a form
     * without one gains none, and its heading keeps falling back to the
     * object label. A list view carries no title, so the key over one
     * resolves nothing (`objectstack validate` refuses it).
     */
    title: z.string().optional().describe("Translated form view title — overlays a form view's own `title` (`FormViewSchema.title`); only a form that authors one is translated"),
    /**
     * A FORM view's thank-you panel — overlays the `title` and `message` of
     * `FormViewSchema.submitBehavior` when its `kind` is `'thank-you'`, which
     * a served form item carries at `config.submitBehavior` (the confirmation
     * an anonymous public form shows after a submit).
     *
     * **Nested under `submitBehavior`, not flattened onto the view node.**
     * The address mirrors the authored path, the way `emptyState.title`
     * does: the panel's `title` is a second heading beside the form's own
     * `title` above, and one key cannot stand for two source strings. The
     * three other kinds (`redirect`, `continue`, `next-record`) author no
     * copy, so this face carries the thank-you member's two strings only.
     *
     * Applied by `translateView` only where the form authors a thank-you
     * `title` / `message`: a form with another kind, or none, gains no
     * panel copy, and the console's own default wording stays in charge.
     */
    submitBehavior: submitBehaviorTranslationSchema('this form submit behavior translation').optional().describe("Translated thank-you panel copy — overlays a form view's `submitBehavior` `title` / `message` when its `kind` is `'thank-you'`; only copy the form authors is translated"),
    emptyState: strictObject({
      surface: 'this view empty-state translation',
      history: TRANSLATION_HISTORY,
      aliases: { label: 'title', heading: 'title', description: 'message', text: 'message', body: 'message' },
    }, {
      title: z.string().optional().describe('Translated empty-state title'),
      message: z.string().optional().describe('Translated empty-state message'),
    }).optional().describe('Translated empty-state copy shown when the view has no rows'),

    /**
     * Selection-bar copy for the view's `bulkActionDefs[]`, keyed by the def's
     * `name` (`BulkActionDefSchema.name`, snake_case).
     *
     * **The hole this closes.** A bulk-action def is part of the VIEW document,
     * not an action document, so it never reaches `translateAction` and no
     * group addressed it: the selection bar rendered
     * `已选择 1 项 · Complete · Skip · 清除` — two English words between two
     * Chinese ones, on a fully translated screen. Not a drifted key; no key.
     * The bar renders `def.label` verbatim (`resolveBulkActions` documents that
     * an authored def is "left as-authored"), so the source-locale string was
     * the only string there was.
     *
     * **Why this and not the `bulkActions: ['<name>']` promotion.** Naming a
     * declared action instead DOES localize — that path runs through
     * `translateAction` — but it is not the same capability: it dispatches the
     * action once per selected record, where a def is one data-plane
     * `updateMany`/`deleteMany` (or one `execution: 'aggregate'` call). Telling
     * an author to trade N elevated dispatches for a translated label is a
     * workaround, not a translation route.
     *
     * **Why a bundle key and not `I18nLabelSchema` on the def.** The def's
     * `label` stays `z.string()` deliberately (`ui/bulk-action.zod.ts` module
     * header): the def reaches the grid verbatim and the bar renders it as a
     * React child, so an inline `{ en, zh-CN }` map would render as a blank
     * cell rather than a parse error. Overlaying from the bundle in
     * `translateView` keeps the wire value a plain string — the renderer's
     * contract is untouched, and it is the same seat that already localizes the
     * view's own `label`/`description`.
     *
     * **The key face is measured against `BulkActionDefSchema`, not mirrored
     * from the report.** Every key below is copy the def actually declares:
     * `label`, `confirmText`, `confirmLabel`, and per-param `label` / `help` /
     * `placeholder`. Two deliberate exclusions carry `guidance` instead:
     * `successMessage` (a def declares none — the run reports a per-record
     * outcome summary the console words itself) and per-param `options`.
     *
     * ⚠️ `help`, not `helpText`. An ACTION param spells its hint `helpText`
     * and a bulk param spells it `help` (`BulkActionParamSchema.help`) — the
     * known divergence `ui/bulk-action.zod.ts` names. This face follows the
     * authored key, and the neighbouring spelling is an alias rather than a
     * second declared key, so one string keeps one address.
     */
    bulkActions: z.record(z.string(), strictObject({
      surface: 'this bulk action translation',
      history: TRANSLATION_HISTORY,
      // Mirrors `BulkActionDefSchema`'s own alias table so an author's habits
      // land on the same canonical key on both the authoring and the
      // translation side.
      aliases: {
        name: 'label', title: 'label',
        confirm: 'confirmText', confirmation: 'confirmText', confirmMessage: 'confirmText',
        confirmButton: 'confirmLabel', confirmButtonLabel: 'confirmLabel', runLabel: 'confirmLabel',
        parameters: 'params', args: 'params', inputs: 'params',
      },
      guidance: {
        successMessage:
          '`successMessage` is not part of the bulk-action translation surface — a `bulkActionDefs` '
          + 'entry declares no success copy (`BulkActionDefSchema` has no such key). The run reports a '
          + 'per-record outcome summary the console words from its own catalog. Translate the button '
          + '(`label`), the confirmation prompt (`confirmText`) and the confirm button (`confirmLabel`).',
        description:
          '`description` is not part of the bulk-action translation surface — a def declares no '
          + 'description. The explanatory sentence above the affected-record summary is `confirmText`.',
        icon:
          '`icon` is a Lucide icon name, not display copy — it is the same string in every locale. '
          + 'Omit it here.',
      },
    }, {
      label: z.string().optional().describe('Translated selection-bar button label (overlays `bulkActionDefs[].label`)'),
      confirmText: z.string().optional().describe('Translated confirmation prompt shown above the affected-record summary'),
      confirmLabel: z.string().optional().describe('Translated Confirm button label'),
      params: z.record(z.string(), strictObject({
        surface: 'this bulk action parameter translation',
        history: TRANSLATION_HISTORY,
        // `helpText` is the correct spelling on an ACTION param and `help` on a
        // FIELD translation and a settings key; a BULK param declares `help`.
        // Neighbouring-surface borrowing, which edit distance reads as a
        // legitimate word rather than a slip.
        aliases: { helpText: 'help', hint: 'help', tooltip: 'help', description: 'help', name: 'label', title: 'label' },
        guidance: {
          options: BULK_PARAM_NO_OPTIONS,
          choices: BULK_PARAM_NO_OPTIONS,
          values: BULK_PARAM_NO_OPTIONS,
        },
      }, {
        label: z.string().optional().describe('Translated bulk-dialog field label'),
        help: z.string().optional().describe('Translated help text under the field (the def spells this `help`, not `helpText`)'),
        placeholder: z.string().optional().describe('Translated bulk-dialog field placeholder'),
      })).optional().describe('Bulk-dialog parameter translations keyed by param name (`BulkActionParamSchema.name`)'),
    })).optional().describe('Selection-bar translations keyed by bulk-action def name (`BulkActionDefSchema.name`)'),
  })).optional().describe('View translations keyed by view name'),

  /**
   * Action translations keyed by action name (snake_case).
   * Convention (auto-resolved by `resolveActionLabel`/`resolveActionConfirm`/`resolveActionSuccess`):
   *   objects.<object>._actions.<action_name>.label
   *   objects.<object>._actions.<action_name>.description
   *   objects.<object>._actions.<action_name>.confirmText
   *   objects.<object>._actions.<action_name>.successMessage
   *   objects.<object>._actions.<action_name>.disabledReason
   *   objects.<object>._actions.<action_name>.submitText
   *   objects.<object>._actions.<action_name>.outcomeMessages.<outcome>
   *   objects.<object>._actions.<action_name>.params.<param_name>.label
   *   objects.<object>._actions.<action_name>.params.<param_name>.helpText
   *   objects.<object>._actions.<action_name>.params.<param_name>.placeholder
   *   objects.<object>._actions.<action_name>.params.<param_name>.options.<value>
   *   objects.<object>._actions.<action_name>.resultDialog.*
   */
  _actions: z.record(z.string(), actionTranslationSchema('this object action translation'))
    .optional().describe('Action translations keyed by action name'),

  /**
   * Section translations keyed by section name (snake_case).
   * Convention:
   *   objects.<object>._sections.<section_name>.label
   *   objects.<object>._sections.<section_name>.description
   *   objects.<object>._sections.<section_name>.fields.<field>.label
   *   objects.<object>._sections.<section_name>.fields.<field>.placeholder
   *   objects.<object>._sections.<section_name>.fields.<field>.helpText
   * Three authoring surfaces name a section under this key (e.g.
   * "Opportunity Information" → "商机信息"): an object-bound form view's
   * `sections[].name` (`FormSectionSchema.name`), a `record:details`
   * component's `sections[].name` on a record page, and an object's
   * `fieldGroups[].key`. A section without a stable name has no key here.
   *
   * Read by the i18n extractor (`walkObjectSections`, which scaffolds the key
   * from all three surfaces), the translation linter (`collectViewRecord`,
   * which accepts the names a form view declares) and `translateView` (which
   * overlays a served form view's `config.sections`). A metadata-editing
   * form's sections are keyed elsewhere, at
   * `metadataForms.<type>.sections.<section_name>`.
   *
   * `fields` carries the override copy of one object-bound form view
   * section's entries (`FormSectionSchema.fields[]`), keyed by each entry's
   * own `field`: the `label`, `placeholder` and `helpText` an entry authors
   * over the object field it renders, for that form alone. `translateView`
   * overlays them onto the served section's entries; an entry that authors
   * none of the three keeps the object field's own copy, translated at
   * `objects.<object>.fields.<field>`.
   */
  _sections: z.record(z.string(), strictObject({
    surface: 'this section translation',
    history: TRANSLATION_HISTORY,
    aliases: { name: 'label', title: 'label', heading: 'label', entries: 'fields' },
  }, {
    label: z.string().optional().describe('Translated section label'),
    description: z.string().optional().describe('Translated section description'),
    fields: z.record(z.string(), strictObject({
      surface: 'this form section entry translation',
      history: TRANSLATION_HISTORY,
      // `helpText` is the spelling a form section entry declares
      // (`FormFieldSchema.helpText`); `help` is the FIELD translation's, one
      // level up at `objects.<object>.fields.<field>`. Neighbouring-surface
      // borrowing, which edit distance reads as a legitimate word.
      aliases: { help: 'helpText', hint: 'helpText', tooltip: 'helpText', name: 'label', title: 'label' },
    }, {
      label: z.string().optional().describe('Translated entry label (overlays the section entry\'s `label` override)'),
      placeholder: z.string().optional().describe('Translated entry placeholder (overlays the section entry\'s `placeholder` override)'),
      helpText: z.string().optional().describe('Translated entry help text (overlays the section entry\'s `helpText` override)'),
    })).optional().describe('Form section entry translations keyed by the entry\'s `field`'),
  })).optional().describe('Section translations keyed by section name'),

  /**
   * Filter-preset tab translations keyed by tab name (`ViewTabSchema.name`).
   * Convention (auto-resolved by `resolveTabLabel`):
   *   objects.<object>._tabs.<tab_name>.label
   *
   * **The hole this closes (#5377).** A tab that references a saved view
   * (`tabs[].view`) already renders a translated label — the console follows
   * the reference and reads `_views.<view>.label`. A tab that carries only a
   * `filter` references nothing, and there was no key to put its label in:
   * this shape is a `strictObject`, so a translator who invented `_tabs` had it
   * rejected rather than ignored. The tab bar then sat above a fully localized
   * grid in the source language, with no authoring workaround.
   *
   * **Why it is object-scoped, next to `_views`, rather than under `pages`.**
   * A tab is a named filter preset over one object's records — "Urgent" names a
   * slice of tasks, which is object vocabulary in the same way a saved view's
   * label is. It is also what makes the view-reference fallback expressible at
   * all: both halves of `resolveTabLabel`'s chain live in one object's
   * namespace. `_sections` is the shape precedent — those live on page
   * components too and are addressed under their object, not their page.
   */
  _tabs: z.record(z.string(), strictObject({
    surface: 'this view tab translation',
    history: TRANSLATION_HISTORY,
    aliases: { name: 'label', title: 'label', heading: 'label', text: 'label' },
  }, {
    label: z.string().optional().describe('Translated tab label'),
  })).optional().describe('Filter-preset tab translations keyed by tab name'),

  /**
   * Custom validation-rule messages keyed by rule name
   * (`ValidationRuleSchema.name`, snake_case).
   *
   * Convention (resolved on the WRITE path by the ObjectQL rule evaluator):
   *   objects.<object>._validations.<rule_name>.message
   *
   * **The hole this closes (#14253).** `object.validations[].message` is the
   * sentence a rejected write returns, and the evaluator emitted it verbatim.
   * A deployment therefore got platform-generated refusals in the caller's
   * language — the built-in field catalog has shipped `zh-CN` since #3957 — and
   * author-written refusals in the source language, side by side in one error
   * envelope.
   *
   * **This is not `validationMessages` coming back.** That group (retired in
   * 17.0.0, #4667) was keyed by rule name at the TOP level, so it could not
   * tell two objects' rules apart, and — the reason it was retired — nothing
   * read it. This one is object-scoped, sits beside `_views` / `_actions` /
   * `_tabs`, and has a reader in the same change: `objectValidationMessageKey`
   * (`system/i18n-resolver.ts`) spells the address, and the rule evaluator asks
   * the **existing** `i18nService` channel (`engine.ts`'s `setI18nService`,
   * #3957 — the one that already localizes built-in messages and field labels).
   * No second i18n path into objectql.
   *
   * **`messages['validation.field.*']` is a different thing** and stays as it
   * is: it overrides the platform's BUILT-IN field catalog
   * (`BUILTIN_VALIDATION_MESSAGES`), which is keyed by constraint, not by rule.
   * It cannot address an author's own rule.
   *
   * **The key face is one key, measured.** A rule declares `label` (its entry
   * in the admin rule listing) and `description` (administrative notes) as well
   * as `message` — neither reaches a rejected caller, and declaring them here
   * would parse clean and translate nothing, the ADR-0078 shape this file keeps
   * paying to remove. Both carry `guidance` instead.
   *
   * A nested `conditional` branch rule carries its own `name` and is addressed
   * by it; the wrapping `conditional`'s own `message` never reaches a user (the
   * branch supplies the violation), so it has nothing to translate.
   */
  _validations: z.record(z.string(), strictObject({
    surface: 'this validation rule translation',
    history: TRANSLATION_HISTORY,
    aliases: {
      text: 'message', error: 'message', errorMessage: 'message', errorText: 'message',
      violation: 'message', violationMessage: 'message', msg: 'message',
    },
    guidance: {
      label:
        "`label` is the rule's entry in the admin rule listing, not the text a rejected write returns "
        + '— nothing resolves it through the bundle, so a key here would parse clean and translate '
        + 'nothing. Only `message` is addressed on this surface.',
      description:
        "`description` is the rule's administrative note (the business reason, for whoever maintains "
        + 'the rule) and never reaches a user. Translate `message`, the sentence a rejected write '
        + 'returns.',
      condition:
        '`condition` / `when` is a CEL predicate, not display copy — it is the same expression in '
        + 'every locale. Only `message` is translatable on a validation rule.',
      when:
        '`when` / `condition` is a CEL predicate, not display copy — it is the same expression in '
        + 'every locale. Only `message` is translatable on a validation rule.',
    },
  }, {
    message: z.string().optional()
      .describe("Translated rejection message — overlays the rule's authored `message` on every rejected write"),
  })).optional().describe('Custom validation-rule messages keyed by rule name (`ValidationRuleSchema.name`)'),
}).describe('Translation data for a single object'));

export type ObjectTranslationData = z.input<typeof ObjectTranslationDataSchema>;

// ────────────────────────────────────────────────────────────────────────────
// The retired object-first dialect
// ────────────────────────────────────────────────────────────────────────────

/**
 * Top-level keys of the retired object-first (`o.<object>`) dialect.
 *
 * Exported for the runtime's benefit, not the schema's: `authored-translation-sync`
 * scans rows that were saved *before* this shape was closed and warns rather
 * than loading them, since nothing resolves from them. New authoring is handled
 * by {@link TRANSLATION_KEY_GUIDANCE} on the strict shapes below.
 *
 * `reports` left this list when it became a declared group (#25788,
 * `reports.<report_name>.label` / `.description`): a key the shape declares
 * cannot also be a retired dialect key, or the sync would skip every row that
 * translates a report. A row stored before #3778 that carried the retired
 * `reports` key with no other key of this list now merges like any other row:
 * the dialect's measured footprint was zero (#3778), a value at
 * `reports.<name>.label` / `.description` now translates that report, and any
 * other value under it still renders nothing.
 */
export const LEGACY_OBJECT_FIRST_KEYS = [
  'o',
  'app',
  'nav',
  'dashboard',
  'notifications',
  'errors',
  '_globalOptions',
  '_meta',
  'namespace',
] as const;

export type LegacyObjectFirstKey = (typeof LEGACY_OBJECT_FIRST_KEYS)[number];

/**
 * Where each retired key's content belongs now (or that it has no home).
 *
 * ## Why this is `guidance` and no longer a bespoke pre-parse guard
 *
 * #3778 retired the object-first dialect and hit the problem this whole
 * campaign is about: Zod strips undeclared keys, so an item authored in the old
 * shape saved cleanly and then resolved to nothing. The fix available at the
 * time was a `z.preprocess` that scanned for these ten keys before parsing and
 * raised a 422 naming the right group.
 *
 * That guard worked, and it had the shape of every workaround for silent
 * stripping: **it could only catch the mistakes someone had already thought
 * of.** Ten keys were named; every other misspelling — `object` for `objects`,
 * `message` for `messages`, a group invented wholesale — went on being dropped
 * in silence. And it only ever ran on the *item* door (`TranslationItemSchema`),
 * so the same ten keys written into a file-authored bundle
 * ({@link TranslationBundleSchema}, the path the examples and platform apps
 * actually use) were stripped with no complaint at all. Exactly the asymmetry
 * #4522 found in #1535's object guard: covered at one door, open at the other.
 *
 * With the shapes closed (#4001) the guard is redundant — `.strict()` catches
 * all ten *and* everything else, at both doors — and what was worth keeping is
 * the prescriptions, which now ride the rejection as {@link strictObject}
 * `guidance`. An entry here suppresses the edit-distance rename, which matters:
 * `app` → `apps` is distance 1 and would otherwise be offered as a typo fix,
 * when the two carry different inner shapes and the content has to be rewritten,
 * not renamed.
 */
const TRANSLATION_KEY_GUIDANCE: Record<LegacyObjectFirstKey | 'validationMessages' | 'screens', string> = {
  // Not a legacy key either — the top-level spelling of the group #7646 added.
  // `screens` → `flows` is distance 4 and would never be suggested, and it is
  // not a rename in any case: screen copy nests one level down, under the flow
  // that owns the node. An author who writes it at the top level has to move
  // the content, not re-spell the key, which is exactly the `app`/`apps`
  // distinction this table was built to draw.
  screens:
    '`screens` is not a top-level translation group — screen copy is addressed under the flow that '
    + "owns it: 'flows.<flow_name>.screens.<node_id>.title' and "
    + "'flows.<flow_name>.screens.<node_id>.fields.<field_name>.label'.",
  // Not a legacy object-first key — a group that was live-looking and unread
  // until 17.0.0 (#4667, ADR-0049). The platform's own signature was on it
  // twice: the schema example showed a concrete override
  // ({"discount_limit": "折扣不能超过40%"}), and #3778's migration table steered
  // retired `errors:` authors straight into it. Both signposts pointed at a
  // group no resolver read — objectui's spec-translations transform passed it
  // through to the client tree and nothing downstream consumed it.
  validationMessages:
    '`validationMessages` was removed in @objectstack/spec 17.0.0 (ADR-0049) — no '
    + 'resolver ever read it, so a translated rule message was stored and never shown, and its '
    + 'rule-name-only keying could not tell two objects\' rules apart. Author the '
    + 'message on the rule itself (`object.validations[].message`), which the engine '
    + 'evaluates and returns on every rejected write, and translate it under the object-scoped '
    + "group 'objects.<object_name>._validations.<rule_name>.message', which the write "
    + 'path resolves. Delete this key. This edit left `os migrate meta` with the protocol-16.x conversions: apply it by hand, or run the tool on a release that still carries the conversion — https://objectstack.ai/docs/protocol-upgrade.',
  o: "`o` is the retired object-first dialect, which no resolver reads — use 'objects.<object_name>'",
  app: "`app` is the retired object-first dialect, which no resolver reads — use 'apps.<app_name>'",
  nav: "`nav` is the retired object-first dialect, which no resolver reads — use 'apps.<app_name>.navigation.<node_id>.label'",
  dashboard: "`dashboard` is the retired object-first dialect, which no resolver reads — use 'dashboards.<dashboard_name>' (plural)",
  notifications: '`notifications` is the retired object-first dialect — notifications have no translation group, omit them',
  // Was: "use 'validationMessages' for rule messages". That was a signpost to a
  // key with no reader — #3778 retired `errors` by pointing authors at
  // `validationMessages`, which was itself dead, so taking the advice moved the
  // content from one unread group to another. Both are gone now (#4667).
  errors:
    '`errors` is the retired object-first dialect and has no replacement under that name. Author '
    + 'the message on the rule itself (`object.validations[].message`) and translate it under '
    + "'objects.<object_name>._validations.<rule_name>.message'; omit `errors`.",
  _globalOptions: "`_globalOptions` is the retired object-first dialect — use 'objects.<object_name>.fields.<field_name>.options'",
  _meta: "`_meta` is the retired object-first dialect — use the top-level 'locale' field (on a bundle, the locale is the map key)",
  namespace: '`namespace` is not part of the translation contract — omit it (ADR-0129 D3 retired the separate namespace declaration platform-wide)',
};

/**
 * The per-app door's answer for `settings`, the one group that is
 * platform-only.
 *
 * Written as `guidance` rather than an alias because there is no key on THIS
 * surface to send the author to: settings copy is not app-authorable at all,
 * and a rename suggestion would be a signpost into a second rejection — the
 * exact failure {@link TRANSLATION_KEY_GUIDANCE} was extracted to stop. The
 * singular `setting` rides the same entry: it was an alias for `settings`
 * while this door declared it, and an alias whose target the shape no longer
 * accepts is a suggestion the author cannot take.
 */
const PER_APP_SETTINGS_PLATFORM_ONLY =
  '`settings` is a PLATFORM group, not an application one: it is keyed by '
  + '`SettingsManifest.namespace`, and a manifest is platform code — an application cannot '
  + 'declare one, so the only namespaces this key could address are the platform\'s own. '
  + 'Authored here it deep-merged into the one served translation tree, where it rendered only '
  + 'where the platform bundle carried no string for that key and locale: wherever both defined '
  + 'the key the platform\'s own `kernel:ready` contribution arrived later and overwrote it. '
  + 'Delete the group. Platform settings copy is translated in the platform bundle '
  + '(`@objectstack/service-settings`\'s `settingsBuiltinTranslations`, typed '
  + '`PlatformTranslationData`); a key it does not translate falls back to the manifest\'s own '
  + 'literal, so correct it there rather than filling the gap from an application. For an '
  + 'application\'s own copy use the sixteen groups this bundle does declare, in the order it '
  + "declares them — 'objects', 'picklists', 'apps', 'messages', 'globalActions', 'dashboards', "
  + "'datasets', 'reports', 'pages', 'flows', 'hooks', 'positions', 'permissions', 'books', "
  + "'metadataForms', 'settingsCommon'. "
  + "Note the last one: 'settingsCommon' IS "
  + 'on this face, so the Settings UI shell strings an application may translate (the source '
  + 'badges, under `settingsCommon.sourceLabels`) are NOT what is being refused here — only the '
  + "per-namespace manifest copy under 'settings' is. "
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies '
  + 'the ones it can prove, and you apply the rest by hand.';

/** The per-app door's guidance: the shared table plus the platform-only `settings`. */
const APP_TRANSLATION_KEY_GUIDANCE: Record<string, string> = {
  ...TRANSLATION_KEY_GUIDANCE,
  settings: PER_APP_SETTINGS_PLATFORM_ONLY,
  setting: PER_APP_SETTINGS_PLATFORM_ONLY,
};

/**
 * The `translation` ITEM door's answer for `settings` (#19620, ruling batch
 * #210 item 2 letter B: the file door and the item door are two authoring
 * surfaces for one app metadata type, so they accept one shape).
 *
 * Its own sentence rather than {@link PER_APP_SETTINGS_PLATFORM_ONLY} reused,
 * because what the key DID differs by door and the prescription must not
 * understate it. A bundle entry only filled gaps (the platform's later
 * `kernel:ready` contribution won every key both defined). An item did not
 * load into that tree at all: `authored-translation-sync` puts it in the
 * runtime-authored layer, which both i18n adapters read OVER the shipped
 * bundles (`deepMerge(static, authored)`), so an item's `settings` OVERRODE the
 * platform's own copy. Telling an item author "the platform overwrote it
 * anyway" would be false. The singular `setting` rides the same entry, as on
 * the bundle door: it was an alias for `settings` while this door declared it.
 */
const ITEM_SETTINGS_PLATFORM_ONLY =
  '`settings` is a PLATFORM group, not an application one: it is keyed by '
  + '`SettingsManifest.namespace`, and a manifest is platform code — an application cannot '
  + 'declare one, so the only namespaces this key could address are the platform\'s own. '
  + 'On a `translation` item it did more than fill gaps: the runtime-authored layer is read over '
  + 'the shipped bundles, so an item\'s entry OVERRODE the platform\'s own settings copy for its '
  + 'locale — application metadata rewriting a platform screen. '
  + 'Delete the group. Platform settings copy is translated in the platform bundle '
  + '(`@objectstack/service-settings`\'s `settingsBuiltinTranslations`, typed '
  + '`PlatformTranslationData`); a key it does not translate falls back to the manifest\'s own '
  + 'literal, so correct it there rather than overriding it from an application. For an '
  + 'application\'s own copy use the groups this item does declare — the same sixteen a per-app '
  + "bundle declares, 'settingsCommon' among them: the Settings UI shell strings an application "
  + 'may translate (the source badges, under `settingsCommon.sourceLabels`) are NOT what is being '
  + "refused here — only the per-namespace manifest copy under 'settings' is. "
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies '
  + 'the ones it can prove, and you apply the rest by hand.';

/** The item door's guidance: the shared table plus the platform-only `settings`. */
const ITEM_TRANSLATION_KEY_GUIDANCE: Record<string, string> = {
  ...TRANSLATION_KEY_GUIDANCE,
  settings: ITEM_SETTINGS_PLATFORM_ONLY,
  setting: ITEM_SETTINGS_PLATFORM_ONLY,
};

// ────────────────────────────────────────────────────────────────────────────
// Locale-level Translation Data (per-locale aggregate)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Translation Data Schema
 * Supports i18n for labels, messages, and options within a single locale.
 * Example structure:
 * ```json
 * {
 *   "objects": { "account": { "label": "Account" } },
 *   "apps": { "crm": { "label": "CRM" } },
 *   "messages": { "commonSave": "Save" }
 * }
 * ```
 *
 * `messages` ids are single-segment. `t()` resolves a key by walking its dot
 * path into this structure, and `messages` is a flat `Record<string, string>`,
 * so an id that itself contains a dot (`'common.save'`) is looked up as a
 * nested `common` object and resolves to nothing; `messages.commonSave`
 * resolves. Both implementations walk identically — see
 * `content/docs/protocol/kernel/i18n-standard.mdx`.
 */
/**
 * The translation groups an APPLICATION may author, as a shape rather than a
 * schema. Sixteen groups — the seventeenth, `settings`, is platform-only and lives in
 * {@link platformSettingsShape}.
 *
 * Three schemas need exactly these keys: {@link TranslationDataSchema} (one
 * entry of a per-app file-authored bundle — these sixteen and no more),
 * {@link PlatformTranslationDataSchema} (these sixteen plus `settings`) and
 * {@link TranslationItemSchema} (the registered `translation` metadata type —
 * the per-app face plus `locale`, its identity keys and the ADR-0010
 * envelope; it carried the platform face's `settings` too until #19620). The item used to
 * reach them with `.extend()`, which is correct for the *validation* but wrong
 * for the *error*: `.extend()` inherits the strict error map that closed over
 * the keys the BASE was built with, so a typo of `locale` on an item would be
 * rejected with `locale` missing from the candidate list. A shape spread into
 * separate `strictObject` calls gives each surface its own full key set — the
 * pattern the six `validation` variants settled on in the same campaign.
 *
 * A function, not a `const`: the values reference `lazySchema` proxies, and
 * building the shape eagerly at module load would defeat the laziness those
 * exist for.
 */
/**
 * The measured exclusion on `datasets.<name>.dimensions.<d>` and
 * `.measures.<m>`.
 *
 * Not inherited by symmetry from the dataset's own `description`: the authoring
 * schema states it directly. `DatasetDimensionSchema` and `DatasetMeasureSchema`
 * each carry a `guidance` entry for `description` reading "its author-facing
 * text is `label`. `description` is declared on the DATASET itself" — so a key
 * here would parse clean and translate nothing, the ADR-0078 shape this file
 * keeps paying to remove.
 */
const DATASET_MEMBER_NO_DESCRIPTION =
  'a dataset dimension/measure has no `description` — its author-facing text is `label`, and '
  + '`DatasetDimensionSchema` / `DatasetMeasureSchema` say so at the authoring site too. '
  + '`description` is declared on the DATASET itself: translate it at '
  + "'datasets.<dataset_name>.description'.";

/**
 * The tombstone prescription for `dashboards.<name>.widgets.<id>.subCaption`
 * — the metric sub-caption, retired at both ends by ruling C on
 * objectui#11389 (batch #264 item 5), which reverses #5428 item 4.
 *
 * The key overlaid the widget's `options.description`, a sub-caption key the
 * dashboard schema never declared and no authored widget wrote (0 producers in
 * either repository, measured), so the string existed in the served document
 * only when this key put it there. A widget keeps ONE authored description,
 * `widget.description`, which renders as the card-header subtitle and is
 * translated by the widget node's `description` key. If a named user later
 * needs a caption under a metric's value, it returns as a declared
 * widget-level key outside `options` — never as `options.description`.
 */
const WIDGET_SUB_CAPTION_RETIRED =
  '`dashboards.<name>.widgets.<id>.subCaption` was removed in @objectstack/spec 17.7.0 '
  + '(ADR-0049 enforce-or-remove) — it overlaid the metric sub-caption onto the widget\'s '
  + '`options.description`, a key the dashboard schema never declared and no authored widget '
  + 'wrote, so it translated a string that existed only when this entry put it there. Delete the '
  + 'entry. A widget has one authored description, `widget.description`, which renders as the '
  + "card-header subtitle; translate it through this widget's `description` entry. "
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

/**
 * The former `subtitle → subCaption` alias, re-homed as `guidance` when
 * `subCaption` became a tombstone (the chart `accessibility` / `ariaProps`
 * precedent in `ui/chart.zod.ts`): an alias whose target is a tombstone is
 * the shape `alias-integrity` refuses, because it sends the author to the one
 * key guaranteed to be rejected next.
 *
 * ⛔ Deliberately NOT repointed at `description`. The alias existed because a
 * `subtitle` on a metric widget meant the caption under the number; a
 * did-you-mean that now answered `description` would silently change what the
 * word is taken to mean. The refusal names both readings instead, so the
 * author picks the one they meant.
 */
const WIDGET_SUBTITLE_RETIRED =
  '`subtitle` was the alias spelling of `subCaption`, which was removed in @objectstack/spec '
  + '17.7.0 (ADR-0049 enforce-or-remove) — the metric sub-caption it translated is retired, and '
  + 'no widget renders a caption under its value. If this string is the card-header subtitle, it '
  + "belongs under this widget's `description` entry, which translates `widget.description`; if "
  + 'it is a caption under the metric\'s value, delete the key.';

const appTranslationDataShape = () => ({
  /** Object translations */
  objects: z.record(z.string(), ObjectTranslationDataSchema).optional().describe('Object translations keyed by object name'),

  /**
   * Picklist translations keyed by picklist name (`Picklist.name`,
   * `data/picklist.zod.ts`).
   *
   *   picklists.<name>.label            → the picklist's own `label`
   *   picklists.<name>.options.<value>  → the label of the option whose `value` matches
   *
   * Every field that references the picklist (`Field.select({ picklist })`)
   * inherits these option labels — the list is translated once, not per
   * field. A field with inline `options` keeps its own
   * `objects.<object>.fields.<field>.options`.
   */
  picklists: z.record(z.string(), strictObject({
    surface: 'this picklist translation',
    history: TRANSLATION_HISTORY,
    aliases: { name: 'label', title: 'label', values: 'options', choices: 'options' },
  }, {
    label: z.string().optional().describe('Translated picklist label'),
    options: z.record(z.string(), z.string()).describe(
      'Option value to translated label map — inherited by every field that references the picklist',
    ),
  })).optional().describe('Picklist translations keyed by picklist name'),

  /** App/Menu translations */
  apps: z.record(z.string(), strictObject({
    surface: 'this app translation',
    history: TRANSLATION_HISTORY,
    aliases: { name: 'label', title: 'label', nav: 'navigation', menu: 'navigation', menus: 'navigation' },
  }, {
    /**
     * Translated app label.
     *
     * Optional because a bundle may carry only the navigation ids its own
     * package contributes into another package's app
     * (`manifest.navigationContributions`): the app's label is declared and
     * translated by the package that owns the app, and the runtime deep-merges
     * the bundles, so the owner's label survives. Requiring it would make every
     * contributing module restate one package's string, and whichever bundle
     * merged last would win.
     */
    label: z.string().optional().describe('Translated app label'),
    description: z.string().optional().describe('Translated app description'),
    navigation: z.record(z.string(), strictObject({
      surface: 'this navigation group translation',
      history: TRANSLATION_HISTORY,
      aliases: { name: 'label', title: 'label', text: 'label' },
    }, {
      label: z.string().describe('Translated navigation group label'),
    })).optional().describe('Navigation group translations keyed by group ID'),
  })).optional().describe('App translations keyed by app name'),

  /** UI Messages */
  messages: z.record(z.string(), z.string()).optional().describe('UI message translations keyed by message ID'),
  
  // `validationMessages` removed in 17.0.0 (#4667) — see the
  // TRANSLATION_KEY_GUIDANCE entry. Removing it from this shared shape retires
  // it at BOTH doors at once (bundle entry + registered item), which is the
  // asymmetry #3778's item-only guard got wrong.

  /**
   * Global (object-less) action translations keyed by action name (snake_case).
   * Used for actions like `log_call` or `export_csv` that are not bound to a
   * specific object via `objectName`. Convention (auto-resolved by
   * `resolveActionLabel`/`resolveActionConfirm`/`resolveActionSuccess`):
   *   globalActions.<action_name>.label
   *   globalActions.<action_name>.description
   *   globalActions.<action_name>.confirmText
   *   globalActions.<action_name>.successMessage
   *   globalActions.<action_name>.disabledReason
   *   globalActions.<action_name>.submitText
   *   globalActions.<action_name>.outcomeMessages.<outcome>
   *   globalActions.<action_name>.params.<param_name>.label
   *   globalActions.<action_name>.params.<param_name>.helpText
   *   globalActions.<action_name>.params.<param_name>.placeholder
   *   globalActions.<action_name>.params.<param_name>.options.<value>
   *   globalActions.<action_name>.resultDialog.*
   */
  globalActions: z.record(z.string(), actionTranslationSchema('this global action translation'))
    .optional().describe('Global action translations keyed by action name'),

  /**
   * Dashboard translations keyed by dashboard name.
   * Convention (auto-resolved by ObjectUI's `useObjectLabel`):
   *   dashboards.<name>.label
   *   dashboards.<name>.description
   *   dashboards.<name>.actions.<actionUrl>.label
   *   dashboards.<name>.widgets.<widgetId>.title
   *   dashboards.<name>.widgets.<widgetId>.description
   *   dashboards.<name>.globalFilters.<filterName>.label
   *   dashboards.<name>.globalFilters.<filterName>.options.<value>
   */
  dashboards: z.record(z.string(), strictObject({
    surface: 'this dashboard translation',
    history: TRANSLATION_HISTORY,
    // `filters` / `globalFilter` mirror `DashboardSchema`'s own alias table for
    // the authored key, so an author who spells the group the way the
    // dashboard document accepts it is pointed at the one spelling the bundle
    // takes.
    aliases: { name: 'label', title: 'label', components: 'widgets', charts: 'widgets', cards: 'widgets', filters: 'globalFilters', globalFilter: 'globalFilters' },
  }, {
    label: z.string().optional().describe('Translated dashboard title'),
    description: z.string().optional().describe('Translated dashboard description'),
    actions: z.record(z.string(), strictObject({
      surface: 'this dashboard header action translation',
      history: TRANSLATION_HISTORY,
      aliases: { name: 'label', title: 'label', text: 'label' },
    }, {
      label: z.string().optional().describe('Translated header action label'),
    })).optional().describe('Header action label translations keyed by action url/key'),
    widgets: z.record(z.string(), strictObject({
      surface: 'this widget translation',
      history: TRANSLATION_HISTORY,
      // A widget's headline is `title`; a dashboard's is `label`. Same document,
      // one level apart, opposite spellings — so `label` on a widget is the
      // likeliest mistake on this surface and the least likely to be noticed.
      aliases: { label: 'title', name: 'title', heading: 'title' },
      // `subtitle` used to alias `subCaption`; it carries the retirement
      // instead of a rename now that its target is a tombstone — see
      // WIDGET_SUBTITLE_RETIRED for why it is not repointed at `description`.
      guidance: { subtitle: WIDGET_SUBTITLE_RETIRED },
    }, {
      title: z.string().optional().describe('Translated widget title'),
      description: z.string().optional().describe('Translated widget description (overlays `widget.description`, the card-header subtitle)'),
      /**
       * RETIRED — the metric sub-caption (ruling C on objectui#11389, which
       * reverses #5428 item 4). It overlaid `widget.options.description`; the
       * overlay is gone from `translateDashboard` and a widget keeps one
       * authored description, `widget.description`, translated by
       * `description` above. Tombstoned rather than deleted so the rejection
       * carries the prescription at `tsc` and at the parse; the
       * `translation-widget-sub-caption-removed` conversion strips the key
       * from stored bundles and items.
       */
      subCaption: retiredKey(WIDGET_SUB_CAPTION_RETIRED),
    })).optional().describe('Widget translations keyed by widget id'),
    /**
     * Global-filter copy, keyed by the filter's stable `name`
     * (`GlobalFilterSchema.name`, which the dashboard schema declares as
     * defaulting to `field` — a filter that authors no `name` is addressed by
     * its `field`, the same key its value is published under and that
     * widgets reference in `filterBindings`).
     *
     * **The hole this closes (#16772).** The filter bar draws DIRECTLY ABOVE
     * the widget titles this group has always translated, and neither a
     * filter's label nor its static option labels had any key here — so a
     * translated dashboard rendered `Requesting Department: 全部` over six
     * Chinese widget titles. Not a drifted key: no key. `label` overlays
     * `globalFilters[].label`; `options.<value>` overlays the matching
     * `globalFilters[].options[].label`, keyed by the option's `value`
     * spelled as a string (`String(value)` — the option value is declared
     * `string | number | boolean`, and a record key can only be a string).
     * Resolved by `translateDashboard` (i18n-resolver.ts) on the served
     * document; objectui's filter bar reads the served `label` / option
     * `label` through `pickLocalized`, so no client change is needed.
     *
     * **Two routes, and which one this is.** A filter bound to an object field
     * may also set `object` (#7804), in which case the CONSOLE resolves its
     * field label and option labels through `objects.<object>.fields.<field>`
     * client-side. That route is object-scoped and shared across every
     * dashboard drawing that field; this group is dashboard-scoped copy for
     * the filter AS THIS DASHBOARD LABELS IT — the authored `label` a
     * translator sees beside the widget titles. A filter that omits `object`
     * (every filter in the measured app) has only this route.
     *
     * `optionsFrom` options are NOT here: they are fetched rows, labelled by
     * the source object's `labelField` at request time, and a bundle key for
     * a value that exists only in data would be the declared-but-unresolvable
     * shape this file exists to keep out.
     */
    globalFilters: z.record(z.string(), strictObject({
      surface: 'this dashboard global-filter translation',
      history: TRANSLATION_HISTORY,
      // `title` / `name` are the `GlobalFilterSchema` alias spellings for the
      // authored label; `choices` / `values` are its alias spellings for
      // `options` — the same words an author reaches for on the dashboard
      // document itself.
      aliases: { name: 'label', title: 'label', text: 'label', choices: 'options', values: 'options', items: 'options' },
    }, {
      label: z.string().optional().describe("Translated filter label (overlays the filter's authored `label` in the dashboard filter bar)"),
      options: z.record(z.string(), z.string()).optional().describe("Static option value to translated label map (overlays `options[].label` for the option whose `value`, spelled as a string, matches the key)"),
    })).optional().describe('Global-filter translations keyed by the filter `name` (a filter that authors no `name` is keyed by its `field`)'),
  })).optional().describe('Dashboard translations keyed by dashboard name'),

  /**
   * Analytics dataset translations keyed by dataset name (`Dataset.name`).
   *
   * Convention (auto-resolved by `translateDataset`):
   *   datasets.<name>.label
   *   datasets.<name>.description
   *   datasets.<name>.dimensions.<dimension_name>.label
   *   datasets.<name>.measures.<measure_name>.label
   *
   * **The hole this closes (#14253).** A dataset reads like a back-office
   * definition, but a measure label is drawn ON THE DASHBOARD — under every
   * metric tile and on every chart axis — and `dataset` was neither in
   * `TRANSLATABLE_METADATA_TYPES` nor addressed by any group. Measured on a
   * translated dashboard: the tile titles and descriptions were Chinese (those
   * are `dashboards.<name>.widgets.<id>.*`) and directly beneath each one the
   * measure label rendered `Untouched > 14 days` / `Oldest touch`. Not a
   * drifted key: no key.
   *
   * **Why a top-level group and not `dashboards.<name>.…`.** A dataset is the
   * ONE semantic definition every presentation binds to by reference
   * (ADR-0021 D1) — the same measure is drawn by N widgets across M dashboards.
   * Addressing it under a dashboard would ask the translator to write the same
   * string once per presentation and would leave a dataset that no dashboard
   * references (a report's, or an API consumer's) unaddressable. One
   * definition, one key.
   *
   * **The key face is measured against `DatasetSchema`.** A dimension and a
   * measure each declare exactly one piece of display copy — `label` — and
   * `dataset.zod.ts` says so twice, in the `guidance` it already gives an
   * author who writes `description` on either: *"its author-facing text is
   * `label`. `description` is declared on the DATASET itself"*. So
   * `description` is declared here on the dataset and NOWHERE below it; a
   * `dimensions.<d>.description` key would parse clean and translate nothing.
   *
   * ⚠️ These four are `I18nLabelSchema` at the authoring site, so a dataset's
   * copy may already be an inline `{ en, 'zh-CN' }` map (#5728).
   * `translateDataset` writes ONLY where the bundle actually has an entry, so
   * an inline map the bundle does not cover is left intact rather than
   * flattened to one language — the same rule `translatePage` follows.
   */
  datasets: z.record(z.string(), strictObject({
    surface: 'this dataset translation',
    history: TRANSLATION_HISTORY,
    aliases: {
      name: 'label', title: 'label', displayName: 'label',
      dimension: 'dimensions', axes: 'dimensions', groupBy: 'dimensions',
      measure: 'measures', metrics: 'measures', metric: 'measures', values: 'measures',
    },
    guidance: {
      // The dataset layer is deliberately smaller than a query, and none of
      // these is display copy — pointing an author at `label` would translate
      // the wrong thing.
      object: '`object` is the dataset\'s base object name, not display copy — the object\'s own label is translated at \'objects.<object_name>.label\'.',
      include: '`include` lists relationship names/paths the joins are compiled from — machine names, identical in every locale.',
      filter: '`filter` is the dataset\'s intrinsic scope predicate, not display copy.',
      format: '`format` is a number format string (e.g. "$0,0.00"), not display copy. For a locale-correct currency symbol declare `currency` (ISO 4217) on the measure — presentations render it through `Intl`.',
    },
  }, {
    label: z.string().optional().describe('Translated dataset label'),
    description: z.string().optional().describe('Translated dataset description'),
    dimensions: z.record(z.string(), strictObject({
      surface: 'this dataset dimension translation',
      history: TRANSLATION_HISTORY,
      aliases: { name: 'label', title: 'label', displayName: 'label', text: 'label' },
      guidance: { description: DATASET_MEMBER_NO_DESCRIPTION },
    }, {
      label: z.string().optional().describe('Translated dimension label (drawn on chart axes and group headers)'),
    })).optional().describe('Dimension translations keyed by dimension name (`DatasetDimensionSchema.name`)'),
    measures: z.record(z.string(), strictObject({
      surface: 'this dataset measure translation',
      history: TRANSLATION_HISTORY,
      aliases: { name: 'label', title: 'label', displayName: 'label', text: 'label' },
      guidance: { description: DATASET_MEMBER_NO_DESCRIPTION },
    }, {
      label: z.string().optional().describe('Translated measure label (drawn under every metric tile and on chart axes)'),
    })).optional().describe('Measure translations keyed by measure name (`DatasetMeasureSchema.name`)'),
  })).optional().describe('Analytics dataset translations keyed by dataset name'),

  /**
   * Report translations keyed by report name (`Report.name`,
   * `ui/report.zod.ts`, the stack's `reports[]`).
   *
   *   reports.<name>.label        → the report's own `label`
   *   reports.<name>.description  → the report's own `description`
   *   reports.<name>.blocks.<block_name>.label / .description
   *                               → a joined report block's own `label` /
   *                                 `description`, keyed by the block's
   *                                 required `name`
   *
   * The two strings the console's report index lists each report by, and the
   * report page's heading. Overlaid by `translateReport` (`i18n-resolver.ts`)
   * on every served `report` document (`GET /meta/report`, the list both the
   * index and the page read). A report is overlay-editable (ADR-0126 Regime
   * O), so, as on a dashboard, the catalog yields to a label or description
   * an org has re-authored on top of the packaged report (ADR-0029 D9.2a).
   *
   * The face stops at those strings. A report's selection (`dataset`,
   * `rows`, `columns`, `values`), and a block's, is machine names whose
   * display copy is the dataset's, translated at `datasets.<dataset_name>`.
   *
   * ⚠️ `label` and `description` are `I18nLabelSchema` at the authoring site,
   * so a report's copy may already be an inline `{ en, 'zh-CN' }` map.
   * `translateReport` writes ONLY where the bundle has an entry, so an inline
   * map the bundle does not cover is left intact.
   */
  reports: z.record(z.string(), strictObject({
    surface: 'this report translation',
    history: TRANSLATION_HISTORY,
    aliases: { name: 'label', title: 'label' },
  }, {
    label: z.string().optional().describe("Translated report label — overlays the report's own `label`"),
    description: z.string().optional().describe("Translated report description — overlays the report's own `description`"),
    /**
     * A joined report's block copy, keyed by the block's `name`
     * (`JoinedReportBlockSchema.name`, required). The heading and caption the
     * joined renderer draws above each block; without this slot a localized
     * report showed a translated title over block headings left in the
     * authoring language. Overlaid by `translateReport`, block by block, under
     * the same packaged-base rule as the report's own two strings.
     */
    blocks: z.record(z.string(), strictObject({
      surface: 'this joined report block translation',
      history: TRANSLATION_HISTORY,
      aliases: { name: 'label', title: 'label', heading: 'label' },
    }, {
      label: z.string().optional().describe("Translated block label — overlays the joined report block's own `label`"),
      description: z.string().optional().describe("Translated block description — overlays the joined report block's own `description`"),
    })).optional().describe('Joined report block translations keyed by block name'),
  })).optional().describe('Report translations keyed by report name'),

  /**
   * Page translations keyed by page name (`Page.name`).
   *
   * Convention (auto-resolved by `translatePage`):
   *   pages.<name>.label        → the page document's own `label`
   *   pages.<name>.description  → the page document's own `description`
   *   pages.<name>.title        → the page's `page:header` `properties.title`
   *   pages.<name>.subtitle     → the page's `page:header` `properties.subtitle`
   *
   *   pages.<name>.components.<componentId>.<key>
   *                             → that component's `properties.<key>` (#6080)
   *   pages.<name>.components.<tabsId>.items.<value>.label
   *                             → that `page:tabs` item's `label`, keyed by the
   *                               item's `value` (see `items` below)
   *   pages.<name>.components.<formId>.submitBehavior.title / .message
   *                             → that `object-form`'s thank-you panel (see
   *                               `submitBehavior` below)
   *
   * When `title` is omitted, the header keeps the title its author wrote.
   * `label` stands in for it only where the header authors no title, or where
   * its title restates the page's own `label`: a page's header title and its
   * nav/breadcrumb label are usually the same string, so translators only
   * author `title` separately when the two genuinely differ (and
   * `os i18n extract` offers `title` exactly then). A label never replaces a
   * header title that says something else, such as a dynamic `'{name}'`: a
   * bundle translates an attribute, it does not swap one attribute for
   * another over authored text.
   *
   * Header copy lives at the TOP level here rather than under `components`
   * because `page:header` instances carry no stable `id`; the page name is the
   * only addressable identifier for them. Every other component does have one,
   * which is what `components` addresses — see its own note.
   *
   * **One component, one address.** For a REGION-LEVEL `page:header` the two
   * keys above are the ONLY route, even when the component happens to carry an
   * `id`: `translatePage` does not read `components.<id>` for it (ruled
   * 2026-09-06, decision batch #58 — the page-name route is canonical). Before
   * that ruling the id route was read here and WON, so a bundle could address
   * one header `title` two ways while `subtitle` — excluded from `components`
   * for exactly this reason, see its note below — only ever had one. A
   * `page:header` NESTED inside a container is a different component: the
   * page-name route does not reach it, so it stays id-only.
   */
  pages: z.record(z.string(), strictObject({
    surface: 'this page translation',
    history: TRANSLATION_HISTORY,
    aliases: { name: 'label', heading: 'title', header: 'title', subheading: 'subtitle', tagline: 'subtitle' },
  }, {
    label: z.string().optional().describe('Translated page label (nav / breadcrumb)'),
    description: z.string().optional().describe('Translated page description'),
    title: z.string().optional().describe('Translated `page:header` title. When omitted the header keeps its authored title; `label` stands in only where the header authors no title or its title restates the page label'),
    subtitle: z.string().optional().describe('Translated `page:header` subtitle'),
    /**
     * Per-component copy, keyed by the component's `id`
     * (`PageComponentSchema.id`) — the page half of what
     * `dashboards.<name>.widgets.<widgetId>` has always given dashboards
     * (#6080).
     *
     * **Why this existed as a hole.** The two component trees are near-identical
     * in shape and a dashboard widget's `title`/`description` were translatable
     * while a page component's were not, so a page's cards, KPI blocks and
     * related lists had no key to write at all — not a drifted key, no key. The
     * strings then reached the user as whatever literal the `*.page.ts` author
     * typed, in every locale. It bit hardest on landing pages: hotcrm's
     * `sales_home_page` rendered a translated header above four English cards
     * and four English KPI blocks in zh/ja/es (12 strings across 8 pages).
     * Nothing was misconfigured — the contract had nowhere to put them, and
     * `.strict()` (correctly) refused the keys a translator invented.
     *
     * **The key face is measured, not mirrored.** Each key below is a copy prop
     * that some component in `ComponentPropsMap` (`ui/component.zod.ts`)
     * actually declares:
     *
     * | key | declared by |
     * |:---|:---|
     * | `title` | `page:card`, `record:related_list` (and a NESTED `page:header` — a region-level one is page-name-addressed, see the `subtitle` note below) |
     * | `label` | `page:tabs`, `page:accordion`, `record:details`, `record:related_list`, `record:path`, `element:button`, `element:record_picker`, `element:text_input` |
     * | `description` | `element:text_input` |
     * | `placeholder` | `element:record_picker`, `element:text_input` |
     * | `emptyText` | `element:record_picker` |
     *
     * `submitLabel` LEFT this face in @objectstack/spec 17 (commit d173125fb, ADR-0049):
     * its only declarer, `element:form`, retired whole (#9249), which under
     * this table's own measured-not-mirrored rule left the key with no
     * declared component to translate. The maintainer ruled retire over
     * re-anchor — the live form surface's submit copy is `object-form`'s
     * `submitText` (`I18nLabelSchema`), localizable at its own authoring site,
     * and adding it here would be a face widening. The rejection carries the
     * prescription (`guidance` below); the
     * `translation-component-submit-label-removed` conversion strips the key
     * from stored bundles.
     *
     * Three deliberate exclusions — the first two because a mirror of the
     * issue's proposed shape would have got them wrong, the third because the
     * key was asked for and declined:
     *
     * - **`help` is not here** — no component in the model declares it. It
     *   would parse clean and translate nothing, which is the ADR-0078 shape
     *   this file keeps paying to remove. (`helpText` exists on an ACTION
     *   PARAM, a different surface with its own translation face.)
     * - **`subtitle` is not here** — `page:header` is its only declarer, and
     *   that component is addressed by page name above. Declaring it in both
     *   places would give one string two spellings, which is how the
     *   dashboards/pages asymmetry started. The 2026-09-06 ruling settled the
     *   same question for its sibling `title` in the same direction: a
     *   region-level `page:header` is read by page name only, so the component
     *   now has ONE address for both of its keys rather than two for one of
     *   them.
     * - **`content` is not here** — `element:text`'s one authored string is
     *   declared `content: I18nLabelSchema` (`ui/component.zod.ts`), so it is
     *   localizable at its own authoring site, and adding it to this face would
     *   be the face widening the `submitLabel` retirement declined for the
     *   identical shape (commit d173125fb). The inline locale map is the ruled route for
     *   page prose, not a workaround. That such maps are invisible to
     *   `os i18n extract` and `check:i18n-coverage` is real, and is its own
     *   question about the extractor (#14749) rather than a second key here.
     *
     * `properties` is an open record and custom component types are legal, so
     * these keys are also the route for a bespoke component that speaks the
     * same vocabulary (hotcrm's `ai_briefing` carries `title` + `description`).
     *
     * ⚠️ The bundle is no longer these keys' ONLY localization route (#5728).
     * `I18nLabelSchema` — which most of them are declared as — now also accepts
     * an inline `{ en, 'zh-CN' }` locale map, so a component's copy may already
     * be multilingual at the authoring site. That does not narrow this face:
     * `translatePage` writes only where the bundle actually has an entry, so an
     * inline map the bundle does not cover is left intact rather than flattened
     * to one language, and a bundle entry still wins where both exist. The
     * bundle stays the route that scales (translators never open a
     * `*.page.ts`); the inline map is the route for copy that ships with the
     * page.
     */
    components: z.record(z.string(), strictObject({
      surface: 'this page component translation',
      history: TRANSLATION_HISTORY,
      // A page component's headline is `title`; the PAGE's is `label`. Same
      // document one level apart with opposite spellings — the same trap
      // `dashboards.widgets` names, so it gets the same alias table.
      aliases: { name: 'title', heading: 'title', text: 'label', caption: 'description', help: 'description', helpText: 'description', empty: 'emptyText', emptyState: 'emptyText', thankYou: 'submitBehavior' },
      guidance: {
        submitLabel:
          '`submitLabel` was removed in @objectstack/spec 17 (ADR-0049) — its only '
          + 'spec-declared carrier, `element:form`, retired whole, so no component in '
          + '`ComponentPropsMap` declares it and the resolver no longer overlays it. The live form '
          + "surface's submit copy is `object-form`'s `submitText` (`I18nLabelSchema`), localizable "
          + 'at its own authoring site. Delete the key. '
          + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.',
        submit:
          '`submit` was the alias spelling of `submitLabel`, which was removed in '
          + '@objectstack/spec 17 (ADR-0049) — no component in `ComponentPropsMap` '
          + 'declares a submit label since `element:form` retired whole. Delete the key; '
          + "the live form surface's submit copy is `object-form`'s `submitText`.",
      },
    }, {
      title: z.string().optional().describe('Translated component title (`page:card`, `record:related_list`, …)'),
      description: z.string().optional().describe('Translated component description / supporting copy'),
      label: z.string().optional().describe("Translated component label — overlays the component's own `label` when it declares one, else `properties.label`"),
      placeholder: z.string().optional().describe('Translated input placeholder (`element:record_picker`, `element:text_input`)'),
      emptyText: z.string().optional().describe('Translated empty-state text (`element:record_picker`)'),
      /**
       * A `page:tabs` component's tab labels, keyed by each item's `value`
       * (`PageTabsProps.items[].value`) — read by `translatePage`, offered by
       * `os i18n extract`, judged by `objectstack validate`.
       *
       * **Why under the tabs component, keyed by `value`.** A tab item is not
       * a component: it carries no `id`, so the `components.<id>` route could
       * never reach it, and a HotCRM home page rendered its three tabs in
       * English under a translated header. Two addresses were open — give
       * items an `id`, or key them under the tabs component they belong to.
       * The item already declares the identifier this needs: `value` is the
       * stable `?tab=` token the renderer reads and restores, so it is unique
       * within the strip by construction, and the ruling that settled the
       * inline-map question (#14749) recorded `tabs item.value` as the
       * identity a page key builds on. A second identifier would give one tab
       * two names. The component half stays the tabs component's own `id`,
       * so `pages.<page>.components.<tabsId>` keeps meaning one component.
       *
       * **An item without a `value` has no key.** Its renderer token is
       * `tab-<index>`, and an array index is never a bundle key: reordering
       * two tabs would silently swap their translations. Author a `value`,
       * or localize that label in place with an inline locale map.
       *
       * Only `page:tabs` items are addressed. A `page:accordion` panel has
       * no author-settable identity (its renderer derives `panel-<index>`),
       * so its label stays an inline-locale-map surface.
       */
      items: z.record(z.string(), strictObject({
        surface: 'this page tab item translation',
        history: TRANSLATION_HISTORY,
        aliases: { name: 'label', title: 'label', text: 'label' },
      }, {
        label: z.string().optional().describe("Translated tab label — overlays the item's own `label` (`PageTabsProps.items[].label`)"),
      })).optional().describe('`page:tabs` item labels keyed by the item `value` (`PageTabsProps.items[].value`); an item without a `value` has no key'),
      /**
       * An `object-form` component's thank-you panel — overlays the `title`
       * and `message` of `properties.submitBehavior` when its `kind` is
       * `'thank-you'` (`ObjectFormPropsSchema.submitBehavior`, the form
       * view's own member by reference), read by `translatePage`, offered by
       * `os i18n extract`, judged by `objectstack validate`.
       *
       * **Under the page, not under the bound object.** The panel is copy the
       * PAGE authors: two pages binding the same object can confirm a submit
       * in different words, and a key under `objects.<object>` (the
       * `_sections` precedent) would make them share one translation. The
       * component's own `id` already addresses its `title` / `description`
       * here, so its panel sits beside them; a form view's panel keeps its
       * own address under `_views`, because there the copy is the view's.
       *
       * Nested the way the authored copy is nested, so the panel's heading
       * never shares the component's own `title` key. The same rules as the
       * form view's panel apply, through the one function both share: only a
       * `kind: 'thank-you'` panel is touched, only authored copy is
       * translated, and a missing key keeps the authored string. An
       * `object-form` without an `id` has no key; give it one.
       */
      submitBehavior: submitBehaviorTranslationSchema('this page form submit behavior translation').optional().describe("Translated thank-you panel copy — overlays an `object-form` component's `submitBehavior` `title` / `message` when its `kind` is `'thank-you'`; only copy the form authors is translated"),
    })).optional().describe('Per-component copy keyed by component id (`PageComponentSchema.id`)'),
  })).optional().describe('Page translations keyed by page name'),

  /**
   * Screen-flow translations keyed by flow name (`Flow.name`).
   *
   * Convention:
   *   flows.<flow_name>.label
   *   flows.<flow_name>.successMessage                 (the terminal toasts, #22507)
   *   flows.<flow_name>.errorMessage
   *   flows.<flow_name>.screens.<node_id>.title          (picked by the engine, #22507)
   *   flows.<flow_name>.screens.<node_id>.description    (picked by the engine, #22507)
   *   flows.<flow_name>.screens.<node_id>.fields.<field_name>.label
   *   flows.<flow_name>.screens.<node_id>.fields.<field_name>.placeholder
   *   flows.<flow_name>.screens.<node_id>.fields.<field_name>.inlineHelpText
   *   flows.<flow_name>.screens.<node_id>.fields.<field_name>.options.<value>   (#22507)
   *   flows.<flow_name>.refusals.<node_id>.message   (a refused `end` node, #22450)
   *   flows.<flow_name>.approvals.<node_id>.label    (an `approval` node's step label)
   *
   * Every user-read string slot of the flow schemas is either one of these
   * keys or recorded, with its reason, in the family pin
   * (`flows-translation-face.test.ts`), so a new slot added without a key
   * fails there rather than in a locale.
   *
   * **The hole this closes (#7646).** A `type: 'screen'` flow is a wizard the
   * user reads — a heading, a list of labelled inputs — and the bundle had no
   * group for any of it. Not a drifted key: no key. HotCRM finished all four
   * locales, retired its i18n exemption ledger, and its `lead_conversion`
   * wizard still rendered "Conversion Details / Create Opportunity? /
   * Opportunity Name" in English on a zh-CN console, because a translator had
   * nowhere to put the strings and `.strict()` (correctly) refused the group
   * they invented.
   *
   * **The addressing is the runner's own, not a second naming scheme.** Every
   * key below is an identifier some consumer already holds at render time:
   *
   * | level | key | declared by |
   * |:---|:---|:---|
   * | flow | `Flow.name` | `flow.zod.ts` — the machine name the console launches the run by |
   * | screen | `FlowNode.id` | `flow.zod.ts`; forwarded to the client verbatim as `ScreenSpec.nodeId` (`contracts/automation-service.ts`) |
   * | field | `ScreenFieldConfig.name` | `builtin-node-config.zod.ts`; forwarded as `ScreenFieldSpec.name` |
   *
   * `nodeId` is what correlates a resume back to its pause point, so it is the
   * one screen identifier that is guaranteed stable and present client-side —
   * a positional index would renumber whenever a step is inserted, and node
   * `label` is itself display copy. Addressing a translation surface by keys
   * nothing produces is the declared-but-unresolvable trap this file exists to
   * keep out.
   *
   * **The key face is measured against the flow schema, not mirrored from the
   * report.** The per-field keys are the screen field's own copy keys, spelled
   * as `ScreenFieldConfigSchema` spells them, because the overlay writes each
   * translation back onto the key it names: `label`, `placeholder` and
   * `inlineHelpText`.
   *
   * - **Help text is `inlineHelpText`, not the report's `help`.** When #7646
   *   ruled the face, the screen field declared nothing help-shaped, so a
   *   `help` key would have parsed clean and translated nothing — the ADR-0078
   *   shape #6080 removed from the page component face for exactly this
   *   reason. #17306 gave the screen field `inlineHelpText` (the object
   *   field's own spelling), and the face gained the key once the console's
   *   screen dialog drew it, under the control. `help` / `helpText` / `hint` /
   *   `tooltip` / `description` are aliases onto it, so an author holding a
   *   neighbouring surface's spelling is told the rename.
   *
   * ⛔ **Runner chrome is NOT here** — the Cancel/Submit buttons the wizard
   * draws around the author's screen belong to the console's own message
   * catalog. They are the console's words in every app, so putting them in a
   * per-app bundle would ask every app to re-translate the platform (maintainer
   * ruling on #7646).
   *
   * The runner half was a separate, downstream change, and it has landed
   * client-side for each field's copy and the flow label. objectui's
   * `FlowRunner` reads each field's copy over `FLOW_SCREEN_FIELD_COPY_KEYS`
   * (`label`, `placeholder`, `inlineHelpText`). It reads `label` through
   * `translateFlow` to name the flow in its header and in the completion
   * toast, falling back to the label the engine serves as
   * `AutomationResult.flowLabel` and then to the flow's API name. Both reads
   * are recorded in the `flows` rows of `liveness/translation.json`: the group
   * and its children are `live`. A
   * screen's `title` and `description` are the engine's to pick, not the
   * runner's (see "picked by the engine" below).
   *
   * ## `refusals` — a refused `end` node's message (#22450)
   *
   *   flows.<flow_name>.refusals.<node_id>.message
   *
   * An `end` node declaring `outcome: 'refused'` carries a `message` the user
   * reads in place of the flow's completion (`EndConfigSchema`), and until this
   * key the group had nowhere to put it: a first-class refusal rendered in the
   * source language on every console, beside a translated flow label and
   * translated screens. Addressed like the screens, by `Flow.name` and
   * `FlowNode.id` (a refused `end` nested in an ADR-0031 region included).
   *
   * **Picked before it is rendered, by the engine.** The run stores the
   * refusal already rendered (`sys_automation_run.refusal_message`,
   * `AutomationResult.refusalMessage`), so an overlay on that string could not
   * work. `AutomationEngine` reads `flowRefusalMessageKey(flow, node)`
   * (`system/i18n-resolver.ts`) through the `i18n` service, in the run's
   * `AutomationContext.locale`, and renders the translation in place of the
   * authored template. With no locale, or no entry, the authored template
   * renders.
   *
   * **The same text slot as the source.** A translation keeps the `{{ }}`
   * holes of the message it translates, and the one text-slot judge
   * (`textSlotTemplateRefusal`) refuses a single-brace `{token}` here exactly
   * as `EndConfigSchema` refuses it on the source. `objectstack validate`
   * refuses a key over an unknown flow, an unknown node, or a node that is not
   * a refused `end`, as it does for the screen keys.
   *
   * ## `approvals` — an `approval` node's step label
   *
   *   flows.<flow_name>.approvals.<node_id>.label
   *
   * An `approval` node (`ApprovalNodeConfigSchema`) is a step a person reads
   * by name: the approval request it opens snapshots the node's `label` as the
   * step the submitter and the approvers see (`current_step_label`). Until
   * this key the group had nowhere to put it, so a pack's step name was
   * refused `translation-target-unknown` under `screens` (the node is not a
   * screen) and rendered in the source language on every console.
   *
   * - **Grouped by node type, like `screens`.** `screens` addresses `screen`
   *   nodes and `refusals` refusing `end` nodes, each by `FlowNode.id`; this
   *   group addresses `approval` nodes the same way, at any depth (an ADR-0031
   *   region included).
   * - **The leaf is `label`, the source's own spelling.** The node config
   *   declares no heading of its own (no `title`, no instructions, no comment
   *   prompt), so the one person-facing string an approval step carries is
   *   `FlowNode.label`. A screen spells its leaf `title` because
   *   `ScreenConfigSchema.title` is what it overlays; `title` here is an alias
   *   onto `label`.
   * - ⛔ **The decision dialog's output labels are NOT here.** A typed
   *   `decisionOutputs[]` entry's `label` is copy the decision dialog draws,
   *   recorded as owed in `flows-translation-face.test.ts`; it waits on a
   *   reader for that dialog, not on this key.
   *
   * `objectstack validate` refuses a key over an unknown flow, an unknown
   * node, or a node that is not an `approval`, and points a `screens` or
   * `refusals` key written over an approval node at this group. This is the
   * spec half of a contract-first split: the reader that renders the step
   * label in the reader's locale is `plugin-approvals`'s, a downstream change.
   *
   * ## `notices` — a `save_notice` node's message (#28251)
   *
   *   flows.<flow_name>.notices.<node_id>.message
   *
   * A `save_notice` node (`SaveNoticeConfigSchema`) tells the person who made
   * the write that fired a record-triggered run what the save set in motion,
   * and the create/update answer carries the rendered sentence as `notice`.
   * It is a `{{ }}` template the server renders per run, so under the #22507
   * rule it is translated where it is rendered: the engine reads
   * `flowNoticeMessageKey(flow, node)` (`system/i18n-resolver.ts`) through the
   * `i18n` service in the triggering WRITER's locale (the hook session's
   * `locale`, which the record-change trigger hands the run with the notice
   * channel), and renders the authored template when none is held. Judged as
   * the text slot it translates, like `refusals.<node_id>.message`.
   * `objectstack validate` refuses a key over an unknown flow, an unknown
   * node, or a node that is not a `save_notice`.
   *
   * ## `successMessage` / `errorMessage` — the terminal toasts (#22507)
   *
   *   flows.<flow_name>.successMessage
   *   flows.<flow_name>.errorMessage
   *
   * The flow's own completion and failure text (`FlowSchema.successMessage` /
   * `.errorMessage`). Since #28054 each is a `{{ }}` template the engine
   * renders at the run's terminal exit, so it is picked like a screen's
   * heading: the engine reads `flowTerminalMessageKey(flow, key)`
   * (`system/i18n-resolver.ts`) through the `i18n` service, in the run's
   * `AutomationContext.locale`, renders the translation in place of the
   * authored template, and serves the result filled; the console draws it as
   * served (maintainer ruling A on #22507). With no locale, or no entry, the
   * authored template renders. A translation is the same text slot as its
   * source (`flowTextSlotTranslation`): it keeps the holes
   * (`'已登记 {{ enrolledCount }} 位联系人'`), and a single-brace `{token}` is
   * refused. Translated only where the flow authors the message: a bundle
   * cannot ADD a toast to a flow that declares none (`objectstack validate`
   * refuses such a key). The toast's chrome sentence (`Flow "…" completed`,
   * shown when the flow declares no `successMessage`) stays the console's own
   * words.
   *
   * ## `options.<value>` — a screen field's option labels (#22507)
   *
   *   flows.<flow_name>.screens.<node_id>.fields.<field_name>.options.<value>
   *
   * Keyed by the option's value coerced to a string
   * (`flowScreenFieldOptionKey`, `String(value)`) — the console select's own
   * identity for the option, and the coercion an action param's inline
   * `options` translation already uses. `ScreenFieldConfigSchema` refuses two
   * options of one field whose values collide as text (`1` and `"1"`), so a
   * key names exactly one option. ⛔ Not by position, which would re-point
   * every translation when an option is inserted; ⛔ not by the label of an
   * object field the screen field happens to mirror — a screen field declares
   * no such binding, so a runner has nothing to read it from.
   *
   * Both new groups of keys are the spec half of a contract-first split, like
   * `screens` was (#7646): objectui's `FlowRunner` reads them in a downstream
   * change, and their liveness rows are `planned` until it lands.
   *
   * ## `screens.<node_id>.title` / `.description` — picked by the engine (#22507)
   *
   *   flows.<flow_name>.screens.<node_id>.title
   *   flows.<flow_name>.screens.<node_id>.description
   *
   * A screen's heading and body text are `{{ }}` templates the server renders
   * per run (`renderTextSlot` in the screen executor), so an overlay on the
   * served string would draw a translated hole as literal text. Maintainer
   * ruling A on #22507 states the rule once: a user-read flow string the
   * server renders per run is translated where it is rendered, in the run's
   * locale, before its holes are filled, and a client overlay never touches a
   * server-rendered slot. So the screen executor asks the engine for each
   * translated TEMPLATE (`flowScreenCopyKey`, `system/i18n-resolver.ts`)
   * through the `i18n` service, in the run's `AutomationContext.locale`, the
   * one channel the `refusals` message is read through, and renders it in
   * place of the authored template. With no locale, or no entry, the authored
   * template renders. The served `ScreenSpec` arrives translated and filled,
   * and the runner draws it as served.
   *
   * - **`title`** covers the node label too: the executor draws
   *   `config.title ?? node.label`, so one key translates whichever heading the
   *   screen shows. Its address is unchanged from the client-side route it had
   *   before.
   * - **`description`** is translated only where the screen authors one. A
   *   bundle cannot add body text the author did not write; `objectstack
   *   validate` refuses such a key.
   * - **Both are judged as the text slot they translate** (#22627). The one
   *   text-slot judge (`textSlotTemplateRefusal`) refuses a single-brace
   *   `{token}` in either exactly as `ScreenConfigSchema` refuses it on the
   *   source, through the one leaf the refusing `end` node's `message` uses
   *   too (`flowTextSlotTranslation`). A translated heading is a template even
   *   where it stands in for the node label, which is plain text: the engine
   *   renders whatever it picks through `renderTextSlot`, so a `{name}` there
   *   would be drawn literally. The refusal names the `{{ name }}` spelling.
   */
  flows: z.record(z.string(), strictObject({
    surface: 'this flow translation',
    history: TRANSLATION_HISTORY,
    aliases: {
      name: 'label', title: 'label', nodes: 'screens', steps: 'screens', screen: 'screens', pages: 'screens',
      refusal: 'refusals', ends: 'refusals',
      approval: 'approvals',
      notice: 'notices', saveNotices: 'notices',
      // The spellings the toast pair arrives in from an action translation,
      // which spells its own success toast `successMessage` with these aliases.
      success: 'successMessage', successText: 'successMessage',
      error: 'errorMessage', errorText: 'errorMessage',
    },
  }, {
    label: z.string().optional().describe('Translated flow label'),
    // [#28054] Picked by the ENGINE in the run's locale and rendered in place
    // of the flow's own template at the terminal exit, so judged as the text
    // slot it translates, like a screen's `title` and `description`.
    successMessage: flowTextSlotTranslation().optional().describe(
      "Translated completion toast — a `{{ }}` template like the flow's own `successMessage`, picked by the engine "
      + "in the run's locale and rendered in its place over the run's variables; only a flow that authors one is "
      + 'translated',
    ),
    errorMessage: flowTextSlotTranslation().optional().describe(
      "Translated failure toast — a `{{ }}` template like the flow's own `errorMessage`, picked by the engine in "
      + "the run's locale and rendered in its place over the variables at the failure point; only a flow that "
      + 'authors one is translated',
    ),
    screens: z.record(z.string(), strictObject({
      surface: 'this flow screen translation',
      history: TRANSLATION_HISTORY,
      // A screen's headline is `title`; the FLOW's is `label`. Same document
      // one level apart with opposite spellings — the trap
      // `dashboards.widgets` and `pages.components` both name, so it gets the
      // same alias table.
      aliases: { label: 'title', name: 'title', heading: 'title', header: 'title', inputs: 'fields', items: 'fields' },
    }, {
      // [#22507] Picked by the ENGINE in the run's locale and rendered in place
      // of the screen node's `config.title`. A screen that declares no `title`
      // shows its node `label` instead (`ScreenConfigSchema.title`, "falls back
      // to the node label"), so this one key covers whichever of the two the
      // screen shows — the same one-string-one-spelling rule
      // `pages.<name>.title` follows over `label`. Judged as the text slot it
      // translates, like `description` below (#22627).
      title: flowTextSlotTranslation().optional().describe(
        'Translated screen heading — a `{{ }}` template like the heading it translates, picked by the engine in the '
        + "run's locale and rendered in place of `config.title` (or the node label when the screen declares none)",
      ),
      // [#22507] The screen's body text, picked the same way, and judged by the
      // one text-slot judge exactly as `ScreenConfigSchema` judges the body
      // text it translates; an empty string is the untranslated skeleton slot.
      description: flowTextSlotTranslation()
        .optional()
        .describe(
          'Translated screen body text — a `{{ }}` template like the `config.description` it translates, picked by '
          + "the engine in the run's locale and rendered in its place; translated only where the screen authors one",
        ),
      fields: z.record(z.string(), strictObject({
        surface: 'this flow screen field translation',
        history: TRANSLATION_HISTORY,
        // The help spellings are the ones `ScreenFieldConfigSchema` renames
        // onto `inlineHelpText` (the object field's table), plus
        // `description`, which an object field uses for its tooltip copy.
        // `choices` / `values` → `options` are the object field translation's
        // and the action param's own renames for the same map.
        aliases: {
          name: 'label', title: 'label', text: 'label',
          help: 'inlineHelpText', helpText: 'inlineHelpText', hint: 'inlineHelpText', tooltip: 'inlineHelpText',
          description: 'inlineHelpText',
          choices: 'options', values: 'options',
        },
      }, {
        label: z.string().optional().describe('Translated screen field label'),
        placeholder: z.string().optional().describe('Translated screen field placeholder'),
        inlineHelpText: z.string().optional().describe('Translated screen field help text (drawn under the input)'),
        options: z.record(z.string(), z.string()).optional().describe(
          'Translated option labels keyed by the option value read as text (`String(value)`) — never by the label '
          + 'or the position',
        ),
      })).optional().describe('Screen field translations keyed by field name (`ScreenFieldConfig.name`)'),
    })).optional().describe('Screen translations keyed by screen node id (`FlowNode.id`, the client\'s `ScreenSpec.nodeId`)'),
    refusals: z.record(z.string(), strictObject({
      surface: 'this flow refusal translation',
      history: TRANSLATION_HISTORY,
      // The words a refusal arrives spelled in — the same aliases
      // `EndConfigSchema` renames onto its own `message`.
      aliases: { text: 'message', reason: 'message', description: 'message' },
      guidance: {
        title:
          'An `end` node has no heading — a runner shows the refusal `message` alone under the flow\'s '
          + 'label. Translate `message`; a `title` belongs to a screen (`screens.<node_id>.title`).',
      },
    }, {
      // The one text-slot judge, applied to the translation exactly as
      // `EndConfigSchema` applies it to the message it translates; an empty
      // string is the untranslated skeleton slot (the authored message renders).
      message: flowTextSlotTranslation()
        .optional()
        .describe(
          "Translated refusal message of an `end` node declaring `outcome: 'refused'` — a `{{ }}` template like "
          + 'the message it translates, rendered by the engine in the run\'s locale in place of the authored one',
        ),
    })).optional().describe("Refusal translations keyed by the node id (`FlowNode.id`) of an `end` node declaring `outcome: 'refused'`"),
    approvals: z.record(z.string(), strictObject({
      surface: 'this flow approval-step translation',
      history: TRANSLATION_HISTORY,
      // An approval step's one person-facing string is the NODE's `label`
      // (`FlowNode.label`), so the leaf is spelled as the source spells it.
      // A screen's headline is `title` one group over; an author who holds
      // that spelling (the measured HotCRM key) is told the rename.
      aliases: { title: 'label', name: 'label', heading: 'label', stepLabel: 'label' },
    }, {
      label: z.string().optional().describe(
        "Translated approval-step label — overlays the `approval` node's own `label`, the step name an approval "
        + 'request shows its submitter and approvers',
      ),
    })).optional().describe("Approval-step translations keyed by the node id (`FlowNode.id`) of an `approval` node"),
    // [#28251] A `save_notice` node's message, picked by the ENGINE in the
    // triggering writer's locale before its holes are filled — the `refusals`
    // posture, one group over, addressed the same way (by `FlowNode.id`).
    notices: z.record(z.string(), strictObject({
      surface: 'this flow save-notice translation',
      history: TRANSLATION_HISTORY,
      // The words a notice arrives spelled in — the same aliases
      // `SaveNoticeConfigSchema` renames onto its own `message`.
      aliases: { notice: 'message', text: 'message', body: 'message', description: 'message' },
      guidance: {
        title:
          'A save notice has no heading — the client shows the `message` alone with its success message. '
          + 'Translate `message`.',
      },
    }, {
      // The one text-slot judge, applied to the translation exactly as
      // `SaveNoticeConfigSchema` applies it to the message it translates; an
      // empty string is the untranslated skeleton slot (the authored message renders).
      message: flowTextSlotTranslation()
        .optional()
        .describe(
          'Translated message of a `save_notice` node — a `{{ }}` template like the message it translates, rendered '
          + "by the engine in the triggering writer's locale in place of the authored one",
        ),
    })).optional().describe('Save-notice translations keyed by the node id (`FlowNode.id`) of a `save_notice` node'),
  })).optional().describe('Screen-flow translations keyed by flow name'),

  /**
   * Hook translations keyed by hook name (`Hook.name`) — #26170, maintainer
   * ruling 6431311681 letter A.
   *
   *   hooks.<hook_name>.refusals.<CODE>.message   (a declared refusal, `HookSchema.refusals`)
   *
   * A hook's business refusal ("A current clean version is required before
   * signing.") is the sentence a user reads most often when an app says "not
   * yet", and it was the one refusal door with nowhere to put a translation:
   * validation rules read `objects.<object>._validations.<rule>.message`, a
   * refused flow `end` reads `flows.<flow>.refusals.<node_id>.message`, and a
   * hook threw its sentence from body code no bundle could reach. Under the
   * ruling a hook DECLARES its refusals (`refusals: { <CODE>: { message,
   * status? } }`) and its body refuses by code only, so each sentence is on a
   * named declaration this group can address and the i18n gates can count.
   *
   * **Addressed by hook, not by object.** A hook binds one object, a list, or
   * `'*'` (`HookSchema.object`); one catalogue per hook means one translation
   * per code, whatever the hook is bound to.
   *
   * **Picked before it is served, by the body runner.** The sandboxed body
   * runner answers a throw of a declared code with `hookRefusalMessageKey(hook,
   * code)` (`system/i18n-resolver.ts`), read through the `i18n` service in the
   * caller's `HookContext.session.locale` negotiated by `resolveBundleLocale`;
   * with no locale, or no entry, the declared message is served. The message
   * is plain text like the validation-rule message it sits beside: no `{{ }}`
   * hole is filled, the translation replaces it whole.
   *
   * `objectstack validate` refuses a key over an unknown hook, or a code the
   * hook's `refusals` does not declare.
   */
  hooks: z.record(z.string(), strictObject({
    surface: 'this hook translation',
    history: TRANSLATION_HISTORY,
    aliases: { refusal: 'refusals', errors: 'refusals', messages: 'refusals' },
    guidance: {
      label:
        'A hook has no translated label — the one string of a hook a user reads is a refusal. Translate '
        + '`refusals.<CODE>.message`.',
    },
  }, {
    refusals: z.record(z.string(), strictObject({
      surface: 'this hook refusal translation',
      history: TRANSLATION_HISTORY,
      // The spellings `HookRefusalSchema` renames onto its own `message`.
      aliases: { text: 'message', reason: 'message', description: 'message' },
    }, {
      // Plain text, like the declared message it translates; an empty string
      // is the untranslated skeleton slot `os i18n extract` writes (the
      // declared message is served).
      message: z.string().optional().describe(
        "Translated refusal message of a hook's declared refusal code — served whole in the caller's locale in "
        + 'place of the declared message',
      ),
    })).optional().describe("Refusal translations keyed by the code the hook's `refusals` declares"),
  })).optional().describe('Hook translations keyed by hook name'),

  /**
   * Position translations keyed by position name (`Position.name`,
   * `identity/position.zod.ts`, the stack's `positions[]`).
   *
   *   positions.<name>.label        → the position's own `label`
   *   positions.<name>.description  → the position's own `description`
   *
   * A position is what an admin assigns a person to and what an approval step
   * is pending on, so its label is read next to object, app and flow labels
   * that the same bundle translates. Overlaid by `translatePosition` (`i18n-resolver.ts`) on
   * every served `position` document (`GET /meta/position`, the catalog the
   * console's `position-ref` picker lists); the face stops at the two strings
   * the position itself authors.
   */
  positions: z.record(z.string(), strictObject({
    surface: 'this position translation',
    history: TRANSLATION_HISTORY,
    aliases: { name: 'label', title: 'label' },
  }, {
    label: z.string().optional().describe("Translated position label — overlays the position's own `label`"),
    description: z.string().optional().describe("Translated position description — overlays the position's own `description`"),
  })).optional().describe('Position translations keyed by position name'),

  /**
   * Permission-set translations keyed by permission-set name
   * (`PermissionSet.name`, `security/permission.zod.ts`, the stack's
   * `permissions[]` — the group is spelled as the stack spells the
   * collection).
   *
   *   permissions.<name>.label        → the permission set's own `label`
   *   permissions.<name>.description  → the permission set's own `description`
   *
   * Overlaid by `translatePermissionSet` (`i18n-resolver.ts`) on every served `permission`
   * document (`GET /meta/permission`, the catalog the console's
   * `permission-ref` picker lists). The face stops at the two strings the set
   * itself authors: its grants are machine names, not copy.
   */
  permissions: z.record(z.string(), strictObject({
    surface: 'this permission-set translation',
    history: TRANSLATION_HISTORY,
    aliases: { name: 'label', title: 'label' },
  }, {
    label: z.string().optional().describe("Translated permission-set label — overlays the set's own `label`"),
    description: z.string().optional().describe("Translated permission-set description — overlays the set's own `description`"),
  })).optional().describe('Permission-set translations keyed by permission-set name'),

  /**
   * Doc-book translations keyed by book name (`Book.name`,
   * `system/book.zod.ts`, the stack's `books[]`).
   *
   *   books.<name>.label                     → the book's own `label`
   *   books.<name>.description               → the book's own `description`
   *   books.<name>.groups.<group_key>.label  → a group's `label`, by the group's `key`
   *
   * A book is the spine of a docs table of contents, and its strings frame
   * every page of it: the book title and each section title in the docs
   * sidebar. The pages themselves localize through `doc.translations`; the
   * spine localizes here, the way an app's label and navigation labels do
   * (`apps.<name>.navigation.<id>.label`, keyed by the stable node id as a
   * group is by its stable `key`). Overlaid by `translateBook`
   * (`i18n-resolver.ts`) on every served `book` document (`GET /meta/book`,
   * the list the console's docs portal draws its sidebar from) and on the
   * book `GET /meta/book/:name/tree` resolves. The inline map a book carried
   * before 17.0.0 stays retired: one translation path, this one.
   */
  books: z.record(z.string(), strictObject({
    surface: 'this book translation',
    history: TRANSLATION_HISTORY,
    aliases: { name: 'label', title: 'label', sections: 'groups', chapters: 'groups', toc: 'groups' },
  }, {
    label: z.string().optional().describe("Translated book title — overlays the book's own `label`"),
    description: z.string().optional().describe("Translated book description — overlays the book's own `description`"),
    groups: z.record(z.string(), strictObject({
      surface: 'this book group translation',
      history: TRANSLATION_HISTORY,
      aliases: { name: 'label', title: 'label' },
    }, {
      label: z.string().describe("Translated section title — overlays the group's own `label`"),
    })).optional().describe('Group (section) translations keyed by the group `key`'),
  })).optional().describe('Doc-book translations keyed by book name'),

  /**
   * Translations for **metadata-type configuration forms** — the forms
   * used by admins to author objects, fields, agents, flows, etc. in the
   * Studio metadata editor.
   *
   * Keyed by metadata type (singular: 'object', 'field', 'agent', …).
   *
   * Convention (auto-resolved by `resolveMetadataFormLabels` /
   * `resolveMetadataTypeLabel`):
   *   metadataForms.<type>.label
   *   metadataForms.<type>.description
   *   metadataForms.<type>.sections.<section_name>.label
   *   metadataForms.<type>.sections.<section_name>.description
   *   metadataForms.<type>.fields.<field_path>.label
   *   metadataForms.<type>.fields.<field_path>.helpText
   *   metadataForms.<type>.fields.<field_path>.placeholder
   *
   * `field_path` uses dot-notation for nested composite/repeater fields,
   * e.g. `"name"`, `"capabilities.trackHistory"`, and a repeater ROW property
   * is `"<repeater>.<property>"` with no `items` segment —
   * `"header.actions.label"` names the `label` column of each
   * `dashboard.header.actions[]` row (`"fields.items.label"` addresses a
   * declared child that happens to be named `items`).
   *
   * A row property is rendered from the JSON Schema (`items.properties[k].title`),
   * not from a form-field spec, so its `label` here is applied by
   * `resolveMetadataFormSchemaTitles` as the schema node's `title`; the zod
   * item schema's own `.meta({ title })` is the English name it overlays.
   *
   * @example
   * ```ts
   * metadataForms: {
   *   object: {
   *     label: '对象',
   *     sections: {
   *       basics: { label: '基础信息' },
   *       capabilities: { label: '功能开关' },
   *     },
   *     fields: {
   *       name: { label: '名称', helpText: 'snake_case 唯一标识符（创建后不可修改）' },
   *       'capabilities.trackHistory': { label: '历史追踪' },
   *     },
   *   },
   * }
   * ```
   */
  metadataForms: z.record(z.string(), strictObject({
    surface: 'this metadata-form translation',
    history: TRANSLATION_HISTORY,
    aliases: { name: 'label', title: 'label', groups: 'sections', properties: 'fields' },
  }, {
    label: z.string().optional().describe('Translated metadata-type display label (overrides registry label)'),
    description: z.string().optional().describe('Translated metadata-type description'),
    sections: z.record(z.string(), strictObject({
      surface: 'this metadata-form section translation',
      history: TRANSLATION_HISTORY,
      aliases: { name: 'label', title: 'label', heading: 'label' },
    }, {
      label: z.string().optional().describe('Translated section label'),
      description: z.string().optional().describe('Translated section description'),
    })).optional().describe('Section translations keyed by section.name'),
    fields: z.record(z.string(), strictObject({
      surface: 'this metadata-form field translation',
      history: TRANSLATION_HISTORY,
      aliases: { name: 'label', title: 'label', help: 'helpText', hint: 'helpText', description: 'helpText' },
    }, {
      label: z.string().optional().describe('Translated field label'),
      helpText: z.string().optional().describe('Translated field help/hint text'),
      placeholder: z.string().optional().describe('Translated field placeholder text'),
    })).optional().describe('Field translations keyed by field path (dot-notation for nested fields)'),
  })).optional().describe('Translations for metadata-type configuration forms keyed by metadata type'),

  /**
   * Cross-namespace strings used by the Settings UI shell — source
   * badges, inheritance chips, lock reasons, common actions. Resolved
   * via the `resolveSettingsCommon*` helpers in `i18n-resolver.ts`.
   */
  settingsCommon: strictObject({
    surface: 'the shared Settings UI translations',
    history: TRANSLATION_HISTORY,
  }, {
    sourceLabels: strictObject({
      surface: 'the settings source-badge labels',
      history: TRANSLATION_HISTORY,
      // The layers are a closed set (ADR-0010 / the settings resolution order),
      // so an unknown one here is a badge that will never render, not a layer
      // the platform is about to grow.
      aliases: { org: 'tenant', workspace: 'tenant', system: 'global', fallback: 'default', environment: 'env' },
    }, {
      env: z.string().optional(),
      global: z.string().optional(),
      tenant: z.string().optional(),
      user: z.string().optional(),
      default: z.string().optional(),
    }).optional().describe('Source badge labels by resolution layer'),
  }).optional().describe('Cross-namespace Settings UI strings'),
});

/**
 * The one group that is PLATFORM-ONLY, as a shape rather than a schema.
 *
 * `settings` is keyed by `SettingsManifest.namespace`, and a manifest is
 * platform code (`packages/services/service-settings/src/manifests/*.manifest.ts`)
 * — an application cannot declare one. So the only namespaces a per-app bundle
 * could ever address are the PLATFORM's own, and what an app authored there
 * deep-merged into the single served tree
 * (`AppPlugin.loadTranslations` → `II18nService.loadTranslations`) that
 * {@link resolveSettingsTitle} and the console's `useSettingsLabel` read.
 *
 * It was therefore not dropped — but nor did it win. `AppPlugin` loads the
 * app's bundles in its own `start()` (kernel Phase 2) while
 * `SettingsServicePlugin` contributes the platform's settings translations from
 * a `kernel:ready` hook (Phase 3), and `deepMerge` gives the LATER source the
 * leaf. So a per-app entry rendered only where the platform bundle carried no
 * string for that key and locale, and was overwritten wherever both defined the
 * key. Platform labels and application labels are separate namespaces (ruling
 * batch #132 item 2 letter ②), so this shape is spread into
 * {@link PlatformTranslationDataSchema} ONLY. Both application-authored doors
 * refuse it by name: {@link TranslationDataSchema} since #15178, and
 * {@link TranslationItemSchema} since #19620 (ruling batch #210 item 2
 * letter B) — the item had been the stronger of the two, because the
 * runtime-authored layer it feeds is read OVER the shipped bundles, so an
 * item's `settings` overrode the platform's copy rather than filling its gaps.
 *
 * A function, not a `const`, for the same reason
 * {@link appTranslationDataShape} is one.
 */
const platformSettingsShape = () => ({
  /**
   * Settings manifest translations keyed by settings namespace
   * (matches `SettingsManifest.namespace`, e.g. "mail", "branding").
   *
   * Convention (auto-resolved by `resolveSettings*` helpers):
   *   settings.<namespace>.title
   *   settings.<namespace>.description
   *   settings.<namespace>.groups.<group_key>.title
   *   settings.<namespace>.groups.<group_key>.description
   *   settings.<namespace>.keys.<setting_key>.label
   *   settings.<namespace>.keys.<setting_key>.help
   *   settings.<namespace>.keys.<setting_key>.placeholder
   *   settings.<namespace>.keys.<setting_key>.options.<option_value>
   *   settings.<namespace>.actions.<action_id>.label
   *   settings.<namespace>.actions.<action_id>.confirmText
   *   settings.<namespace>.actions.<action_id>.successMessage
   *   settings.<namespace>.banners.<banner_id>.title
   *   settings.<namespace>.banners.<banner_id>.text
   *
   * `banners` is keyed by an `info_banner` specifier's `id`, as `groups` is
   * keyed by a `group` specifier's. Its leaves follow the nearest sibling:
   * the specifier's `label` translates as `title` (the heading spelling
   * `groups` already uses for the same field), and its `bannerText` as
   * `text`. A banner without an `id` has no address here and renders its
   * manifest literals.
   */
  settings: z.record(z.string(), strictObject({
    surface: 'this settings manifest translation',
    history: TRANSLATION_HISTORY,
    aliases: { label: 'title', name: 'title', sections: 'groups', fields: 'keys', settings: 'keys', banner: 'banners', notices: 'banners', alerts: 'banners' },
  }, {
    title: z.string().optional().describe('Translated settings manifest title'),
    description: z.string().optional().describe('Translated settings manifest description'),
    groups: z.record(z.string(), strictObject({
      surface: 'this settings group translation',
      history: TRANSLATION_HISTORY,
      aliases: { label: 'title', name: 'title', heading: 'title' },
    }, {
      title: z.string().optional().describe('Translated group title'),
      description: z.string().optional().describe('Translated group description'),
    })).optional().describe('Group translations keyed by group key'),
    keys: z.record(z.string(), strictObject({
      surface: 'this setting translation',
      history: TRANSLATION_HISTORY,
      aliases: { title: 'label', name: 'label', helpText: 'help', hint: 'help', description: 'help', choices: 'options', values: 'options' },
    }, {
      label: z.string().optional().describe('Translated setting label'),
      help: z.string().optional().describe('Translated setting help text'),
      placeholder: z.string().optional().describe('Translated input placeholder'),
      options: z.record(z.string(), z.string()).optional()
        .describe('Enum option value → translated label'),
    })).optional().describe('Per-setting field translations keyed by setting key'),
    actions: z.record(z.string(), strictObject({
      surface: 'this settings action translation',
      history: TRANSLATION_HISTORY,
      // Settings actions have no `params`/`resultDialog` — a settings button is
      // not an action-metadata action. Say so, rather than suggesting the
      // nearest key and sending the author round again.
      aliases: { name: 'label', title: 'label', confirm: 'confirmText', success: 'successMessage' },
      guidance: {
        params: 'settings actions take no parameters — there is no `params` group to translate',
        resultDialog: 'settings actions have no result dialog — `resultDialog` translations belong under `objects.<object>._actions` or `globalActions`',
      },
    }, {
      label: z.string().optional().describe('Translated action label'),
      confirmText: z.string().optional().describe('Translated confirmation prompt'),
      successMessage: z.string().optional().describe('Translated success toast/message'),
    })).optional().describe('Action button translations keyed by action id'),
    banners: z.record(z.string(), strictObject({
      surface: 'this settings banner translation',
      history: TRANSLATION_HISTORY,
      // The specifier's own spellings (`label`, `bannerText`) and the group
      // body's (`description`) are the likely borrowings; each names the leaf
      // that holds the same string here.
      aliases: { label: 'title', name: 'title', heading: 'title', bannerText: 'text', body: 'text', description: 'text', message: 'text' },
    }, {
      title: z.string().optional().describe('Translated banner title (the info_banner specifier label)'),
      text: z.string().optional().describe('Translated banner body, markdown (the info_banner specifier bannerText)'),
    })).optional().describe('Info banner translations keyed by the info_banner specifier id'),
  })).optional().describe('Settings manifest translations keyed by namespace'),
});

/**
 * One locale of a PER-APP translation bundle — `stack.translations`, and
 * everything {@link defineTranslationBundle} builds.
 *
 * Sixteen groups: every group the platform bundle declares EXCEPT `settings`,
 * which is platform-only and is refused here by name with
 * {@link PER_APP_SETTINGS_PLATFORM_ONLY} as the remedy. See
 * {@link PlatformTranslationDataSchema} for the seventeen-group face and for why
 * the two are separate namespaces.
 */
export const TranslationDataSchema = lazySchema(() => strictObject({
  surface: 'this locale of the translation bundle',
  history: TRANSLATION_HISTORY,
  guidance: APP_TRANSLATION_KEY_GUIDANCE,
  // ⛔ No `setting: 'settings'` alias any more: this door no longer declares
  // `settings`, and an alias prescribing a key the shape rejects is a
  // suggestion the author cannot take (the `alias-integrity` audit judges
  // exactly that). Both spellings are answered by `guidance` above instead.
  aliases: { object: 'objects', fields: 'objects', app: 'apps', page: 'pages', dashboard: 'dashboards', dataset: 'datasets', report: 'reports', picklist: 'picklists', flow: 'flows', hook: 'hooks', position: 'positions', permission: 'permissions', permissionSets: 'permissions', book: 'books', message: 'messages', strings: 'messages', labels: 'messages', actions: 'globalActions' },
  // `locale` lives on the ITEM, not on a bundle entry (the bundle keys ARE the
  // locales). Naming it keeps the suggestion useful for an author who moved a
  // `translation` item into a bundle and left the field behind.
  extraKeys: ['locale'],
}, appTranslationDataShape()).describe('Per-app translation data for objects, apps, and UI messages'));

export type TranslationData = z.input<typeof TranslationDataSchema>;

/**
 * One locale of a PLATFORM translation bundle — the seventeen groups, `settings`
 * included.
 *
 * The platform's own bundles are code, not authored metadata
 * (`@objectstack/service-settings`, `@objectstack/platform-objects`, the
 * plugins), and `settings` is theirs alone: it is keyed by
 * `SettingsManifest.namespace` and only platform code declares a manifest.
 *
 * ## Why this is a second export rather than one type serving both
 *
 * It was one type, and one type serving two bundles is what made every
 * reading of this key wrong. A per-app census asked "does any application
 * carry `settings` data?", got zero, and read that as "dead key" — while the
 * platform read it on every Settings screen. The two bundles are separate
 * namespaces on the platforms this one resembles, and they are separate here
 * (ruling batch #132 item 2 letter ②, 2026-09-13).
 *
 * What the merged type cost, measured rather than assumed: both bundles are
 * loaded into ONE served tree (`AppPlugin.loadTranslations` and each platform
 * plugin's `kernel:ready` contribution both call
 * `II18nService.loadTranslations`, which deep-merges), and
 * {@link resolveSettingsTitle} and the console's `useSettingsLabel` read that
 * merged tree. So a per-app `settings` branch did not sit inert — but it did
 * not override the platform either. The app's bundles arrive in `AppPlugin`'s
 * `start()` (kernel Phase 2) and the platform's at `kernel:ready` (Phase 3),
 * and `deepMerge` gives the later source the leaf, so the platform won every
 * key both defined. What an application actually had was a GAP FILLER on a
 * namespace it does not own: it rendered only where the platform bundle
 * carried no string for that key and locale, silently and with no way to tell
 * the two cases apart.
 */
export const PlatformTranslationDataSchema = lazySchema(() => strictObject({
  surface: 'this locale of the platform translation bundle',
  history: TRANSLATION_HISTORY,
  guidance: TRANSLATION_KEY_GUIDANCE,
  aliases: { object: 'objects', fields: 'objects', app: 'apps', page: 'pages', dashboard: 'dashboards', dataset: 'datasets', report: 'reports', picklist: 'picklists', flow: 'flows', hook: 'hooks', position: 'positions', permission: 'permissions', permissionSets: 'permissions', book: 'books', setting: 'settings', message: 'messages', strings: 'messages', labels: 'messages', actions: 'globalActions' },
  extraKeys: ['locale'],
}, {
  ...appTranslationDataShape(),
  ...platformSettingsShape(),
}).describe('Platform translation data — the per-app groups plus the platform-only `settings`'));

export type PlatformTranslationData = z.input<typeof PlatformTranslationDataSchema>;

/**
 * The platform groups the SERVED document leaves out —
 * `GET /i18n/translations/:locale` answers {@link ServedTranslationDataSchema},
 * the platform face without these (#25785).
 *
 * A group belongs here when the server resolves it before it serves the
 * surface the group translates, so no browser reads it from the served
 * document. `metadataForms` is the one member: it translates Studio's
 * metadata-type authoring forms, and those reach Studio already translated —
 * the `/meta/types` handler applies `resolveMetadataTypeLabel`,
 * `resolveMetadataFormLabels` and `resolveMetadataFormSchemaTitles` to each
 * entry over the i18n service's in-process bundle before it answers. Carried in
 * the served document as well, it was the second-largest group of every console
 * open (75 KB of 221 KB raw on `examples/app-crm` zh-CN) and nothing read it.
 *
 * ⛔ Only the served document leaves these out. Every bundle face still
 * declares the group, and the i18n service still holds it: the serving door
 * copies the document without them and never edits the service's own tree,
 * which is the tree `/meta/types` translates from.
 */
export const SERVER_RESOLVED_TRANSLATION_GROUPS = ['metadataForms'] as const;

/**
 * One locale of the SERVED translation document — what
 * `GET /i18n/translations/:locale` answers: {@link PlatformTranslationDataSchema}
 * without {@link SERVER_RESOLVED_TRANSLATION_GROUPS}.
 *
 * Its own `strictObject` rather than `.omit()` on the platform face, for the
 * reason {@link appTranslationDataShape} gives against `.extend()`: the derived
 * schema would keep the error map that closed over the base's keys, so a body
 * still carrying `metadataForms` would be told the key it should not carry is
 * a declared one. Closed, a served body that carries a server-resolved group
 * fails this schema, which is what the response conformance suites parse with.
 */
export const ServedTranslationDataSchema = lazySchema(() => {
  const { metadataForms: _serverResolved, ...appGroups } = appTranslationDataShape();
  return strictObject({
    surface: 'this locale of the served translation document',
    history: TRANSLATION_HISTORY,
    guidance: {
      metadataForms:
        "the served document leaves 'metadataForms' out: Studio's authoring forms are translated "
        + 'on the server, and /meta/types serves each form already in the requested locale.',
    },
  }, {
    ...appGroups,
    ...platformSettingsShape(),
  }).describe('Served translation data — the platform groups the browser reads, without the server-resolved `metadataForms`');
});

export type ServedTranslationData = z.input<typeof ServedTranslationDataSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Translation Bundle (all locales)
// ────────────────────────────────────────────────────────────────────────────

export const TranslationBundleSchema = lazySchema(() => z.record(LocaleSchema, TranslationDataSchema).describe('Map of locale codes to per-app translation data'));

export type TranslationBundle = z.input<typeof TranslationBundleSchema>;

/**
 * The platform's own locale map — {@link PlatformTranslationDataSchema} per
 * locale. `@objectstack/service-settings`'s `settingsBuiltinTranslations` is
 * the bundle that needs it; a platform package authoring only groups the
 * per-app face also declares can keep the narrower {@link TranslationBundle}.
 */
export const PlatformTranslationBundleSchema = lazySchema(() => z.record(LocaleSchema, PlatformTranslationDataSchema).describe('Map of locale codes to platform translation data'));

export type PlatformTranslationBundle = z.input<typeof PlatformTranslationBundleSchema>;

/**
 * Type-safe factory for an i18n translation bundle (locale code → translations map). Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: TranslationBundle` literal.
 */
export function defineTranslationBundle(config: z.input<typeof TranslationBundleSchema>): TranslationBundle {
  return TranslationBundleSchema.parse(config);
}

// ────────────────────────────────────────────────────────────────────────────
// Translation Configuration
// ────────────────────────────────────────────────────────────────────────────

/**
 * Translation Configuration Schema
 *
 * Defines internationalization settings for the stack.
 *
 * #3494: the aspirational knobs `fileOrganization`, `messageFormat`, `lazyLoad`
 * and `cache` were removed — no runtime ever read them (there is no ICU engine;
 * interpolation is always simple `{variable}` substitution), so authoring them
 * was a silent no-op (liveness audit #1878/#1893).
 *
 * @example
 * ```typescript
 * export default defineStack({
 *   i18n: {
 *     defaultLocale: 'en',
 *     supportedLocales: ['en', 'zh-CN', 'ja-JP'],
 *     fallbackLocale: 'en',
 *   },
 *   translations: [...],
 * });
 * ```
 */
export const TranslationConfigSchema = lazySchema(() => strictObject({
  surface: 'the i18n configuration',
  history:
    'Until this shape was closed an unknown key was dropped silently — the stack still '
    + 'built, with the setting the author wrote never reaching any runtime.',
  aliases: { locale: 'defaultLocale', defaultLanguage: 'defaultLocale', locales: 'supportedLocales', languages: 'supportedLocales', fallback: 'fallbackLocale', fallbackLanguage: 'fallbackLocale' },
  // #3494 removed these four. They were the exemplar the liveness audit
  // (#1878/#1893) was built to find — declared, authored, and read by nothing —
  // and removing them made a config that was *already* a no-op into a config
  // that was a silent no-op for a second reason. A tombstone is the only thing
  // that tells an author upgrading from <17 why their setting vanished.
  guidance: {
    fileOrganization: '`fileOrganization` was removed — no runtime ever read it; how you split bundle files is a convention of your source tree, and the loader reads whatever `translations` you hand `defineStack`',
    messageFormat: '`messageFormat` was removed — there is no ICU engine; interpolation is always simple `{variable}` substitution',
    lazyLoad: '`lazyLoad` was removed — no runtime ever read it, so setting it changed nothing',
    cache: '`cache` was removed — no runtime ever read it, so setting it changed nothing',
  },
}, {
  /** Default locale for the application */
  defaultLocale: LocaleSchema.describe('Default locale (e.g., "en")'),
  /** Supported BCP-47 locale codes */
  supportedLocales: z.array(LocaleSchema).describe('Supported BCP-47 locale codes'),
  /** Fallback locale when translation is not found */
  fallbackLocale: LocaleSchema.optional().describe('Fallback locale code'),
}).describe('Internationalization configuration'));

export type TranslationConfig = z.input<typeof TranslationConfigSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Translation Item (the runtime-authored `translation` metadata type)
// ────────────────────────────────────────────────────────────────────────────

/**
 * TranslationItemSchema
 *
 * The shape of a single `translation` metadata item — one locale's worth of
 * translations, authored either as a file (`*.translation.ts`) or at runtime
 * through the metadata door (Studio, the metadata API, an AI agent).
 *
 * It is deliberately the SAME set of groups the file-authored bundles use and
 * the resolvers read (`objects.<object_name>`, `apps`, `messages`, …): one
 * item is one entry of a {@link TranslationBundle}, plus the `locale` naming
 * which entry it is. Before #3778 this type was registered against a second,
 * object-first (`o.<object>`) dialect that no resolver ever read, so a
 * translation authored in the product saved successfully and then rendered
 * nothing. That dialect is gone, and its keys are rejected outright rather
 * than stripped — see {@link LEGACY_OBJECT_FIRST_KEYS}. Since #4001 so is
 * every *other* undeclared key, which is the part #3778 could not reach.
 *
 * `locale` is required rather than inferred from the item name: the runtime
 * sync skips an item whose locale it cannot resolve, and a skip is invisible
 * to whoever — or whatever — authored it.
 *
 * `settings` is NOT on this door (#19620, ruling batch #210 item 2 letter B):
 * the item takes the PER-APP face, the same sixteen groups as
 * {@link TranslationDataSchema}, and refuses `settings` (and the singular
 * `setting`) by name with {@link ITEM_SETTINGS_PLATFORM_ONLY} as the remedy.
 * The file door and the item door are two authoring surfaces for one app
 * metadata type, so they accept one shape; settings copy belongs to the
 * platform bundle ({@link PlatformTranslationDataSchema}). A row stored
 * before the door closed is converted rather than refused — the runtime sync
 * replays the ADR-0087 chain over it (`translation-per-app-settings-removed`)
 * and drops the group with a warning.
 *
 * `messages` ids are single-segment, for the reason spelled out on
 * {@link TranslationDataSchema}: `t()` walks the dot path, so an id containing
 * a dot resolves to nothing.
 *
 * @example
 * ```typescript
 * const zhCN = defineTranslation({
 *   locale: 'zh-CN',
 *   objects: {
 *     account: {
 *       label: '客户',
 *       fields: { name: { label: '客户名称' } },
 *       _views: { all_accounts: { label: '全部客户' } },
 *       _actions: { merge: { label: '合并客户', confirmText: '此操作无法撤销，确认合并？' } },
 *     },
 *   },
 *   apps: { crm: { label: '客户关系管理' } },
 *   messages: { commonSave: '保存' },
 * });
 * ```
 */
export const TranslationItemSchema = lazySchema(() => strictObject({
  surface: 'this translation',
  history: TRANSLATION_HISTORY,
  guidance: ITEM_TRANSLATION_KEY_GUIDANCE,
  // ⛔ No `setting: 'settings'` alias any more, for the file door's reason:
  // this door no longer declares `settings`, and an alias prescribing a key
  // the shape rejects is a suggestion the author cannot take. Both spellings
  // are answered by `guidance` above instead.
  aliases: { object: 'objects', app: 'apps', page: 'pages', dataset: 'datasets', report: 'reports', picklist: 'picklists', flow: 'flows', hook: 'hooks', position: 'positions', permission: 'permissions', permissionSets: 'permissions', book: 'books', message: 'messages', strings: 'messages', labels: 'messages', actions: 'globalActions', lang: 'locale', language: 'locale' },
}, {
  ...appTranslationDataShape(),
  locale: LocaleSchema.describe('BCP-47 locale this item translates (e.g. "zh-CN")'),

  // Item identity. Every other registered metadata type declares these;
  // `translation` did not, because #3778 rebuilt the shape as "one entry of a
  // bundle, plus `locale`" and the identity keys were not part of a bundle
  // entry. They ARE part of an item: the platform's own create seed
  // (`metadata-create-seeds.ts`) sends both, and `authored-translation-sync`
  // destructures `name` back out of the stored body — it knows the body has it.
  // Undeclared, they were stripped on every parse, so the metadata door quietly
  // discarded an item's own name on the way through.
  //
  // Named like every other metadata item: snake_case (`zh_cn`), with the BCP-47
  // tag in `locale`. The save door's item-name grammar
  // (`METADATA_ITEM_NAME_PATTERN`) refuses a tag-shaped name such as `zh-CN`,
  // so this shape does not re-check it. The runtime sync still reads a
  // tag-shaped `row.name` as a locale fallback, but only for rows stored before
  // `locale` became required. Optional because `locale`, not `name`, is this
  // type's required identity — that call was deliberate (a skipped item is
  // invisible) and is not being reopened.
  name: z.string().optional().describe('Item name — snake_case like every metadata item (e.g. `zh_cn`); the BCP-47 tag goes in `locale`'),
  label: z.string().optional().describe('Human-readable label shown in metadata lists'),

  // ADR-0010 — runtime protection envelope (internal — set by the loader).
  // `translation` is a registered metadata type, so `MetadataPlugin`'s artifact
  // loader stamps `_packageId` / `_provenance` on it. Undeclared, they were
  // dropped on every parse — and `authored-translation-sync` has to strip them
  // by hand on the read side precisely because the schema could not hold them.
  ...MetadataProtectionFields,
  // ADR-0146 D2 — the override declaration (authored; travels with the item).
  ...OverrideDeclarationFields,
}).describe('One locale of translations — the `translation` metadata type'));

/** A single `translation` metadata item. */
export type TranslationItem = z.input<typeof TranslationItemSchema>;

/**
 * Type-safe factory for a single-locale `translation` item. Validates at
 * authoring time via `.parse()` — preferred over a bare `: TranslationItem`
 * literal, which cannot catch a retired key.
 */
export function defineTranslation(config: z.input<typeof TranslationItemSchema>): TranslationItem {
  return TranslationItemSchema.parse(config);
}

// ────────────────────────────────────────────────────────────────────────────
// Translation Diff & Coverage
// ────────────────────────────────────────────────────────────────────────────

/**
 * Translation Diff Status
 *
 * Status of a single translation entry compared to the source metadata.
 */
export const TranslationDiffStatusSchema = lazySchema(() => z.enum([
  'missing',
  'redundant',
  'stale',
]).describe('Translation diff status: missing from bundle, redundant (no matching metadata), or stale (metadata changed)'));

export type TranslationDiffStatus = z.input<typeof TranslationDiffStatusSchema>;

/**
 * TranslationDiffItemSchema
 *
 * Describes a single translation key that is missing, redundant, or stale
 * relative to the source metadata. Used by CLI/API diff detection.
 *
 * @example
 * ```typescript
 * const item: TranslationDiffItem = {
 *   key: 'objects.account.fields.website.label',
 *   status: 'missing',
 *   objectName: 'account',
 *   locale: 'zh-CN',
 * };
 * ```
 */
export const TranslationDiffItemSchema = lazySchema(() => z.object({
  /** Dot-path translation key (e.g. "objects.account.fields.website.label") */
  key: z.string().describe('Dot-path translation key'),
  /** Diff status */
  status: TranslationDiffStatusSchema.describe('Diff status of this translation key'),
  /** Object name if the key belongs to an object translation node */
  objectName: z.string().optional().describe('Associated object name (snake_case)'),
  /** Locale code */
  locale: z.string().describe('BCP-47 locale code'),
  /**
   * Hash of the source metadata value at the time the translation was made.
   * Used by CLI/Workbench to detect stale translations without a full diff.
   */
  sourceHash: z.string().optional().describe('Hash of source metadata for precise stale detection'),
  /**
   * AI-suggested translation text for missing or stale entries.
   * Populated by AI translation hooks or TMS integrations.
   */
  aiSuggested: z.string().optional().describe('AI-suggested translation for this key'),
  /** Confidence score (0-1) for the AI suggestion */
  aiConfidence: z.number().min(0).max(1).optional().describe('AI suggestion confidence score (0–1)'),
}).describe('A single translation diff item'));

export type TranslationDiffItem = z.input<typeof TranslationDiffItemSchema>;

/**
 * TranslationCoverageResultSchema
 *
 * Aggregated coverage result for a locale, optionally scoped to a single object.
 * Returned by the i18n diff detection API.
 *
 * @example
 * ```typescript
 * const result: TranslationCoverageResult = {
 *   locale: 'zh-CN',
 *   totalKeys: 120,
 *   translatedKeys: 105,
 *   missingKeys: 12,
 *   redundantKeys: 3,
 *   staleKeys: 0,
 *   coveragePercent: 87.5,
 *   items: [ ... ],
 * };
 * ```
 */
/**
 * Per-group coverage breakdown entry.
 */
export const CoverageBreakdownEntrySchema = lazySchema(() => z.object({
  /** Group category (e.g. "fields", "views", "actions", "messages") */
  group: z.string().describe('Translation group category'),
  /** Total translatable keys in this group */
  totalKeys: z.number().int().nonnegative().describe('Total keys in this group'),
  /** Number of translated keys in this group */
  translatedKeys: z.number().int().nonnegative().describe('Translated keys in this group'),
  /** Coverage percentage for this group */
  coveragePercent: z.number().min(0).max(100).describe('Coverage percentage for this group'),
}).describe('Coverage breakdown for a single translation group'));

export type CoverageBreakdownEntry = z.input<typeof CoverageBreakdownEntrySchema>;

export const TranslationCoverageResultSchema = lazySchema(() => z.object({
  /** BCP-47 locale code */
  locale: z.string().describe('BCP-47 locale code'),
  /** Optional object name scope */
  objectName: z.string().optional().describe('Object name scope (omit for full bundle)'),
  /** Total translatable keys derived from metadata */
  totalKeys: z.number().int().nonnegative().describe('Total translatable keys from metadata'),
  /** Number of keys that have a translation */
  translatedKeys: z.number().int().nonnegative().describe('Number of translated keys'),
  /** Number of missing translations */
  missingKeys: z.number().int().nonnegative().describe('Number of missing translations'),
  /** Number of redundant (orphaned) translations */
  redundantKeys: z.number().int().nonnegative().describe('Number of redundant translations'),
  /** Number of stale translations */
  staleKeys: z.number().int().nonnegative().describe('Number of stale translations'),
  /** Coverage percentage (0-100) */
  coveragePercent: z.number().min(0).max(100).describe('Translation coverage percentage'),
  /** Individual diff items */
  items: z.array(TranslationDiffItemSchema).describe('Detailed diff items'),
  /**
   * Per-group coverage breakdown for translation project management.
   * Each entry represents a logical group (e.g. "fields", "views", "actions",
   * "messages") with its own coverage statistics.
   */
  breakdown: z.array(CoverageBreakdownEntrySchema).optional()
    .describe('Per-group coverage breakdown'),
}).describe('Aggregated translation coverage result'));

export type TranslationCoverageResult = z.input<typeof TranslationCoverageResultSchema>;
