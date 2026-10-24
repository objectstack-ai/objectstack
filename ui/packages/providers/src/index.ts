/**
 * @object-ui/providers
 *
 * Reusable context providers for ObjectUI applications
 */

export { DataSourceProvider, useDataSource } from './DataSourceProvider.js';
export { MetadataProvider, useMetadata } from './MetadataProvider.js';
export { ThemeProvider, useTheme } from './ThemeProvider.js';
export {
  UploadProvider,
  useUpload,
  createObjectUrlAdapter,
  createS3Adapter,
  createAzureBlobAdapter,
  createObjectStackUploadAdapter,
} from './UploadProvider.js';

export type {
  DataSourceProviderProps,
  MetadataProviderProps,
  ThemePreferenceProviderProps,
  ThemePreference,
} from './types.js';

export type {
  UploadAdapter,
  UploadOptions,
  UploadResult,
  UploadProviderProps,
  S3AdapterOptions,
  AzureBlobAdapterOptions,
  ObjectStackUploadAdapterOptions,
} from './UploadProvider.js';
