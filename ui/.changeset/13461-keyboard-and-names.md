---
'@object-ui/app-shell': patch
'@object-ui/components': patch
'@object-ui/fields': patch
'@object-ui/i18n': patch
'@object-ui/plugin-chatbot': patch
---

Icon-only buttons in the console now have an accessible name, and the clickable `div` / `span` controls the console drew are real buttons a keyboard can reach (objectui#13461).

Clause-②: no
Metadata-protocol: none

- Named, in every shipped language: the AI canvas's close button, the secret value's show / hide toggle in the action result dialog, the permission set editor's remove-policy and remove-tab buttons, the metadata history page's refresh button, the sort builder's remove button, the `file-upload` renderer's remove buttons, the file, master-detail, password and QR-code field widgets' icon buttons, the chat composer's send button, the chat's scroll-to-latest button, and the top bar's avatar button ("Account menu").
- The organization picker's "Manage" link is its own button beside the card, not a clickable `span` inside the card's button, so it can be tabbed to and is no longer read as part of the card's name.
- A flow canvas branch label selects its edge with Enter or Space when the edge is selectable.
- `tree-view`: the expand toggle is named ("Expand" / "Collapse") and reports `aria-expanded`; a node is a button only when the host passes `onNodeClick`, instead of a clickable row wrapped round the toggle.
- `file-upload`: the dropzone opens the file picker with Enter or Space.
- The app preview's read-only navigation list no longer carries a click handler that could never fire.
- New pack keys: `common.expand`, `common.collapse`, `user.accountMenu`, `actions.resultDialog.showValue` / `hideValue`, `fields.masterDetail.view` / `remove`, `fields.password.show` / `hide`, `fields.qrCode.copy` / `show` / `hide`, `chatbot.sendMessage`, `chatbot.scrollToBottom`.
