---
'@object-ui/react': patch
'@object-ui/app-shell': patch
---

feat(ui): a page element bound to an `api` data source reads again after an action on the same page succeeds

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/app-shell`: the page's action refresh reaches its `api`-bound elements.** After a successful `api`, `flow` or `script` action on a page, the page still declares `'*'` on the data-invalidation bus, and then asks its own `api`-bound elements to read again. Before, those elements kept the answer they read when the page opened, so a row's "Turn off" button changed the server and left the page showing the old state. A failed action, a cancelled confirmation or param dialog, and `refreshAfter: false` read nothing, as they refresh nothing today.
- **`@object-ui/react`: `ElementApiRereadScope` and `createElementApiReread()`.** A host mounts the scope around a page with a signal and calls its `reread()` after that page's action succeeds; every `api`-bound element below reads again, and none outside it does. A change declared on the bus alone re-reads nothing, because an endpoint names no object and that change comes from every surface of the app. While the new read is in flight the element keeps its last answer on screen, with no loading panel, so a row button in the middle of its own run stays mounted. The new answer replaces it in place. A failed re-read draws the binding's error face, never the answer from before the write. A read asked after `reread()` never joins, and is never handed out from the console's open, a request asked before it.

Every page element carrying `dataSource: { provider: 'api' }` gets this through `SchemaRenderer`, including the product blocks (`hero`, `stat`, `usage-bar`, `checklist`, `tile-grid`, `row-table`). Navigation `visible` gates that read an `api` binding are outside the page and do not read again. No `@objectstack/spec` change: `refreshAfter` already decides whether an action refreshes.
