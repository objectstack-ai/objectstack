---
"@objectstack/client": patch
---

fix(client): `data.find()` emits `top`/`skip` on presence, so `limit: 0` reaches the server (#6485)

Both `find` implementations — `ObjectStackClient.data.find` and its
byte-identical `ScopedProjectClient.data.find` copy — emitted the two pagination
transport params on **truthiness**:

```ts
if (normalizedOptions.top) queryParams.set('top', normalizedOptions.top.toString());
if (normalizedOptions.skip) queryParams.set('skip', normalizedOptions.skip.toString());
```

while the canonical normalizer ten lines above already tested **presence**
(`if (v2.limit != null) normalizedOptions.top = v2.limit`). So `0` survived the
normalizer and was then discarded by the emitter. Both now test presence, in
both copies.

**What changes on the wire, and why that is the fix rather than a preference.**
`find('task', { limit: 0 })` — and equally `{ top: 0 }` — used to reach the
server with **no `top` param at all**. The GET list route has no default page
size, so an absent `top` returns the *entire* match set: the caller who asked
for no records received every record, under HTTP 200 with no warning.

The direction was measured before the change rather than assumed, because a
client fix is only worth having if the server honours what it sends:

| layer | `top=0` |
|:---|:---|
| REST list route → `ObjectStackProtocolImplementation.findData` | not rejected, not ignored — folds `top` into `limit`, coerces `Number('0')`, forwards `{ limit: 0 }` to the engine; envelope reports `total: 0, hasMore: false` |
| `SqlDriver.find` (the driver behind the default file-backed SQLite datasource, and every Postgres/MySQL deployment) | paginates on presence — `LIMIT 0`, **zero rows** |
| `TursoRemoteTransport` | presence — `LIMIT ?` bound to `0`, zero rows |

So `limit: 0` now means "return no records" end to end, which is what the
canonical branch already implied.

**`offset: 0` / `skip: 0` were dropped too, and that half is a consistency
change with no behavioural consequence** — `skip=0` is already the server's
default, so the request means the same thing whether the param is sent or not.
They are aligned because one emitter must not hold two rules for one pair, not
because a wrong answer was being returned.

Callers passing a non-zero `limit`/`top`/`offset`/`skip`, or omitting them
entirely, are unaffected — the emitted query string is byte-identical.
