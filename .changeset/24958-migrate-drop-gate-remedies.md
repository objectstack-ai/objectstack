---
'@objectstack/cli': patch
---

fix(cli): `os migrate plan` and `os migrate apply` name the command each held drop waits for, never `--allow-destructive`, for every drop `apply` refuses (#24958)

Clause-②: no

`os migrate apply --allow-destructive` refuses the whole run, whatever flag is passed, while it would drop one of three columns before its precondition holds: `sys_account.issuer` while its retirement pre-flight finds `(provider_id, account_id)` keys held by more than one row (or cannot read `sys_account`), `sys_comment.reactions` while no verified run of `os migrate comment-reactions --apply` is recorded, and an `organization_id` column while the organization-ownership ceremony has not verified. Yet `os migrate plan` offered `--allow-destructive` for the first two, and `os migrate apply` without the flag listed all three with `"os migrate apply --allow-destructive" to drop it.` and closed with `N destructive change(s) will be SKIPPED (re-run with --allow-destructive to include them).` and `Skipped N destructive change(s) (re-run with --allow-destructive to include them).` That re-run was refused, exit 1.

- **Now.** Each such drop is still listed and counted as destructive drift, in both commands. Its line names what it waits for: the ceremony, `os migrate comment-reactions`, or the retirement pre-flight `os migrate account-issuer`.
- **The footer.** One line per gate that holds a drop names that gate's commands and says `--allow-destructive` is refused until they have run. `os migrate plan` offers `--allow-destructive` for nothing while a drop is held. `os migrate apply` prints `N destructive change(s) will be SKIPPED, and a re-run with --allow-destructive cannot include them yet:` before those lines, and `Skipped N destructive change(s); a re-run with --allow-destructive cannot include them yet (see above).` after the apply.
- **Unchanged.** A database with no held drop prints what it printed before, byte for byte, in both commands. The `--json` documents, the exit codes and every refusal of `os migrate apply --allow-destructive` (its rule and its text) are unchanged.

**What to do.** Nothing. Follow the footer: run the command each held drop names, then re-run `os migrate plan`.
