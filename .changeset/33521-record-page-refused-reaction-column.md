---
'@object-ui/app-shell': patch
---

fix(app-shell): a record page offers the reactions column write only where `sys_comment` still declares the column

Clause-②: no
Metadata-protocol: none

A caller refused `sys_comment_reaction` (a permission set with no read on it, or an external user) was offered the reaction control on a record page's discussion, and every click answered `400 INVALID_FIELD`: the page fell back to writing the retired `sys_comment.reactions` column with `PATCH /api/v1/data/sys_comment/ID`, which the server refuses because the column left `sys_comment` in the release that added `sys_comment_reaction`.

The page took that fallback whenever it could not read `sys_comment_reaction`, and a refusal reads the same as an object the deployment does not have: the metadata door answers both as absent. It now tells them apart by `sys_comment`'s own definition, which the caller can read. Where `sys_comment` still declares `reactions` (a framework that predates `sys_comment_reaction`), the column path is used exactly as before. Anywhere else the caller is refused the reaction object: the page offers no reaction control, reads no reactions and sends no reaction request.

- A caller who holds read on `sys_comment_reaction` is unchanged: reactions are that object's records.
- `useObjectPresence` also returns the object's served `definition` when the object is present, so a reader can choose by what the object declares without a second registry read.
