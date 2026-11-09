---
'@objectstack/cli': patch
---

fix(cli): `os build` leaves `devPlugins` out of the artifact, and `os validate --target` no longer reads it as code

Clause-②: yes (widening) — two accept-sets widen: `os validate --target` with `allowCode: false` now accepts a stack that declares `devPlugins`, and an unmanaged install (`os package install --install-mode unmanaged`, and the cloud-connection local installs) of a freshly built artifact of such a stack is no longer refused, because that artifact no longer carries the key. Leaving the key out of `objectstack.json` refuses nothing (every stack that built before still builds, and the published stack schema still accepts an artifact that carries it).
Metadata-protocol: none

`devPlugins` is the list a development boot (`os dev`, `os serve --dev`) adds to the plugins it loads, read off the config it loads. Nothing that boots or installs the artifact loads it, yet `os build` wrote it into `objectstack.json`, so `os package publish` and `os deploy` (which send that file) carried a development-only load list to the target. `os build` now drops it at the one place the artifact is written, as it already dropped `demoStaff`.

Because the key no longer reaches a target, a target environment's restriction profile has nothing to refuse: `os validate --target` with `allowCode: false` no longer reports a row per dev-only plugin. `plugins`, `functions`, `hooks` and the other code keys are judged as before, and `os dev` / `os serve --dev` still load `devPlugins` from the config.

The same goes for an unmanaged install: a freshly built artifact of a stack with `devPlugins` now installs unmanaged, where it was refused as carrying code. A bundle that still carries the key, such as an artifact built before this release, is still refused as code by an unmanaged install: the spec's classification of `devPlugins` is unchanged.
