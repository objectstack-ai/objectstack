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
  /** Translated singular label for the object */
  label: z.string().describe('Translated singular label'),
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
   */
  _views: z.record(z.string(), z.object({
    label: z.string().optional().describe('Translated view label'),
    description: z.string().optional().describe('Translated view description'),
  })).optional().describe('View translations keyed by view name'),

  /**
   * Action translations keyed by action name (snake_case).
   * Convention (auto-resolved by `resolveActionLabel`/`resolveActionConfirm`/`resolveActionSuccess`):
   *   objects.<object>._actions.<action_name>.label
   *   objects.<object>._actions.<action_name>.confirmText
   *   objects.<object>._actions.<action_name>.successMessage
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

// ────────────────────────────────────────────────────────────────────────────
// File Organization Convention
// ────────────────────────────────────────────────────────────────────────────

/**
 * Translation File Organization Strategy
 *
 * Defines how translation files are organized on disk.
 *
 * - `bundled` — All locales in a single `TranslationBundle` file.
 *   Best for small projects with few objects.
 *   ```
 *   src/translations/
 *     crm.translation.ts        # { en: {...}, "zh-CN": {...} }
 *   ```
 *
 * - `per_locale` — One file per locale containing all namespaces.
 *   Recommended when a single locale file stays under ~500 lines.
 *   ```
 *   src/translations/
 *     en.ts                     # TranslationData for English
 *     zh-CN.ts                  # TranslationData for Chinese
 *   ```
 *
 * - `per_namespace` — One file per namespace (object) per locale.
 *   Recommended for large projects with many objects/languages.
 *   Aligns with Salesforce DX and ServiceNow conventions.
 *   ```
 *   i18n/
 *     en/
 *       account.json            # ObjectTranslationData
 *       contact.json
 *       common.json             # messages + app labels
 *     zh-CN/
 *       account.json
 *       contact.json
 *       common.json
 *   ```
 */
export const TranslationFileOrganizationSchema = lazySchema(() => z.enum([
  'bundled',
  'per_locale',
  'per_namespace',
]).describe('Translation file organization strategy'));

export type TranslationFileOrganization = z.infer<typeof TranslationFileOrganizationSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Translation Configuration
// ────────────────────────────────────────────────────────────────────────────

/**
 * Translation Configuration Schema
 *
 * Defines internationalization settings for the stack.
 *
 * @example
 * ```typescript
 * export default defineStack({
 *   i18n: {
 *     defaultLocale: 'en',
 *     supportedLocales: ['en', 'zh-CN', 'ja-JP'],
 *     fallbackLocale: 'en',
 *     fileOrganization: 'per_locale',
 *   },
 *   translations: [...],
 * });
 * ```
 */
/**
 * Message format standard used for interpolation, pluralization, and
 * gender-aware translations.
 *
 * - `icu` — ICU MessageFormat (recommended for complex plurals, gender, select).
 *   Strings may contain `{count, plural, one {# item} other {# items}}` patterns.
 * - `simple` — Simple `{variable}` interpolation only (default).
 */
export const MessageFormatSchema = lazySchema(() => z.enum([
  'icu',
  'simple',
]).describe('Message interpolation format: ICU MessageFormat or simple {variable} replacement'));

export type MessageFormat = z.infer<typeof MessageFormatSchema>;

export const TranslationConfigSchema = lazySchema(() => z.object({
  /** Default locale for the application */
  defaultLocale: LocaleSchema.describe('Default locale (e.g., "en")'),
  /** Supported BCP-47 locale codes */
  supportedLocales: z.array(LocaleSchema).describe('Supported BCP-47 locale codes'),
  /** Fallback locale when translation is not found */
  fallbackLocale: LocaleSchema.optional().describe('Fallback locale code'),
  /** How translation files are organized on disk */
  fileOrganization: TranslationFileOrganizationSchema.default('per_locale')
    .describe('File organization strategy'),
  /**
   * Message interpolation format.
   * When set to `'icu'`, messages and validationMessages are expected to use
   * ICU MessageFormat syntax (plurals, select, number/date skeletons).
   * @default 'simple'
   */
  messageFormat: MessageFormatSchema.default('simple')
    .describe('Message interpolation format (ICU MessageFormat or simple)'),
  /** Load translations on demand instead of eagerly */
  lazyLoad: z.boolean().default(false).describe('Load translations on demand'),
  /** Cache loaded translations in memory */
  cache: z.boolean().default(true).describe('Cache loaded translations'),
}).describe('Internationalization configuration'));

export type TranslationConfig = z.infer<typeof TranslationConfigSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Object-First Translation Node (object-first aggregated structure)
// ────────────────────────────────────────────────────────────────────────────

/** Translatable option map: option value → translated label */
const OptionTranslationMapSchema = z.record(z.string(), z.string())
  .describe('Option value to translated label map');

/**
 * ObjectTranslationNodeSchema
 *
 * Object-first aggregated translation node that groups **all** translatable
 * content for a single object under one key. Aligns with Salesforce / Dynamics
 * conventions where translations are organized per-object rather than per-category.
 *
 * Located at `o.{object_name}` inside an {@link AppTranslationBundle}.
 *
 * @example
 * ```typescript
 * const accountNode: ObjectTranslationNode = {
 *   label: '客户',
 *   pluralLabel: '客户',
 *   description: '客户管理对象',
 *   fields: {
 *     name: { label: '客户名称', help: '公司或组织的法定名称' },
 *     industry: { label: '行业', options: { tech: '科技', finance: '金融' } },
 *   },
 *   _options: { status: { active: '活跃', inactive: '停用' } },
 *   _views: { all_accounts: { label: '全部客户' } },
 *   _sections: { basic_info: { label: '基本信息' } },
 *   _actions: {
 *     convert_lead: { label: '转换线索', confirmMessage: '确认转换？' },
 *   },
 * };
 * ```
 */
export const ObjectTranslationNodeSchema = lazySchema(() => z.object({
  /** Translated singular label */
  label: z.string().describe('Translated singular label'),
  /** Translated plural label */
  pluralLabel: z.string().optional().describe('Translated plural label'),
  /** Translated object description */
  description: z.string().optional().describe('Translated object description'),
  /** Translated help text shown in tooltips or guidance panels */
  helpText: z.string().optional().describe('Translated help text for the object'),

  /** Field-level translations keyed by field name (snake_case) */
  fields: z.record(z.string(), FieldTranslationSchema).optional()
    .describe('Field translations keyed by field name'),

  /**
   * Global picklist / select option overrides scoped to this object.
   * Keyed by field name → { optionValue: translatedLabel }.
   */
  _options: z.record(z.string(), OptionTranslationMapSchema).optional()
    .describe('Object-scoped picklist option translations keyed by field name'),

  /** View translations keyed by view name */
  _views: z.record(z.string(), z.object({
    label: z.string().optional().describe('Translated view label'),
    description: z.string().optional().describe('Translated view description'),
  })).optional().describe('View translations keyed by view name'),

  /** Section (form section / tab) translations keyed by section name */
  _sections: z.record(z.string(), z.object({
    label: z.string().optional().describe('Translated section label'),
  })).optional().describe('Section translations keyed by section name'),

  /** Action translations keyed by action name */
  _actions: z.record(z.string(), z.object({
    label: z.string().optional().describe('Translated action label'),
    confirmMessage: z.string().optional().describe('Translated confirmation message'),
    params: z.record(z.string(), z.object({
      label: z.string().optional().describe('Translated action parameter label'),
      helpText: z.string().optional().describe('Translated action parameter help/hint text'),
      placeholder: z.string().optional().describe('Translated action parameter placeholder'),
      options: z.record(z.string(), z.string()).optional().describe('Param select option value to translated label'),
    })).optional().describe('Action parameter translations keyed by parameter name'),
  })).optional().describe('Action translations keyed by action name'),

  /** Notification message translations keyed by notification name */
  _notifications: z.record(z.string(), z.object({
    title: z.string().optional().describe('Translated notification title'),
    body: z.string().optional().describe('Translated notification body (supports ICU MessageFormat when enabled)'),
  })).optional().describe('Notification translations keyed by notification name'),

  /** Error message translations keyed by error code */
  _errors: z.record(z.string(), z.string()).optional()
    .describe('Error message translations keyed by error code'),
}).describe('Object-first aggregated translation node'));

export type ObjectTranslationNode = z.infer<typeof ObjectTranslationNodeSchema>;

// ────────────────────────────────────────────────────────────────────────────
// App Translation Bundle (object-first, full application)
// ────────────────────────────────────────────────────────────────────────────

/**
 * AppTranslationBundleSchema
 *
 * Complete application translation bundle for a **single locale** using
 * the **object-first** convention. All per-object translatable content
 * is aggregated under `o.{object_name}`, while global (non-object-bound)
 * translations are kept in dedicated top-level groups.
 *
 * This schema is designed for:
 * - Translation workbench UIs (object-level editing & coverage)
 * - CLI skeleton generation (`objectstack i18n extract`)
 * - Automated diff/coverage detection
 *
 * @example
 * ```typescript
 * const zh: AppTranslationBundle = {
 *   o: {
 *     account: {
 *       label: '客户',
 *       fields: { name: { label: '客户名称' } },
 *       _options: { industry: { tech: '科技' } },
 *       _views: { all_accounts: { label: '全部客户' } },
 *       _sections: { basic_info: { label: '基本信息' } },
 *       _actions: { convert: { label: '转换' } },
 *     },
 *   },
 *   _globalOptions: { currency: { usd: '美元', eur: '欧元' } },
 *   app: { crm: { label: '客户关系管理', description: '管理销售流程' } },
 *   nav: { home: '首页', settings: '设置' },
 *   dashboard: { sales_overview: { label: '销售概览' } },
 *   reports: { pipeline_report: { label: '管道报表' } },
 *   pages: { landing: { title: '欢迎' } },
 *   messages: { 'common.save': '保存' },
 *   validationMessages: { 'discount_limit': '折扣不能超过40%' },
 * };
 * ```
 */
export const AppTranslationBundleSchema = lazySchema(() => z.object({
  /**
   * Bundle-level metadata.
   * Provides locale-aware rendering hints such as text direction (bidi)
   * and the canonical locale code this bundle represents.
   */
  _meta: z.object({
    /** BCP-47 locale code this bundle represents */
    locale: z.string().optional().describe('BCP-47 locale code for this bundle'),
    /** Text direction for the locale */
    direction: z.enum(['ltr', 'rtl']).optional().describe('Text direction: left-to-right or right-to-left'),
  }).optional().describe('Bundle-level metadata (locale, bidi direction)'),

  /**
   * Namespace for plugin/extension isolation.
   * When multiple plugins contribute translations, each should use a unique
   * namespace to avoid key collisions (e.g. "crm", "helpdesk", "plugin-xyz").
   */
  namespace: z.string().optional()
    .describe('Namespace for plugin isolation to avoid translation key collisions'),

  /** Object-first translations keyed by object name (snake_case) */
  o: z.record(z.string(), ObjectTranslationNodeSchema).optional()
    .describe('Object-first translations keyed by object name'),

  /** Global picklist options not bound to any specific object */
  _globalOptions: z.record(z.string(), OptionTranslationMapSchema).optional()
    .describe('Global picklist option translations keyed by option set name'),

  /** App-level translations */
  app: z.record(z.string(), z.object({
    label: z.string().describe('Translated app label'),
    description: z.string().optional().describe('Translated app description'),
  })).optional().describe('App translations keyed by app name'),

  /** Navigation menu translations */
  nav: z.record(z.string(), z.string()).optional()
    .describe('Navigation item translations keyed by nav item name'),

  /** Dashboard translations keyed by dashboard name */
  dashboard: z.record(z.string(), z.object({
    label: z.string().optional().describe('Translated dashboard label'),
    description: z.string().optional().describe('Translated dashboard description'),
  })).optional().describe('Dashboard translations keyed by dashboard name'),

  /** Report translations keyed by report name */
  reports: z.record(z.string(), z.object({
    label: z.string().optional().describe('Translated report label'),
    description: z.string().optional().describe('Translated report description'),
  })).optional().describe('Report translations keyed by report name'),

  /** Page translations keyed by page name */
  pages: z.record(z.string(), z.object({
    title: z.string().optional().describe('Translated page title'),
    description: z.string().optional().describe('Translated page description'),
  })).optional().describe('Page translations keyed by page name'),

  /** UI message translations (supports ICU MessageFormat when enabled) */
  messages: z.record(z.string(), z.string()).optional()
    .describe('UI message translations keyed by message ID (supports ICU MessageFormat)'),

  /** Validation error message translations (supports ICU MessageFormat when enabled) */
  validationMessages: z.record(z.string(), z.string()).optional()
    .describe('Validation error message translations keyed by rule name (supports ICU MessageFormat)'),

  /** Global notification translations not bound to a specific object */
  notifications: z.record(z.string(), z.object({
    title: z.string().optional().describe('Translated notification title'),
    body: z.string().optional().describe('Translated notification body (supports ICU MessageFormat when enabled)'),
  })).optional().describe('Global notification translations keyed by notification name'),

  /** Global error message translations not bound to a specific object */
  errors: z.record(z.string(), z.string()).optional()
    .describe('Global error message translations keyed by error code'),
}).describe('Object-first application translation bundle for a single locale'));

export type AppTranslationBundle = z.infer<typeof AppTranslationBundleSchema>;

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
 *   key: 'o.account.fields.website.label',
 *   status: 'missing',
 *   objectName: 'account',
 *   locale: 'zh-CN',
 * };
 * ```
 */
export const TranslationDiffItemSchema = lazySchema(() => z.object({
  /** Dot-path translation key (e.g. "o.account.fields.website.label") */
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
