---
'@objectstack/metadata-protocol': patch
---

Global search (`GET /api/v1/search`) skips the objects a caller cannot read instead of failing the whole request with `403 PERMISSION_DENIED` (#21836).

Clause-②: no

- **Object level.** Before an object is queried, `searchAll` asks the `security` service's `canReadObject` with the caller's context, the same read gate the engine middleware enforces. An object it refuses is skipped. A member whose scope included any object they hold no read grant on used to get 403 for every query. The console palette then showed "No results found." with no error.
- **Field level.** Each object is searched only on the fields the caller may query (`getQueryableFields`). The engine refuses a search that would match on a hidden field, and `sys_user`'s searchable fields include admin-only columns, so a member's unscoped search hit that refusal as well. An object left with no queryable search field is skipped.
- **Nothing about a skipped object reaches the response.** It is not queried, named or counted in `totalObjects`, and the decision is made before any row is read. An explicit `objects=` naming an unreadable object gets the same answer as a name that matches no object.
- **Other failures still fail the search.** A read error on a readable object, or an admission check that throws, propagates as before. Callers that can read every object, and calls without a context, get the same answer as before.
