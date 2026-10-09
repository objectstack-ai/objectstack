---
"@objectstack/spec": minor
---

`AuthSessionApi.getSession` (`@objectstack/spec/contracts`) now declares the optional `query.disableRefresh` that the in-process session readers send

Clause-②: yes (widening)

- **The declaration.** `getSession`'s input is `{ headers: unknown; query?: { disableRefresh?: boolean } }`. It was `{ headers: unknown }`. The return type and the rest of `AuthSessionApi` are unchanged.
- **Why.** The in-process readers call `api.getSession(inProcessSessionReadInput(headers))` (`@objectstack/types`). For a request that carries a better-auth session cookie, that input is `{ headers, query: { disableRefresh: true } }`, so the session renews only on the `get-session` route, which re-issues the cookie. A bearer-only request is still read with `{ headers }` alone. The declaration said the readers send only `{ headers }`, which stopped being true when the readers moved to the helper.
- **Nothing to migrate.** The added key is optional. A caller that passes `{ headers }` compiles as before, and so does an implementation of `getSession` that accepts `{ headers }` and ignores the rest. An implementation that reads `input.query?.disableRefresh` now type-checks against the contract instead of needing a cast.
