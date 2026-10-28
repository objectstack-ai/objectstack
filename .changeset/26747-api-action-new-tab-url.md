---
'@object-ui/app-shell': patch
---

fix(app-shell): a `type: 'api'` action declaring `opensInNewTab` + `newTabUrl` opens the tab and sends no request

Clause-②: no
Metadata-protocol: none

The spec documents `newTabUrl` as the zero-roundtrip target of a new-tab action: on click the console pre-opens a tab and navigates it to `newTabUrl` (with `{recordId}` substituted), and no action request is sent. The console's server-action handler did this, but its `type: 'api'` handlers never read the pair. A `type: 'api'` action declaring both therefore opened no tab and POSTed to its `target` instead, from the record header, its more-menu and the list toolbar.

What changes:

- On the record page (header row and the more-menu) and on every surface the shared console runtime serves (the list toolbar and the console's root action provider), a `type: 'api'` action with `opensInNewTab: true` and a `newTabUrl` now takes that path: the record id resolves the way that surface resolves it, the pre-opened tab goes to `newTabUrl`, and nothing is sent to `target`. A list launch with several rows selected is refused before the tab opens, as for a `script` action.
- A `type: 'api'` action without `newTabUrl` sends its request to `target` as before.

What to do: nothing. An api action that declares the pair now does what it declares.
