---
"@objectstack/rest": patch
---

fix(rest): a missing relation is only an unknown OBJECT when it IS the object asked for (#5462)

`mapDataError`'s unknown-object heuristic asked whether a driver error mentioned
`no such table` / `relation … does not exist` — never **which** table was
missing. A business object that was never registered and the metadata plane
collapsing entirely produce the same two words, so `sys_metadata` becoming
unreachable came back to the caller as:

```
404 {"error":"Object not found","code":"OBJECT_NOT_FOUND"}
```

The caller was told to check the object name they typed while the real answer
was "the metadata store is gone". And because 404 is an `isExpectedDataStatus`,
`handleRouteError` printed no `[REST] Unhandled error` — so a total outage of
the metadata plane left **not one line** in the server log. Reproduced in
process on a real `ObjectQL` + `ObjectStackProtocolImplementation` whose driver
fails every access with `SQLITE_ERROR: no such table: sys_metadata`:
`PUT /api/v1/meta/object/acct` answered 404 with zero log lines.

**The rule now: a missing-relation message is an unknown-object verdict only
when the relation it names is the object the request named.** Attribution takes
both halves — a request object, and a relation name the phrasing actually
carries (`no such table: main.acct`, `relation "public.acct" does not exist`;
the schema qualifier is stripped and the compare is case-insensitive). Prime
Directive #6 is what makes that comparison sound rather than a guess: the object
`name` **is** the table name, with no `tableName` mapping to launder it.

Anything unattributable — a different table than the one asked for, an auxiliary
table, no request object at all (which is every metadata / UI / discovery route,
since they call `handleRouteError(res, error)` without one), or a phrasing that
names no relation — is now the sanitised data-store fault the SQL-leak branch
has always emitted: `500 { "error": "Internal data error", "code":
"DATABASE_ERROR" }`. 500 sits outside `isExpectedDataStatus`, which is what buys
back the log line the silent 404 never had; the driver's own words still never
reach the client.

Deliberately unchanged:

- **A genuine unknown object is still a quiet `404 OBJECT_NOT_FOUND`.** Both
  producers still land on one envelope (#3770): the protocol's registry gate,
  and the driver limb when the missing table is the requested object. It still
  logs nothing — an unknown object is a client mistake, not a fault (#4886).
- **The engine-authored limbs.** `unknown object`, `object not found`,
  `[ObjectQL] No driver available for object '<name>'` and the quoted-name
  catch-all are ObjectStack's own vocabulary about a named object; they mean
  what they say. Only the DATABASE-authored limbs, which cannot know which table
  the caller wanted, needed attribution.
- **The declared-status band.** #5437/#5464 (a declared 5xx is withheld and
  logged) and #5423/#5436 (a 4xx is truncated, not erased) answer in
  `resolveErrorResponse` before the heuristic is reached at all. That fix
  covered producers that declare `status: 500`; this path never reached it,
  because `saveMetaItem` rethrows the driver's `Error` with no `status` and no
  `code` — which is why the message text was judging it.
