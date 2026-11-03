---
'@object-ui/app-shell': patch
---

fix(app-shell): Studio Access no longer calls a permission set the `.custom` pair added "Package"

Clause-②: no
Metadata-protocol: none

A permission set held by a read-only base's `.custom` pair (a New similar copy, or a set created there) opened in Studio Access with a "Package" chip in its header, while the rail marked the same row "Added" and the page saved its edits as drafts in the pair. The header chip now reads the customization mark the rail draws, from the same rule (`customizationMarks.ts`): a set the pair adds reads "Custom", and a set the base itself ships, or a customized base set, still reads "Package". Setup and the metadata admin pass no mark and are unchanged. While the base's customization read is loading or has failed, neither the rail nor the header shows a mark, and the header keeps its previous answer.
