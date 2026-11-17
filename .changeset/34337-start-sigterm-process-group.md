---
'@objectstack/cli': patch
---

fix(cli): `objectstack start` leaves nothing of its process group behind when it exits on SIGTERM

Clause-②: no
Metadata-protocol: none

On a project with an `objectstack.config.ts`, a SIGTERM sent to the `objectstack start` process made it forward the signal to its `serve` child and exit with the child's code, as before, but one process of its group was still alive at that moment: the esbuild service `serve` started to bundle the config. esbuild keeps that service process for the life of its caller and it leaves only after the caller has exited, so a supervisor that read the group right after `start` exited (a container runtime, systemd, a drill reading `kill(-pid, 0)`) found a leftover process.

`serve` now stops the esbuild service as soon as the config module has loaded, at boot. The service exits while `serve` is still alive to reap it, so when `start` exits on SIGTERM no process of its group is left. Boots from `--artifact` or `--prebuilt` never started the service and are unchanged.
