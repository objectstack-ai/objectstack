// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #12032 — ADR-0049 enforce-or-remove, one class over from #12428 (PR #12571)
// and #12340 (PR #12425) in the same host-driven lifecycle library, and for a
// sharper reason than either: this key HAD a reader that acted, and what it did
// was not what the key declared.
//
// `PluginHealthMonitor.attemptRestart` called `plugin.destroy()` and stopped.
// The comment above the call read "Call destroy and init to restart"; `init`
// appeared in `health-monitor.ts` ONLY inside that comment. What a plugin got
// was destroy -> `logger.info('Plugin restarted')` -> status `recovering` ->
// periodic checks continuing against the destroyed instance, which the default
// check (`{ name: 'plugin-loaded', status: 'passed' }`, used whenever no
// `checkMethod` resolves) passes forever. So the TERMINAL report on a
// destroyed, never-re-initialised plugin was `healthy` — reproduced before
// anything was changed, at ee3595cefd with `successThreshold: 3`:
//
//   round 1 (failing): status=failed     destroyed=0 alive=true
//   after backoff:     status=recovering destroyed=1 alive=false
//   recovery round 3:  status=healthy    destroyed=1 alive=false
//
// #11955 made that MORE convincing rather than less: reaching `healthy` now
// costs `successThreshold` consecutive passing rounds.
//
// Neither of ADR-0049's other two states was available. ENFORCE would have to
// BUILD the restart, and the class cannot host one: `Plugin.init(ctx)` needs a
// `PluginContext`, and the only two `plugin.init(...)` call sites in the tree
// are the kernel's own boot loops (`kernel-base.ts:202`, `kernel.ts:607`), both
// over the full plugin list with a context that is `private` on `ObjectKernel`
// and `protected` on `KernelBase` — no host can obtain one (positive control:
// the same scan resolves five real non-test `plugin.destroy()` call sites, so
// it sees lifecycle drivers). Building a per-plugin re-init API plus a host
// callback for a caller that does not exist is the speculation ADR-0049's
// staged decision names as the wrong default at this milestone. EXPERIMENTAL
// requires a roadmap, and a scan of the whole `docs/` planning + ADR corpus
// returned ZERO mentions of plugin auto-restart against 118 control hits for
// "health" and 13 for "hot reload" in the same corpus.
//
// The three keys retire together: with no restart, "Maximum restart attempts
// before giving up" and "Backoff strategy for restart delays" have nothing left
// to be the vocabulary OF — the same test that took `distributedConfig` out
// with the `stateStrategy` value it was documented as being required for.
//
// Tombstoned with `retiredKey()` rather than deleted, for #12428's reason: a
// key leaving a SURVIVING def has no route-3 exit, and `PluginHealthCheckSchema`
// is not `.strict()`, so a bare deletion would be a SILENT STRIP (#3733,
// ADR-0104). Deliberately NO D2 conversion: the chain walks a normalized STACK,
// and `PluginHealthCheck` is not an authorable surface — no metadata-type
// binding, stack collection or manifest embed ever carried it, and nothing in
// the tree parses `PluginHealthCheckSchema` outside its own unit test — so a
// conversion would be a transform with no seam that ever runs. The D3 semantic
// entry `plugin-auto-restart-never-reinitialised` is the declaration, and the
// registration-time refusal in `PluginHealthMonitor.registerPlugin` is the door
// for the audience that exists.
export const entry = 'kernel/PluginHealthCheck:restartBackoff';
