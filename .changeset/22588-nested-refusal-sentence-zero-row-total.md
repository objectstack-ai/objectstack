---
"@objectstack/runtime": patch
"@objectstack/metadata-protocol": patch
---

fix: a hook's refusal reached through an action or another hook answers in the hook's own words, and `$top=0` reports the real `total` (#22588)

Clause-②: no

- **A nested sandboxed refusal keeps its sentence (`@objectstack/runtime`).** A script action whose body writes through `ctx.api` and is refused by a sandboxed hook used to answer with the hook's debug wrapper in front of the sentence: `POST /api/v1/actions/:object/:action/:id` → `400 VALIDATION_ERROR` "`hook 'guard' threw: Error: A finished task cannot be reopened.`". It now answers the hook's sentence alone, as `PATCH /api/v1/data/:object/:id` and a declarative `operation: 'update'` action already did. The same holds for a hook that writes another object through `ctx.api` and is refused there: `/data` answers the inner hook's sentence. Status and `code` do not change. The cause was the sandbox's VM hop: a host error crosses into a body's VM as `name` and `message` only, so the refused write's sentence was left behind and the wrapper became the outer error's caller-facing text. The sentence now travels beside the wrapper and is used when the body lets that error escape unchanged. A body that catches the error and throws its own (or rewrites its message first) is still answered in its own words, a nested crash is still a `500`, and the server log still names every frame.
- **The `/actions` door reads its sentence through `sandboxBusinessMessage`** (`@objectstack/types`), the same read `/data`, the bulk doors and `/analytics/dataset/query` make, instead of its own copy. The wire answer is unchanged.
- **`$top=0` reports the filtered `total` (`@objectstack/metadata-protocol`).** `limit: 0` asks for no rows, and `findData` treated it as "no limit", so the zero-length page was reported as the total: `GET /api/v1/data/:object?$top=0` answered `total: 0` while `$top=1` answered the real count. The Console reads its list footer's record count from exactly that `$top: 0` request. A zero-row request is now a paged request: it returns no rows and the same `total` as any other page size, filters included. `$count=false` still skips the count and now omits `total` for `$top=0` too, instead of reporting `0`. A `search` query still reports its page-local estimate, as it does at every page size.
