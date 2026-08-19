---
"@objectstack/driver-sql": patch
"@objectstack/mcp": patch
"@objectstack/objectql": patch
"@objectstack/spec": patch
---

docs: four published READMEs stop documenting symbols and call sites that do not exist (#9544)

All four packages ship `README.md` in their `files` array with `private` unset, so these
are the pages npm renders. Each finding was re-measured against the **built `.d.ts`**, not
against source, because that is what a consumer resolves through the `exports` map.

- **`@objectstack/driver-sql`** — `import type { IDriver } from '@objectstack/spec'` named
  a type that exists **nowhere in the repository** (0 hits across every package's `src`
  and `dist`). The real contract is `IDataDriver` on `@objectstack/spec/contracts` — the
  one `SqlDriver` actually declares (`export class SqlDriver implements IDataDriver`). The
  adjacent operation list was corrected too: the method is `create`, not `insert`.

- **`@objectstack/mcp`** — `DriverSql` has never existed (the export is `SqlDriver`), and
  the README then called `DriverSql.configure({...})` on it. Renaming alone would have
  been wrong twice over: `SqlDriver` has **no static `configure` either**, and `driver:`
  is not a key of `defineStack` at all. The example now declares a datasource the way the
  shipped templates do. `MCPServerPlugin.configure({...})` — five call sites — becomes
  `new MCPServerPlugin({...})`, the form the class's own JSDoc and every in-repo caller
  use. The documented options block claimed `serverName`, `autoRegisterTools`,
  `autoExposeObjects`, `enableStreaming`, `port` and `debug`; the real
  `MCPServerPluginOptions` is `name`, `version`, `transport`, `autoStart`, `instructions`,
  and the env switches are named instead.

- **`@objectstack/objectql`** — `registerObject` is an **instance** method, so
  `SchemaRegistry.registerObject(...)` on the class could never run. The example now
  reaches it through the engine's registry and states the real parameter order
  (`schema, packageId, namespace?`).

- **`@objectstack/spec`** — the protocol package's own front page imported
  `MCPServerConfigSchema` from `@objectstack/spec/ai`, which exports `MCPServerRefSchema`.
  A rename by itself would have swapped a broken import for a broken **parse**: the
  documented payload was built for a schema that does not exist, and
  `MCPServerRefSchema.safeParse` rejects it (`transport` is an enum of
  `stdio | http | websocket`, not an object, and `endpoint` is required and was absent).
  The example is now a payload that parses green, and the page says plainly that tools,
  resources and prompts are derived from metadata at runtime rather than authored there.
