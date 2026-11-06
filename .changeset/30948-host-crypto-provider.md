---
'@objectstack/cli': patch
'@objectstack/types': patch
---

feat(cli): `os serve` seals secrets with the crypto provider a plugin registers, so a KMS- or Vault-backed provider can hold the keys

Clause-②: yes (widening)
Metadata-protocol: none

A plugin supplies the host's secret crypto provider by registering an `ICryptoProvider` as the kernel service `crypto-provider` — `CRYPTO_PROVIDER_SERVICE`, new in `@objectstack/types` — with `ctx.registerService` in its `init()`, and declaring it in `providesServices`. `os serve` then hands that one provider to everything that seals a `sys_secret` row: the data engine (secret fields), the datasource secret binder (datasource credentials) and the default settings service (encrypted settings). Before, `os serve` built `LocalCryptoProvider` itself after every plugin hook and overwrote whatever a plugin had set.

Without a registration nothing changes: the host keeps `LocalCryptoProvider`, keyed off `OS_SECRET_KEY` or the persisted key file exactly as before, and a production boot without a stable key still refuses at `kernel:ready` with the same message. The one difference is that the default settings service now shares that local provider instead of building a second one from the same key source; what either sealed, the other opens.

The provider holds every secret's key, so the boot refuses rather than guess:

- two plugins that both declare `providesServices: ['crypto-provider']` refuse before either initializes, both named (an undeclared second `registerService` is refused by the kernel, naming the service);
- a provider registered after plugin init, or the registered one replaced, refuses once the boot is up;
- a value registered under the name that is not an `ICryptoProvider` refuses, naming the missing methods;
- a secret sealed or opened while plugins are still initializing is refused, never sealed by a provider the boot has not chosen yet.

No refusal prints a registered value.
