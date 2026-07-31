---
"@objectstack/objectql": patch
"@objectstack/cli": patch
---

feat(migrate,objectql): the upgrade path names the data migrations that are still open here (#3438, ADR-0104 2026-07-30)

Both value-shape gates fail toward leniency: a deployment that never runs its
migration keeps warning instead of rejecting, and keeps every released file
forever. That default is right — and completely silent, so the gate could sit
open for the life of a deployment without anyone learning that one command ends
it. A gate nobody is told about is served by nobody.

Two announcements, each where an upgrade actually looks:

- **`os migrate meta --from 16`** now ends by naming the data migrations a
  chain crossing into 17 leaves behind — `files-to-references`, `value-shapes`
  — with what each unlocks, scoped to the field classes the author's own
  metadata declares (an app with no media field is never told about the file
  migration). `--json` carries the same list as `dataMigrations`. The command
  reads no database, so it reports what remains *to do*, never what a given
  deployment has *done*.
- **The server logs one line per open gate at boot**, naming the command that
  closes it. Only the lax posture announces itself — a verified gate already
  logs that it is enforcing, and an app declaring neither class of field costs
  nothing and says nothing. This is the half that can speak to a deployment's
  actual data, because it is the half with the database.

Nothing about enforcement changes: same gates, same flags, same fail-toward-
leniency default. The advisory runs on `kernel:bootstrapped` rather than
`kernel:ready`, deliberately — the answer depends on the storage service's own
ready handler, which registers `sys_migration` and may attest a store it just
created, and racing it would tell a brand-new deployment its gates are open
moments after they closed.
