# @object-ui/providers

**Reusable Context Providers for ObjectUI**

React context providers for ObjectUI applications that third-party systems can use without console dependencies — today, the upload adapter context.

## Installation

```bash
pnpm add @object-ui/providers
```

## Providers

Every example below compiles against this package's built types. The values your
own app supplies are written as `declare const` stand-ins so each block stands
alone.

### UploadProvider

The ambient upload adapter the `@object-ui/fields` file, image and avatar widgets
upload through (`useUpload()` reads it). Without a provider they fall back to
`createObjectUrlAdapter()`, which persists nothing and is a no-crash default, not
an upload destination.

```tsx
import type { ReactNode } from 'react';
import { UploadProvider, createObjectStackUploadAdapter } from '@object-ui/providers';

declare const App: () => ReactNode;

const adapter = createObjectStackUploadAdapter({ baseUrl: 'https://api.example.com' });

<UploadProvider adapter={adapter}>
  <App />
</UploadProvider>
```

`createS3Adapter` and `createAzureBlobAdapter` build adapters for presigned
S3 and Azure Blob uploads; any object with a `name` and an `upload(file, opts)`
method is an `UploadAdapter`.

## Retired providers

`DataSourceProvider` / `useDataSource`, `MetadataProvider` / `useMetadata` and
`ThemeProvider` / `useTheme` are no longer exported from this package. Use the
ones the rest of ObjectUI reads instead:

- the data source: `SchemaRendererProvider` (its `dataSource` prop) from
  `@object-ui/react`;
- metadata: `MetadataProvider` / `useMetadata` from `@object-ui/app-shell`;
- theme: `ThemeProvider` / `useTheme` from `@object-ui/react` (`defaultMode`
  takes `auto | light | dark`; the old `system` spelling is `auto`).

## Links

- 📦 [npm package](https://www.npmjs.com/package/@object-ui/providers)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
