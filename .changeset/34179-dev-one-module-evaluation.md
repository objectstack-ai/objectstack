---
'@objectstack/cli': patch
---

fix(cli): an app's `onEnable` and its job, hook and action handlers run from one evaluation of its config module

Clause-②: no
Metadata-protocol: none (boot composition; no authorable key changes; the dev confirms against the diff)

A boot that serves the compiled artifact took the handlers from the artifact's runtime module (`dist/objectstack-runtime.*.mjs`). That module is a bundle of the same config source, so it is a second evaluation of it. `onEnable` came from the config module the boot had loaded. State that `onEnable` sets at module scope, such as a data engine a job reads, was therefore missing when the handler ran. Under `os dev` on a host config, a job that read it failed on every run with "no data engine", while `os start` served the same project.

Every handler the runtime module supplies now runs from the config module this boot loaded, the same module as `onEnable`. Handlers are matched by the ref the build gave them. Metadata still comes from the artifact. If the artifact names a handler that the config no longer has (for example `os dev --no-compile` over an older build), that handler still runs from the runtime module. The boot warns once and names it.
