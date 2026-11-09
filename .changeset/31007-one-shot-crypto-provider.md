---
'@objectstack/cli': patch
---

fix(cli): one-shot secret commands seal and open with the crypto provider `os serve` uses

Clause-②: no
Metadata-protocol: none

`os secret rewrap`, `os secret orphans` and the data migrations that compose the settings service (`os migrate files-to-references`, `os storage orphans`, `os migrate recompute-home-amounts`) used to build their own `LocalCryptoProvider`. On a deployment whose plugin registers a KMS- or Vault-backed provider as the `crypto-provider` service, they could open nothing `os serve` sealed, and a re-wrap could have re-sealed under the local key.

They now choose the provider with `os serve`'s own function. They read the host config's `plugins`, as `os serve` does without `--dev`:

- One plugin declares `providesServices: ['crypto-provider']`: the run boots it and seals and opens with the provider it registers.
- Two plugins declare it: the run refuses before either initializes, and names both.
- No plugin declares it: nothing changes. The run uses the local provider over the key that already exists, and never mints one.

The run fails closed and never falls back to the local key for a deployment that declares a provider. It refuses, names the provider, and writes nothing when:

- the declared plugin cannot boot in the run;
- the declared plugin boots but registers no provider;
- the host config, or one of its `plugins` entries, cannot be loaded.

`os secret rewrap` names the provider as the report's key source.
