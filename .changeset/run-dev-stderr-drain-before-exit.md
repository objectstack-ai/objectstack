---
'@objectstack/cli': patch
---

`bin/run-dev.js` now waits for its stderr writes to reach the pipe before oclif's
`handle()` exits on top of them.

The unbuilt-workspace diagnostic (`objectstack: NOT A MISSING COMMAND` plus the one
build command that fixes it) is written after ~138 KB of oclif `ModuleLoadError`
blocks, because `settings.debug` is on for this entry point. A pipe holds 64 KiB and
`handle()` ends in `process.exit()`, which drops whatever has not drained — so a
parent that is slow to read got exactly one buffer and lost the diagnostic *and*
oclif's own `command … not found`. Measured unfixed against a stalled reader: 64378
bytes captured, both lines gone. Interactively it never reproduced, because a TTY is
written synchronously.

This is the #6531 defect (`src/utils/format.ts`, `emitJson`) on stderr instead of
stdout, and it is fixed the way that module prescribes — at the write, by awaiting
the callback, rather than at the exit, since there is no hook between `handle()`'s
`console.error` and its `process.exit`. Awaiting our own write also drains the
backlog queued ahead of it, which is what leaves an empty buffer for oclif's line.

Scope: `bin/run-dev.js` is the repo's SOURCE entry point, used by gates and e2e
suites; it is not published (`files` names only `dist`, and the `bin` target is
`bin/run.js`). The shipped binary's failure path writes one short line with no
backlog ahead of it and is not affected.
