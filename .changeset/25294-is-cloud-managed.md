---
'@objectstack/core': patch
'@objectstack/cloud-connection': patch
---

feat(core): `isCloudManaged()` is the one reader of `OS_CLOUD_MANAGED`, and a production boot that sets it without a bound control plane refuses to start

Clause-②: yes (widening)
Metadata-protocol: none

- **New exports of `@objectstack/core`:** `isCloudManaged()`, `resolveControlPlaneApiKey(configured?)` and `resetCloudManagedForTesting()`. `isCloudManaged()` is synchronous and answers `true` when `OS_CLOUD_MANAGED` is exactly `1`, `false` when it is unset or empty; any other value is refused with an error that names it. The answer is memoized for the process; tests that set the variable call `resetCloudManagedForTesting()` before and after.
- **The fuse.** On a production boot (not `--dev`, which sets `NODE_ENV=development` only when `NODE_ENV` is unset, and not `NODE_ENV=test`; so `NODE_ENV=production os serve --dev` counts as a production boot and is refused the same way), `OS_CLOUD_MANAGED=1` with `OS_CLOUD_API_KEY` unset or empty refuses: `ObjectKernel.bootstrap()` and `LiteKernel.bootstrap()` reject before any plugin initialises, and `isCloudManaged()` throws the same error. The cloud sets both variables on the runtimes it hosts. A self-hosted deployment that has `OS_CLOUD_MANAGED=1` in a copied env file now fails to boot; remove the variable, which a self-hosted deployment never needs.
- **One caveat:** the fuse reads the environment only. A runtime that binds its control plane solely through `CloudConnectionPlugin`'s `controlPlaneApiKey` option, and also sets `OS_CLOUD_MANAGED=1` in production, is refused. Set `OS_CLOUD_API_KEY` instead.
- **`@objectstack/cloud-connection`:** the plugin resolves its control-plane credential through `resolveControlPlaneApiKey(controlPlaneApiKey)`, so the plugin's "platform-managed" answer and the fuse share one derivation. Its behaviour is unchanged: the option wins, then `OS_CLOUD_API_KEY`, trimmed.
