---
'@objectstack/cli': patch
---

fix(cli): `os data delete`'s human-readable arm reads the server's `success` flag instead of always printing "Record deleted" (#19413)

Clause-②: no

`os data delete` renders three output faces from one call. The `--format json`
and `--format yaml` arms lower the server's `DeleteDataResponse.success` into
their own `deleted` key — that is what #5638 landed, and its note is still in
the command. The default human-readable arm did not read it at all: it printed
`Record deleted: <id>` unconditionally. One command, one call, two output
formats able to state opposite facts about whether a row is gone.

**What changes.** When the server answers `success: false`, the default arm now
prints a warning instead of a success line:

```
FROM   ✓ Record deleted: rec_1                 (whatever the server said)

TO     ✓ Record deleted: rec_1                 (success: true  — unchanged)
       ⚠ Not deleted: rec_1 — the server reported the deletion did not happen
                                               (success: false)
```

**The exit code does not move — on either arm, in any format.** The two machine
arms already publish `success: true`, the CLI envelope's *"the command
completed"* flag, beside `deleted: false`, and they exit `0`. Moving only the
human arm off `0` would re-create this very defect one layer down: the same
call exiting `0` under `--format json` and non-zero by default. Moving it on
all three arms would narrow a published CLI accept set — a script that succeeds
today would start failing — which is a contract change and not this fix. So
this is a `patch`, not a `minor` with a breaking banner, and the new pin
asserts `0` in both directions so the next change cannot move it silently.

**This is reachable on `main`, not hypothetical.** #19411 landed while this was
being written. `MetadataProtocol.deleteData` used to return the literal
`success: true`, so the single-record door could not answer `false` at all and
the unconditional print was merely wrong on its own terms; it now returns
`success: deleted !== 0`, and a package-declared `sys_permission_set` — whose
delete is an ADR-0005 reset that re-projects the row rather than removing it —
answers `success: false` on the live door. From that commit on,
`os data delete sys_permission_set <id>` printed `Record deleted` for a row the
same command's `--format json` arm reported as `deleted: false`. The
`--format json` and `--format yaml` bytes are untouched in both directions.

**The flag is read as `=== false`, not as falsiness** — the same reading
`MetadataProtocol.deleteData` takes of the driver contract. `false` is the
protocol's positive *"no row was deleted"* value; an absent or `undefined` flag
from an off-contract server is no signal at all, and turning "no signal" into
"not deleted" would make the CLI deny deletions that really happened.

**Why this carries a changeset rather than `skip-changeset`.** Measured on the
built tree: `@objectstack/cli`'s published `files[]` ships `dist`, and the new
sentence is present in `dist/commands/data/delete.js` after a build, with the
unchanged success sentence from the same file as the lit control. The new test
file is absent from `dist` entirely, as the negative control.
