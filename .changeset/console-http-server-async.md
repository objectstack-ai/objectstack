---
'@objectstack/cli': patch
---

fix(cli): resolve `http.server` asynchronously in the console / runtime-assets static plugins

`createConsoleStaticPlugin` and `createRuntimeAssetsPlugin` fetched the
`http.server` service with the **synchronous** `ctx.getService('http.server')`.
When `http.server` is registered as an async factory (the console /
schema-migration boot path), that accessor throws
`Service 'http.server' is async - use await`; because the call sat outside
any try/catch, the throw escaped the plugin's `start()` and rolled back
kernel bootstrap — crashing the CONSOLE/migration boot
(`Plugin startup failed: com.objectstack.runtime-assets`). The runtime
`serve` path, where `http.server` is registered synchronously, was
unaffected, which is why only the control-plane migration boot broke.

Resolve both plugins' `http.server` through a shared `resolveHttpServer`
helper that prefers the async accessor (`getServiceAsync`, which resolves a
sync- or async-registered service) and falls back to the sync one, mirroring
plugin-auth's async `cache` lookup. The helper never throws, so these
optional static-asset plugins skip cleanly when no HTTP server is present
instead of taking down boot.
