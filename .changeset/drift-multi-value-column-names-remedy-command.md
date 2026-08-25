---
'@objectstack/driver-sql': patch
---

The stale multi-value column warning now names `os migrate multi-value-columns`,
instead of telling operators ObjectStack will never fix the column

The finding that reports a multi-value field left on a stale `varchar`/`text`
column opened its remedy with **"ObjectStack will NOT change this column for
you. Migrate it by hand"** and then printed raw SQL. That was true when it was
written and became false the moment `os migrate multi-value-columns` shipped:
there is now an operator-run command that does exactly this, with a dry run as
the default, a confirmation prompt, and a post-run re-detection that exits
non-zero if the finding has not cleared. Operators were being sent to hand-write
DDL on a production table while the safer route sat one command away, unnamed.

The message now leads with the command and keeps the hand-run statement after it
for anyone without the CLI. Both surfaces an operator meets this on pick the
change up, because both print `message` verbatim: the boot warning
(`[schema-drift] …` on every restart) and `os migrate plan`.

What has **not** changed is what the finding gates. It stays `severity: 'error'`,
`category: 'needs_confirm'` — the artifact boot gate refuses a boot on
`category === 'destructive'` and on nothing else, and every database this finding
describes is already serving, so making the report louder must never be the thing
that stops one from starting. No load-time or write-time refusal was added; the
platform still never migrates the column on its own, per the ruling that it warns
and ships an explicit operator-run migration rather than altering a customer's
production table unattended.

The dialect-specific statement stays embedded **verbatim**, which is a contract
rather than formatting: a `ManagedDriftEntry` carries no dialect, so the CLI
command recovers one by testing which dialect's statement the message contains.
That coupling is now pinned from the emitting side as well as the consuming one.
