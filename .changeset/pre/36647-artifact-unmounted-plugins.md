---
'@objectstack/runtime': patch
---

fix(runtime): an artifact boot names every code plugin of the app that it does not run

Clause-②: no
Metadata-protocol: none

A compiled artifact carries an app's metadata and hook handlers, not its code plugins: `os build` writes each entry of the stack's `plugins` as a plain descriptor (`{ name, version, dependencies, options }`), and the runtime module beside the JSON exports `functions` only. So a boot from the artifact (`OS_ARTIFACT_URL`, the composed hosted boot, `os start` on a built app) runs none of them. That is the envelope-key rule: an artifact carries metadata, a host assembles plugins. It used to happen in silence, and every service those plugins register was simply absent, so whatever depended on them failed later and somewhere else.

The artifact boot now says so once, at `warn`, when the app's `AppPlugin` starts: `[AppPlugin] app 'APP_ID' lists N plugin(s) that are not running on this kernel: 'PLUGIN_NAME', …`, with the remedy (boot the app from its `objectstack.config.ts`, or from a host config that loads the artifact and lists the plugins in its own `plugins`, or package them with `os plugin build` and `os plugin install`). The structured fields are `{ appId, plugins }`. Each listed plugin is judged by name against the kernel's own plugin table, so a host that assembles the app's plugins itself hears nothing about the ones it runs. A package-specifier string entry is not judged: the name its plugin registers under is not in the specifier.

Only the artifact door judges: the `AppPlugin` that `createStandaloneStack` builds over the artifact it loaded (the one composed with `securityMetadataRegistrar: 'artifact-door'`). A config boot's `AppPlugin` does not, because its host materializes the stack's `plugins` itself. No option, export or artifact field is added, and nothing else changes: no plugin is mounted, refused or reordered, and the boot does not fail.
