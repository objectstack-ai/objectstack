/**
 * @object-ui/providers
 *
 * Reusable context providers for ObjectUI applications
 */

// `DataSourceProvider` / `useDataSource`, `MetadataProvider` / `useMetadata`
// and `ThemeProvider` / `useTheme` retired in objectui#13453: they duplicated
// names `@object-ui/react` and `@object-ui/app-shell` publish with different
// implementations, and nothing in the repo but one example read them.
export {
  UploadProvider,
  useUpload,
  createObjectUrlAdapter,
  createS3Adapter,
  createAzureBlobAdapter,
  createObjectStackUploadAdapter,
} from './UploadProvider.js';

export type {
  UploadAdapter,
  UploadOptions,
  UploadResult,
  UploadProviderProps,
  S3AdapterOptions,
  AzureBlobAdapterOptions,
  ObjectStackUploadAdapterOptions,
} from './UploadProvider.js';
