---
"@objectstack/spec": minor
"@objectstack/core": minor
---

fix(spec,core): `PluginHealthMonitor` stops claiming a restart it never performed; the three `PluginHealthCheck` restart keys retired (#12032, ADR-0049)

<!-- adr-0087: registered plugin-auto-restart-never-reinitialised -->

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the prescriptions are registered
under protocol major 18 — three `RETIRED_KEYS_BY_MAJOR[18]` entries plus the D3
semantic entry `plugin-auto-restart-never-reinitialised` — where
`os migrate meta` users will look). Graded `minor` rather than `major` for the
same reason #12340 and #12428 were, the day before, in this same module.

## What was measured

`PluginHealthMonitor.attemptRestart` called `plugin.destroy()` and stopped
there. The comment above the call read *"Call destroy and init to restart"*,
and `init` appeared in `health-monitor.ts` **only inside that comment**. So a
plugin whose health checks crossed `failureThreshold` with `autoRestart: true`
got: `destroy()`, a log line reading `Plugin restarted`, status `recovering`,
and periodic health checks that carried on running against the destroyed
instance. The default check when no `checkMethod` resolves is
`{ name: 'plugin-loaded', status: 'passed' }`, which a destroyed object passes
indefinitely — so the **terminal** report on a torn-down, never-re-initialised
plugin was `healthy`.

Reproduced at `ee3595cefd` before anything was changed, with
`successThreshold: 3`:

```
round 1 (failing): status=failed     destroyed=0 alive=true
after backoff:     status=recovering destroyed=1 alive=false
recovery round 1:  status=recovering destroyed=1 alive=false
recovery round 2:  status=recovering destroyed=1 alive=false
recovery round 3:  status=healthy    destroyed=1 alive=false
```

#11955 made that report *more* convincing rather than less: reaching `healthy`
now costs `successThreshold` consecutive passing rounds, so a destroyed plugin
has to earn a declared number of passes before it is misreported.
`restartAttempts` was incremented as though a restart had occurred, and
`maxRestartAttempts` / `restartBackoff` scheduled further "restarts" of a plugin
that was never brought back up.

## Why REMOVE and not the other two ADR-0049 states

**ENFORCE** would have to build the restart, and the class cannot host one.
`Plugin.init(ctx)` needs a `PluginContext`; the only two `plugin.init(...)` call
sites in the tree are the kernel's own boot loops (`kernel-base.ts:202`,
`kernel.ts:607`), both over the full plugin list, with a context that is
`private` on `ObjectKernel` and `protected` on `KernelBase`. No host can obtain
one, so a host-provided re-init hook would have had nothing to call. (Positive
control for that scan: the same pass resolves five real non-test
`plugin.destroy()` call sites, so it does see lifecycle drivers.) Building a
per-plugin re-init API for a caller that does not exist — no runtime constructs
`PluginHealthMonitor` (#11825) — is the speculation ADR-0049's staged decision
names as the wrong default at this milestone, where the shippable liability is
the false promise and not the missing feature.

**EXPERIMENTAL** requires a roadmap. A scan of the whole `docs/` planning + ADR
corpus returned **zero** mentions of plugin auto-restart, against 118 control
hits for "health" and 13 for "hot reload" in the same corpus.

`maxRestartAttempts` and `restartBackoff` leave with `autoRestart` rather than
as a tidy-up: with no restart, *"Maximum restart attempts before giving up"* and
*"Backoff strategy for restart delays"* have nothing left to be the vocabulary
**of** — the test that took `distributedConfig` out with the `stateStrategy`
value it was documented as requiring (#12340).

## What changes for a host

All three keys are **tombstoned**, not deleted: `PluginHealthCheckSchema` is not
`.strict()`, so a bare deletion would be a silent strip (#3733, ADR-0104) — a
milder form of the defect being retired. A TypeScript host gets a `tsc` error
(the keys are typed `never`); a parse raises the prescription; and
`PluginHealthMonitor.registerPlugin` refuses a hand-built config carrying any of
them with an ADR-0112 envelope (`code: VALIDATION_ERROR`, `status: 400`), thrown
before any state is stored so a refused config leaves no half-registered plugin
behind.

`PluginHealthMonitor` no longer calls `plugin.destroy()` at all. A plugin that
crosses `failureThreshold` is reported `degraded` / `unhealthy` / `failed` and
left running; acting on that is the host's job in this host-driven library
(#11825 route 2). Poll `getHealthStatus(pluginName)` / `getHealthReport(pluginName)`
and restart at the level that owns the plugin's lifetime.

Everything else in the monitor is unchanged: registration, periodic checks, the
`timeout` race and its refd-timer guard (#4875), both failure routes sharing the
counters (#11852), and `successThreshold` binding from every status that records
a failure (#11955). `recovering` is now written only by the success branch —
the one writer that ever meant it.
