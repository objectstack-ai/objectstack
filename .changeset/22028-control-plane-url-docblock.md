---
"@objectstack/cloud-connection": patch
---

`RuntimeConfigPluginConfig.controlPlaneUrl`'s published docblock no longer says that an empty string declares "this runtime IS the cloud". It now says what the constructor does: `''` keeps marketplace and install requests on this origin, and that is all it says.

Clause-②: no

- The runtime that passes `''` may serve the catalog itself or proxy a control plane it does not name. The CLI's cloud-connected `os serve` passes `''` while its marketplace proxy forwards to the control plane `resolveCloudUrl()` answers. So `''` reads neither as "this runtime is the cloud" nor as "there is no upstream". This matches the `AppShellRuntimeConfig.cloudUrl` doc in `@object-ui/app-shell`.
- A runtime with no control plane says so with a decline spelling (`'off'` / `'none'` / `'local'` / `'disabled'`), in `controlPlaneUrl` or in `OS_CLOUD_URL`. The docblock now says this too.
- ⛔ No code, type, export or default change. The served `cloudUrl` and the telemetry posture do not change.
