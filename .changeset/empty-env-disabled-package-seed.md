---
"@objectstack/runtime": patch
---

fix(runtime): disabled packages no longer come back enabled after an empty-env restart (#5047)

An operator who disables a package has that decision persisted to
`<OS_HOME>/package-state/<environmentId>.json`, and boot replays it by seeding
the registry's initial-disabled set **before** any package is registered — so
every registration path (boot-artifact decomposition, `sys_packages`
rehydration, HTTP install) installs those packages disabled.

That seed ran inside `AppPlugin.init` **after** the empty-env early return. An
empty environment is one whose artifact carries no app payload — which is
exactly the environment where every package arrives later, from
`PackageServicePlugin`'s Phase 2 replay of `sys_packages` or from an HTTP
install. So on precisely those DB-driven environments the initial-disabled set
stayed empty, and a package the administrator had disabled came back **enabled**
on every restart, with no error anywhere: the disable had persisted correctly,
it was simply never read.

The seed now runs before that return, alongside the default hook/action body
runners and the authored-translation sync, which are before it for the same
reason. Non-empty environments are unaffected — the seed still lands before the
manifest is decomposed — and the seed remains best-effort, degrading silently on
kernels with no engine.
