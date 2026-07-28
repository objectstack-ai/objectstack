// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

// ────────────────────────────────────────────────────────────────────────────
// Locale
// ────────────────────────────────────────────────────────────────────────────

import { lazySchema } from '../shared/lazy-schema';
export const LocaleSchema = lazySchema(() => z.string().describe('BCP-47 Language Tag (e.g. en-US, zh-CN)'));

// ────────────────────────────────────────────────────────────────────────────
// Object-level Translation (per-object file)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Field Translation Schema
 * Translation data for a single field.
 */
export const FieldTranslationSchema = lazySchema(() => z.object({
  label: z.string().optional().describe('Translated field label'),
  help: z.string().optional().describe('Translated help text'),
  placeholder: z.string().optional().describe('Translated placeholder text for form inputs'),
  options: z.record(z.string(), z.string()).optional().describe('Option value to translated label map'),
}).describe('Translation data for a single field'));

export type FieldTranslation = z.infer<typeof FieldTranslationSchema>;

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
export const ActionResultDialogTranslationSchema = lazySchema(() => z.object({
  title: z.string().optional().describe('Translated result dialog title'),
  description: z.string().optional().describe('Translated result dialog description'),
  acknowledge: z.string().optional().describe('Translated acknowledge button label'),
  fields: z.record(z.string(), z.string()).optional()
    .describe('Result field labels keyed by the literal field path declared in the action metadata (keys may contain dots)'),
}).describe('Translations for an action result dialog'));

export type ActionResultDialogTranslation = z.infer<typeof ActionResultDialogTranslationSchema>;

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
export const ObjectTranslationDataSchema = lazySchema(() => z.object({
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
  _views: z.record(z.string(), z.object({
    label: z.string().optional().describe('Translated view label'),
    description: z.string().optional().describe('Translated view description'),
    emptyState: z.object({
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
  _actions: z.record(z.string(), z.object({
    label: z.string().optional().describe('Translated action label'),
    confirmText: z.string().optional().describe('Translated confirmation prompt'),
    successMessage: z.string().optional().describe('Translated success toast/message'),
    params: z.record(z.string(), z.object({
      label: z.string().optional().describe('Translated action parameter label'),
      helpText: z.string().optional().describe('Translated action parameter help/hint text'),
      placeholder: z.string().optional().describe('Translated action parameter placeholder'),
      options: z.record(z.string(), z.string()).optional().describe('Param select option value to translated label'),
    })).optional().describe('Action parameter translations keyed by parameter name'),
    resultDialog: ActionResultDialogTranslationSchema.optional()
      .describe('Translations for the action result dialog'),
  })).optional().describe('Action translations keyed by action name'),

  /**
   * Section translations keyed by section name (snake_case).
   * Convention:
   *   objects.<object>._sections.<section_name>.label
   * Used by `record:details` to translate per-section labels on detail pages
   * (e.g. "Opportunity Information" → "商机信息"). Each section in the
   * page schema must declare a stable `name` for the lookup to fire.
   */
  _sections: z.record(z.string(), z.object({
    label: z.string().optional().describe('Translated section label'),
    description: z.string().optional().describe('Translated section description'),
  })).optional().describe('Section translations keyed by section name'),
}).describe('Translation data for a single object'));

export type ObjectTranslationData = z.infer<typeof ObjectTranslationDataSchema>;

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
export const TranslationDataSchema = lazySchema(() => z.object({
  /** Object translations */
  objects: z.record(z.string(), ObjectTranslationDataSchema).optional().describe('Object translations keyed by object name'),
  
  /** App/Menu translations */
  apps: z.record(z.string(), z.object({
    label: z.string().describe('Translated app label'),
    description: z.string().optional().describe('Translated app description'),
    navigation: z.record(z.string(), z.object({
      label: z.string().describe('Translated navigation group label'),
    })).optional().describe('Navigation group translations keyed by group ID'),
  })).optional().describe('App translations keyed by app name'),

  /** UI Messages */
  messages: z.record(z.string(), z.string()).optional().describe('UI message translations keyed by message ID'),
  
  /** Validation Error Messages */
  validationMessages: z.record(z.string(), z.string()).optional().describe('Translatable validation error messages keyed by rule name (e.g., {"discount_limit": "折扣不能超过40%"})'),

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
  globalActions: z.record(z.string(), z.object({
    label: z.string().optional().describe('Translated action label'),
    confirmText: z.string().optional().describe('Translated confirmation prompt'),
    successMessage: z.string().optional().describe('Translated success toast/message'),
    params: z.record(z.string(), z.object({
      label: z.string().optional().describe('Translated action parameter label'),
      helpText: z.string().optional().describe('Translated action parameter help/hint text'),
      placeholder: z.string().optional().describe('Translated action parameter placeholder'),
      options: z.record(z.string(), z.string()).optional().describe('Param select option value to translated label'),
    })).optional().describe('Action parameter translations keyed by parameter name'),
    resultDialog: ActionResultDialogTranslationSchema.optional()
      .describe('Translations for the action result dialog'),
  })).optional().describe('Global action translations keyed by action name'),

  /**
   * Dashboard translations keyed by dashboard name.
   * Convention (auto-resolved by ObjectUI's `useObjectLabel`):
   *   dashboards.<name>.label
   *   dashboards.<name>.description
   *   dashboards.<name>.actions.<actionUrl>.label
   *   dashboards.<name>.widgets.<widgetId>.title
   *   dashboards.<name>.widgets.<widgetId>.description
   */
  dashboards: z.record(z.string(), z.object({
    label: z.string().optional().describe('Translated dashboard title'),
    description: z.string().optional().describe('Translated dashboard description'),
    actions: z.record(z.string(), z.object({
      label: z.string().optional().describe('Translated header action label'),
    })).optional().describe('Header action label translations keyed by action url/key'),
    widgets: z.record(z.string(), z.object({
      title: z.string().optional().describe('Translated widget title'),
      description: z.string().optional().describe('Translated widget description'),
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
   * `title` falls back to `label` when omitted, since a page's header title
   * and its nav/breadcrumb label are usually the same string — translators
   * only author `title` separately when the two genuinely differ.
   *
   * Header copy lives here rather than under a per-component key because
   * `page:header` instances carry no stable `id`; the page name is the only
   * addressable identifier on the metadata document.
   */
  pages: z.record(z.string(), z.object({
    label: z.string().optional().describe('Translated page label (nav / breadcrumb)'),
    description: z.string().optional().describe('Translated page description'),
    title: z.string().optional().describe('Translated `page:header` title (defaults to `label`)'),
    subtitle: z.string().optional().describe('Translated `page:header` subtitle'),
  })).optional().describe('Page translations keyed by page name'),

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
  settings: z.record(z.string(), z.object({
    title: z.string().optional().describe('Translated settings manifest title'),
    description: z.string().optional().describe('Translated settings manifest description'),
    groups: z.record(z.string(), z.object({
      title: z.string().optional().describe('Translated group title'),
      description: z.string().optional().describe('Translated group description'),
    })).optional().describe('Group translations keyed by group key'),
    keys: z.record(z.string(), z.object({
      label: z.string().optional().describe('Translated setting label'),
      help: z.string().optional().describe('Translated setting help text'),
      placeholder: z.string().optional().describe('Translated input placeholder'),
      options: z.record(z.string(), z.string()).optional()
        .describe('Enum option value → translated label'),
    })).optional().describe('Per-setting field translations keyed by setting key'),
    actions: z.record(z.string(), z.object({
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
  metadataForms: z.record(z.string(), z.object({
    label: z.string().optional().describe('Translated metadata-type display label (overrides registry label)'),
    description: z.string().optional().describe('Translated metadata-type description'),
    sections: z.record(z.string(), z.object({
      label: z.string().optional().describe('Translated section label'),
      description: z.string().optional().describe('Translated section description'),
    })).optional().describe('Section translations keyed by section.name'),
    fields: z.record(z.string(), z.object({
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
  settingsCommon: z.object({
    sourceLabels: z.object({
      env: z.string().optional(),
      global: z.string().optional(),
      tenant: z.string().optional(),
      user: z.string().optional(),
      default: z.string().optional(),
    }).optional().describe('Source badge labels by resolution layer'),
  }).optional().describe('Cross-namespace Settings UI strings'),
}).describe('Translation data for objects, apps, and UI messages'));

export type TranslationData = z.infer<typeof TranslationDataSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Translation Bundle (all locales)
// ────────────────────────────────────────────────────────────────────────────

export const TranslationBundleSchema = lazySchema(() => z.record(LocaleSchema, TranslationDataSchema).describe('Map of locale codes to translation data'));

export type TranslationBundle = z.infer<typeof TranslationBundleSchema>;
/** Authoring input for {@link TranslationBundle} — defaulted fields are optional. */
export type TranslationBundleInput = z.input<typeof TranslationBundleSchema>;

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
export const TranslationConfigSchema = lazySchema(() => z.object({
  /** Default locale for the application */
  defaultLocale: LocaleSchema.describe('Default locale (e.g., "en")'),
  /** Supported BCP-47 locale codes */
  supportedLocales: z.array(LocaleSchema).describe('Supported BCP-47 locale codes'),
  /** Fallback locale when translation is not found */
  fallbackLocale: LocaleSchema.optional().describe('Fallback locale code'),
}).describe('Internationalization configuration'));

export type TranslationConfig = z.infer<typeof TranslationConfigSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Translation Item (the runtime-authored `translation` metadata type)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Top-level keys of the retired object-first (`o.<object>`) dialect.
 *
 * {@link TranslationItemSchema} checks for them *before* parsing, because Zod
 * strips undeclared keys silently: an item authored in the old shape would
 * otherwise save cleanly and then resolve to nothing — exactly the failure
 * this type is being fixed for (#3778). Guarding ahead of the parse turns
 * that silence into a 422 naming the correct group, while keeping the retired
 * keys out of the schema itself, so neither the generated JSON Schema nor the
 * Studio editor advertises a shape that cannot work.
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

/** Where each retired key's content belongs now (or that it has no home). */
const LEGACY_KEY_MIGRATION: Record<LegacyObjectFirstKey, string> = {
  o: "use 'objects.<object_name>'",
  app: "use 'apps.<app_name>'",
  nav: "use 'apps.<app_name>.navigation.<node_id>.label'",
  dashboard: "use 'dashboards.<dashboard_name>'",
  reports: 'reports have no translation group — omit them',
  notifications: 'notifications have no translation group — omit them',
  errors: "use 'validationMessages' for rule messages; other errors have no translation group",
  _globalOptions: "use 'objects.<object_name>.fields.<field_name>.options'",
  _meta: "use the top-level 'locale' field",
  namespace: 'namespaces are not part of the translation contract — omit it',
};

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
 * than stripped — see {@link LEGACY_OBJECT_FIRST_KEYS}.
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
/**
 * The item's own shape, without the retired-key guard. Private: it exists so
 * the guard can wrap it (and so the factory below can type its argument) —
 * {@link TranslationItemSchema} is the schema every caller should use.
 */
const TranslationItemDataSchema = lazySchema(() => TranslationDataSchema.extend({
  locale: LocaleSchema.describe('BCP-47 locale this item translates (e.g. "zh-CN")'),
}).describe('One locale of translations — the `translation` metadata type'));

export const TranslationItemSchema = lazySchema(() => z.preprocess((raw, ctx) => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const key of LEGACY_OBJECT_FIRST_KEYS) {
      if ((raw as Record<string, unknown>)[key] === undefined) continue;
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message:
          `'${key}' belongs to the retired object-first translation shape, which no resolver `
          + `reads — ${LEGACY_KEY_MIGRATION[key]}.`,
      });
    }
  }
  return raw;
}, TranslationItemDataSchema));

/** A single `translation` metadata item. */
export type TranslationItem = z.infer<typeof TranslationItemDataSchema>;

/**
 * Type-safe factory for a single-locale `translation` item. Validates at
 * authoring time via `.parse()` — preferred over a bare `: TranslationItem`
 * literal, which cannot catch a retired key.
 */
export function defineTranslation(config: z.input<typeof TranslationItemDataSchema>): TranslationItem {
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

export type TranslationDiffStatus = z.infer<typeof TranslationDiffStatusSchema>;

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

export type TranslationDiffItem = z.infer<typeof TranslationDiffItemSchema>;

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

export type CoverageBreakdownEntry = z.infer<typeof CoverageBreakdownEntrySchema>;

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

export type TranslationCoverageResult = z.infer<typeof TranslationCoverageResultSchema>;
