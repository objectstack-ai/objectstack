---
'@objectstack/cli': patch
---

fix(cli): an `os serve` boot that composes no HTTP server now stays up until it is stopped, as its banner's `Press Ctrl+C to stop` says

Clause-②: no

- **Before.** `os serve --no-server --preset minimal`, in production with no storage driver (no `OS_DATABASE_URL`), printed the ready banner ending `Press Ctrl+C to stop` and then exited 0 by itself, about 50 ms later, with no signal and without the kernel shutting down. The same command stayed up whenever the storage driver kept a connection pool (`--dev --no-server`, or `--no-server` with `OS_DATABASE_URL` set). Measured, that pool's reaping interval was the only thing keeping those boots alive, so whether a kernel-only boot stayed up depended on the driver.
- **After, for an operator or supervisor of a boot with no HTTP server composed** (`--no-server` with no config-mounted transport, or a transport plugin that did not load). The process stays up after its banner, whatever the driver, until SIGINT, SIGTERM or SIGQUIT. The kernel's own signal handling then drains it and exits with the kernel's code, 0 on a clean shutdown, as on a server boot. No signal listener is added.
- **Why "stay up" and not "run and exit".** The banner says `Press Ctrl+C to stop`. The kernel is built to own the process: a signal drains it, then exits it. The platform's background loops never keep a process alive by themselves, so the host decides the lifetime. The run-and-exit kernel boot already exists, and is explicit: `OS_MIGRATE_AND_EXIT=1`. Every in-repo kernel-only boot that is meant to exit sets it, and every other one is stopped by a signal.
- **Unchanged.** A boot with an HTTP server composed, including a `--no-server` boot whose config mounts its own `HonoServerPlugin`. `OS_MIGRATE_AND_EXIT=1`, which still shuts the kernel down and exits 0 before any banner. The IPC messages and the runtime state file.
- **If you relied on the exit.** A script that ran `os serve --no-server` and waited for the process to end now has to set `OS_MIGRATE_AND_EXIT=1` (bootstrap once, then exit 0), or stop the process with a signal.
