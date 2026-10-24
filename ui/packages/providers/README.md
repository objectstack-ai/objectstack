# @object-ui/providers

**Reusable Context Providers for ObjectUI**

A collection of framework-agnostic React context providers that can be used by third-party systems without console dependencies.

## Installation

```bash
pnpm add @object-ui/providers
```

## Providers

Every example below compiles against this package's built types. The values your
own app supplies are written as `declare const` stand-ins so each block stands
alone, and each stand-in is typed from the prop it is passed to — so the bound
the example teaches is the bound the package actually declares.

### DataSourceProvider

Generic data source context that decouples ObjectUI from ObjectStack.

```tsx
import type { ReactNode } from 'react';
import { DataSourceProvider, type DataSourceProviderProps } from '@object-ui/providers';

// `DataSourceProviderProps['dataSource']` is declared `any` today, so this
// stand-in inherits `any`: the compiler checks nothing about the adapter's
// shape here (objectui#8160, objectui#7912 track that laundering).
declare const myCustomDataSource: DataSourceProviderProps['dataSource'];
declare const App: () => ReactNode;

<DataSourceProvider dataSource={myCustomDataSource}>
  <App />
</DataSourceProvider>
```

### MetadataProvider

Schema/metadata management for objects, fields, and views.

```tsx
import type { ReactNode } from 'react';
import { MetadataProvider, type MetadataProviderProps } from '@object-ui/providers';

// `MetadataProviderProps['metadata']` is declared `any` today — same bound as
// `dataSource` above, so nothing about this object's shape is checked here.
declare const myMetadata: MetadataProviderProps['metadata'];
declare const App: () => ReactNode;

<MetadataProvider metadata={myMetadata}>
  <App />
</MetadataProvider>
```

### ThemeProvider

Theme management with system theme detection.

`defaultTheme` takes a `ThemePreference` (`auto | light | dark | system`); both
props are optional.

```tsx
import type { ReactNode } from 'react';
import { ThemeProvider } from '@object-ui/providers';

declare const App: () => ReactNode;

<ThemeProvider defaultTheme="system" storageKey="my-app-theme">
  <App />
</ThemeProvider>
```

## Usage Example

`DataSourceProvider` and `MetadataProvider` both declare `children` as required,
so each one needs a real element inside it — a placeholder comment is not a
child.

```tsx
import type { ReactNode } from 'react';
import {
  DataSourceProvider,
  MetadataProvider,
  ThemeProvider,
  type DataSourceProviderProps,
  type MetadataProviderProps,
} from '@object-ui/providers';

declare const myDataSource: DataSourceProviderProps['dataSource'];
declare const myMetadata: MetadataProviderProps['metadata'];
// Your own component tree goes here.
declare const AppContent: () => ReactNode;

function App() {
  return (
    <ThemeProvider>
      <DataSourceProvider dataSource={myDataSource}>
        <MetadataProvider metadata={myMetadata}>
          <AppContent />
        </MetadataProvider>
      </DataSourceProvider>
    </ThemeProvider>
  );
}
```

## Links

- 📦 [npm package](https://www.npmjs.com/package/@object-ui/providers)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
