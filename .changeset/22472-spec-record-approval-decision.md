---
'@objectstack/spec': minor
---

`record:approval_decision` is a declared page component type — the approval decision panel of a `sys_approval_request` record page — with a `ComponentPropsMap` row that accepts no props

Clause-②: yes (widening)

- **New `PageComponentType` member:** `record:approval_decision`, in the reserved `record` namespace. One node shows an approval request's decision progress and its declared decision actions. It reads the record context (the request row the page binds, with its `viewer` and `decision_progress`) and `sys_approval_request`'s own declared actions, and nothing authored. Outside a `sys_approval_request` record page it draws nothing.
- **Its `ComponentPropsMap` row is an empty strict object.** A node with no `properties`, or `properties: {}`, passes. Any key inside `properties` is refused by name: `os validate` / `os build` / `os lint` report it as `component-props-unknown-key`, naming the component and the key. Node-level keys (`id`, `className`, `visibleWhen`, …) stay on the node as for every component.
- **A misspelling is refused.** Because `record` is a reserved namespace, `record:approval_decison` and other near spellings are `component-type-unknown` errors that offer `record:approval_decision`.
- **Not printable.** Inside a page that declares `print`, the type is refused with its own reason (decision controls that differ by viewer, with nothing to print), like the other action-control blocks.
- **Consumers.** objectui renders it (objectui#12045, the approvals request page), and `@objectstack/plugin-approvals` places it on the request page it ships (objectstack#22473). A consumer that derives coverage from `PageComponentType.options` — a designer palette, a renderer registry — sees one more member to classify.
