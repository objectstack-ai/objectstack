// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The host's secret crypto provider, supplied by a plugin
 *
 * Every `sys_secret` row a host writes is sealed by ONE `ICryptoProvider`
 * (`@objectstack/spec/contracts`): an object's `secret` fields (the data
 * engine), a datasource's credentials (the datasource secret binder) and the
 * encrypted settings (`SettingsServicePlugin`). One provider means one key
 * custody, so every secret opens under the provider that sealed it.
 *
 * `os serve` builds that provider itself — `LocalCryptoProvider`, keyed off
 * `OS_SECRET_KEY` or a persisted key file — unless a plugin supplies one. A
 * plugin supplies one (a KMS- or Vault-backed provider, for customer-managed
 * keys) by registering it as the kernel service
 * {@link CRYPTO_PROVIDER_SERVICE}:
 *
 * - register it with `ctx.registerService` in the plugin's `init()`, never
 *   later: the host chooses once every `init()` has run, and a provider
 *   registered after that refuses the boot rather than being used for some
 *   secrets and not others;
 * - declare it in the plugin's `providesServices`, so a composition that holds
 *   two such plugins refuses at boot naming both (ADR-0116's declaration
 *   vocabulary). An undeclared second registration is refused by the kernel
 *   itself, without the names;
 * - register exactly one: the provider holds every secret's key, so two
 *   registrations refuse the boot rather than letting either one win.
 *
 * No registration leaves the host on `LocalCryptoProvider`, exactly as before
 * the seam existed, its production refusal for an unstable key included.
 *
 * ⛔ A provider's key material never appears in a log line, an error or a
 * refusal: the host's refusals name the service and the plugins, never the
 * registered value.
 */

/** The kernel service name a plugin registers the host's secret crypto provider under. */
export const CRYPTO_PROVIDER_SERVICE = 'crypto-provider';
