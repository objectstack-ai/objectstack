---
'@objectstack/spec': patch
'@objectstack/cli': patch
'@objectstack/connector-imap': patch
'@objectstack/core': patch
'create-objectstack': patch
'@objectstack/lint': patch
'@objectstack/metadata': patch
'@objectstack/metadata-core': patch
'@objectstack/objectql': patch
'@objectstack/platform-objects': patch
'@objectstack/plugin-auth': patch
'@objectstack/plugin-webhooks': patch
'@objectstack/service-cluster': patch
'@objectstack/service-datasource': patch
'@objectstack/types': patch
---

docs: TypeScript's legacy `node10` module resolution is unsupported for packages with subpath exports

Clause-②: no
Metadata-protocol: none

These fifteen packages declare their entry points only through `exports`, including subpaths such as `@objectstack/spec/kernel`. TypeScript's legacy `node10` resolution (`moduleResolution: "node"`, the default when `module` is `commonjs`) ignores `exports`, so a project configured that way cannot resolve the types of any subpath import, while the root entry still appears to work. Each package's README now says so in one line, and the plugin development guide gains a "Module resolution" paragraph. No `exports` map changes and no `typesVersions` fallback is added.

What to do: set `moduleResolution` to `node16`, `nodenext` or `bundler` in the consuming project's `tsconfig.json`.
