---
'@object-ui/components': patch
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': patch
---

fix(components): avatar pictures keep their proportions instead of being stretched to the circle

Clause-②: no
Metadata-protocol: none

A user photo or organization logo that is not square was squashed or stretched to fit the round avatar, because the shared `AvatarImage` set no `object-fit` and the browser default (`fill`) scales each axis on its own. It showed in the account menu, the members and organizations pages, user and lookup fields, kanban card owners, the history timeline and the chatbot.

`AvatarImage` now draws its picture with `object-cover`: it fills the circle, keeps its proportions and crops the overflow, as common avatar components do. A caller that wants a logo-style fit still passes `object-contain`, which wins over the default. The comment author avatar and the organization settings logo dropped their local `object-cover`, which the default now covers.
