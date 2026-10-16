---
'@objectstack/metadata-core': patch
---

fix(metadata-core): the package installs on npm 10 again, and into projects that use vitest 5, because it no longer declares an optional `vitest` peer

Clause-②: no

On npm 10, the npm that Node 22 bundles, `npm install @objectstack/metadata-core` exited 1 with `Cannot read properties of null (reading 'edgesOut')`. So did installing a package that depends on it, such as `@objectstack/objectql`. The cause was this package's optional peer `vitest: ^4.0.0`. It led npm 10 to vitest 4.1.12, whose own peer declarations contradict each other, and npm 10's resolver crashes on that. The same peer also made npm refuse (`ERESOLVE`) to install the package into a project that already uses vitest 5.

The package's main entry never imports `vitest`. Only the test-only `@objectstack/metadata-core/testing` entry does, so the peer is removed. Nothing the package exports changes.

If you import `@objectstack/metadata-core/testing`, list `vitest` in your own `devDependencies`, as that entry's documentation already says. This package runs that suite on vitest 4. In a pnpm workspace with hoisting turned off (`hoist=false`), that entry can no longer find `vitest` from inside a workspace package. Declare the peer back in your `pnpm-workspace.yaml`:

```yaml
packageExtensions:
  '@objectstack/metadata-core':
    peerDependencies:
      vitest: '*'
```

`@objectstack/plugin-auth` still fails the same way on npm 10, because its `better-auth` dependency declares its own optional `vitest` peer. Install it with npm 11, or add `"overrides": { "vitest": "~4.0.0" }` to your project's `package.json`.
