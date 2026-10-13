---
'@objectstack/spec': minor
---

feat(spec)!: retire the view-level `api` data source — a view binds its object or static rows, and a metadata-declared API call is the page element's binding (#23082)

**BREAKING** — `provider: 'api'` on a view's `data` (`ViewDataSchema`, with its `read` / `write` request blocks) is now refused at parse. The arm took any `url` and any `headers`, so a credential or a cross-origin call written into a view was stored as metadata, served to every client that read the view and sent by the console as written. The page element's API binding (`ElementApiDataSourceSchema`, `dataSource` on a page component) is the one door for a metadata-declared API call: same-origin, no credential key, read with the console's own signed-in fetch. One operation with two implementations that behave differently keeps the governed one — the view-level source is re-homed on the page element and removed, not aligned.

Clause-②: no (narrowing)

Measured before removal: no producer wrote `provider: 'api'` on a view outside documentation in objectstack (`bcebd8409`), objectui (`origin/main` `f228d710` — the console's approval-requests source builds `ApiDataSource` in code from an `ApiDataSourceConfig`, never a `ViewData`) or hotcrm (`0f84c9c`), each with a lit `provider: 'object'` control. A renderer reader existed in objectui, measured at `7578323a544e` (`ListView` routed the block to `ApiDataSource`; `ObjectGantt` built one from `read` / `write`), and is now unreachable from authored metadata.

## FROM → TO

| you wrote (17.7 and earlier) | write instead |
| --- | --- |
| `data: { provider: 'api', read: { url, method?, params?, headers? } }` on a list or form view | `data: { provider: 'object', object: '<object_name>' }` (or `{ provider: 'value', items: [...] }`), and the read as a page component's `dataSource: { provider: 'api', read: { url: '/api/...' }, path? }` |
| `data: { provider: 'api', write: { url, method, body? } }` on a form view | nothing — a form submits to its object; a submit-to-endpoint is not a view concern |
| `read.headers: { Authorization: '...' }` | nothing — a credential never lives in metadata; the page element binding refuses a credential key and the console sends its signed-in fetch |

**The one-line fix:** bind every `provider: 'api'` view to its object or to static rows, and move the endpoint read onto a page component's `dataSource`.

**What an author who still writes it sees.** `tsc` fails at the authoring site (`ViewData` no longer has the arm), and the parse — `defineView()`, `defineStack({ views })`, `os validate`, `PUT /api/v1/meta/view/:name` — refuses it at `data.provider` with the prescription:

> `view.data.provider: 'api'` was removed in @objectstack/spec 17 (ADR-0049 enforce-or-remove) — a view-level API source took any `url` and any `headers`, so a credential or a cross-origin call written there was stored with the view, served to every client that read it and sent by the console as written; a metadata-declared API call now has one door, the page element's binding, which is same-origin and credential-free. Bind the view to its object — `data: { provider: 'object', object: '<object_name>' }` — or to static rows — `data: { provider: 'value', items: [...] }` — and move the API read onto a page component: `dataSource: { provider: 'api', read: { url: '/api/...' } }` (with an optional `path` into the response) under a page's `regions[].components[]`, which the console reads with its own signed-in fetch.

## The retirement kit

- **A value retirement, not a key**: `data` survives one arm lighter, so there is no `retiredKey()` tombstone and no `RETIRED_KEYS_BY_MAJOR` row. The prescription rides the discriminated union's own `error` map, keyed on the input's `provider === 'api'` — the retired bare-string `sort` clause's shape — so every other unknown provider keeps zod's own report, which lists the live arms (`object`, `value`, `schema`).
- **No D2 conversion, deliberately.** The replacement lives on a different metadata type (a page element), and the only mechanical edit a conversion could make — deleting the view's `data` so the view falls back to querying its bound object — would change what the view shows without telling anyone. An authored source or a stored `sys_metadata` row still carrying the arm meets the prescription at parse instead.
- **The D3 entry `view-data-api-provider-retired`** asks the author, per such view, which page composes the endpoint it read and what the view itself should now bind.
- **`HttpRequestSchema` / `HttpMethodSubsetSchema` stay exported** from `@objectstack/spec/shared` and `@objectstack/spec/ui`, unchanged. After this change no schema in the package composes `HttpRequestSchema`; that orphan is recorded, not acted on here.
- **Ledger:** `view.list.data` and `view.form.data` stay `live` (their surviving arms are read) and carry the arm's retirement record.
- **Docs and the published skill** no longer teach a view-level `api` source; both point at the page element binding.
- **No deprecation window**, per the project's startup-stage posture.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec` is published, and `objectstack-ai/cloud`'s own view metadata was not readable from this change's session; a cloud view carrying an `api` source is refused at parse with the prescription above.

<!-- adr-0087: registered view-data-api-provider-retired -->
