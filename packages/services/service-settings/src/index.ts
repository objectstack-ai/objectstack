// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Public entrypoint for `@objectstack/service-settings`.
 * See ADR-0007 and `README.md`.
 */

export { SettingsService } from './settings-service.js';
export {
  type CryptoAdapter,
  NoopCryptoAdapter,
} from './crypto-adapter.js';
// Default, KMS-free ICryptoProvider. AES-256-GCM keyed off `OS_SECRET_KEY`
// (production) or a persisted dev key; fails loud in production rather than
// silently minting an ephemeral key. Hosts swap in a KMS/Vault provider for
// managed custody. Exported so other subsystems (e.g. the runtime-UI
// datasource secret binder) can reuse the same wrapping. `InMemoryCryptoProvider`
// remains a deprecated alias for backward compatibility.
export {
  LocalCryptoProvider,
  InMemoryCryptoProvider,
  type LocalCryptoProviderOptions,
  type CryptoMode,
  type KeySource,
} from './local-crypto-provider.js';
export {
  type SettingsActionHandler,
  type SettingsAuditSink,
  type SettingsContext,
  type SettingsEngine,
  type SettingsRow,
  type SettingsServiceOptions,
  envKeyOf,
  SettingsLockedError,
  UnknownKeyError,
  UnknownNamespaceError,
} from './settings-service.types.js';
export {
  SettingsServicePlugin,
  type SettingsServicePluginOptions,
} from './settings-service-plugin.js';
export {
  registerSettingsRoutes,
  type SettingsRoutesOptions,
} from './settings-routes.js';
export {
  settingsObjects,
  settingsPluginManifestHeader,
  SETTINGS_PLUGIN_ID,
  SETTINGS_PLUGIN_VERSION,
} from './manifest.js';

// Reference manifests (mail / branding / feature flags) and the
// convenience aggregate. Hosts can pass `builtinSettingsManifests`
// directly to `new SettingsServicePlugin({ manifests })`.
export {
  builtinSettingsManifests,
  brandingSettingsManifest,
  featureFlagsSettingsManifest,
  mailSettingsManifest,
  mailTestActionHandler,
  storageSettingsManifest,
  storageTestActionHandler,
} from './manifests/index.js';

// Re-export the spec types for convenience so plugin authors only need
// one import.
export type {
  SettingsManifest,
  ResolvedSettingValue,
  SettingsNamespacePayload,
  SettingsActionResult,
  SpecifierScope,
} from '@objectstack/spec/system';

// Built-in translations (en / zh-CN / ja-JP) for the reference manifests.
// Hosts merge `settingsBuiltinTranslations` into their i18next resource tree
// so SettingsView resolves labels via `<ns>.settings.<namespace>.…`.
export {
  settingsBuiltinTranslations,
  en as settingsTranslationsEn,
  zhCN as settingsTranslationsZhCN,
  jaJP as settingsTranslationsJaJP,
} from './translations/index.js';
