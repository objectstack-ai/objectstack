# ObjectStack Plugin Standards (OPS)

To facilitate **AI-Driven Development** and Human Code Review, all plugins in the ecosystem generally follow the "ObjectStack Plugin Standard" (OPS).

> **🎯 Goal:** Ensure an AI agent can instantly understand the project structure and know exactly where to create or modify files without searching.

---

## 1. Directory Structure: "Domain-First"

We recommend organizing code by **Business Domain (Module)** rather than technical file type. This keeps related logic (Schema, UI, Automation) co-located, fitting neatly into an AI's context window.

### Recommended Layout

```text
my-plugin/
├── package.json
├── objectstack.config.ts        # Plugin Entry Point
├── src/
│   ├── main.ts                  # Logic Entry (Exports)
│   │   
│   └── [module-name]/           # e.g., "project-management"
│       ├── [object].object.ts   # Database Schema
│       ├── [object].trigger.ts  # Backend Logic Hook
│       ├── [object].client.ts   # Frontend Logic
│       ├── [object].view.ts     # UI Layouts (Grid, Forms)
│       ├── [object].action.ts   # Custom Buttons/Actions
│       ├── [process].flow.ts    # Automation Flows
│       └── permissions.ts       # Module-specific permissions
```

### Example: CRM Plugin

```text
plugins/crm/
├── package.json
├── src/
│   ├── leads/
│   │   ├── lead.object.ts       # "lead" Object definition
│   │   ├── lead.trigger.ts      # "beforeInsert" logic
│   │   └── lead.view.ts         # "All Leads" grid view
│   │   
│   ├── sales/
│   │   ├── opportunity.object.ts
│   │   ├── opportunity.view.ts
│   │   └── quote.object.ts
│   │   
│   └── analytics/
│       └── sales-dashboard.dashboard.ts
```

---

## 2. File Naming Conventions

We use **Semantic Suffixes** to tell the AI exactly what a file contains.
Format: `snake_case_name.SUFIX.ts`

| Suffix | Purpose | Content Type |
| :--- | :--- | :--- |
| `*.object.ts` | **Data Schema** | `Data.ObjectSchema` (Zod) |
| `*.field.ts` | **Field Extensions** | `Data.FieldSchema` |
| `*.trigger.ts` | **Backend Logic** | Function Hooks (Before/After) |
| `*.app.ts` | **App Definition** | `UI.AppSchema` (Navigation) |
| `*.view.ts` | **UI Views** | `UI.ViewSchema` (Grid/Form) |
| `*.page.ts` | **Custom UI** | `UI.PageSchema` |
| `*.dashboard.ts` | **Analytics** | `UI.DashboardSchema` |
| `*.flow.ts` | **Automation** | `Automation.FlowSchema` |
| `*.router.ts` | **Custom API** | Express/Router definitions |

---

## 3. Implementation Rules for AI

### Rule #1: One Thing Per File
Ideally, define **one primary resource per file**.
*   ✅ `lead.object.ts` exports `LeadObject`.
*   ❌ `crm.ts` exports `LeadObject`, `ContactObject`, and `DealObject`.

*Why? It prevents huge files that get truncacted in AI context, and makes file-search reliable.*

### Rule #2: Explicit Typing
Always strictly type your exports using the `spec` definitions.

```typescript
import { ObjectSchema } from '@objectstack/spec/data';

// ✅ GOOD: AI knows exactly what this is
export const ProjectObject: ObjectSchema = {
  name: 'project',
  fields: { ... }
};
```

### Rule #3: The `index.ts` Barrier
Each module folder should have an `index.ts` that exports its public artifacts. This allows the manifest loader to simply import the module.

```typescript
// src/leads/index.ts
export * from './lead.object';
export * from './lead.trigger';
export * from './lead.view';
```

---

## 4. Context Tags (JSDoc)

To help AI understand the "intent" of a file, use a standard JSDoc header.

```typescript
/**
 * @domain CRM
 * @object Lead
 * @purpose Defines the structure of a Sales Lead and its status lifecycle.
 */
export const LeadObject = ...
```

---

## 5. Plugin Runtime Capabilities

The microkernel architecture provides the following runtime capabilities for plugins. The Zod schemas governing each capability live in `src/kernel/`.

### 5.1 Hot Reload — ~~`plugin-loading.zod.ts` → `PluginHotReloadSchema`~~ RETIRED in v17; one vocabulary survives

`PluginHotReloadSchema` was removed in v17 (#4914, ADR-0049 enforce-or-remove),
with the rest of the `manifest.loading` block (§5.2). It was the **dead one of
two** hot-reload vocabularies, and this page used to point at exactly that one:
an author following it configured `environment`, `productionSafety`, health
validation, auto-rollback, connection draining and `maxConcurrentReloads` — and
none of it was read by anything.

**The surviving vocabulary** is `plugin-lifecycle-advanced.zod.ts` →
`HotReloadConfigSchema`, carried on `AdvancedPluginLifecycleConfig.hotReload`.
That is the one with an implementation body behind it: `HotReloadManager` in
`packages/core/src/hot-reload.ts` reads it.

⚠️ **Status, stated honestly: a foundation, not a shipped capability.**
`HotReloadManager` exists and is unit-tested, but **no runtime composes one** —
the only constructions are its own test and
`packages/core/examples/phase2-integration.ts`. So configuring
`AdvancedPluginLifecycleConfig.hotReload` today does not give a running system
hot reload either. It is kept, unenforced, as the starting point if hot reload is
ever built for real; making it enforced is a separate decision (ADR-0049's
enforce leg) and deliberately **not** part of the #4914 retirement. Treat this
section as "one honest pointer", not as a feature you can turn on.

### 5.2 Plugin Isolation — ~~`plugin-loading.zod.ts` → `PluginSandboxingSchema`~~ REMOVED in v17

`PluginSandboxingSchema` — and the whole `manifest.loading` block that carried it
— was removed in v17 (#4914, ADR-0049 enforce-or-remove, maintainer ruling
2026-08-04). `Manifest.loading` is now a `retiredKey()` tombstone: authoring it
is a `tsc` error and a parse error carrying the fix.

It declared configurable sandbox **scope** (`automation-only` / `untrusted-only`
/ `all-plugins`), **isolation levels** (`none` / `process` / `vm` / `iframe` /
`web-worker`), IPC transports (`message-port` / `unix-socket` / `tcp` /
`memory`) and a service ACL (`allowedServices`) — and **none of it was ever
read**. A bare-name scan of objectstack, cloud and objectui (each with a control
probe) found every reference inside `packages/spec` itself: the declaration, its
own unit tests, the `Manifest.loading` embed and generated artifacts.

**Why this one was urgent rather than untidy.** An inert *security* control is
worse than an absent one, because it is believed. An author — very often an AI
(ADR-0033) — read this vocabulary as proof the platform isolates plugins, wrote
`loading: { sandboxing: { isolationLevel: 'process' } }`, got a clean parse, and
had **no isolation whatsoever**: no process, vm, iframe or web-worker boundary,
and `allowedServices` gating no call. That is ADR-0049 false compliance at its
sharpest, and it is why the ruling chose REMOVE over an `experimental` marker.

**What is real:** the plugin trust tier (`manifest.runtime`, ADR-0025 §3.6) and
the manifest permission declarations. If plugin isolation is ever built, it
returns via the enforce route of ADR-0049 through a new ADR — mechanism first,
vocabulary second.

### 5.3 Dynamic Loading — ~~`plugin-runtime.zod.ts`~~ REMOVED in v17

The whole module is gone (#4834, ADR-0049 enforce-or-remove). It declared runtime
load / unload / reload of plugins **without restarting the kernel** — sources
(`npm` / `local` / `url` / `registry` / `git`), integrity hashes, sandboxing,
graceful/forceful/drain unload, dependent-cascade policy — and **no runtime in
any repo ever implemented one of those operations**: a bare-name scan of
objectstack, cloud and objectui found zero references outside the declaration
itself, its own unit tests and the generated artifacts. Removed with the module:
`DynamicLoadRequestSchema`, `DynamicUnloadRequestSchema`,
`DynamicPluginResultSchema`, `PluginSourceSchema`, `DynamicPluginOperationSchema`
and every type alias. The `activationEvents` tombstone #4657 left on
`DynamicLoadRequest` goes with the shape that carried it, as did the
discovery/sandbox config island #3896 had already retired.

**What is real:** plugins are composed at boot. `defineStack` registers them and
the kernel runs `init` → `start`; the set is fixed until the process restarts.
Runtime loading, if it is ever built, returns via the enforce route of ADR-0049
through a new ADR — loader first, vocabulary second.

### 5.4 Plugin System Assessment Summary

| Capability | Status | Schema / Details |
| :--- | :--- | :--- |
| Plugin Registration | ✅ | `manifest.zod.ts` — `objectstack.config.ts` plugin array, ordered initialization |
| Lifecycle Hooks | ✅ | `plugin.zod.ts` — `init()` → `start()` → `healthCheck()` → `destroy()` |
| Service Registry | ✅ | `service-registry.zod.ts` — 17 services across 13 plugins via `ctx.registerService()` |
| Event Bus | ✅ | `events.zod.ts` — Pub/sub with pattern matching |
| Dependency Resolution | ✅ | `manifest.zod.ts` (`dependencies`) + `packages/core/src/plugin-order.ts` — `resolvePluginOrder` topologically orders plugins from each composed plugin's `dependencies` / `optionalDependencies`, erroring on a cycle or a missing hard dependency. (The `PluginDependencyResolution` *config* schema this row used to cite was inert and went with the `loading` block in #4914 — the capability is real, the configuration surface was not) |
| Health Checks | ✅ | `plugin-lifecycle-advanced.zod.ts` — Per-plugin health + system aggregation |
| Hot Reload | ⚠️ | **Foundation only, not enforced.** `plugin-lifecycle-advanced.zod.ts` → `HotReloadConfigSchema` is the surviving vocabulary and `HotReloadManager` (`packages/core/src/hot-reload.ts`) reads it — but no runtime composes one, so configuring it changes nothing today. The rival `PluginHotReloadSchema` was removed in v17 (#4914, ADR-0049): it had no reader at all. See §5.1 |
| Plugin Isolation | ❌ | **Not built.** The `PluginSandboxingSchema` vocabulary that declared it (scope, `process`/`vm`/`iframe`/`web-worker` isolation, IPC, `allowedServices` ACL) was removed in v17 (#4914, ADR-0049) — it had no runtime reader, so it isolated nothing while appearing to. Trust tiers (`manifest.runtime`) and permission declarations are the real surfaces. See §5.2 |
| Dynamic Loading | ❌ | **Not built.** The `plugin-runtime.zod.ts` vocabulary that declared it was removed in v17 (#4834, ADR-0049) — it had no runtime reader in any repo. Plugins are composed at boot; the set is fixed until restart |
