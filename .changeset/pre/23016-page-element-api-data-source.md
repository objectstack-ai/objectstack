---
"@objectstack/spec": minor
---

feat(spec): a page element's `dataSource` can name an API endpoint — `{ provider: 'api', read: { url }, path? }`

Clause-②: yes (widening: a new accepted shape)

- **What is new.** `PageComponentSchema.dataSource` takes a second shape beside the object binding: the API binding, exported as `ElementApiDataSourceSchema` (type `ElementApiDataSource`). It reads one endpoint on the deployment's own origin and binds its answer, so a product page composes from a summary that is not an object — `{ provider: 'api', read: { url: '/api/v1/cloud/home' }, path: 'data.environments' }`. `path` is an optional dotted path into the `{ success, data }` response; omitted, the element binds the whole response.
- **Same-origin only, refused at parse.** `read.url` must open with a single `/`. Five classes are refused with the reason and the fix, at `dataSource.read.url`: an absolute URL of any scheme (`https:`, `http:`, `mailto:`, `javascript:`, `data:`, …), a protocol-relative `//host`, a backslash the browser reads as a slash (`/` then a backslash, or a leading backslash), a space or ASCII control character (a tab, line feed or carriage return anywhere is deleted by the URL parser, so `/`, a tab, `/host` is `//host`), and a relative path such as `./home` or `api/v1/x`, which resolves against the page, never the API. The rule is a `pattern` in the published JSON Schema too, so a validator reading `json-schema/` refuses what the parse refuses.
- **No credentials in metadata.** The console reads the endpoint with its own signed-in fetch. The read block declares `url` and `method` only; `headers`, `credentials`, `auth`, `authorization`, `token` and `apiKey` are refused with that prescription, and so are `params` and `body`.
- **Reads only.** `read.method` is optional and accepts `GET` alone, the method the console's API adapter sends for every read. There is no `write` block.
- **The object binding is unchanged.** `ElementDataSourceSchema` accepts exactly what it did and gains no `provider` key; the two shapes meet as a `z.union` at `PageComponentSchema.dataSource`. One visible difference: a refused object binding parsed through `PageComponentSchema` now arrives as one `invalid_union` issue at `dataSource`, whose object branch carries the same issue as before. `os validate` and the API error envelope print one `Invalid input` line for the union at `dataSource`, then the object branch's issue at the same path as before (for example `dataSource.filter`).
- **Not rendered yet.** No console block reads an API binding today: the generic stat, usage-bar and checklist blocks that will are a console release still to come. Until then the binding parses and no block reads it; its schema description says so (`[PLANNED — not yet rendered]`).
