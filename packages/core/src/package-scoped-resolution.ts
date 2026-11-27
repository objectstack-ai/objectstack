// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The one rule for "which package's item does this bare name mean" (ADR-0150 D3), re-exported
 *
 * The rule, its refusal and its vocabulary live in `@objectstack/metadata-core`
 * (`packages/metadata-core/src/package-scoped-resolution.ts`, whose header
 * states the rule and why it is hosted there). They moved there from this file
 * so `@objectstack/lint`, which depends on metadata-core and never on a
 * runtime, judges a skill's `context` by the same rule the runtime resolves it
 * with (#37609).
 *
 * This module re-exports every name under the same spelling, so core's public
 * surface and every `@objectstack/core` caller are unchanged, and each value is
 * the very object metadata-core exports (pinned by
 * `package-scoped-resolution-reexport.test.ts`). ⛔ Never a second copy here:
 * one rule, one home.
 */

export {
  BARE_NAME_ONE_HOLDER_TYPES,
  ENGINE_FUNCTION_TYPE,
  NAMESPACE_SCOPED_BARE_NAME_TYPES,
  OVERRIDABLE_BASELINE_PACKAGES,
  PACKAGE_SCOPED_TYPES,
  PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE,
  PackageScopedNameRefusedError,
  RUNTIME_COMPATIBILITY_PACKAGE_ID,
  describeBareNameHolder,
  describePackageScopedHolder,
  isBareNameOneHolderType,
  isNamespaceScopedBareNameType,
  isOverridableBaseline,
  isPackageScopedResolvableType,
  isPackageScopedType,
  isPlatformRequestedBareName,
  packageScopedActionOwnersSentence,
  packageScopedHolderSource,
  packageScopedRefusalMessage,
  resolvePackageScopedHolders,
  type BareNameHolder,
  type BareNameOneHolderType,
  type BareNameRegistryType,
  type PackageResolutionClosureOf,
  type PackageScopedHolder,
  type PackageScopedHolderSource,
  type PackageScopedHoldersQuery,
  type PackageScopedRefusal,
  type PackageScopedRefusalReason,
  type PackageScopedResolution,
  type PackageScopedResolutionStep,
  type PackageScopedResolvableType,
  type PackageScopedType,
} from '@objectstack/metadata-core';
