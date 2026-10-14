---
'@objectstack/spec': minor
---

`record:approvals` and `record:attachments` are declared page component types — the record page's Approvals and Attachments panels — each with a `ComponentPropsMap` row that accepts no props

Clause-②: yes (widening)

- **Two new `PageComponentType` members:** `record:approvals` (the record's approval timeline: the step its approval sits at, who it waits on, what has been decided) and `record:attachments` (the record's attached files, with upload, download and delete). objectui already renders both, and its default record page places them: the Attachments tab on every record page of an `enable.files: true` object, the Approvals tab on a record that has approval requests.
- **The page Studio's page create seeds now passes `os validate`.** Before, `record` was a reserved namespace with neither type declared, so `os validate` / `os build` / `os lint` refused the seeded page of any `enable.files` object with `component-type-unknown` on its `record:attachments` node. The metadata save door did not refuse it and still does not.
- **Both rows are strict and accept no key.** A node with no `properties`, or `properties: {}`, passes. Any key inside `properties` is reported as `component-props-unknown-key`, naming the component and the key. Node-level keys (`id`, `className`, `visibleWhen`, …) stay on the node as for every component.
- **`record:approvals` refuses the runtime channel it reads, with the fix.** Its renderer reads `approvals` (the approval requests the default record page fetched) and `currentUserId` (the signed-in user) from the node, and both are filled by the host at runtime. An authored `approvals` would show a static approval history that never updates, and an authored `currentUserId` would decide for every viewer who counts as the submitter. Both are refused with a message that says to omit them: the block fetches the record's own approval requests and reads the signed-in user itself.
- **A misspelling is refused.** `record:attachment`, `record:aprovals` and other near spellings are `component-type-unknown` errors that offer the declared spelling.
- **Not printable.** Inside a page that declares `print`, each type is refused with its own reason, in place of the generic "not in the printable block subset" one.
- **Consumers.** A `kind: 'react'` page that names `<RecordApprovals>` or `<RecordAttachments>` is now refused by `react-block-needs-record-context`, as every `record:*` block is: these blocks read the record context a record page mounts, and a react page mounts none. A consumer that derives coverage from `PageComponentType.options` or the keys of `ComponentPropsMap` — a designer palette, a renderer registry — sees two more members to classify.
