// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Backward-compatibility shim. The provider was renamed to
 * `LocalCryptoProvider` (see ./local-crypto-provider.ts) because the old
 * `InMemoryCryptoProvider` name implied an ephemeral key when it actually
 * persists one (env var or on-disk file). This module re-exports the new
 * implementation so existing deep imports keep working.
 *
 * @deprecated Import from './local-crypto-provider.js' instead.
 */
export {
  LocalCryptoProvider,
  InMemoryCryptoProvider,
  type LocalCryptoProviderOptions,
  type InMemoryCryptoProviderOptions,
  type CryptoMode,
  type KeySource,
} from './local-crypto-provider.js';
