---
'@objectstack/core': patch
'@objectstack/objectql': patch
'@objectstack/service-storage': patch
---

fix(service-storage): a member attaches a file through the attach verb again; the verb vouches for the one file it created

Clause-②: no
Metadata-protocol: none

A signed-in member who may attach files can attach one again through the server-side attach verb (`attachFileAs` on the `file-attachments` service), and so can a print to a record's attachments (`printRecordToFile`). Since the write-time reference check began judging a `lookup` value through the caller's own read door, the verb's `sys_attachment` insert — written as the caller — was refused over its `file_id`: a member who may attach need not read `sys_file`, so the file the verb had just created answered `reference_not_found` and the call failed.

The rule now: a service verb that has created a record in the same call may vouch, on its own write, for the one reference to that record (`vouchForReference`, `@objectstack/core`). The write-time reference check does not ask the caller's read door for exactly that object, field and id, and still probes that the record exists. The attach verb vouches for its own `sys_attachment.file_id` and for nothing else; every other gate on the insert still judges the caller (the permission to create an attachment, the parent-edit attach rule, `enable.files`, the file-reference gate, row- and field-level security, and the `uploaded_by` stamp).

Unchanged: no caller gains a read of `sys_file` or of anything else. A `sys_file` id sent through any data door — REST, MCP, a flow, an import — is judged through the caller's read door exactly as before, the file the verb attached included. The mark is a symbol-keyed context property that no request body, query, stored row or flow definition can spell.
