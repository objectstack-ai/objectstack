# @objectstack/service-i18n

I18n Service for ObjectStack — implements `II18nService` with file-based locale loading and translation management.

## Features

- **Multi-Language Support**: Manage translations for unlimited languages
- **File-Based Locales**: Load translations from JSON/YAML files
- **Namespace Support**: Organize translations by domain (e.g., `common`, `errors`, `ui`)
- **Interpolation**: Dynamic variable replacement in translations
- **Pluralization**: Language-specific plural rules
- **Fallback Chain**: Graceful fallback from dialect → base language → default
- **Type-Safe**: TypeScript support with type-safe translation keys
- **Hot Reload**: Reload translations without restarting (development)

## Installation

```bash
pnpm add @objectstack/service-i18n
```

## Basic Usage

```typescript
import { defineStack } from '@objectstack/spec';
import { ServiceI18n } from '@objectstack/service-i18n';

const stack = defineStack({
  services: [
    ServiceI18n.configure({
      defaultLocale: 'en-US',
      supportedLocales: ['en-US', 'es-ES', 'fr-FR', 'de-DE'],
      loadPath: './locales/{{lng}}/{{ns}}.json',
    }),
  ],
});
```

## Configuration

```typescript
interface I18nServiceConfig {
  /** Default locale (e.g., 'en-US') */
  defaultLocale: string;

  /** List of supported locales */
  supportedLocales: string[];

  /** Path template for locale files */
  loadPath: string;

  /** Fallback locale when translation is missing */
  fallbackLocale?: string;

  /** Enable hot reload in development */
  hotReload?: boolean;
}
```

## Directory Structure

```
locales/
├── en-US/
│   ├── common.json
│   ├── errors.json
│   └── ui.json
├── es-ES/
│   ├── common.json
│   ├── errors.json
│   └── ui.json
└── fr-FR/
    ├── common.json
    ├── errors.json
    └── ui.json
```

Example `locales/en-US/common.json`:

```json
{
  "welcome": "Welcome to ObjectStack",
  "greeting": "Hello, {{name}}!",
  "item_count": "You have {{count}} item",
  "item_count_plural": "You have {{count}} items",
  "save_button": "Save",
  "cancel_button": "Cancel"
}
```

## Service API

```typescript
// Get i18n service
const i18n = kernel.getService<II18nService>('i18n');
```

### Basic Translation

```typescript
// Simple translation
const text = await i18n.t('common:welcome');
// "Welcome to ObjectStack"

// With interpolation
const greeting = await i18n.t('common:greeting', { name: 'Alice' });
// "Hello, Alice!"

// With pluralization
const count1 = await i18n.t('common:item_count', { count: 1 });
// "You have 1 item"

const count5 = await i18n.t('common:item_count', { count: 5 });
// "You have 5 items"
```

### Change Locale

```typescript
// Set locale for current context
await i18n.setLocale('es-ES');

// Get current locale
const locale = i18n.getLocale();
// "es-ES"

// Translate in specific locale (without changing context)
const text = await i18n.t('common:welcome', { locale: 'fr-FR' });
```

### Namespaces

```typescript
// Load translation from 'errors' namespace
const errorMsg = await i18n.t('errors:not_found');

// Load multiple namespaces
await i18n.loadNamespaces(['common', 'ui', 'errors']);

// Check if namespace is loaded
const isLoaded = i18n.isNamespaceLoaded('common');
```

### Locale Management

```typescript
// Get all supported locales
const locales = i18n.getSupportedLocales();
// ['en-US', 'es-ES', 'fr-FR', 'de-DE']

// Check if locale is supported
const isSupported = i18n.isLocaleSupported('ja-JP');
// false

// Get locale metadata
const metadata = i18n.getLocaleMetadata('en-US');
// {
//   name: 'English (United States)',
//   nativeName: 'English (United States)',
//   direction: 'ltr',
//   pluralRules: 'en'
// }
```

## Advanced Features

### Nested Keys

```json
{
  "user": {
    "profile": {
      "title": "User Profile",
      "edit": "Edit Profile"
    }
  }
}
```

```typescript
await i18n.t('common:user.profile.title');
// "User Profile"
```

### Arrays

```json
{
  "days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
}
```

```typescript
const days = await i18n.t('common:days', { returnObjects: true });
// ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
```

### Context-Based Translations

```json
{
  "friend": "A friend",
  "friend_male": "A boyfriend",
  "friend_female": "A girlfriend"
}
```

```typescript
await i18n.t('common:friend', { context: 'male' });
// "A boyfriend"

await i18n.t('common:friend', { context: 'female' });
// "A girlfriend"
```

### Formatting

```typescript
// Date formatting
const formatted = await i18n.formatDate(new Date(), {
  locale: 'es-ES',
  format: 'long',
});
// "15 de enero de 2024"

// Number formatting
const price = await i18n.formatNumber(1234.56, {
  style: 'currency',
  currency: 'EUR',
  locale: 'fr-FR',
});
// "1 234,56 €"

// Relative time
const relative = await i18n.formatRelative(new Date('2024-01-01'), {
  locale: 'en-US',
});
// "3 months ago"
```

### Dynamic Loading

```typescript
// Add a new locale dynamically
await i18n.addLocale('ja-JP', {
  loadPath: './locales/ja-JP/{{ns}}.json',
});

// Remove a locale
await i18n.removeLocale('ja-JP');

// Reload translations (useful in development)
await i18n.reload();
```

## Integration with Metadata

Translate metadata labels automatically:

```typescript
import { ObjectSchema, Field } from '@objectstack/spec/data';

const contact = ObjectSchema.create({
  name: 'contact',
  label: 'i18n:objects.contact.label', // References translation key
  fields: {
    name: Field.text({
      label: 'i18n:fields.contact.name',
    }),
  },
});

// Translation file: locales/en-US/metadata.json
{
  "objects": {
    "contact": {
      "label": "Contact",
      "label_plural": "Contacts"
    }
  },
  "fields": {
    "contact": {
      "name": "Full Name"
    }
  }
}
```

## REST API Endpoints

```
GET    /api/v1/i18n/locales              # Get supported locales
GET    /api/v1/i18n/translations/:locale # Get all translations for locale
POST   /api/v1/i18n/translate            # Translate keys (batch)
```

## Client Integration

### React Hook Example

```typescript
import { useTranslation } from '@objectstack/client-react';

function MyComponent() {
  const { t, locale, setLocale } = useTranslation();

  return (
    <div>
      <h1>{t('common:welcome')}</h1>
      <button onClick={() => setLocale('es-ES')}>
        Español
      </button>
    </div>
  );
}
```

## Best Practices

1. **Use Namespaces**: Organize translations by domain (common, ui, errors, metadata)
2. **Consistent Keys**: Use dot notation for nested keys (e.g., `user.profile.title`)
3. **Provide Context**: Use context for gender, formality, or pluralization variants
4. **Fallback Values**: Always provide fallback translations in default locale
5. **Avoid Hardcoding**: Never hardcode user-facing text; use translation keys
6. **Professional Translation**: Use professional translators for production
7. **Version Control**: Store translation files in version control

## Locale Coverage Detection

```typescript
// Get coverage statistics
const coverage = await i18n.getCoverage();
// {
//   'en-US': { total: 245, missing: 0, percentage: 100 },
//   'es-ES': { total: 245, missing: 12, percentage: 95.1 },
//   'fr-FR': { total: 245, missing: 45, percentage: 81.6 }
// }

// Get missing keys for a locale
const missing = await i18n.getMissingKeys('es-ES');
// ['errors.validation.email', 'ui.dashboard.title', ...]
```

## Performance Considerations

- **Lazy Loading**: Namespaces are loaded on demand
- **Caching**: Translations are cached in memory
- **Hot Reload**: Only enable in development
- **Bundle Size**: Load only required locales on client

## Contract Implementation

Implements `II18nService` from `@objectstack/spec/contracts`:

```typescript
interface II18nService {
  t(key: string, options?: TranslationOptions): Promise<string>;
  setLocale(locale: string): Promise<void>;
  getLocale(): string;
  getSupportedLocales(): string[];
  loadNamespaces(namespaces: string[]): Promise<void>;
  formatDate(date: Date, options?: FormatOptions): Promise<string>;
  formatNumber(value: number, options?: FormatOptions): Promise<string>;
}
```

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).

## See Also

- [i18next Documentation](https://www.i18next.com/)
- [@objectstack/spec/system (Translation schema)](../../spec/src/system/)
- [I18n Best Practices Guide](/content/docs/protocol/objectos/i18n-standard.mdx)
