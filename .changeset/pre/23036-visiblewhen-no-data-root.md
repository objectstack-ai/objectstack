---
'@objectstack/spec': patch
---

fix(spec): a page component's `visibleWhen` describe no longer says the renderer binds `data` — the shipping renderer mounts no `data` root there (#23036)

Clause-②: no

The `.describe()` on `PageComponentSchema.visibleWhen` said "The shipping renderer additionally mounts `features`, `os.user` and binds `data` to the data-source ADAPTER here", and the TSDoc above it said the same. The console's renderer stopped binding `data` on this surface (objectui ruling on the renderer seam's data scope, 2026-09-13): a `data.*` read there now faults, and a faulting `visibleWhen` renders the component, so a gate written from the old text, such as `data.total > 0`, shows the component whether it is true or false.

The describe now names what the renderer mounts beyond the contract-bound roots (`features` and `os.user`), states that no `data` root is mounted, and says the one declared `data` read on this surface is the PLANNED API binding's (`dataSource: { provider: 'api' }`), once that binding's renderer ships. The `page:tabs` item-level `visibleWhen`, a different evaluator that binds `data` to the record row, is still called out. Nothing an author can write changes: the accept set is the same, and only the description text and the generated reference page move.

**If you wrote a page component gate on `data.*`:** gate on the page's row as `record.*`, or on page state as `page.<var>`.
