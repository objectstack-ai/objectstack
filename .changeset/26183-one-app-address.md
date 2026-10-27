---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(app-shell,console): one app opens under one address — a name-alias route moves onto the package id

Clause-②: no
Metadata-protocol: none

An app with a package id answered under two address families in one session. ADR-0048 keys `/apps/<segment>` on the package id, and every sidebar entry builds on it, but the app's `name` still resolves as an alias, and a page opened on the alias built every link of its own (list rows, record pages, related lists) on the alias. Landing on `/apps/clm/…` therefore opened contracts under the name and obligations and the approvals inbox under `/apps/app.objectstack.hotclm/…`.

- **`@object-ui/app-shell`:** a route under `/apps/<name>/…` whose app carries a package id is rewritten, with `replace`, to the same path under `/apps/<package id>/…`, keeping the query string, hash and history state. Old name-based bookmarks and shared links keep opening, now on the one address. The top-bar logo and every Home affordance (`resolveDeclaredHomePath`) name the declared app by its package id. An app without a package id, an app whose name is its package id, and every app after the first of a package that ships several (the package id opens the first) keep their name as their address.
- **`@object-ui/console`:** the `/` landing (`resolveLandingPath`) names the landing app by the same address, so post-login and the logo agree and no redirect hop follows.

What to do: nothing. Links that name an app by its name keep working; they now arrive on its package-id address.
