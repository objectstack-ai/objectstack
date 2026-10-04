---
'@objectstack/cli': patch
---

`os migrate plan` and `os migrate apply` boot a config whose connector plugins depend on a service that only `requires` supplies (#21732). Before this fix, both commands exited 1 on a fresh `create-objectstack -t blank` app and on `examples/app-showcase` with `[Kernel] Dependency 'com.objectstack.service-automation' not found for plugin 'com.objectstack.connector.rest'`.

Clause-②: no

- **Why it failed.** The connectors (`@objectstack/connector-rest`, `-openapi`, `-mcp`, `-slack`) declare a hard dependency on the automation service. The blank template and the showcase ask for automation only through `requires: ['automation', …]`. `os serve` turns that token into the provider, but the schema-migration composition read `config.plugins` and never read `requires`.
- **What it composes now.** It uses the same token lookup `os serve` uses (`Serve.CAPABILITY_PROVIDERS`, with exact identity matching, and an explicit instance in `plugins` still wins). It composes a provider only when a plugin it already composed hard-depends on that provider and the config's `requires` (or the always-on slate) supplies it.
- **Automation is taken inert** (`armRuntime: false`). The engine and node registry come up. No flow is registered, no trigger or job is bound, no connector is materialized and no suspended run is resumed. Its `init()` declares `sys_automation_run`, `sys_flow_dispatch` and `sys_flow_credential`, so the plan now covers the tables `os serve` creates for this capability.
- **A provider with no measured declaration posture is refused by name.** The refusal names the plugin, its dependency and the token, instead of booting that provider's `start()` inside a dry run. A dependency that no token supplies is still refused by the kernel, as `os serve` refuses it.
- A config that lists no plugin with such a dependency composes exactly what it did before.
