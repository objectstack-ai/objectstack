---
'@objectstack/runtime': patch
---

A hook's `timeout` authored by 17.x tooling bounds the hook again, and the three retired translation keys are no longer served, when the bundle reaches `AppPlugin` raw

Clause-②: no

Protocol 18 renames a hook's `timeout` to `timeoutMs`, and retires three translation keys: a per-app `settings` group, a page component's `submitLabel` and a dashboard widget's `subCaption`. An artifact built earlier still carries the old spellings, and the boot's ADR-0087 forward conversion rewrites them. `AppPlugin` bound its hooks and loaded its translation bundles from the RAW bundle, though. So the engine's hook wrapper found no `timeoutMs` and ran the hook with no time limit and no notice, and the i18n service served all three retired keys; the per-app `settings` group still filled the gaps in the platform's own settings copy.

`loadArtifactBundle` converts at load, so an artifact booted with `os start --artifact` or `os dev -a` already arrived converted. A bundle in a host config's `plugins[]` array does not go through it: `os serve` and `os migrate` wrap it into `new AppPlugin(bundle)` as authored. Measured through that route on a bundle that declares no `engines.protocol`: the hook reached the engine as `{ timeout: 5000 }` and never timed out, and `getTranslations('zh-CN')` served all three retired keys.

The hook binder and `loadTranslations` now read the boot's one forward conversion, the copy every other `AppPlugin` registrar takes. Which lists are read (the stack's own, a legacy `manifest.hooks` or `manifest.translations` list) is decided as before, and a list the conversion lifted from the manifest is read once, converted. A bundle authored in the current spellings is read exactly as before: a conversion that changes nothing returns its input, so the binder and the i18n service are handed the authored hooks and bundles themselves.
