---
'@object-ui/console': patch
---

fix(console): the approvals inbox names the flow, the step and the object in the language the user chose

Clause-②: no
Metadata-protocol: none

- **Before.** A user whose chosen language differed from the browser's (a zh-CN user on an en-US browser) read every inbox row's flow, step and object in the authoring language, while the request page showed the same request translated. The inbox read the approvals routes with a bare `fetch`, so the approvals door picked its labels by the browser's `Accept-Language`.
- **Now.** Every approvals call the inbox makes goes through the console's authenticated fetch, the channel the request page already reads over. It sends the session's language as `Accept-Language`, and the door answers `process_label`, `step_label` and `object_label` from the app's pack (`flows.FLOW.label`, `flows.FLOW.approvals.NODE.label`, `objects.OBJECT.label`). A flow, step or object the pack does not cover keeps its stored label. No second translator is added. The inbox's object filter now lists each object by that label instead of its machine name, and search matches the object label too.
- **Unchanged.** What is stored on the request row. The Setup › Approval Requests object list reads the generic data door, which serves the stored labels.
