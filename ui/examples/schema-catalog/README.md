# @object-ui/example-schema-catalog

Canonical JSON schema catalog for ObjectUI. **Private** (not published to npm).

> Naming note: this package lives under `examples/` (alongside the runnable
> example apps), but it is **not** itself a runnable app — it is a data
> package + smoke tests. The runnable apps are `examples/hello-world`,
> `examples/console-starter`, etc.

This package is the **single source of truth** for every schema example we ship.
It is consumed by:

- 📚 The docs site (`apps/site`) — via the `<SchemaExample id="..." />` MDX component
- 🧪 Smoke tests — every entry is mounted with `SchemaRenderer` and asserted not to throw
- 🤖 AI agents (RAG / few-shot) — structured, machine-readable schema corpus

## Why a dedicated package?

Previously, schema examples were duplicated across:

- `content/docs/**/*.mdx` (inline JSX object literals — easy to corrupt, no validation)
- `apps/console/src/schemas/*.ts` (real app usage)

They drifted, no one validated them, and the docs versions were a maintenance nightmare
(500+ line MDX files with broken indentation, no type safety).

This package consolidates the **docs** examples into versioned, type-checked JSON.

## Structure

```
src/
  schemas/
    auth/
      login-simple.json
      signup.json
      forgot-password.json
      two-factor.json
    dashboard/
    forms/
    ...
  catalog-meta.json  # Hand-curated title / description / tags, by entry id
  index.ts           # GENERATED registry: id -> { schema, meta }
  types.ts           # ExampleMeta type
test/
  smoke.test.tsx  # Renders every example with SchemaRenderer
```

`src/index.ts` is **generated** — a pure function of the schema files and
`src/catalog-meta.json`. Never edit it by hand: the next person to regenerate
discards whatever you typed there (objectui#4633, where that is exactly what
happened to ten entries' curated strings).

## Adding an example

1. Drop a `.json` file under `src/schemas/<category>/<slug>.json`
2. Give it a real title and description in `src/catalog-meta.json`, keyed by
   `<category>/<slug>`. Optional — an entry with no curated metadata gets a
   title derived from its slug and an empty description — but the title and
   description are user-visible on `/docs/guide/schema-catalog`, so write them.
3. Regenerate the registry:

   ```bash
   pnpm --filter @object-ui/example-schema-catalog regenerate
   ```

   Safe to run on an untouched tree: it produces no diff unless you changed an
   input. The `regenerate:check` script verifies without writing, and CI runs
   it (`scripts/__tests__/catalog-index-regenerable-4633.test.ts`).

4. Reference it from MDX:

   ```mdx
   <SchemaExample id="auth/login-simple" />
   ```

5. The smoke test picks it up automatically — no per-example test needed.

## Consuming from code

```ts
import { getExample, allExamples } from '@object-ui/example-schema-catalog';

const example = getExample('auth/login-simple');
// { id, meta, schema }

for (const ex of allExamples()) {
  console.log(ex.id, ex.meta.title);
}
```
