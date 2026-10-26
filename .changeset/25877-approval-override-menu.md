---
'@object-ui/app-shell': patch
'@object-ui/react': patch
'@object-ui/plugin-detail': patch
---

fix(app-shell,react,plugin-detail): on a record under approval, an administrator who is not the approver sees one status line and one override menu instead of five buttons above the title, and Recall is drawn once

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/app-shell`:** for a viewer who holds no approver slot but may override, the record page's approval bar is now one line: the request's pending status and who the step waits on, the levers that have no override arm (Reply) as buttons, and one marked menu holding every lever the override flag admits (Override Approve, Override Reject, Override Reassign, and Recall). The approver's own bar is unchanged. Who may override, the override notice each lever shows, and the request each lever sends are unchanged. `DeclaredActionsBar` takes a new optional `foldOverrides` prop for this; a host that does not pass it renders as before.
- **`@object-ui/react`:** `InlineEditProvider` and the `InlineEditContext` value gain an optional `approvalRecallDrawnByHost`. It is optional so every existing host keeps its behaviour: absent means `false`, and then the approval band draws its own Recall exactly as before. A host that draws the pending request's declared Recall itself sets it to `true`.
- **`@object-ui/plugin-detail`:** the DetailView approval band leaves out its Recall button when the host says it draws one, and keeps its lock badge and tally. The record page sets the signal whenever it shows the approval bar, so Recall appears once on the page.

What to do: nothing.
