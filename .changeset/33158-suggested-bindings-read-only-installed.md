---
'@object-ui/app-shell': patch
---

fix(app-shell): a marketplace-installed app's pending default permission set can be accepted from Studio and from its marketplace page

Clause-②: no
Metadata-protocol: none

A package permission set shipped with `isDefault: true` suggests granting the set to everyone, and an administrator holding `manage_metadata` accepts or dismisses that suggestion once for the deployment. Two surfaces draw that decision, and neither reached an app installed from the marketplace:

- Studio's Access pillar drew the suggestion strip only on a writable package. A marketplace-installed package is read-only in Studio, and it is exactly the package that ships an `isDefault` set. The strip is now drawn whatever the package's read-only state, because accepting or dismissing a suggestion is a deployment decision about the package, not an edit of it. Everything on the pillar that edits the package stays read-only.
- The marketplace package page drew the panel only in an install's own result in this session. It now draws it on every visit for a package installed here (a local install this runtime loaded, or a cloud install into the environment this console renders), whenever the package has a pending, dismissed or accepted suggestion.

A caller without `manage_metadata` still sees nothing: the server refuses the list, and the panel stays silent on that answer.
