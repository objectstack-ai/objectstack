---
'@objectstack/cli': minor
'@objectstack/spec': patch
---

feat(cli): the v18 upgrade carries stored comment reactions — `os migrate comment-reactions` turns each reaction stored in the retired `sys_comment.reactions` column into a `sys_comment_reaction` record, and `os migrate apply --allow-destructive` drops the column only after that run is verified

Clause-②: no

**What the upgrade now carries.** A database upgraded from 17.x keeps `sys_comment.reactions` and every emoji reaction stored in it (schema sync is additive). Those reactions are no longer lost. `os migrate comment-reactions` converts them into records:

- **One record per stored reaction.** Each (comment, emoji, user) in a stored map becomes one `sys_comment_reaction` row with the same comment, emoji and user, in the comment's organization, owned by the user who reacted. That user can remove it like any reaction made on v18. A user id listed twice under one emoji is one reaction.
- **Nothing is guessed.** A stored value that is not JSON or not a map of emoji to user-id lists, an entry that is not a user id, an emoji longer than a reaction record holds, and a user id that names no `sys_user` row are each listed in the report with their comment id. Nothing is written for them. The readable entries of the same comment still convert.
- **Idempotent.** A reaction that already has its record is skipped, so a second run writes nothing, and re-running finishes an interrupted run.
- **Dry run by default.** `--apply` writes the records, reads the column back, and records the run in `sys_migration`. The run is recorded as verified only when every readable reaction has its record and no stored value is left unreadable. `--json` gives the full report. A run that lists an unreadable value or fails a write exits `1`, and so does an `--apply` run whose read-back finds anything unconverted.

**The column drop waits for the conversion.** Until a verified run is recorded, `os migrate apply --allow-destructive` refuses to drop `sys_comment.reactions` and exits `1` (`--json`: `message: "refused_comment_reactions_unconverted"`, with the recorded run under `conversion`). Nothing else is applied on that run. This also covers the boot drift line, which names that command as the remedy for the orphaned column.

**Upgrade order:** take a backup, run `os migrate comment-reactions`, then `os migrate comment-reactions --apply`. If it lists unreadable values, correct each one in the database so it reads as a map of emoji to user ids, or clear it if it holds nothing to keep, and run `--apply` again. Once the run is verified, run `os migrate apply --allow-destructive` to drop the column. Run these with the flags and environment the deployment boots with (an auth secret set), so the audit plugin's objects are composed.

This supersedes the "stored reactions are not migrated" sentence in the entry that retired the column. `@objectstack/spec`: the protocol-18 semantic entry `sys-comment-reactions-column-retired` now names the conversion in its replacement, reason and acceptance criteria, and orders it before the drop. `os migrate meta` and the upgrade guide carry that text. Its id and surface are unchanged.
