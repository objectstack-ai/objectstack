---
'@object-ui/app-shell': patch
---

perf(app-shell): the app sidebar and recent rows label their items by name

Clause-②: no
Metadata-protocol: none

Two label readers still downloaded a whole metadata list to name one row:

- Inside an app, a sidebar entry with no label of its own read the whole object registry (`GET /api/v1/meta/object`, with the `/meta/view` list it is composed with) on every page whose route had not loaded it. The sidebar now resolves labels with `useNavTargetLabel({ byName: true })`: the entry's object by name, which the app bundle answers, and a dashboard entry the bundle does not hold by name too.
- A recent dashboard, page or report row (Home, the command palette, the sidebar's recent list) read its type's whole list. Each row now asks its own item through the provider's by-name read (`useReadItemsByName`, beside `readObjectsByName`).

Once something else has loaded a list, these readers read it and ask nothing more. The labels shown are unchanged, in every language, and an item that has not landed shows its machine name, as before.
