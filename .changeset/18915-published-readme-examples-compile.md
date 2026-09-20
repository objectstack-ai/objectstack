---
"@objectstack/cli": patch
"@objectstack/client": patch
"@objectstack/client-react": patch
"@objectstack/driver-memory": patch
"@objectstack/driver-mongodb": patch
"@objectstack/driver-turso": patch
"@objectstack/mcp": patch
"@objectstack/observability": patch
"@objectstack/plugin-auth": patch
"@objectstack/rest": patch
"@objectstack/runtime": patch
"@objectstack/service-cache": patch
"@objectstack/service-i18n": patch
"@objectstack/service-job": patch
"@objectstack/service-package": patch
"@objectstack/service-queue": patch
"@objectstack/service-realtime": patch
"@objectstack/service-storage": patch
"@objectstack/spec": patch
"@objectstack/types": patch
---

The TypeScript examples in these packages' **published** `README.md` now compile against the package they document — 43 of the 44 blocks the `measure-markdown-ts-blocks` census reported as syntactically valid and wrong, in documents that ship inside the npm tarball.

`README.md` is listed in every one of these packages' `files[]`, so these bytes are the artefact a consumer — or a consumer's AI — reads and copies. What the census counted was not style: the examples named options the packages no longer accept, chained a method that returns a promise, and implemented interfaces they never imported.

The corrections, by class:

- **Legacy option vocabulary.** `@objectstack/client-react`'s hooks take `fields` / `orderBy` / `limit` / `where`, not `select` / `sort` / `top` / `filters`, and `PaginatedResult` carries `records`, not `value`. `@objectstack/service-job` takes `timeoutMs`, `@objectstack/service-queue` takes `maxAttempts`, and `IDataEngine.find` takes `where`.
- **Async registration used synchronously.** `ObjectKernel.use()` returns `Promise<this>`, so `kernel.use(a).use(b)` does not chain; the examples now `await` each registration. `ObjectKernelConfig` has no `plugins` member.
- **Interfaces implemented but never imported.** Several plugin examples wrote `implements Plugin` with no import, which bound to the DOM's `Plugin`; they now import `Plugin` / `PluginContext` and declare the required `init`. `PluginContext.getService<T>()` has no default type argument, so the examples that read a service now name its contract.
- **Removed or never-existing API.** `@objectstack/driver-memory`'s default export is a legacy `onEnable` object that `kernel.use()` refuses — the quick start now registers through `DriverPlugin`; its persistence adapters take an options bag under `persistence.adapter`. `defineStack` has no `driver` key. `@objectstack/rest`'s `RestServer` takes the host `IHttpServer` first and `registerRoutes()` takes no arguments; `RouteManager` is constructed on a server. `@objectstack/spec`'s `ObjectSchema.parse()` returns the value — the `{ success, data }` envelope is `safeParse`'s. `useMutation` has no `onMutate` / mutation context.

No runtime code changed and no gate was added (#18715 ruling F). One block is deliberately left: `@objectstack/knowledge-ragflow`'s README writes `source.options.datasetId`, which is what the shipped adapter reads and what `KnowledgeSourceSchema` does not declare — correcting the document either way would contradict one of the two, so the conflict is reported rather than papered over.
