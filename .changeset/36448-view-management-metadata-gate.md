---
'@object-ui/app-shell': patch
---

fix(console): offer view management only to an administrator who may write views

Clause-②: no
Metadata-protocol: none

Manage views, the view settings panel and Create View on a list page, the plugin view's own Create View and view actions, the data page's Save as view, and a saved shared view's rename and save in place were offered to every workspace administrator. Each of them writes `view` metadata, which the server refuses without the `manage_metadata` capability, so an organization administrator who lacks it was offered them and met a refusal on the first save. They now read the answer the Shared choice of a new view already reads (`mayManageViews`): an administrator whose session holds `manage_metadata`. A metadata administrator sees them as before; a reader's own views are unchanged.
