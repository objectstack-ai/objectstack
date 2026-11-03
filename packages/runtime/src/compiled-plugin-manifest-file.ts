// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The filename of the compiled manifest at an `.osplugin` artifact's root
 * (ADR-0025 §3.2): the ONE spelling. `os plugin build` writes the entry under
 * it, `os plugin publish` / `install` exempt it from the integrity map, and
 * `readCompiledPluginManifest` finds it by it. The CLI imports this constant,
 * so build and the runtime cannot drift onto two names.
 *
 * It lives in a module with no imports, published as its own subpath
 * (`@objectstack/runtime/compiled-plugin-manifest-file`), because the CLI
 * reads it from `utils/osplugin.ts`, which every `os plugin` command loads:
 * the package's root entry costs about a second of load time that
 * `os plugin build` and `os plugin sign` never need. ⛔ Keep this module free
 * of imports, or the subpath stops being cheap.
 */
export const COMPILED_PLUGIN_MANIFEST_FILE = 'objectstack.plugin.json';
