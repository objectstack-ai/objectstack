---
'@object-ui/app-shell': patch
---

fix(app-shell): the Attachments tab offers the uploader Delete and Rename on their own upload

Clause-②: no
Metadata-protocol: none

On a record's Attachments tab, a member who uploaded a file now sees Delete and Rename on that row, with no grant on `sys_attachment` beyond the member baseline (read and create). Before, the row menu offered Delete only to a holder of the `delete` grant and Rename only behind it, so a plain member could remove or rename their own upload through the API but never from the console.

The panel now judges each row the way the storage service's two attachment doors do. On the caller's own upload (its `uploaded_by` names the signed-in user) it offers both verbs: Delete goes through the removal door, `DELETE /api/v1/attachments/:id`, and Rename through the rename door, `PATCH /api/v1/attachments/:id`, as before. On another user's upload it offers Delete to a holder of the `delete` grant, through the data API as before, and Rename to a holder of the edit grant; the delete grant no longer gates Rename. A refusal from either door is shown in the panel's error line, and the row stays.
