---
"@objectstack/spec": patch
---

fix(spec): the reference docs index is keyed by `<category>/<name>`, so a schema is documented on the page of the file that exports it (#4696)

`build-docs.ts` kept two maps — schema name to category, schema name to page —
keyed by the **bare** schema name, globally. A bare name is not a schema
identity: `build-schemas.ts` publishes `json-schema/<category>/<Name>.json`, so
the same name under two categories is two published schemas. The docs index now
uses that same `<category>/<name>` key.

Two things were wrong under the old key, and the second one turned out to be
the bigger of the two:

- **Same name, two categories, last writer wins.** `ServiceStatus` is an enum
  declared in `api/discovery.zod.ts` and an object declared in
  `system/core-services.zod.ts`. `system` was walked later, so the API enum was
  written to `content/docs/references/api/core-services.mdx` — a page with no
  `packages/spec/src/api/core-services.zod.ts` behind it.
- **A re-export was invisible.** The scan matched `export const X` only, so a
  name reaching an entry point through `export { XSchema } from '…'` — or a
  bare `export { XSchema }` of an imported binding — had no entry for its own
  category at all, and fell through to the case above. That accounts for 25 of
  the 26 misplaced schemas, not name collisions: `RetryPolicy` under
  `./automation` and `./system`, the five `ConnectorInstance*Auth` under
  `./integration`, `HttpMethod` / `HttpRequest` under `./api` and `./ui`, the
  twelve package-registry RPC envelopes under `./api`, and the metadata-loader
  pair under `./system`.

The index now records every **value** export a `.zod.ts` names — declarations
and re-exports alike, type-only exports excluded because they publish no
`z.ZodType` — and a declaration owns the page over any number of re-exports of
it. Nine pages that named no real file are gone; their sections moved onto the
page of the file that genuinely exports them, which is also the page whose
`Source:` line and `import … from '@objectstack/spec/<category>'` example were
already true:

| removed page | sections now live on |
| :--- | :--- |
| `api/core-services` | `api/discovery` |
| `api/http` | `api/router` |
| `api/package-registry` | `api/protocol` |
| `automation/retry-policy` | `automation/control-flow` |
| `integration/connector-auth` | `integration/connector` |
| `system/metadata-loader` | `system/metadata-persistence` |
| `system/metadata-types` | `system/metadata-persistence` |
| `system/retry-policy` | `system/job` |
| `ui/http` | `ui/view` |

Cross-reference links follow the same key: a `$ref` links to the page in the
reader's **own** category when that entry point exports the name, and otherwise
to the single declaring category. When two categories declare the name, no link
is emitted at all — plain text beats a confident link to the wrong schema.

A name that two files inside one category both claim is now a **build error**
naming both files, never an overwrite.
