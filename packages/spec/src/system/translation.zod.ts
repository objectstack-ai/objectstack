// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

// ────────────────────────────────────────────────────────────────────────────
// Locale
// ────────────────────────────────────────────────────────────────────────────

import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
export const LocaleSchema = lazySchema(() => z.string().describe('BCP-47 Language Tag (e.g. en-US, zh-CN)'));
export type Locale = z.input<typeof LocaleSchema>;

/**
 * Shared history sentence for every shape in this file (#4001).
 *
 * Translation data has the most literal version of the silent-strip failure in
 * the whole spec: a misspelled group or key is dropped, the bundle saves or
 * loads without complaint, and the string it was meant to translate renders in
 * the source language. There is no error, no log line, and no difference
 * between "not translated yet" and "translated into a key nothing reads" — so
 * the bug looks like missing coverage forever.
 */
const TRANSLATION_HISTORY =
  'Until #4001 closed these shapes an unknown key was dropped silently — the bundle still '
  + 'loaded, and whatever it was meant to translate rendered in the source language with no '
  + 'diagnostic, indistinguishable from a translation nobody had written yet.';

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
    parameters: 'params', args: 'params', inputs: 'params',
    result: 'resultDialog', dialog: 'resultDialog',
  },
}, {
  label: z.string().optional().describe('Translated action label'),
  // The address `useObjectLabel.actionDescription` already resolves —
  // `objects.{object}._actions.{action}.description`, falling back to
  // `globalActions.{action}.description` (objectui
  // packages/i18n/src/useObjectLabel.ts:463). Declared here with #7367's
  // `ActionSchema.description`: a bundle could not carry the string the
  // resolver was already looking for.
  description: z.string().optional().describe('Translated action description — the explanatory line under the title in the action\'s param dialog'),
  confirmText: z.string().optional().describe('Translated confirmation prompt'),
  successMessage: z.string().optional().describe('Translated success toast/message'),
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
export const ObjectTranslationDataSchema = lazySchema(() => strictObject({
  surface: 'this object translation',
  history: TRANSLATION_HISTORY,
  aliases: {
    // The group prefixes are the whole point of the `_`-prefixed convention,
    // and the un-prefixed spelling is the one an author reaches for first.
    views: '_views', actions: '_actions', sections: '_sections',
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
   *   objects.<object>._views.<view_name>.emptyState.title
   *   objects.<object>._views.<view_name>.emptyState.message
   */
  _views: z.record(z.string(), strictObject({
    surface: 'this view translation',
    history: TRANSLATION_HISTORY,
    aliases: { name: 'label', title: 'label', empty: 'emptyState', emptyMessage: 'emptyState' },
  }, {
    label: z.string().optional().describe('Translated view label'),
    description: z.string().optional().describe('Translated view description'),
    emptyState: strictObject({
      surface: 'this view empty-state translation',
      history: TRANSLATION_HISTORY,
      aliases: { label: 'title', heading: 'title', description: 'message', text: 'message', body: 'message' },
    }, {
      title: z.string().optional().describe('Translated empty-state title'),
      message: z.string().optional().describe('Translated empty-state message'),
    }).optional().describe('Translated empty-state copy shown when the view has no rows'),
  })).optional().describe('View translations keyed by view name'),

  /**
   * Action translations keyed by action name (snake_case).
   * Convention (auto-resolved by `resolveActionLabel`/`resolveActionConfirm`/`resolveActionSuccess`):
   *   objects.<object>._actions.<action_name>.label
   *   objects.<object>._actions.<action_name>.confirmText
   *   objects.<object>._actions.<action_name>.successMessage
   *   objects.<object>._actions.<action_name>.resultDialog.*
   */
  _actions: z.record(z.string(), actionTranslationSchema('this object action translation'))
    .optional().describe('Action translations keyed by action name'),

  /**
   * Section translations keyed by section name (snake_case).
   * Convention:
   *   objects.<object>._sections.<section_name>.label
   * Used by `record:details` to translate per-section labels on detail pages
   * (e.g. "Opportunity Information" → "商机信息"). Each section in the
   * page schema must declare a stable `name` for the lookup to fire.
   */
  _sections: z.record(z.string(), strictObject({
    surface: 'this section translation',
    history: TRANSLATION_HISTORY,
    aliases: { name: 'label', title: 'label', heading: 'label' },
  }, {
    label: z.string().optional().describe('Translated section label'),
    description: z.string().optional().describe('Translated section description'),
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
 */
export const LEGACY_OBJECT_FIRST_KEYS = [
  'o',
  'app',
  'nav',
  'dashboard',
  'reports',
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
    '`validationMessages` was removed in @objectstack/spec 17.0.0 (#4667, ADR-0049) — no '
    + 'resolver ever read it, so a translated rule message was stored and never shown. '
    + 'Validation messages are not translated through a translation group: author the '
    + 'message on the rule itself (`object.validations[].message`), which the engine '
    + 'evaluates and returns on every rejected write. Delete the key. Run '
    + '`os migrate meta --from 16` to rewrite existing sources automatically.',
  o: "`o` is the retired object-first dialect, which no resolver reads — use 'objects.<object_name>'",
  app: "`app` is the retired object-first dialect, which no resolver reads — use 'apps.<app_name>'",
  nav: "`nav` is the retired object-first dialect, which no resolver reads — use 'apps.<app_name>.navigation.<node_id>.label'",
  dashboard: "`dashboard` is the retired object-first dialect, which no resolver reads — use 'dashboards.<dashboard_name>' (plural)",
  reports: '`reports` is the retired object-first dialect — reports have no translation group, omit them',
  notifications: '`notifications` is the retired object-first dialect — notifications have no translation group, omit them',
  // Was: "use 'validationMessages' for rule messages". That was a signpost to a
  // key with no reader — #3778 retired `errors` by pointing authors at
  // `validationMessages`, which was itself dead, so taking the advice moved the
  // content from one unread group to another. Both are gone now (#4667).
  errors:
    '`errors` is the retired object-first dialect and has no replacement — rule messages are '
    + 'not translated through a translation group at all. Author the message on the rule '
    + "itself (`object.validations[].message`); omit `errors`.",
  _globalOptions: "`_globalOptions` is the retired object-first dialect — use 'objects.<object_name>.fields.<field_name>.options'",
  _meta: "`_meta` is the retired object-first dialect — use the top-level 'locale' field (on a bundle, the locale is the map key)",
  namespace: '`namespace` is not part of the translation contract — omit it (ADR-0006 D4 retired namespaces platform-wide)',
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
 *   "messages": { "common.save": "Save" }
 * }
 * ```
 */
/**
 * The translation groups, as a shape rather than a schema.
 *
 * Two schemas need exactly these keys: {@link TranslationDataSchema} (one entry
 * of a file-authored bundle) and {@link TranslationItemSchema} (the registered
 * `translation` metadata type — the same groups plus `locale` and the ADR-0010
 * envelope). The item used to reach them with `.extend()`, which is correct for
 * the *validation* but wrong for the *error*: `.extend()` inherits the strict
 * error map that closed over the keys the BASE was built with, so a typo of
 * `locale` on an item would be rejected with `locale` missing from the
 * candidate list. A shape spread into two `strictObject` calls gives each
 * surface its own full key set — the pattern the six `validation` variants
 * settled on in the same campaign.
 *
 * A function, not a `const`: the values reference `lazySchema` proxies, and
 * building the shape eagerly at module load would defeat the laziness those
 * exist for.
 */
/**
 * The two measured exclusions on `flows.<flow>.screens.<node>.fields.<field>`.
 *
 * Both are keys an author reaches for from a neighbouring surface — `help` is
 * correct on an object FIELD translation and on a settings key, `options` on
 * both of those too — and on a screen field neither has anything behind it.
 * Written as `guidance` rather than aliases because there is no right key to
 * send them to: the copy does not exist on this surface at all, and pointing
 * at the nearest-looking one would translate the wrong string.
 */
const FLOW_SCREEN_FIELD_NO_HELP =
  'a screen field declares no help/hint copy — `ScreenFieldConfig` is '
  + '`name`/`label`/`type`/`required`/`options`/`defaultValue`/`placeholder`/`visibleWhen`, so there is '
  + 'nothing here to translate. Use `placeholder` for the in-input hint the field does declare.';

const FLOW_SCREEN_FIELD_NO_OPTIONS =
  'select-option labels are not translatable on a screen field: `ScreenFieldConfig.options[].value` is '
  + 'unconstrained (numbers and booleans are legal), so an option map keyed by value — the shape '
  + '`objects.<object>.fields.<field>.options` uses — cannot address them unambiguously. Author the '
  + "option labels on the node's `config`.";

const translationDataShape = () => ({
  /** Object translations */
  objects: z.record(z.string(), ObjectTranslationDataSchema).optional().describe('Object translations keyed by object name'),

  /** App/Menu translations */
  apps: z.record(z.string(), strictObject({
    surface: 'this app translation',
    history: TRANSLATION_HISTORY,
    aliases: { name: 'label', title: 'label', nav: 'navigation', menu: 'navigation', menus: 'navigation' },
  }, {
    label: z.string().describe('Translated app label'),
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
   *   globalActions.<action_name>.confirmText
   *   globalActions.<action_name>.successMessage
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
   *   dashboards.<name>.widgets.<widgetId>.subCaption
   */
  dashboards: z.record(z.string(), strictObject({
    surface: 'this dashboard translation',
    history: TRANSLATION_HISTORY,
    aliases: { name: 'label', title: 'label', components: 'widgets', charts: 'widgets', cards: 'widgets' },
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
      //
      // `subtitle` points at `subCaption`, not `description`: on a metric
      // widget the string an author calls the "subtitle" is the sub-caption
      // under the number (`widget.options.description`), a DIFFERENT authored
      // field from `widget.description` (the copy under the card header). The
      // #5428 ruling (2026-08-06, item 4) gives each authored field its own
      // key — 「两个作者字段两个 key」 — so steering `subtitle` authors at
      // `description` would steer them at exactly the shared key the ruling
      // forbids (#7862).
      aliases: { label: 'title', name: 'title', heading: 'title', subtitle: 'subCaption' },
    }, {
      title: z.string().optional().describe('Translated widget title'),
      description: z.string().optional().describe('Translated widget description'),
      /**
       * Overlays the metric widget's sub-caption — the authored
       * `widget.options.description`, NOT `widget.description`. Two authored
       * fields, two keys (#5428 item 4, #7862): `description` above translates
       * `widget.description`; this key translates `options.description`.
       * Resolved by `translateDashboard` (i18n-resolver.ts); objectui's
       * client-side renderer half consumes the same
       * `dashboards.<name>.widgets.<widgetId>.subCaption` path.
       */
      subCaption: z.string().optional().describe("Translated metric sub-caption (overlays the widget's `options.description`, a different authored field from `description`)"),
    })).optional().describe('Widget translations keyed by widget id'),
  })).optional().describe('Dashboard translations keyed by dashboard name'),

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
   *
   * `title` falls back to `label` when omitted, since a page's header title
   * and its nav/breadcrumb label are usually the same string — translators
   * only author `title` separately when the two genuinely differ.
   *
   * Header copy lives at the TOP level here rather than under `components`
   * because `page:header` instances carry no stable `id`; the page name is the
   * only addressable identifier for them. Every other component does have one,
   * which is what `components` addresses — see its own note.
   */
  pages: z.record(z.string(), strictObject({
    surface: 'this page translation',
    history: TRANSLATION_HISTORY,
    aliases: { name: 'label', heading: 'title', header: 'title', subheading: 'subtitle', tagline: 'subtitle' },
  }, {
    label: z.string().optional().describe('Translated page label (nav / breadcrumb)'),
    description: z.string().optional().describe('Translated page description'),
    title: z.string().optional().describe('Translated `page:header` title (defaults to `label`)'),
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
     * | `title` | `page:card`, `record:related_list` (and `page:header`, see below) |
     * | `label` | `page:tabs`, `page:accordion`, `record:details`, `record:related_list`, `record:path`, `element:button`, `element:record_picker`, `element:text_input` |
     * | `description` | `element:text_input` |
     * | `placeholder` | `element:record_picker`, `element:text_input` |
     * | `emptyText` | `element:record_picker` |
     * | `submitLabel` | `element:form` |
     *
     * Two deliberate exclusions, both of which a mirror of the issue's proposed
     * shape would have got wrong:
     *
     * - **`help` is not here** — no component in the model declares it. It
     *   would parse clean and translate nothing, which is the ADR-0078 shape
     *   this file keeps paying to remove. (`helpText` exists on an ACTION
     *   PARAM, a different surface with its own translation face.)
     * - **`subtitle` is not here** — `page:header` is its only declarer, and
     *   that component is addressed by page name above. Declaring it in both
     *   places would give one string two spellings, which is how the
     *   dashboards/pages asymmetry started.
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
      aliases: { name: 'title', heading: 'title', text: 'label', caption: 'description', help: 'description', helpText: 'description', empty: 'emptyText', emptyState: 'emptyText', submit: 'submitLabel' },
    }, {
      title: z.string().optional().describe('Translated component title (`page:card`, `record:related_list`, …)'),
      description: z.string().optional().describe('Translated component description / supporting copy'),
      label: z.string().optional().describe("Translated component label — overlays the component's own `label` when it declares one, else `properties.label`"),
      placeholder: z.string().optional().describe('Translated input placeholder (`element:record_picker`, `element:text_input`)'),
      emptyText: z.string().optional().describe('Translated empty-state text (`element:record_picker`)'),
      submitLabel: z.string().optional().describe('Translated submit button label (`element:form`)'),
    })).optional().describe('Per-component copy keyed by component id (`PageComponentSchema.id`)'),
  })).optional().describe('Page translations keyed by page name'),

  /**
   * Screen-flow translations keyed by flow name (`Flow.name`).
   *
   * Convention:
   *   flows.<flow_name>.label
   *   flows.<flow_name>.screens.<node_id>.title
   *   flows.<flow_name>.screens.<node_id>.fields.<field_name>.label
   *   flows.<flow_name>.screens.<node_id>.fields.<field_name>.placeholder
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
   * report.** Two of the three per-field keys the issue proposed are real
   * (`label`, `placeholder`); `help` is not:
   *
   * - **`help` is not here** — `ScreenFieldConfigSchema` declares
   *   `name`/`label`/`type`/`required`/`options`/`defaultValue`/`placeholder`/`visibleWhen`
   *   and nothing help-shaped at all. Declaring it would parse clean and
   *   translate nothing, the ADR-0078 shape #6080 removed from the page
   *   component face for exactly this reason. It is `guidance` instead, so an
   *   author who reaches for it is told the field has no such copy rather than
   *   sent to a neighbouring key that means something else.
   *
   * ⛔ **Runner chrome is NOT here** — the Cancel/Submit buttons the wizard
   * draws around the author's screen belong to the console's own message
   * catalog. They are the console's words in every app, so putting them in a
   * per-app bundle would ask every app to re-translate the platform (maintainer
   * ruling on #7646).
   *
   * ⚠️ The runner half is a separate, downstream change: this declares the
   * vocabulary and closes it, and no shipped runner reads it yet — see the
   * `flows` row in `liveness/translation.json`, which is `planned` and carries
   * that warning for authors.
   */
  flows: z.record(z.string(), strictObject({
    surface: 'this flow translation',
    history: TRANSLATION_HISTORY,
    aliases: { name: 'label', title: 'label', nodes: 'screens', steps: 'screens', screen: 'screens', pages: 'screens' },
    guidance: {
      successMessage:
        '`flow.successMessage` / `flow.errorMessage` are not part of the flows translation surface — '
        + 'it carries the flow label, per-screen headings and per-screen field copy (#7646). The terminal '
        + 'toast renders the string authored on the flow.',
      errorMessage:
        '`flow.errorMessage` / `flow.successMessage` are not part of the flows translation surface — '
        + 'it carries the flow label, per-screen headings and per-screen field copy (#7646). The terminal '
        + 'toast renders the string authored on the flow.',
    },
  }, {
    label: z.string().optional().describe('Translated flow label'),
    screens: z.record(z.string(), strictObject({
      surface: 'this flow screen translation',
      history: TRANSLATION_HISTORY,
      // A screen's headline is `title`; the FLOW's is `label`. Same document
      // one level apart with opposite spellings — the trap
      // `dashboards.widgets` and `pages.components` both name, so it gets the
      // same alias table.
      aliases: { label: 'title', name: 'title', heading: 'title', header: 'title', inputs: 'fields', items: 'fields' },
      guidance: {
        description:
          "`description` — a screen's body text (`config.description`) — is not part of the flows "
          + 'translation surface, which carries the heading (`title`) and per-field copy (#7646).',
      },
    }, {
      // Overlays the screen node's `config.title`. A screen that declares no
      // `title` shows its node `label` instead (`ScreenConfigSchema.title`,
      // "falls back to the node label"), so this one key covers whichever of
      // the two the runner ends up drawing — the same one-string-one-spelling
      // rule `pages.<name>.title` follows over `label`.
      title: z.string().optional().describe('Translated screen heading (overlays `config.title`, or the node label when the screen declares none)'),
      fields: z.record(z.string(), strictObject({
        surface: 'this flow screen field translation',
        history: TRANSLATION_HISTORY,
        aliases: { name: 'label', title: 'label', text: 'label' },
        guidance: {
          help: FLOW_SCREEN_FIELD_NO_HELP,
          helpText: FLOW_SCREEN_FIELD_NO_HELP,
          hint: FLOW_SCREEN_FIELD_NO_HELP,
          tooltip: FLOW_SCREEN_FIELD_NO_HELP,
          description: FLOW_SCREEN_FIELD_NO_HELP,
          options: FLOW_SCREEN_FIELD_NO_OPTIONS,
          choices: FLOW_SCREEN_FIELD_NO_OPTIONS,
          values: FLOW_SCREEN_FIELD_NO_OPTIONS,
        },
      }, {
        label: z.string().optional().describe('Translated screen field label'),
        placeholder: z.string().optional().describe('Translated screen field placeholder'),
      })).optional().describe('Screen field translations keyed by field name (`ScreenFieldConfig.name`)'),
    })).optional().describe('Screen translations keyed by screen node id (`FlowNode.id`, the client\'s `ScreenSpec.nodeId`)'),
  })).optional().describe('Screen-flow translations keyed by flow name'),

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
   */
  settings: z.record(z.string(), strictObject({
    surface: 'this settings manifest translation',
    history: TRANSLATION_HISTORY,
    aliases: { label: 'title', name: 'title', sections: 'groups', fields: 'keys', settings: 'keys' },
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
  })).optional().describe('Settings manifest translations keyed by namespace'),

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
   * e.g. `"name"`, `"capabilities.trackHistory"`,
   * `"fields.items.label"` (a repeater "fields" → row → "label" sub-field).
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

export const TranslationDataSchema = lazySchema(() => strictObject({
  surface: 'this locale of the translation bundle',
  history: TRANSLATION_HISTORY,
  guidance: TRANSLATION_KEY_GUIDANCE,
  aliases: { object: 'objects', fields: 'objects', app: 'apps', page: 'pages', dashboard: 'dashboards', flow: 'flows', setting: 'settings', message: 'messages', strings: 'messages', labels: 'messages', actions: 'globalActions' },
  // `locale` lives on the ITEM, not on a bundle entry (the bundle keys ARE the
  // locales). Naming it keeps the suggestion useful for an author who moved a
  // `translation` item into a bundle and left the field behind.
  extraKeys: ['locale'],
}, translationDataShape()).describe('Translation data for objects, apps, and UI messages'));

export type TranslationData = z.input<typeof TranslationDataSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Translation Bundle (all locales)
// ────────────────────────────────────────────────────────────────────────────

export const TranslationBundleSchema = lazySchema(() => z.record(LocaleSchema, TranslationDataSchema).describe('Map of locale codes to translation data'));

export type TranslationBundle = z.input<typeof TranslationBundleSchema>;

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
    'Until #4001 closed this shape an unknown key was dropped silently — the stack still '
    + 'built, with the setting the author wrote never reaching any runtime.',
  aliases: { locale: 'defaultLocale', defaultLanguage: 'defaultLocale', locales: 'supportedLocales', languages: 'supportedLocales', fallback: 'fallbackLocale', fallbackLanguage: 'fallbackLocale' },
  // #3494 removed these four. They were the exemplar the liveness audit
  // (#1878/#1893) was built to find — declared, authored, and read by nothing —
  // and removing them made a config that was *already* a no-op into a config
  // that was a silent no-op for a second reason. A tombstone is the only thing
  // that tells an author upgrading from <17 why their setting vanished.
  guidance: {
    fileOrganization: '`fileOrganization` was removed in #3494 — no runtime ever read it; how you split bundle files is a convention of your source tree, and the loader reads whatever `translations` you hand `defineStack`',
    messageFormat: '`messageFormat` was removed in #3494 — there is no ICU engine; interpolation is always simple `{variable}` substitution',
    lazyLoad: '`lazyLoad` was removed in #3494 — no runtime ever read it, so setting it changed nothing',
    cache: '`cache` was removed in #3494 — no runtime ever read it, so setting it changed nothing',
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
 *   messages: { 'common.save': '保存' },
 * });
 * ```
 */
export const TranslationItemSchema = lazySchema(() => strictObject({
  surface: 'this translation',
  history: TRANSLATION_HISTORY,
  guidance: TRANSLATION_KEY_GUIDANCE,
  aliases: { object: 'objects', app: 'apps', page: 'pages', flow: 'flows', setting: 'settings', message: 'messages', strings: 'messages', labels: 'messages', actions: 'globalActions', lang: 'locale', language: 'locale' },
}, {
  ...translationDataShape(),
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
  // Not snake_case-constrained the way `job.name` is: translation items are
  // conventionally named after their locale (`zh-CN`), and the runtime sync
  // reads `row.name` as a locale fallback for exactly that reason. Optional
  // because `locale`, not `name`, is this type's required identity — that call
  // was deliberate (a skipped item is invisible) and is not being reopened.
  name: z.string().optional().describe('Item name — conventionally the locale code (`zh-CN`); the runtime sync falls back to it when `locale` is absent'),
  label: z.string().optional().describe('Human-readable label shown in metadata lists'),

  // ADR-0010 — runtime protection envelope (internal — set by the loader).
  // `translation` is a registered metadata type, so `MetadataPlugin`'s artifact
  // loader stamps `_packageId` / `_provenance` on it. Undeclared, they were
  // dropped on every parse — and `authored-translation-sync` has to strip them
  // by hand on the read side precisely because the schema could not hold them.
  ...MetadataProtectionFields,
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
