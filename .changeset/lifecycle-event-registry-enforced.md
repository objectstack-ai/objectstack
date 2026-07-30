---
"@objectstack/spec": major
"@objectstack/core": patch
---

fix(spec)!: retire the never-built typed-event system; the lifecycle registry now lists the events that actually fire (#4212 follow-up)

The lifecycle-event surface promised a typed-event system that was never
built, in three layers. `kernel/plugin-lifecycle-events.zod.ts` shipped ten
payload schemas (`PluginRegisteredEvent`, `PluginErrorEvent`,
`HookTriggeredEvent`, `KernelReadyEvent`, …) and a 21-name
`PluginLifecycleEventType` enum — zero consumers for every export, and the
enum was wrong in both directions: 17 names nothing fires, 10 real events
missing. `contracts/plugin-lifecycle-events.ts` declared the same 17 dead
names in `IPluginLifecycleEvents` next to 5 real ones, plus an
`ITypedEventEmitter` interface nothing implements. All of it read as a
promise; anyone who coded against it (hooking `plugin:started`, awaiting
`plugin:error`) registered a handler that could never fire, with no error
saying so — the same silent-drop shape as the #4212 lifecycle-hook family.

Removed, with zero consumers verified repo-wide:

- `kernel/plugin-lifecycle-events.zod.ts` and every export: `EventPhase`,
  `PluginEventBase`, `PluginRegisteredEvent`, `PluginLifecyclePhaseEvent`,
  `PluginErrorEvent`, `ServiceRegisteredEvent`, `ServiceUnregisteredEvent`,
  `HookRegisteredEvent`, `HookTriggeredEvent`, `KernelEventBase`,
  `KernelReadyEvent`, `KernelShutdownEvent`, `PluginLifecycleEventType`
  (schemas and inferred types).
- `ITypedEventEmitter` from `contracts/plugin-lifecycle-events.ts`.
- The 17 never-fired names from `IPluginLifecycleEvents`.

`IPluginLifecycleEvents` is now the registry of the **14 events with a real
emitter** — `kernel:{ready,bootstrapped,listening,shutdown}`, `app:seeded`,
`metadata:reloaded` (payload `metadata` now optional, matching the documented
contract), `external.schema.drift`, `ai:routes`, `auth:configure`, and the
`{service}:ready` convention family (`mcp`, `automation`, `analytics`,
`external-datasource`, `datasource-admin`) — each payload as observed at its
fire site. A new `LifecycleEventName` union types
`PluginContext.hook`/`trigger` in `@objectstack/core` as
`LifecycleEventName | (string & {})`: known names autocomplete, custom
cross-plugin names stay legal, existing callers compile unchanged. A pinning
test asserts two-way equality between the interface keys and the fire-site
inventory.

FROM → TO:

- `PluginLifecycleEventType` → `LifecycleEventName` (the union of names that
  fire). There is no runtime enum; the bus is open by design.
- Event payload schemas (`KernelReadyEvent`, `PluginErrorEvent`, …) → the
  payload tuples on `IPluginLifecycleEvents`. No wire format existed or
  exists; payloads are in-process arguments.
- `ITypedEventEmitter` → `PluginContext.hook`/`trigger` (the emitter that
  actually exists).
- Handlers for the 17 dead names → delete them; they never ran. For plugin
  phase observation use the boot report (ADR-0084); for per-plugin errors the
  kernel throws/logs at the failing phase.

Plain deletion rather than `retiredKey()` tombstones, per the #4233
precedent: these keys were never authorable — they described runtime event
payload records no config author can write, so the silent-strip class the
authorable-surface ratchet guards against is vacuous. Its baseline entries
and the `json-schema.manifest.json` keys are dropped deliberately in this PR.
No ADR-0087 conversion: no stack metadata names these types; there is nothing
for `os migrate meta` to rewrite.
