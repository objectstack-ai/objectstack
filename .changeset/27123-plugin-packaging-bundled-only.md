---
'@objectstack/spec': minor
'@objectstack/cli': patch
---

feat(spec, cli)!: `bundled` is the one plugin packaging strategy — `manifest-deps` is retired, and `os plugin build` refuses a native addon (#27123)

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered manifest-packaging-manifest-deps-removed, manifest-packaging-manifest-deps-retired -->

ADR-0025 v2 §3.3 makes `bundled` the only dependency-packaging strategy. `manifest-deps` kept every dependency external and packed `package.json` and the lockfile beside the bundle, but nothing ever installed them, so a plugin built with it could not load them. A compiled `.node` addon can be neither bundled nor run by every host, so a plugin may not carry one.

- **`@objectstack/spec`**: `PluginPackagingSchema` is `['bundled']`. `manifest-deps` is a retired value: every door that parses a manifest refuses it at `packaging` with the prescription — `ManifestSchema` (an `objectstack.plugin.json` at `os plugin build`, a stack's `manifest` at `defineStack`, the ObjectQL registry), a packaged artifact's `packages[].manifest`, and the `POST /packages` install body — and TypeScript no longer admits it. The ADR-0087 D2 conversion `manifest-packaging-manifest-deps-removed` deletes the value from a stack's `manifest` and from each `packages[].manifest` (`os migrate meta --from 17`), and the D3 entry `manifest-packaging-manifest-deps-retired` carries the change to the upgrade guide. The `packaging` liveness row is `planned`: a one-member enum has no fork left to read.
- **`@objectstack/cli`**: `os plugin build` packs one strategy. It inlines every dependency except the host-provided `@objectstack/*` packages and no longer packs `package.json` or `pnpm-lock.yaml`. It refuses a native addon before it writes anything, naming each one it finds: a `.node` file the bundle imports (with its importer), a bundled package that declares a node-gyp build or ships a `.node` binary, and a `.node` file under `assets/`. An addon loaded at run time from an absolute or computed path outside every bundled package is not visible to the build.

**BREAKING** for a plugin manifest that writes `packaging: 'manifest-deps'`, and for a plugin that carries a native addon.

- **Before.** `packaging: 'manifest-deps'` built an artifact that left the dependencies out and carried `package.json` for an install step that never ran. A plugin importing a `.node` file failed in esbuild with a bare "Bundle failed"; one whose dependency located its binary at run time, or that kept a `.node` file under `assets/`, built an artifact that could not load it on a host without that binary.
- **Now.** `manifest-deps` is refused at the manifest (`objectstack.plugin.json is invalid:` names `packaging`, exit 1, no artifact). A native addon is refused by name (`Native addon refused: …`, exit 1, no artifact).
- **Fix.** Delete the `packaging` key, or write `bundled`. A stack source gets the edit from `os migrate meta --from 17` (`--write` applies it); an `objectstack.plugin.json` is edited by hand. Replace a native addon with a pure-JavaScript or WebAssembly alternative.
