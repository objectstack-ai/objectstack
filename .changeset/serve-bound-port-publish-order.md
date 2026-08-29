---
"@objectstack/cli": patch
---

fix(cli): `os serve` writes `runtime.<environment>.json` BEFORE it announces the port (#13193)

`os serve` publishes the port it bound on three channels: the runtime state file
`runtime.<environment>.json`, the `objectstack:listening` IPC message, and the
ready banner. Two of those ANNOUNCE an address; the third is the FILE those
consumers then open.

FROM: the three fired in the order they had happened to be written — banner,
then IPC, then the file. Every consumer that believed an announcement therefore
raced a file that did not exist yet: a supervisor that opens
`runtime.env_local.json` when the banner says "ready", or an `os dev` parent
that reacts to the IPC message, could both reach the path before `serve` had
written it. Nothing errored on the producer side, so the window was invisible
from inside `serve`; a loaded machine simply widened it by descheduling the
child between the announcement and the write.

TO: the state file is written first, and only then is the address announced —
IPC, then banner. A consumer that reacts to either announcement now finds the
file already on disk, by the producer's own program order rather than by luck.

Unchanged: the three channels still publish the same bound port
(`resolveBoundPort`, #13062), each leg still keeps its own error handling, and a
state-file write that fails still cannot take the announcements down with it —
a boot does not die because a supervision file could not be written.

The ordering is now a contract with a test that can observe it:
`publishBoundPort()` takes its three channels as arguments, and
`test/serve-bound-port-publish-order.test.ts` records the sequence and fails
deterministically if it is ever reversed.
