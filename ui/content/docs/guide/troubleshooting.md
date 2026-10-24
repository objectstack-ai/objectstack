---
title: Troubleshooting
description: Solutions to common issues when building with ObjectUI.
---

# Troubleshooting

This guide covers the most common issues you may encounter when working with ObjectUI, along with their solutions.

## 1. "Component type X not found"

**Symptom:** The `SchemaRenderer` renders nothing or shows a fallback, and the console logs `component type "object-kanban" not found in registry`.

**Cause:** The plugin that provides the component type has not been imported, so it never registered itself with the `ComponentRegistry`.

**Fix:**

```typescript
// Import the plugin package — registration happens on import
import '@object-ui/plugin-kanban';
import '@object-ui/plugin-grid';
```

If you are using a custom component, register it explicitly:

<!-- doc-snippet: fragment — `./MyCustomWidget` is the reader's own component module, so the import cannot resolve from this repository -->

```typescript
import { ComponentRegistry } from '@object-ui/core';
import { MyCustomWidget } from './MyCustomWidget';

ComponentRegistry.register('my-widget', MyCustomWidget, {
  namespace: 'custom',
  label: 'My Widget',
  category: 'plugin',
});
```

Verify what is registered by running:

```bash
npx objectui doctor
```

## 2. Build Errors with Tailwind CSS

**Symptom:** Tailwind utility classes are not applied. Components render without styling.

**Cause:** You are not importing the stylesheets the ObjectUI packages publish. Their utilities — including every themed one, such as `bg-primary` and `border-input` — are compiled at build time into each package's `style.css`, and nothing in your own build can reproduce the themed ones.

**Fix:** Import them in your main CSS file, after your own Tailwind entry, in this order:

```css
/* src/index.css */
@import 'tailwindcss';
@import '@object-ui/components/style.css';
@import '@object-ui/fields/style.css';
```

`@object-ui/components` publishes the base sheet — theme tokens, base layer, its own utilities — and every other sheet is a supplement built by subtracting everything the base already ships, so each must come **after** it and none styles much on its own. `@object-ui/fields` carries what the field widgets add. `@object-ui/plugin-grid` and `@object-ui/plugin-kanban` carry what those two plugins add; add a line for each plugin package you install:

```css
@import '@object-ui/plugin-grid/style.css';
@import '@object-ui/plugin-kanban/style.css';
```

If a grid or a kanban board specifically looks wrong — column headers and card surfaces flat, drag feedback and selection rings missing — that plugin's sheet is the missing import. It did not exist before either: those packages emitted no CSS at all until [#4929](https://github.com/objectstack-ai/objectui/issues/4929), so on earlier versions the subpath does not resolve and upgrading is the fix, not a scanning path. The remaining `@object-ui/plugin-*` packages still publish no stylesheet.

If field widgets specifically look wrong — tag and badge colours flat, the rating stars not reacting to hover, the signature pad showing the wrong cursor — the fields import is the one that is missing. Note that it genuinely did not exist before: every release up to and including 17.3.0 declared the `@object-ui/fields/style.css` subpath while shipping no stylesheet at all ([#4059](https://github.com/objectstack-ai/objectui/issues/4059)), so on those versions the import fails to resolve and breaks the build. Upgrade rather than adding scanning paths.

Then check that the Tailwind 4 build plugin is actually installed and wired up — `@tailwindcss/postcss` in `postcss.config.mjs`, or `@tailwindcss/vite` in `vite.config.ts`. Without it, `@import 'tailwindcss'` is passed through as a plain CSS import and no utilities are generated at all.

> **Do not** try to fix this by adding `node_modules` paths to a `content` array or an `@source` line. ObjectUI is Tailwind 4 and has no `tailwind.config.js`; Tailwind 4 does not load one unless you opt in with `@config`, so on most projects those paths do nothing whatsoever. Even when they are read, scanning the published files only regenerates the shape-only utilities (`inline-flex`, `rounded-md`, `h-9`) the two sheets already contain — it can never produce the themed ones, because the `@theme` block declaring their tokens lives in unpublished package source. Missing theme colours are always a missing `style.css` import, never a missing path.

## 3. Missing Peer Dependencies

**Symptom:** Build or runtime errors about missing modules like `react`, `react-dom`, or `react-hook-form`.

**Cause:** ObjectUI packages declare React 18+ as a **peer dependency**. Your host project must provide them.

**Fix:**

```bash
# Run the built-in doctor command to detect missing dependencies
npx objectui doctor

# Or install manually
pnpm add react react-dom react-hook-form
```

The `objectui doctor` command checks:
- Peer dependency versions
- Package compatibility
- Registry health
- Missing plugins referenced in schemas

## 4. Expression Evaluation Errors

**Symptom:** Expressions like `${data.user.name}` render as literal strings or throw runtime errors.

**Cause:** Malformed expression syntax, missing context variables, or unclosed brackets.

**Fix:**

| Problem | Bad | Good |
|---------|-----|------|
| Missing `$` prefix | `{data.name}` | `${data.name}` |
| Unclosed bracket | `${data.name` | `${data.name}` |
| Wrong context var | `${row.name}` | `${data.name}` |
| Nested quotes | `${"hello"}` | `${'hello'}` or `${data.greeting}` |

Available context variables:
- `data.*` — Current data scope
- `user.*` — Authenticated user
- `params.*` — URL/query parameters

Debug expressions by enabling debug mode in `SchemaRendererContext`:

<!-- doc-snippet: fragment — a bare `<SchemaRenderer />` tag shown for the `debug` prop alone; `schema` is the reader's own document -->

```tsx
<SchemaRenderer schema={schema} debug={true} />
```

This logs each expression evaluation to the browser console.

## 5. Schema Validation Errors

**Symptom:** Schema renders incorrectly, the development console shows `[ObjectUI] Invalid schema detected:`, or `assertValidSchema` throws `Schema validation failed:`.

**Fix:** Validate your schema before passing it to the renderer:

```bash
# CLI validation (checks against @objectstack/spec)
npx objectui validate ./path/to/schema.json
```

Common schema issues:
- Missing required `type` field on components
- Invalid action type (must be one of: `script`, `url`, `api`, `modal`, `flow`)
- Referencing a field type that doesn't exist (e.g., `rich-text` without importing `plugin-editor`)

Schema-structure validation is `validateSchema` / `assertValidSchema` from `@object-ui/core` (`packages/core/src/validation/schema-validator.ts`); `SchemaRenderer` runs `validateSchema` once per schema object in development.

## 6. TypeScript Errors with Schema Types

**Symptom:** TypeScript cannot find types like `BaseSchema`, `ActionSchema`, or `FieldWidgetProps`.

**Cause:** `@object-ui/types` is not installed, or the version is mismatched.

**Fix:**

```bash
pnpm add @object-ui/types
```

Then import types from the correct entry points:

```typescript
// Base types
import type { BaseSchema } from '@object-ui/types';

// Category-specific types
import type { FormSchema } from '@object-ui/types/form';
import type { LayoutSchema } from '@object-ui/types/layout';
import type { DataDisplaySchema } from '@object-ui/types/data-display';

// Zod validation schemas — same PascalCase names as the types, so alias one of
// the two when a module imports both.
import { BaseSchema as BaseSchemaValidator } from '@object-ui/types/zod';
```

The `@object-ui/types` package exports multiple entry points (`base`, `layout`, `form`, `data-display`, `feedback`, `overlay`, `navigation`, `complex`, `data`, `zod`). Check `packages/types/package.json` for the full list.

## 7. Dark Mode Flickering

**Symptom:** Page flashes white before switching to dark mode on initial load.

**Cause:** The `ThemeProvider` (`packages/react/src/context/ThemeContext.tsx`) is mounted too late, or the theme preference is read asynchronously after first paint.

**Fix:**

1. Place the `ThemeProvider` as high as possible in your component tree — ideally wrapping your entire app:

```tsx
import { ThemeProvider } from '@object-ui/react';
import type { FC } from 'react';

declare const YourApp: FC;

function App() {
  return (
    <ThemeProvider defaultTheme="system">
      <YourApp />
    </ThemeProvider>
  );
}
```

2. Add a blocking script in your HTML `<head>` to set the `class` attribute before React hydrates:

```html
<script>
  const theme = localStorage.getItem('object-ui-theme') || 'system';
  if (theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  }
</script>
```

## 8. i18n Missing Translations

**Symptom:** UI shows raw translation keys like `common.save` instead of localized text.

**Cause:** Locale files are missing or the `I18nProvider` is not configured.

**Fix:**

1. Ensure the `I18nProvider` from `packages/i18n/` wraps your app:

```tsx
import { I18nProvider } from '@object-ui/i18n';
import type { FC } from 'react';

declare const App: FC;

// The app's own packs are merged with the built-in locales.
const resources = { en: { greeting: 'Hello' }, fr: { greeting: 'Bonjour' } };

<I18nProvider config={{ defaultLanguage: 'en', resources }}>
  <App />
</I18nProvider>;
```

2. Check that locale files follow the expected structure. Each locale file should export a flat or nested object of key-value pairs.

3. Verify the locale code matches exactly (e.g., `en`, `fr`, `de` — not `en-US` unless your locale files use that format). The built-in catalogues are looked up exact tag first, then base language, so a region-tagged code such as `zh-CN` is served by the built-in `zh` catalogue.

## 8b. The UI paints in English first, then switches to the user's language

**Symptom:** a `zh` / `ja` / `de` user sees one frame of English before the real
strings arrive. The strings are correct in both frames — this is not the missing
-translation symptom above, which shows raw keys like `common.save`.

**Cause:** this is the documented behaviour, not a defect. Only the `en`
catalogue ships resident; the other nine are fetched per locale, so a provider
that boots into `zh` renders through `fallbackLng: 'en'` until the `zh`
catalogue lands.

**Fix:** resolve the catalogue before you mount. If your app already awaits
anything before `createRoot().render()`, spend that await here:

```tsx
import { I18nProvider, preloadBootstrapLocale } from '@object-ui/i18n';
import { createRoot } from 'react-dom/client';
import type { FC } from 'react';

declare const App: FC;
declare const container: HTMLElement;

// Pass the SAME options you pass to <I18nProvider> — otherwise the two can
// disagree about which language this boot is in, and the preload fetches the
// wrong catalogue. Never rejects: a catalogue that will not download must not
// take the boot down, and the provider retries on mount.
await preloadBootstrapLocale();
createRoot(container).render(
  <I18nProvider>
    <App />
  </I18nProvider>,
);
```

An app that has no such seam keeps the fallback render, which is correct in both
frames.

## 9. Performance Issues with Large Datasets

**Symptom:** Grid, table, or list views become slow with 1,000+ rows.

**Cause:** All rows are being rendered in the DOM at once.

**Fix:**

- **Grid Plugin** (`packages/plugin-grid/`): Built-in grid supports virtualization out of the box for large datasets.
- **Paginate server-side**: Configure your data source adapter (`packages/core/src/adapters/`) to fetch data in pages rather than loading everything at once.

For custom views, use the `usePerformance` hook from `@object-ui/react` to monitor render times:

```typescript
import { usePerformance } from '@object-ui/react';

// Inside your component:
const { metrics, markRenderStart } = usePerformance({
  virtualScroll: { enabled: true, itemHeight: 40 },
});

const stopMeasure = markRenderStart(); // call stopMeasure() once the render settles
console.log(metrics.lastRenderDuration);
```

## 10. Plugin Conflicts

**Symptom:** Two plugins register the same component type and one silently overrides the other.

**Cause:** Plugins registered without namespaces collide on the same type key.

**Fix:** Always use namespaced registrations:

```typescript
import { ComponentRegistry } from '@object-ui/core';
import type { FC } from 'react';

declare const MyGridComponent: FC;

ComponentRegistry.register('grid', MyGridComponent, {
  namespace: 'my-plugin',  // ← prevents collision
  label: 'Custom Grid',
  category: 'plugin',
});
```

The `PluginSystem` (`packages/core/src/registry/PluginSystem.ts`) uses `PluginScopeImpl` to auto-prefix registrations with the plugin name. If you register manually, always provide a `namespace`.

To debug conflicts:

```bash
npx objectui doctor
```

This reports duplicate registrations and namespace collisions.

## 10. `react-day-picker` v9 prop / classNames errors

**Symptom:** After upgrading `react-day-picker` (a transitive dependency of `@object-ui/components`) you see TypeScript errors such as:

- `Property 'initialFocus' does not exist on type 'DayPickerProps'`
- `Property 'fromYear' does not exist on type 'DayPickerProps'`
- `'table' does not exist in type 'Partial<ClassNames>'`

**Cause:** v9 removed several legacy props/classnames slots inherited from the v7 API.

**Fix:** Apply the v8 → v9 mapping below in any file that consumes `<Calendar>` / `<DayPicker>` directly:

| v8 / earlier         | v9 replacement                                                |
| -------------------- | ------------------------------------------------------------- |
| `initialFocus`       | `autoFocus`                                                   |
| `fromYear={2000}`    | `startMonth={new Date(2000, 0)}`                              |
| `toYear={2050}`      | `endMonth={new Date(2050, 11)}`                               |
| `classNames.table`   | removed — drop the entry (the table wrapper now styles itself) |

The components shipped in `@object-ui/components` and `@object-ui/plugin-calendar` already use the v9 API; this note exists so downstream apps with their own `<Calendar>` wrappers can apply the same migration.

## 11. A list column is empty, or a relation column shows a raw id

**Symptom:** A column appears in a list/grid but every cell is blank, or a
`lookup` / `master_detail` / `user` column shows a record id (`8UY9zHWBfjYjYor4`)
instead of the related record's name. Sorting by that column does nothing, and
exports come out missing it.

**Cause:** The column object names its field with more than one key. The
canonical key is `field` — the only identity key `@objectstack/spec`'s
`ListColumnSchema` declares — but stored objectui metadata also carries the
legacy `name` (and, in older imports, `fieldName`). When a column carries two
of them with different values, the renderer and the data request can resolve
two different fields: the row fetch asks the server for one field while the
grid renders another, so the cell has nothing behind it and the relation is
never expanded.

✗ two identities on one column

```json
{ "field": "account", "name": "account_name" }
```

✗ legacy-only: the renderer shows it, the request used to drop it

```json
{ "name": "account" }
```

✓ canonical

```json
{ "field": "account" }
```

**Fix:** Author columns with `field`. Two mechanisms keep legacy metadata
working, and both resolve the canonical key first:

- Metadata reaching a `list-view` is canonicalized at the component boundary by
  `normalizeListViewSchema`, which stamps `field` from whichever spelling is
  present and makes any legacy key it already carries agree.
- Every renderer that resolves a column — list, grid, tree, related lists, the
  `$expand` / `$select` builders — reads that identity through one shared
  function, so a surface rendered outside the fold (a standalone `object-grid`
  node, for instance) still resolves the same field the request asked for.

Legacy keys are still accepted, but they are a migration bridge, not a second
contract: fix the producer. A column that carries two identity keys that
*disagree* logs a one-time dev-mode warning naming which key won and what to
change — the renderer recovering is not the same as the metadata being right:

```
[ObjectUI] Column carries two identities: `field: 'account'` and
`name: 'account_name'`. `field` wins — it is the only key `ListColumnSchema`
declares — and `name` has been rewritten to match, so the rendered column and
the requested field agree. Fix the producer: drop `name` and author `field`
only. (objectui#3104)
```

If you read column identity in your own code, use the one reader rather than
spelling out a fallback chain — it resolves canonical-first, so it agrees with
what the data layer requested:

```typescript
import { columnIdentity } from '@object-ui/core';

declare const column: unknown;

const fieldName = columnIdentity(column); // string | undefined
```

## Getting Help

If none of the above resolves your issue:

1. Search [existing issues](https://github.com/objectstack-ai/objectui/issues)
2. Run `npx objectui doctor` and include the output in your report
3. Open an issue with your schema JSON, error message, and ObjectUI package versions
