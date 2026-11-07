---
'@objectstack/cli': patch
---

fix(cli): `os build` leaves `devPlugins` out of the artifact, and `os validate --target` no longer reads it as code

Clause-②: yes (widening) — `os validate --target` with `allowCode: false` now accepts a stack that declares `devPlugins`; leaving the key out of `objectstack.json` refuses nothing (every stack that built before still builds, and the published stack schema still accepts an artifact that carries it).
Metadata-protocol: none

`devPlugins` is the list a development boot (`os dev`, `os serve --dev`) adds to the plugins it loads, read off the config it loads. Nothing that boots or installs the artifact loads it, yet `os build` wrote it into `objectstack.json`, so `os package publish` and `os deploy` (which send that file) carried a development-only load list to the target. `os build` now drops it at the one place the artifact is written, as it already dropped `demoStaff`.

Because the key no longer reaches a target, a target environment's restriction profile has nothing to refuse: `os validate --target` with `allowCode: false` no longer reports a row per dev-only plugin. `plugins`, `functions`, `hooks` and the other code keys are judged as before, and `os dev` / `os serve --dev` still load `devPlugins` from the config.
