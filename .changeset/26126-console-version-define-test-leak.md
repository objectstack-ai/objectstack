---
'@object-ui/console': patch
---

fix(console): the console's build-identity define no longer leaks into the other ui test projects

Clause-②: no (build/test configuration only; no exported type or runtime contract change; the console production build keeps its version stamp)
Metadata-protocol: none

The console's Vite config bakes `import.meta.env.VITE_APP_VERSION` (the build's version, else the git short sha) as a `define`. The console's vitest project merges that config, and vitest moves every `import.meta.env.*` / `process.env.*` define into the main process's `process.env` while it resolves a project's config, so every other ui test project's workers inherited the console's git sha. App-shell's `getConsoleBuild()` then read that sha instead of `null`, and `buildIdentity-12970`'s "reads null" case went red in full ui runs. The console's vitest config now drops those keys from the merged Vite config. `vite build` still bakes the version exactly as before.
