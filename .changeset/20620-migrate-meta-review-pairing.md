---
'@objectstack/cli': patch
---

fix(cli): `os migrate meta --from N` prints the manual change that judges an applied edit beside that edit, marked review

Clause-②: no

Some applied mechanical edits are not the end of the job. A default flip such as
`flow-decision-mode-inclusive-explicit` writes `mode: 'inclusive'` onto a decision so
the flow keeps its old behaviour, and the manual change that judges it says the right
edit is usually none: delete the key where the branch conditions partition. That
judgment used to print hundreds of lines below the edit, among every other manual
change of the major.

A manual change can now declare which conversions' edits it judges. In the
`Applied N mechanical change(s):` group, each run of edits by such a conversion is
followed by one line:

    ↳ review the N edits above against the manual change [protocol M] surface → replacement

The line copies the headline the manual change prints in its own group, so its `why`
and `verify` lines are found there under the same text. Two pairs are declared today:
`flow-decision-mode-inclusive-explicit` with the decision-mode entry, and
`time-default-utc-suffix-dropped` with the time-default entry. Only declared links
pair; a manual change that merely mentions a conversion in its prose does not.

Nothing else moves. The `N manual change(s) require your judgment:` group still lists
every manual change, byte for byte, with the same count. An edit no manual change
judges prints exactly as before. `--json`, `--out`, the exit code and the loader's
stderr are unchanged, and `--stored` is not affected.
