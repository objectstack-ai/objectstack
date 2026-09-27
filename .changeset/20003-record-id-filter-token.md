---
"@objectstack/spec": minor
"@objectstack/core": minor
"@objectstack/lint": minor
---

A record-scoped filter token, `{record_id}`: the id of the record a `type: 'record'` page is showing. It resolves where a record is in context, and is refused by name everywhere else (#20003).

On a record page, `record:related_list` was the only component that could scope itself to the record in view. Every other data-bearing component takes a `FilterCondition`, and the only dynamic values a filter could hold named the signed-in viewer. So "open tasks" on a person's record page counted the whole organisation's tasks, under that person's name. `{ assignee: '{record_id}' }` now says "this record's".

**Where it is accepted, and where it is refused:**

- **Accepted:** a filter on a component of a `type: 'record'` page (`regions[].components[]`, `slots`, and any filter key inside them). `os lint` / `os validate` pass it there. A page with no `type` is a record page by `PageSchema`'s default.
- **Refused by `os lint` / `os validate`** (rule `filter-token-unknown`, `error`), with the reason "no record in context on this surface" rather than the unknown-token message: list views (top-level `views` and an object's list views and field filters), dashboard widgets and dashboard filters, reports, datasets, app navigation filters, and every page whose `type` is not `'record'` (`home`, `app`, `utility`, `list`, including a list page's `interfaceConfig.filterBy`).
- **Refused on every server path.** `resolveFilterTokens()` in `@objectstack/core` throws `UnresolvedFilterTokenError` (`FILTER_TOKEN_UNRESOLVED` / 400, `token: 'record_id'`) on the ObjectQL read path (`find`, `findOne`, `count`, `aggregate`), the write path (`update` / `delete`, by id or `multi`), the analytics query door and the dataset executor. That is the same envelope a session token gets when the request has no value for it. It happens whatever the request carries, because no server path knows which record a page is showing. The token never becomes `null` (a count "about nobody"), is never dropped (a count "about everybody"), and never reaches the driver.

**What is in `@objectstack/spec/data`:**

- `RECORD_CONTEXT_TOKENS` (`['record_id']`), `RecordContextToken` and `isRecordContextToken()`: a sibling of `CONTEXT_TOKENS`, not a member. `CONTEXT_TOKENS` resolves against the caller's session, and `{record_id}` resolves against the surface. So `isContextToken('record_id')`, `ContextTokenSchema` and `ContextTokenPlaceholderSchema` are unchanged and still reject it, and a client resolver that fills `CONTEXT_TOKENS` from the session does not pick it up.
- `classifyFilterToken('{record_id}')` returns the new kind `{ kind: 'record-context', token: 'record_id' }` instead of `unknown`. A consumer that switches exhaustively on `kind` gets a compile error until it handles the new kind.
- `isKnownFilterToken('record_id')` stays `false`. That predicate answers "can the server resolve it?", and its one consumer, the flow engine's filter hand-off, is a server position. A flow addresses its own record as `{record.id}`.
- Near misses are still refused, now with `{record_id}` suggested: `{recordId}` (the URL / flow-template placeholder), `{record.id}`, `{record-id}`, `{current_record_id}`. `CONTEXT_TOKEN_SUGGESTIONS`' value type widens to `ContextToken | RecordContextToken`.

**Presentation scope, not access.** Like `{current_user_id}`, `{record_id}` narrows what a component shows. It decides nothing about which rows the caller may read; that is still RLS.

**What you do:** on a record page, filter a component on the record in view with `{ <field>: '{record_id}' }`. If `os validate` refuses it with "no record in context on this surface", the filter is on a surface with no record: move it onto a component of a `type: 'record'` page, or filter on a concrete id. Until the renderer you run resolves `{record_id}`, a record-page query that carries it is refused by the server with `FILTER_TOKEN_UNRESOLVED` rather than answered with a wrong number.
