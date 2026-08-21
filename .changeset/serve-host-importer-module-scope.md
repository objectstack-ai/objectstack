---
"@objectstack/cli": patch
---

`os serve` now resolves **every** app-declarable optional package from the app
being served, not from the CLI, and the ordering hazard that broke it twice is
gone by construction (#10769).

`serve.ts` reaches optional and enterprise packages through `createHostImporter`,
which anchors resolution at the host app. The helper was bound as a `const`
partway down one very long boot method, so it existed only *below* its own
binding — and a load written above that point was **not** a compile error. The
author simply wrote a bare `import()`, which resolves against the CLI's own
realpath and works fine in a dev checkout where everything is hoisted into one
`node_modules`. It breaks only in a real distribution layout, at boot, in
production. That shipped twice:

- **cloud#1013** — the binding sat below the auth block, so the enterprise
  `@objectstack/organizations` load resolved in the framework workspace, never
  found the cloud-private package, and every walled-posture deployment hit the
  ADR-0093 D5 fail-fast and exited 1.
- **#10645** — the binding sat below the cluster block, so on the published EE
  image `OS_CLUSTER_DRIVER=redis` died at boot with `Cannot find package
  '@objectstack/service-cluster'`, and compose's `service_completed_successfully`
  took the whole stack down with it.

Each was fixed by hoisting the binding, which left the class open: the next load
added above the new line reproduces it exactly, and no author has any reason to
know where that line is. `importFromHost` is now a **module-scope function
declaration**, hoisted over the whole module, so "above the definition" is no
longer a state the file can be in — every line of `serve.ts` reaches the same
host-anchored importer, in any order.

Sweeping the file for the class then turned up one live instance:
`@objectstack/service-i18n` was loaded with a bare `import()`. `packages/cli`
does not declare it, so an app that declares its own copy could only be found by
accident of workspace hoisting — green in a dev checkout, absent on a real
install layout. It is now host-anchored like the rest. An app that does not
declare the package still falls back to the CLI's own resolution, so the quiet
"i18n not installed, use the kernel fallback" path is unchanged.

Nothing about what `serve` binds, listens on, advertises, or *accepts* moves:
this changes only where a module resolves **from**. The `#4719` declaration gate
is untouched — a package the app has not declared is still refused rather than
picked up from a hoisted store.

`serve-cluster-host-resolution.test.ts` is widened from the cluster pair to every
app-declarable optional load, classifying mechanically (a package is
app-declarable exactly when `packages/cli`'s own manifest does not declare it) so
a newly added optional package is covered without anyone remembering the test
exists.
