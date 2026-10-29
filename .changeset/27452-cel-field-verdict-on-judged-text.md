---
'@object-ui/app-shell': patch
---

fix(app-shell): a CEL field shows the server's verdict only on the text it judged

Clause-②: no
Metadata-protocol: none

In Studio's permission-set editor, an RLS `using` or `check` clause kept showing the previous draft's server error under text the author had since changed. An edit the CEL syntax check holds is never saved, so the draft is not read again and the server's verdict on the old text stayed on screen beside the new error: two different errors at once, one of them about text no longer in the field.

The clause now shows the server's errors on the same terms on which they hold the save: only while it still shows the text the server judged. Editing the text away hides them, and the next save's re-read brings the new verdict. Typing the judged text back shows the verdict again, because it describes that text.
