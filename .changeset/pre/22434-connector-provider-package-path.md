---
"@objectstack/spec": minor
"@objectstack/service-automation": minor
---

feat(spec): `ConnectorProviderContext.resolvePackagePath` — a connector provider factory can resolve a path against the declaring app's root

Clause-②: yes (widening)

- **What is new.** `ConnectorProviderContext` gains one optional, host-provided member, `resolvePackagePath(relativePath): Promise<string>`, beside `loadPackageFile`. It resolves a relative path against the root of the stack or package that declared the connector entry and returns the absolute path. `'.'` returns the root itself. It refuses (throws on) an empty path, an absolute path, and a path that escapes the root after resolution, such as `../x` or `a/../../x`. That is the same rule `loadPackageFile` follows. It reads nothing and does not check that the path exists.
- **Who hands it.** The connector materializer in `@objectstack/service-automation` hands it to every provider factory. It is anchored at the plugin's `packageRoot` option, the same root `loadPackageFile` reads under, and falls back to `process.cwd()` the same way. The two members now share one confinement check, so they cannot disagree about what is inside the root. `loadPackageFile`'s behaviour and error messages are unchanged.
- **Who reads it.** Nothing yet. `@objectstack/connector-mcp` is next: a declarative stdio transport will use it as the launched process's working directory, so a relative command or argument resolves against the app's root instead of the directory the server was started from.
- **What does not change.** Which commands a declarative stdio transport may launch is untouched. A factory that does not read the member behaves as before.
- **Nothing to migrate.** A host that builds its own `ConnectorProviderContext` may leave the member out. A factory must then keep its existing behaviour, or fail with a clear message if it needs the root.
