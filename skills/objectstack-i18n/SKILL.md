---
name: objectstack-i18n
description: >
  Author ObjectStack translation bundles — object/field labels, view text,
  app navigation strings, automation messages — and configure locale
  fallback, coverage reporting, and the per-locale source layout. Use when
  the user is adding `*.translation.ts` files, wiring a new locale, or
  resolving missing-translation warnings. Do not use for general i18n
  library questions unrelated to ObjectStack bundles.
license: Apache-2.0
compatibility: Requires @objectstack/spec 16.x (Zod v4 schemas)
metadata:
  author: objectstack-ai
  version: "1.2"
  domain: i18n
  tags: i18n, translation, locale, l10n, bundle, coverage
---

# Internationalization — ObjectStack I18n Protocol

Expert instructions for designing internationalization (i18n) and localization (l10n)
strategies using the ObjectStack specification. This skill covers translation bundle
structures, locale configuration, object-first translation patterns, coverage detection,
and integration with the I18nService.

---

## When to Use This Skill

- You are **configuring i18n** for a new ObjectStack project.
- You need to **create translation bundles** for multiple locales.
- You are designing **object-first translation structures** (per-object translation files).
- You need to **detect missing translations** (`os i18n check` coverage analysis).
- You are extending the service contract with **AI translation suggestions** (TMS / machine-translation integrations).
- You are implementing **locale-specific formatting** (dates, numbers, currency).
  Related: workspace regional defaults (`timezone`, `locale`, `currency`) live in the
  tenant-scoped `localization` settings, are resolved onto each request's
  `ExecutionContext`, and are exposed at `GET /api/v1/auth/me/localization`; a currency
  field falls back to `localization.currency` when it omits its own (ADR-0053).
- You need to understand **translation file organization strategies** (bundled, per_locale, per_namespace).

---

## Core Concepts

### Translation Architecture Overview

1. **Runtime format — `objects.*` (`TranslationData`)**: each locale is authored as one
   `TranslationData` value. All translatable content for an object (label, fields,
   options, views, sections, actions) is grouped under `objects.{object_name}`, with
   global groups (`apps`, `messages`, `validationMessages`, `globalActions`,
   `dashboards`, `settings`, `metadataForms`) at the top level.

2. **Bundle registration**: per-locale files are assembled with
   `defineTranslationBundle({ en, 'zh-CN': … })` into a `TranslationBundle`
   (locale code → `TranslationData`) and registered via
   `defineStack({ translations: [...] })`. This is the format the runtime resolvers,
   `os i18n extract`, `os i18n check`, and the example apps all use.

3. **Coverage detection**: `os i18n check` compares registered bundles against source
   metadata to report missing keys per locale.

4. **Secondary format — `o.*` (`AppTranslationBundle`)**: a separate object-first,
   single-locale format aimed at translation-workbench UIs, Studio-authored
   `translation` metadata, and the coverage-diff schemas. It is **not** what the stack
   `translations` array consumes — see "Secondary Format: AppTranslationBundle" below.

---

## Translation Configuration

### Stack-Level I18n Config

Configure i18n settings in your `objectstack.config.ts`:

<!-- os:check -->
```typescript
import { defineStack } from '@objectstack/spec';

export default defineStack({
  i18n: {
    defaultLocale: 'en',
    supportedLocales: ['en', 'zh-CN', 'ja-JP', 'es-ES'],
    fallbackLocale: 'en',
  },
  // translations: [MyTranslations],  ← register your bundles here (see below)
});
```

| Property | Type | Required / Default | Description |
|:---------|:-----|:-------------------|:------------|
| `defaultLocale` | `string` | **required** | Default BCP-47 locale code |
| `supportedLocales` | `string[]` | **required** | All supported locales |
| `fallbackLocale` | `string` | optional | Fallback when translation missing |

> **BCP-47 Locale Codes**: Use standard locale tags (e.g., `en-US`, `zh-CN`, `pt-BR`, `en-GB`).

---

## File Organization Strategies

### 1. Bundled (Single File)

All locales in one file. Best for small projects with few objects.

```
src/translations/
  crm.translation.ts        # { en: {...}, "zh-CN": {...} }
```

**When to use:** Fewer than 5 objects, 2-3 locales, < 200 translation keys total.

### 2. Per-Locale (Recommended)

One file per locale containing all namespaces. Recommended when a single locale file stays under ~500 lines.

```
src/translations/
  en.ts                     # TranslationData for English
  zh-CN.ts                  # TranslationData for Chinese
  ja-JP.ts                  # TranslationData for Japanese
```

**When to use:** Medium projects (5-20 objects), 3-5 locales, organized by language.

### 3. Per-Namespace (Enterprise)

One file per namespace (object) per locale. Aligns with Salesforce DX and ServiceNow conventions.

```
i18n/
  en/
    account.json            # ObjectTranslationData
    contact.json
    common.json             # messages + app labels
  zh-CN/
    account.json
    contact.json
    common.json
```

**When to use:** Large projects (20+ objects), 5+ locales, team collaboration, CI/CD pipelines.

> These are **authoring conventions**: your import graph assembles whichever layout you
> choose into the `TranslationBundle` values you register on the stack.
> `FileI18nAdapter`'s `localesDir` loads only flat top-level `{locale}.json` files
> (subdirectories are skipped) — a per-namespace tree must be assembled by your own
> imports or build step.

---

## Authoring Translation Bundles (`objects.*`)

The canonical authoring path: one `TranslationData` per locale, assembled with
`defineTranslationBundle` and registered on the stack. This mirrors the shipped
example apps (`src/translations/{en,zh-CN}.ts` + `index.ts`):

<!-- os:check -->
```typescript
// src/translations/en.ts — one TranslationData per locale
import { defineStack, defineTranslationBundle } from '@objectstack/spec';
import type { TranslationData } from '@objectstack/spec/system';

const en: TranslationData = {
  objects: {
    task: {
      label: 'Task',
      pluralLabel: 'Tasks',
      fields: {
        subject: { label: 'Subject', help: 'Brief title of the task' },
        status: {
          label: 'Status',
          options: {
            not_started: 'Not Started',
            in_progress: 'In Progress',
            completed: 'Completed',
          },
        },
        due_date: { label: 'Due Date' },
      },
      _views: {
        all_tasks: {
          label: 'All Tasks',
          emptyState: { title: 'No tasks yet', message: 'Create your first task' },
        },
      },
      _sections: {
        details: { label: 'Details' },
      },
      _actions: {
        complete: {
          label: 'Complete',
          confirmText: 'Mark this task as completed?',
          successMessage: 'Task completed',
        },
      },
    },
  },
  apps: {
    todo_app: { label: 'Todo Manager', description: 'Personal task management' },
  },
  messages: {
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'welcome.user': 'Welcome, {{userName}}!',
  },
  validationMessages: {
    completed_date_required: 'Completed date is required when status is Completed',
  },
};

// src/translations/zh-CN.ts — same shape, translated values
const zhCN: TranslationData = {
  objects: {
    task: {
      label: '任务',
      pluralLabel: '任务',
      fields: {
        subject: { label: '主题', help: '任务的简要标题' },
        status: {
          label: '状态',
          options: { not_started: '未开始', in_progress: '进行中', completed: '已完成' },
        },
        due_date: { label: '截止日期' },
      },
    },
  },
  apps: {
    todo_app: { label: '待办管理', description: '个人任务管理' },
  },
  messages: {
    'common.save': '保存',
    'common.cancel': '取消',
    'welcome.user': '欢迎，{{userName}}！',
  },
};

// src/translations/index.ts — assemble the locales into one bundle…
export const TodoTranslations = defineTranslationBundle({
  en,
  'zh-CN': zhCN,
});

// objectstack.config.ts — …and register it on the stack
export default defineStack({
  i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },
  translations: [TodoTranslations],
});
```

`defineTranslationBundle` validates the bundle at authoring time via `.parse()` —
prefer it over a bare `: TranslationBundle` literal.

---

## Object-Level Translation Structure

All translatable content for a single object is aggregated under
`objects.{object_name}` with these sub-keys:

| Sub-key | Holds |
|:--------|:------|
| `label` / `pluralLabel` / `description` | Object-level text (`label` is required) |
| `fields.{field_name}` | `label`, `help`, `placeholder`, `options` (option value → label) per field |
| `_views.{view_name}` | `label`, `description`, `emptyState.title` / `emptyState.message` |
| `_actions.{action_name}` | `label`, `confirmText`, `successMessage`, `params.{param_name}`, `resultDialog` |
| `_sections.{section_name}` | Form section / tab `label`, `description` |

Top-level groups alongside `objects`: `apps` (label, description, navigation),
`messages`, `validationMessages`, `globalActions` (object-less actions),
`dashboards`, `settings`, `metadataForms`, `settingsCommon`.

For the exact Zod shape (and any field that may have been added since), read
`node_modules/@objectstack/spec/src/system/translation.zod.ts` —
`TranslationDataSchema`, `ObjectTranslationDataSchema`, and `FieldTranslationSchema`.

---

## Naming Conventions

| Context | Convention | Example |
|:--------|:-----------|:--------|
| Locale codes | BCP-47 | `en`, `en-US`, `zh-CN`, `pt-BR` |
| Object keys in `objects.*` | `snake_case` | `objects.project_task`, `objects.support_case` |
| Field keys | `snake_case` | `fields.first_name`, `fields.due_date` |
| Option values | lowercase | `options.status.in_progress` |
| Message keys | dot-separated | `common.save`, `validation.required` |

> **Critical:** Object names and field keys in translation bundles **must** match the `snake_case` names defined in your Object and Field schemas.

---

## Secondary Format: AppTranslationBundle (`o.*`)

`AppTranslationBundle` is a **separate, object-first format for a single locale**
where per-object content lives under `o.{object_name}`. It targets translation
workbench UIs, Studio-authored `translation` metadata, and the coverage/diff
schemas. **Do not** use it in the files you register through
`defineStack({ translations: [...] })` — the runtime resolvers read `objects.*`
(`TranslationData`).

Differences from the runtime format worth knowing:

- Objects live under `o.*` (not `objects.*`); extra groups are `_meta`,
  `_globalOptions`, `app`, `nav`, `dashboard`, `reports`, `pages`,
  `notifications`, `errors`.
- `_options` is keyed by **field name** → `{ optionValue: label }` (not by picklist name).
- Actions use `confirmMessage` (the runtime format's `_actions` use `confirmText` / `successMessage`).
- `namespace` is a **declared** isolation field for multi-plugin bundles; no shipped
  code prefixes keys with it.
- `_meta.direction: 'rtl'` lets UI frameworks apply RTL CSS for locales like Arabic.

<!-- os:check -->
```typescript
import type { AppTranslationBundle } from '@objectstack/spec/system';

const zh: AppTranslationBundle = {
  _meta: { locale: 'zh-CN', direction: 'ltr' },
  o: {
    account: {
      label: '客户',
      pluralLabel: '客户',
      fields: {
        name: { label: '客户名称', help: '公司或组织的法定名称' },
        industry: { label: '行业', options: { tech: '科技', finance: '金融' } },
      },
      _options: {
        status: { active: '活跃', inactive: '停用' }, // keyed by FIELD name
      },
      _views: { all_accounts: { label: '全部客户' } },
      _sections: { basic_info: { label: '基本信息' } },
      _actions: {
        merge: { label: '合并客户', confirmMessage: '此操作无法撤销，确认合并？' },
      },
    },
  },
  _globalOptions: { currency: { usd: '美元', eur: '欧元' } },
  app: { crm: { label: '客户关系管理', description: '管理销售流程' } },
  nav: { home: '首页', settings: '设置' },
  messages: { 'common.save': '保存' },
};
```

Exact Zod shape: `node_modules/@objectstack/spec/src/system/translation.zod.ts` —
`AppTranslationBundleSchema` and `ObjectTranslationNodeSchema`.

---

## Message Interpolation

### Simple Format (Default)

Both shipped adapters (`FileI18nAdapter` and the in-memory fallback) substitute
**double-brace** `{{variable}}` placeholders only — single braces pass through
unchanged. (The schema docstring mentions `{variable}` notation, but that is not
what the runtime implements.)

```json
{
  "messages": {
    "welcome": "Welcome, {{userName}}!",
    "pagination": "Showing {{start}} to {{end}} of {{total}} items"
  }
}
```

Usage:
```typescript
i18n.t('messages.welcome', 'en', { userName: 'Alice' });
// "Welcome, Alice!"
```

### No ICU MessageFormat

There is no ICU MessageFormat engine — interpolation is always simple
`{{variable}}` substitution (the aspirational `messageFormat` config knob was
removed in #3494). Author messages for simple substitution; ICU plural/select
strings like `{count, plural, one {1 message} other {# messages}}` will not be
evaluated. To pluralize, select the form in application code before calling `t()`.

---

## Translation Coverage

### `os i18n check`

The working coverage path is the CLI:

```bash
os i18n check                          # every locale found in the config
os i18n check --locales=zh-CN          # scope to specific locales
os i18n check --strict --threshold=95  # CI gate: locale parity + minimum coverage
```

It compares registered bundles against source metadata and reports missing
object/field/option/view/action keys per locale. Missing keys in the default
locale are errors; `--strict` promotes non-default gaps to errors and
`--show-keys` lists every missing key. `os lint --i18n-strict` folds the same
gate into linting.

### Diff & Coverage Schemas

The spec models coverage results for tooling: `TranslationCoverageResult`
(totals, `coveragePercent`, per-group `breakdown`) and `TranslationDiffItem` —
`key` (dot path), `status` (`missing | redundant | stale`), `locale`, optional
`sourceHash` for stale detection, and AI-enrichment fields (`aiSuggested`,
`aiConfidence`). Full Zod shape:
`node_modules/@objectstack/spec/src/system/translation.zod.ts` —
`TranslationCoverageResultSchema`, `TranslationDiffItemSchema`.

These schemas back the **optional** contract methods `getCoverage()` and
`suggestTranslations()`, which **no shipped adapter implements** — point coverage
workflows at `os i18n check` / `os lint --i18n-strict` instead.

---

## AI-Powered Translation Suggestions

`II18nService.suggestTranslations(locale, items)` is an optional contract method
that enriches diff items with `aiSuggested` / `aiConfidence`. It is
**contract-only today**: no shipped adapter implements it, and there is no CLI
command for it. Implement it on a custom adapter to integrate:

- Translation Management Systems (TMS) like Phrase, Crowdin, Lokalise
- Machine translation APIs (Google Translate, DeepL)
- Internal translation memory databases

> **Best Practice:** Review and approve machine suggestions before committing them.

---

## Integration with II18nService

### Service Contract

`II18nService` is the kernel service (name `'i18n'`) that loads bundles and
resolves keys with fallback:

```typescript
import type { II18nService } from '@objectstack/spec/contracts';
```

(The contract's source `.ts` is not part of the published package — only
`src/**/*.zod.ts` ships — so import the type from `@objectstack/spec/contracts`
rather than reading `node_modules` source.)

Methods implemented by both shipped adapters (`FileI18nAdapter` from
`@objectstack/service-i18n`, and the in-memory fallback `@objectstack/core`
registers when no i18n plugin is present):

- **`t(key, locale, params?)`** — dot-path resolution (e.g. `objects.account.label`)
  with `{{param}}` interpolation and fallback-locale lookup
- **`getTranslations(locale)`** — full snapshot for a locale
- **`loadTranslations(locale, data)`** — programmatic load; deep-merges, so multiple
  plugins can each contribute their own `objects.*` slice
- **`getLocales()`** / **`getDefaultLocale()`** / **`setDefaultLocale()`**

The in-memory fallback additionally resolves locale codes
(exact → case-insensitive → base language `zh-CN` → `zh` → variant `zh` → `zh-CN`).

The contract also declares optional methods — `getAppBundle`, `loadAppBundle`,
`getCoverage`, `suggestTranslations` — that **no shipped implementation provides**.
Treat them as extension points for a custom workbench or TMS adapter.

### Plugin Setup

```typescript
import { ObjectKernel } from '@objectstack/core';
import { I18nServicePlugin } from '@objectstack/service-i18n';

const kernel = new ObjectKernel();
kernel.use(new I18nServicePlugin({
  defaultLocale: 'en',
  localesDir: './i18n',
  fallbackLocale: 'en',
  registerRoutes: true,  // Auto-register REST endpoints
  basePath: '/api/v1/i18n',
}));

await kernel.bootstrap();

const i18n = kernel.getService<II18nService>('i18n');
```

> `localesDir` loads only flat, top-level `{locale}.json` files from the directory
> (subdirectories are skipped). `registerRoutes: true` (the default) self-registers
> `GET {basePath}/locales`, `/translations/:locale`, and `/labels/:object/:locale`
> once an HTTP server is available.

---

## Translation Workflow Best Practices

### 1. Extract Skeletons from Metadata

Scaffold ready-to-edit translation files from your stack config:

```bash
os i18n extract --locales=zh-CN --out=./src/translations
```

This writes `<locale>.objects.generated.ts` TypeScript modules (not JSON) — the
default locale is filled from schema labels, other locales follow `--fill`
(`empty | default | todo`). Other flags: `--default-locale`, `--filter` (regex
over object/app names or key paths), `--dry-run`, `--json`.

### 2. Translate

Fill in the values manually. (AI suggestion is a contract-only concept —
`suggestTranslations()` has no CLI and no shipped implementation.)

### 3. Verify Coverage

```bash
os i18n check --locales=zh-CN
```

Add `--strict` / `--threshold=95` in CI to fail on locale gaps.

### 4. Commit & Register

Commit the translation files, import them into your bundle, and register it via
`defineStack({ translations: [...] })`.

---

## CRM I18n Blueprint

Reference implementation shape:

- Bundle entry: `src/translations/index.ts` (or `crm.translation.ts`)
- Locale files: `src/translations/{en,zh-CN,ja-JP,es-ES}.ts`

Use this structure for metadata apps:

| Layer | CRM Pattern |
|:--|:--|
| Stack config | `i18n` with an explicit locale list; per-locale source files by convention |
| Translation assembly | One `defineTranslationBundle` call that imports per-locale files |
| Locale content | Object-scoped translations (`objects.account.fields.*`, `_views`, `_actions`) + global app/messages |
| Naming integrity | Translation object/field keys exactly match metadata machine names |

For new locales, copy one locale file as a baseline, then run `os i18n check`
before release.

---

## Common Pitfalls

### ❌ Studio Shape in Runtime Bundles

The runtime resolvers read `objects.*` — the `o.*` shape belongs to the
secondary `AppTranslationBundle` format only:

```typescript
// Registered via defineStack({ translations }) — WRONG
{ o: { account: { label: '客户' } } }

// CORRECT (TranslationData)
{ objects: { account: { label: '客户' } } }
```

### ❌ Mismatched Object Names

Translation keys must match metadata exactly:

```typescript
// Metadata
{ name: 'project_task' }

// Translation (WRONG)
{ objects: { projectTask: { label: '项目任务' } } }

// Translation (CORRECT)
{ objects: { project_task: { label: '项目任务' } } }
```

### ❌ Hardcoded Option Values

Always use lowercase machine values for options:

```typescript
// Metadata
options: [
  { value: 'in_progress', label: 'In Progress' },
]

// Translation (WRONG)
options: { 'In Progress': '进行中' }

// Translation (CORRECT)
options: { in_progress: '进行中' }
```

### ❌ Ignoring Coverage Reports

Stale translations can cause confusion. Always run `os i18n check` before releases.

---

## Quick-Start Template

One compact per-locale file — assemble locales with `defineTranslationBundle` and
register via `defineStack({ translations: [...] })` as shown in
"Authoring Translation Bundles" above:

<!-- os:check -->
```typescript
// src/translations/zh-CN.ts
import type { TranslationData } from '@objectstack/spec/system';

export const zhCN: TranslationData = {
  objects: {
    account: {
      label: '客户',
      pluralLabel: '客户',
      fields: {
        name: { label: '客户名称' },
        email: { label: '邮箱', placeholder: '输入邮箱地址' },
        status: {
          label: '状态',
          options: {
            active: '活跃',
            inactive: '停用',
          },
        },
      },
      _views: {
        all_accounts: { label: '全部客户' },
      },
    },
  },

  apps: {
    crm: { label: '客户关系管理' },
  },

  messages: {
    'common.save': '保存',
    'common.cancel': '取消',
  },
};
```

---

## Verify your work

After editing a `*.translation.ts` bundle:

```bash
os i18n check   # translation coverage vs the default locale (missing-key report)
os validate     # the bundle conforms to the protocol schema (no artifact)
# or: os build  # the same schema gate, plus emits dist/
```

`os i18n check` lists keys missing per locale; `os lint --i18n-strict` turns
coverage gaps into hard errors. In a scaffolded project the schema gate is
`npm run validate`. See objectstack-platform → **Verify your work**.

---

## References

See [references/_index.md](./references/_index.md) for the full list of Zod
schemas (with one-line descriptions) — pointers into
`node_modules/@objectstack/spec/src/`. Always `Read` the source for exact field
shapes; do not rely on memory of property names.

## See Also

- **objectstack-data** — For understanding object and field metadata structure
- **objectstack-ui** — For view, app, and action translations
- **objectstack-automation** — For workflow and flow message translations
