---
'@objectstack/cli': patch
---

fix(cli): `os dev` on a host config serves one copy of the stack — the compiled artifact its staleness warning describes

Clause-②: no
Metadata-protocol: none

A host config is one whose `plugins` list holds plugin instances; the blank scaffold is one, because it ships the REST, OpenAPI and MCP connector plugins. Under `os dev`, such a config used to be served from two copies at once: the compiled `dist/objectstack.json`, read by the dev artifact reloader, and the config module itself, registered over it. With `--no-compile` over an artifact older than your sources, views and public forms (`GET /api/v1/forms/SLUG`) answered the edited source while objects answered the old build, and the "this boot serves the STALE build" warning matched neither.

The app is now registered from the same artifact file the reloader reads, which is how a config without plugin instances already boots. The config module still contributes `onEnable` and `functions`, the members a JSON artifact cannot carry. What changes on `os dev` over a host config:

- With `--no-compile` and an older artifact, the boot serves the artifact for every metadata type, as the warning says. Run `objectstack build` or drop `--no-compile` to serve your edits.
- With the default compile, the same items are served. Three of them now appear in the compiled form other boots already served: a hook declared with a function shows its compiled `handler` name and `body`; a connector whose `providerConfig.spec` names a file shows the document the build inlined; and the app's package record lists its plugins and runtime module as the build recorded them. Hooks, `onEnable` and action handlers run as before.
- The ready banner's app row reads `Artifact: dist/objectstack.json` instead of `Config: objectstack.config.ts`, because that is where the metadata came from.

Not changed: `os serve` and `os start` on a host config still serve the config module (no dev artifact reloader composes there), a config without plugin instances still boots from the artifact, and an artifact-only boot is untouched. If the artifact cannot be read, the boot falls back to the config module, as before. The staleness warning text is unchanged.
