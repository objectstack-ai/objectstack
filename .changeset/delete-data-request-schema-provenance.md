---
"@objectstack/spec": patch
---

Record, on `DeleteDataRequestSchema` itself, what it is for and why the DELETE data door carries no `requestSchema` for it.

The schema is the request contract of `DataProtocol.deleteData()`, consumed statically through the `DeleteDataRequest` type alias and parsed at runtime nowhere — a grep that finds "exported, documented, zero `safeParse` call sites" is reading the wrong surface, and had already filed it once as a gap. Its docblock now says so; records that the absence of a `requestSchema` on `DELETE /api/v1/data/:object/:id` is a pinned decision (#3899 — the catalog entry states it in place of the key, and `plugin-rest-api.schema-refs.test.ts` goes red if one is added, because the route reads no body); and points at the compile-time check (#15866) under which a field added to the schema as required reddens the door at build instead of being silently unsent.

Documentation only: no shape, `.describe()` text, or export changes. `@objectstack/spec` ships the new text in its published type declarations and in the source file it publishes directly via its `src/**/*.zod.ts` entry.
