// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Public entrypoint for `@objectstack/service-settings`.
 * See ADR-0007 and `README.md`.
 */

export { SettingsService } from './settings-service.js';
export {
  type CryptoAdapter,
  NoopCryptoAdapter,
  // #8026 — the predicate the write path asks before it agrees to hold a
  // declared-secret value. Published with the interface it reads: an adapter
  // author needs to be able to check their own `confidential` declaration the
  // same way the service does, rather than re-deriving the two-arm rule.
  providesConfidentiality,
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
  type SettingsDiagnosticsLogger,
  type SettingsEngine,
  type SettingsRow,
  type SettingsServiceOptions,
  envKeyOf,
  // #8026 — thrown when a declared-encrypted write has nothing able to encrypt
  // it. Exported so an in-process caller can branch on the refusal (there is no
  // dedicated wire code for it yet; see the class doc).
  SettingsCryptoUnavailableError,
  SettingsLockedError,
  SettingsValidationError,
  UnknownKeyError,
  UnknownNamespaceError,
} from './settings-service.types.js';
export {
  evaluateVisibility,
  referencedKeys,
  // #7169 — the `${…}` / envelope unwrapper. Published alongside the evaluator
  // because a caller that now REFUSES an unparseable predicate has to be able
  // to quote the source it refused, and re-deriving the unwrap in the consumer
  // is how the two spellings drift apart.
  visibilitySource,
  VisibilityParseError,
} from './visibility-eval.js';
export {
  SettingsServicePlugin,
  type SettingsServicePluginOptions,
} from './settings-service-plugin.js';
export {
  registerSettingsRoutes,
  type SettingsRoutesOptions,
} from './settings-routes.js';
// #7522 — the REST read mask for encrypted settings, plus the two halves of the
// boundary it defines. Published because a client has to be able to RECOGNISE a
// masked read: the console renders "configured" from it and echoes it back
// unchanged on save, and comparing against a string hard-coded in the console is
// exactly the drift this export prevents. The SERVICE layer is unaffected — it
// still hands real plaintext to in-process consumers; see the module header.
export {
  SETTINGS_SECRET_MASK,
  redactSecretValues,
  dropEchoedSecretMasks,
} from './settings-secret-redaction.js';
// #8103 — REPORT-ONLY classification of `sys_secret` rows against the settings
// subsystem's references. Published because the operator-facing vehicle for it
// (admin command / opt-in script) is still an open maintainer decision and will
// live outside this package; the classifier is the part that is safe to settle
// now. ⛔ Contains no deletion and must not grow one — and note the verdict
// vocabulary's third value: `sys_secret` has three producers, so "unreferenced
// by `sys_setting`" is NOT "unreferenced". See the module header.
export {
  classifySysSecretRows,
  collectEncryptedSpecifierRefs,
  isSecretHandle,
  SECRET_HANDLE_PREFIX,
  type ClassifiedSecretRow,
  type EncryptedSpecifierRef,
  type SecretRowSnapshot,
  type SecretRowVerdict,
  type SettingRowSnapshot,
  type SysSecretOrphanReport,
} from './sys-secret-orphan-report.js';
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
  smsSettingsManifest,
  smsTestActionHandler,
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
