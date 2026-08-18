# @objectstack/service-i18n

The shipped provider for the kernel's **`i18n`** service slot — a file-based
`II18nService` implementation that also mounts the `/api/v1/i18n/*` routes.

Slot criticality: `core` (`ServiceRequirementDef` in `@objectstack/spec/system`).

## Installation

```bash
pnpm add @objectstack/service-i18n
```

## Usage

```typescript
import { ObjectKernel } from '@objectstack/core';
import type { II18nService } from '@objectstack/spec/contracts';
import { I18nServicePlugin } from '@objectstack/service-i18n';

const kernel = new ObjectKernel();
await kernel.use(new I18nServicePlugin({
  defaultLocale: 'en',
  localesDir: './i18n',
  fallbackLocale: 'en',
}));
await kernel.bootstrap();

const i18n = kernel.getService<II18nService>('i18n');
i18n.t('objects.account.label', 'en');            // 'Account'
i18n.t('greeting', 'en', { name: 'Alice' });      // 'Hello, Alice!'
```

⚠️ `t()` is **synchronous** and takes the locale as its **second positional argument** —
`t(key, locale, params?)`. It is not `await`-able and there is no ambient "current
locale" to set: every call names the locale it wants.

## Plugin options

`I18nServicePluginOptions` has exactly five fields, all optional.

| Option | Type | Default | Purpose |
|:---|:---|:---|:---|
| `defaultLocale` | `string` | `'en'` | Reported by `getDefaultLocale()`; used as the adapter's default. |
| `localesDir` | `string` | none | Directory of `{locale}.json` files loaded at construction. |
| `fallbackLocale` | `string` | none | Consulted when a key is missing in the requested locale. |
| `registerRoutes` | `boolean` | `true` | Register the REST routes at `kernel:ready`. |
| `basePath` | `string` | `'/api/v1/i18n'` | Base path for those routes. |

With `registerRoutes: false` — or when no `http-server` service is present — the plugin
logs a warning and the service stays available programmatically through
`kernel.getService('i18n')`.

## Locale files

One JSON file per locale, named `{locale}.json`, in `localesDir`. Files may be flat or
nested; keys resolve by dot notation. There is no per-namespace file layout and no
`{{lng}}`/`{{ns}}` path template.

```
i18n/
├── en.json
├── zh-CN.json
└── ja-JP.json
```

`i18n/en.json`:

```json
{
  "greeting": "Hello, {{name}}!",
  "objects": {
    "account": { "label": "Account" }
  }
}
```

Interpolation is `{{paramName}}` only, substituted from the third argument of `t()`. A
parameter with no supplied value is left as the literal `{{name}}` placeholder. There is
no pluralization, no `context` suffix resolution, no `returnObjects`, and no date /
number / relative-time formatting in this package — use `Intl` for those.

## Service API

`II18nService` (from `@objectstack/spec/contracts`) declares four required members plus
optional ones; `FileI18nAdapter` implements the required four and three of the optional.

```typescript
import type { II18nService } from '@objectstack/spec/contracts';

// required
//   t(key, locale, params?)               -> string   (the key itself when unresolved)
//   getTranslations(locale)               -> Record<string, unknown>
//   loadTranslations(locale, data)        -> void      (deep-merged into the locale)
//   getLocales()                          -> string[]
// optional, implemented here
//   getDefaultLocale() / setDefaultLocale(locale)
//   setSupportedLocales(locales | undefined)
```

`t()` returns the **key itself** when nothing resolves — it never throws and never
returns `undefined`, so a missing translation surfaces as a visible key rather than an
empty string.

`loadTranslations` deep-merges, so several plugins can each contribute keys under the
same nested path (every platform plugin pushes its own bundle at `kernel:ready`).

### Which locales are reported

`getLocales()` reports what is **loaded**, narrowed by the app's declared
`i18n.supportedLocales` when the runtime injects them via `setSupportedLocales`.
The narrowing rules are contractual:

- absent / empty / not an array ⇒ **no** narrowing (every loaded locale is reported);
- a declared locale with no loaded bundle is still reported (declared-but-unserved is
  visible rather than silently intersected away);
- narrowing is applied at read time, never as a prune of what is stored — bundles keep
  arriving after the app plugin has run.

### Runtime-authored translations

Translations authored in Studio persist as `translation` metadata. The plugin wires the
shared core sync, which replaces the authored layer wholesale (`clear`-then-reload) at
`kernel:ready`, on `metadata:reloaded`, and on `translation` protocol mutations — so a
key deleted from an authored item stops resolving on the next sync, while the static
bundle layer underneath is untouched.

## REST API

Registered by this plugin directly on the `http-server` service. These three routes are
the whole surface (shown at the default `basePath`):

```
GET    /api/v1/i18n/locales                     # available locales
GET    /api/v1/i18n/translations/:locale        # all translations for one locale
GET    /api/v1/i18n/labels/:object/:locale      # field labels for one object
```

⚠️ The locale is a **path** segment, not a `?locale=` query parameter — the query
dialect was a wire-level 404 against every serving surface and was retired. Each route
is expressed by the SDK (`i18n.getLocales`, `i18n.getTranslations`, `i18n.getFieldLabels`);
`src/i18n-route-ledger.ts` is the audited list, and a conformance test fails when a
mounted route has no entry or an entry names a route that is no longer mounted.

## Client integration

There is no `useTranslation` hook in this repo. On the client, `@objectstack/client-react`
carries the **active locale** so requests send a matching `Accept-Language`, and
translations are fetched through `@objectstack/client`:

```tsx
import { ObjectStackProvider, useObjectStackLocale } from '@objectstack/client-react';

function App({ client, language }) {
  return (
    <ObjectStackProvider client={client} locale={language}>
      <Screen />
    </ObjectStackProvider>
  );
}

function Screen() {
  const locale = useObjectStackLocale();   // string | undefined
  return <span>{locale}</span>;
}
```

```typescript
import { ObjectStackClient } from '@objectstack/client';

const client = new ObjectStackClient({ baseUrl: 'http://localhost:3000' });
const locales = await client.i18n.getLocales();
const bundle = await client.i18n.getTranslations('zh-CN');
const labels = await client.i18n.getFieldLabels('crm_account', 'zh-CN');
```

## Exports

```typescript
import { I18nServicePlugin, FileI18nAdapter } from '@objectstack/service-i18n';
```

Types: `I18nServicePluginOptions`, `FileI18nAdapterOptions`.

`FileI18nAdapter` is the implementation behind the plugin, exported for hosts that wire
their own kernel integration. Beyond the contract it also exposes
`replaceAuthoredTranslations(byLocale)`, which the authored-translation sync uses.

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).

## See Also

- [@objectstack/spec/system](../../spec/src/system/) — the `translation` metadata schema
- [I18n Standard](/content/docs/protocol/kernel/i18n-standard.mdx)
