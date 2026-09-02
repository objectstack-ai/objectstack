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
compatibility: Requires @objectstack/spec 17.x (Zod v4 schemas)
metadata:
  author: objectstack-ai
  version: "1.3"
  domain: i18n
  tags: i18n, translation, locale, l10n, bundle, coverage
---

# Internationalization — ObjectStack I18n Protocol

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

## Authoring Translation Bundles (`objects.*`)

The canonical authoring path: one `TranslationData` per locale, assembled with
`defineTranslationBundle` and registered on the stack. This mirrors the shipped
`examples/app-todo` (`src/translations/{en,zh-CN,ja-JP}.ts` + `index.ts`):

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
| `label` / `pluralLabel` / `description` | Object-level text (every key optional) |
| `fields.{field_name}` | `label`, `help`, `placeholder`, `options` (option value → label) per field |
| `_views.{view_name}` | `label`, `description`, `emptyState.title` / `emptyState.message` |
| `_actions.{action_name}` | `label`, `description`, `confirmText`, `successMessage`, `params.{param_name}`, `resultDialog` |
| `_sections.{section_name}` | Form section `label`, `description` |
| `_tabs.{tab_name}` | Filter-preset tab `label` (`ViewTabSchema.name`) |

Top-level groups alongside `objects`: `apps` (label, description, navigation),
`messages`, `globalActions` (object-less actions), `dashboards`, `pages`, `flows`,
`settings`, `metadataForms`, `settingsCommon`.

> `validationMessages` is not a translation group — it was removed in spec 17.0.0.
> Author the message on the rule itself (`object.validations[].message`), which the
> engine returns on every rejected write.

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

Option sub-keys are the option's stored **`value`**, never its display label:
for `options: [{ value: 'direct_mail', label: 'Direct Mail' }]` write
`options: { direct_mail: '直邮' }` — both `'Direct Mail'` and `'direct-mail'`
parse, ship, and resolve to nothing.

`os validate` / `os lint` / `os compile` check this direction and report it as
warnings (`translation-target-unknown`, `translation-option-key-unknown`): a key
naming an object, field, view, tab, action, param, section, app, nav item,
dashboard, widget or flow screen that does not exist is listed alongside the names
that do. A bundle keyed to something since renamed still parses — the label just
renders silently in its source locale while every neighbouring one resolves.

---

## File Organization Strategies

Layout is an **authoring convention**: whichever one you pick, your own import graph
assembles it into the `TranslationBundle` you register on the stack — nothing loads a
directory tree for you.

| Layout | Files | Use when |
|:--|:--|:--|
| Bundled | one `crm.translation.ts` holding every locale | under 5 objects, 2-3 locales |
| Per-locale (recommended) | `src/translations/{en,zh-CN,ja-JP}.ts` + `index.ts` | 5-20 objects, 3-5 locales |
| Per-namespace | `i18n/{locale}/{object}.json`, assembled by your own imports | 20+ objects, 5+ locales |

---

## Authoring at Runtime: the `translation` Item

Translations do not have to ship as files. A **`translation` metadata item** — created in
the Studio, through the metadata API, or by an agent — carries one locale's worth of the
**same** `objects.*` groups documented above plus the `locale` it translates. `locale` is
required, one locale per item, and published items load at boot and on every publish,
layering **over** the file bundles (delete the item and the shipped value returns). There
is exactly one shape; nothing converts between formats. Author with `defineTranslation`;
exact Zod shape is `TranslationItemSchema` in
`node_modules/@objectstack/spec/src/system/translation.zod.ts`.

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
removed). Author messages for simple substitution; ICU plural/select
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

It compares registered bundles against source metadata and reports missing keys
per locale for every surface the extractor walks — objects and their sub-keys,
global actions, apps, dashboards, pages, flow screens, metadata forms. Gaps in
the default locale are errors, `--strict` promotes the rest, `--show-keys` lists
them all; `os lint --i18n-strict` folds the same gate into lint.

### `os i18n extract --check` — freshness, not coverage

If you commit **generated** bundles (`*.generated.ts` produced by
`os i18n extract`), coverage is only half the gate:

```bash
os i18n extract <config> --locales=zh-CN,ja-JP --fill=default \
  --out=src/translations --check
```

`--check` writes nothing. It re-renders what a real extract would produce and
fails if that differs from what is committed in `--out`, naming each stale or
missing file and printing the regenerate command.

**Use both gates — they answer different questions.** `os i18n check` asks *are
the strings translated?* (coverage: human work). `extract --check` asks *are the
generated bundles still what the schema produces?* (freshness: machine output).
Renaming a label or removing a spec key leaves coverage at 100% while bundles go
stale — how the platform's own ended up translating keys the schema had deleted.

It runs in the same **merge mode** as a normal extract, so it never asks for
re-translation: an up-to-date bundle re-extracts byte-identically. Requires
`--out` — there is nothing to compare against without it.

### Diff & Coverage Schemas

The spec models coverage results for tooling: `TranslationCoverageResult`
(totals, `coveragePercent`, per-group `breakdown`) and `TranslationDiffItem` —
`key` (dot path), `status` (`missing | redundant | stale`), `locale`, optional
`objectName`, optional `sourceHash` for stale detection, and AI-enrichment
fields (`aiSuggested`, `aiConfidence`). Full Zod shape:
`node_modules/@objectstack/spec/src/system/translation.zod.ts` —
`TranslationCoverageResultSchema`, `TranslationDiffItemSchema`.

These schemas back the **optional** contract methods `getCoverage()` and
`suggestTranslations()`, which **no shipped adapter implements** — point coverage
workflows at `os i18n check` / `os lint --i18n-strict` instead.

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
- **`getLocales()`** / **`setSupportedLocales()`** / **`getDefaultLocale()`** / **`setDefaultLocale()`**

The in-memory fallback additionally resolves locale codes
(exact → case-insensitive → base language `zh-CN` → `zh` → variant `zh` → `zh-CN`).

The contract also declares optional methods — `getFieldLabels`, `getCoverage`,
`suggestTranslations` — that **no shipped implementation provides**. Treat them
as extension points for a custom workbench or TMS adapter. (`getAppBundle` /
`loadAppBundle` went with the `o.*` shape they returned.)

### Registration

You do not wire this plugin: `os serve` registers `I18nServicePlugin` itself whenever the
stack config carries `translations` or `i18n` (kernel bootstrap is
**objectstack-platform → Runtime Boot Sequence**). It self-registers
`GET /api/v1/i18n/locales`, `/translations/:locale` and `/labels/:object/:locale`.

---

## Translation Workflow Best Practices

### 1. Extract Skeletons from Metadata

Scaffold ready-to-edit translation files from your stack config:

```bash
os i18n extract --locales=zh-CN --out=./src/translations
```

This writes `<locale>.objects.generated.ts` TypeScript modules (not JSON), plus a
`<locale>.metadata-forms.generated.ts` companion unless `--no-metadata-forms` —
the default locale is filled from schema labels, other locales follow `--fill`
(`empty | default | todo`). `os i18n extract --help` lists the rest: `--filter`,
`--default-locale`, `--no-merge`, `--objects-only`, `--source-hashes`, `--dry-run`,
`--json`, …

⚠️ **`--objects-only` is on by DEFAULT**, so extract writes only the `objects` /
`globalActions` subtree — while `os i18n check` also demands `app`, `navigation`,
`dashboard`, `widget`, `page` and `flow` keys. Run the workflow as written and coverage
reports gaps the extract never scaffolded. Pass `--no-objects-only` to include those
groups, or author them by hand.

### 2. Translate

Fill in the values manually.

### 3. Verify Coverage

```bash
os i18n check --locales=zh-CN
```

Add `--strict` / `--threshold=95` in CI to fail on locale gaps.

### 4. Register

A stack registers its bundles with `defineStack({ translations: [...] })`. A **package or
plugin shipping its own generated bundle** — the most common shape in this repo — has one
more step: a generated module exports an objects *subtree*
(`NonNullable<TranslationData['objects']>`), not a `TranslationData`, so it must be
wrapped before it is a bundle at all.

```typescript
// src/translations/index.ts
import type { TranslationBundle, TranslationData } from '@objectstack/spec/system';
import { withSourceFallback } from '@objectstack/platform-objects/apps';
import { enObjects } from './en.objects.generated.js';
import { zhCNObjects } from './zh-CN.objects.generated.js';
import { zhCNGeneratedSourceHashes } from './zh-CN.source-hashes.generated.js';

const enSource: TranslationData = { objects: enObjects };

export const StorageTranslations: TranslationBundle = {
  en: enSource,
  // 4th argument = the `--source-hashes` companion. Without it a leaf whose SOURCE has
  // moved goes on serving the superseded fill under a green `os i18n check` forever.
  // The 3rd stays undefined: it judges hand-authored `apps` / `dashboards` / `pages`,
  // which a fully generated set does not have.
  'zh-CN': withSourceFallback({ objects: zhCNObjects }, enSource, undefined, zhCNGeneratedSourceHashes),
};
```

A plugin that owns its objects loads that bundle from its own `kernel:ready` hook rather
than registering it on the stack: `i18n.loadTranslations(locale, data)` deep-merges, so
every plugin contributes its own `objects.*` slice.

---

## Shipped examples

`examples/app-crm` — the bundled layout (one `crm.translation.ts`, `en` + `zh-CN`).
`examples/app-todo` — the per-locale layout (`{en,zh-CN,ja-JP}.ts` + `index.ts`).

---

## Common Pitfalls

### ❌ The Retired `o.*` Shape

Everything reads `objects.*`. The `o.*` dialect was removed — not a "Studio
format", not a secondary format, just gone. Both doors reject it, files included.

```typescript
// WRONG — in a file bundle AND in a `translation` item
{ o: { account: { label: '客户' } } }

// CORRECT (TranslationData)
{ objects: { account: { label: '客户' } } }
```

Same rule for its sibling keys: `app` → `apps`, `nav` →
`apps.<app>.navigation.<id>.label`, `dashboard` → `dashboards`,
`_globalOptions` → `objects.<obj>.fields.<field>.options`, `_meta.locale` →
top-level `locale`, and `_actions.confirmMessage` → `_actions.confirmText`.

### ❌ Ignoring Coverage Reports

Run `os i18n check` before releases; `extract --check` is what sees staleness.

---

## Verify your work

```bash
os i18n check   # coverage: which keys are missing, per locale
os validate     # the bundle conforms to the protocol schema
```

`os lint --i18n-strict` turns coverage gaps into hard errors. For the build and scaffold
gates see objectstack-platform → **Verify your work**.

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
