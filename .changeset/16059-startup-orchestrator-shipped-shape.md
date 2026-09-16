---
"@objectstack/spec": minor
"@objectstack/core": minor
---

feat(spec,core)!: the startup contract describes what the kernel produces — the orchestrator vocabulary is retired and `PluginStartupResult` is declared once (#16059)

<!-- adr-0087: registered startup-orchestrator-retired -->

**BREAKING** — a published exported surface is removed, landing in the launch window as
`minor` (the lockstep convention: `major` is refused by `check-changeset-no-major`, and
breaking-ness is carried by this banner plus the ADR-0087 disposition above).

`@objectstack/spec` declared a plugin startup ORCHESTRATOR that was never built, and its
one shape that *is* real had drifted away from the kernel that produces it. The maintainer
ruling on this card keeps a startup-result contract, and makes it describe what the kernel
actually returns.

## What is removed

`IStartupOrchestrator` (`orchestrateStartup` / `rollback` / `checkHealth` /
`startWithTimeout`) and the three schemas it tied together. Nothing in any repository
implemented the interface and nothing parsed the schemas; `healthCheck` and `HealthStatus`
named a per-plugin startup health probe the runtime has never had.

| removed | from | what to write instead |
|:--|:--|:--|
| `IStartupOrchestrator` | `@objectstack/spec/contracts` | nothing — plugin startup is the kernel's own boot loop |
| `StartupOptionsSchema` / `StartupOptions` / `StartupOptionsParsed` | `@objectstack/spec/kernel`, `/contracts` | `startupTimeout` on the plugin; `rollbackOnFailure` on the kernel config |
| `StartupOptions.healthCheck` | (with the schema) | **no replacement** — no startup probe system exists |
| `HealthStatusSchema` / `HealthStatus` | `@objectstack/spec/kernel`, `/contracts` | **no replacement** — see above |
| `StartupOrchestrationResultSchema` / `StartupOrchestrationResult` | `@objectstack/spec/kernel` | `ObjectKernel.getPluginStartupDurations()` |

`StartupOptions.parallel` and `StartupOptions.context` have no replacement either: the
kernel starts plugins sequentially and passes its own `PluginContext`.

## What survives, re-declared

`PluginStartupResultSchema` / `PluginStartupResult` stay on both entries, rewritten to the
shape `@objectstack/core` has always returned from `ObjectKernel.startPluginWithTimeout()`.
`@objectstack/core` now **imports** that type instead of declaring a twin, so the two
cannot drift again.

| member | before (spec) | after (spec and core, one declaration) |
|:--|:--|:--|
| `plugin: { name, version? }` | required | **removed** — write `pluginName: string` |
| `pluginName` | absent | `string`, required |
| `success` | `boolean`, required | unchanged |
| `durationMs` | `number`, **required** | `number`, **optional** (absent when the plugin declares no `start()`) |
| `startTime` | absent (it was core's own deprecated alias) | **removed** — read `durationMs`, which always carried the same value |
| `error` | serializable projection | unchanged (a thrown `Error` satisfies it) |
| `timedOut` | absent | `boolean`, optional — set when the failure was the timeout |
| `health: HealthStatus` | optional | **removed** — no probe ever filled it |

**The one-line fix:** rename `plugin: { name }` to `pluginName`, delete `health`, and read
`durationMs` wherever you read `startTime`. All three old spellings are `retiredKey()`
tombstones on the surviving schema, so each is a `tsc` error at the construction site and a
parse error carrying the prescription.

`startTime` is the one member whose removal a reader can OBSERVE: `@objectstack/core`
populated it beside `durationMs` with the identical elapsed value, under its own ADR-0087
L1 deprecation, and `ObjectKernel.startPluginWithTimeout()` stops setting it here. Mirroring
it on the contract was the alternative and the tree refuses it — `check:duration-unit-keys`
(ruling B on #14478) fails an elapsed number whose key name carries no unit, and neither of
that rule's two schema-declared exemptions fits: it is not an `EpochMs` instant and it
mirrors no external standard. Renaming it to `startTimeMs` would mint a spelling nothing has
ever produced, for a member already documented as slated for removal.

For `@objectstack/core` consumers the members are unchanged; the one narrowing is that
`PluginStartupResult.error` is now typed as the serializable projection
(`name` / `message` / `stack?` / `code?`) rather than `Error`. The kernel still puts the
thrown instance there, so `result.error instanceof Error` still narrows — only code that
reads an `Error`-only member such as `cause` off it without that guard needs the guard.

## The retirement kit

Route 3 of the `spec-property-retirement` playbook: no authored document carried any of
the three defs, so there is no seam for a D2 conversion and no author to hand a tombstone
to. `RETIRED_DEFS_BY_MAJOR[18]` (`kernel/StartupOptions`, `kernel/HealthStatus`,
`kernel/StartupOrchestrationResult`) plus the D3 semantic entry
`startup-orchestrator-retired` **are** the declaration, and the three
`json-schema.manifest/kernel.json` keys plus their 16 `authorable-surface/kernel.json`
lines are deleted deliberately in this same change. The two keys of the SURVIVING result
schema (`plugin`, `health`) take the tombstone route instead, registered in
`RETIRED_KEYS_BY_MAJOR[18]`, because that def keeps emitting and its type is imported by
`@objectstack/core`.

Runtime behaviour is deliberately unchanged: nothing ever read the retired surfaces, and
the kernel boot loop is untouched.
