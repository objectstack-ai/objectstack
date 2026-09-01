---
'@objectstack/cli': patch
---

`bin/run-dev.js` now waits for its stderr writes to reach the pipe before oclif's
`handle()` exits on top of them, and bounds that wait by PROGRESS rather than by a
deadline.

The unbuilt-workspace diagnostic (`objectstack: NOT A MISSING COMMAND` plus the one
build command that fixes it) is written after ~138 KB of oclif `ModuleLoadError`
blocks, because `settings.debug` is on for this entry point. A pipe holds 64 KiB and
`handle()` ends in `process.exit()`, which drops whatever has not drained — so a
parent that is slow to read got exactly one buffer and lost the diagnostic *and*
oclif's own `command … not found`. Measured against a stalled reader: 64721 bytes
captured, both lines gone. Interactively it never reproduced, because a TTY is
written synchronously. This is the #6531 defect (`src/utils/format.ts`, `emitJson`)
on stderr instead of stdout, fixed the way that module prescribes — at the write,
since there is no hook between `handle()`'s `console.error` and its `process.exit`.

⚠️ Waiting is only safe if something bounds the wait. The bound is a NO-PROGRESS
window, not a deadline: a deadline cannot tell a reader that is merely slow from one
that is absent, and those want opposite answers. A live reader keeps draining however
slowly (measured worst case: a vitest worker's event loop never stalled beyond 61 ms
under real suite load); an absent one drains nothing, ever. Exceeding the bound
degrades to the prompt-but-lossy behaviour this file had before the drain existed —
never to a hang.

Scope: `bin/run-dev.js` is the repo's SOURCE entry point, used by gates and e2e
suites; it is not published (`files` names only `dist`, and the `bin` target is
`bin/run.js`). The shipped binary's failure path writes one short line with no
backlog ahead of it and is not affected.
