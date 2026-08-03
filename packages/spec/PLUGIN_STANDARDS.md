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

### 5.1 Hot Reload (`plugin-loading.zod.ts` → `PluginHotReloadSchema`)

Hot reload supports **development, staging, and production** environments. The `environment` field controls the safety level:

| Environment | Behavior |
| :--- | :--- |
| `development` | Fast reload with file watchers, no health validation required |
| `staging` | Production-like reload with validation but relaxed rollback |
| `production` | Full safety: health validation, auto-rollback, connection draining |

Production safety features (`productionSafety`):
- **Health validation** — run health checks after reload before accepting traffic
- **Rollback on failure** — auto-rollback if reloaded plugin fails health check
- **Connection draining** — gracefully drain active requests before reloading
- **Concurrency control** — limit concurrent reloads (`maxConcurrentReloads`)
- **Reload cooldown** — minimum interval between reloads of the same plugin (≥1s)

### 5.2 Plugin Isolation (`plugin-loading.zod.ts` → `PluginSandboxingSchema`)

Sandboxing supports configurable **scope** and **isolation level**:

| Scope | Description |
| :--- | :--- |
| `automation-only` | Sandbox automation/scripting plugins only (default) |
| `untrusted-only` | Sandbox plugins below a trust threshold |
| `all-plugins` | Sandbox all plugins for maximum isolation |

Isolation levels: `none`, `process`, `vm`, `iframe`, `web-worker`.

**Inter-Plugin Communication (IPC):** Isolated plugins communicate with the kernel and other plugins via configurable IPC:
- Transports: `message-port`, `unix-socket`, `tcp`, `memory`
- Configurable message size limit, timeout, and service ACL (`allowedServices`)

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
| Dependency Resolution | ✅ | `plugin-loading.zod.ts` — Declared dependencies with conflict resolution |
| Health Checks | ✅ | `plugin-lifecycle-advanced.zod.ts` — Per-plugin health + system aggregation |
| Hot Reload | ✅ | `plugin-loading.zod.ts` — Dev + production-safe with rollback and draining |
| Plugin Isolation | ✅ | `plugin-loading.zod.ts` — Configurable scope + IPC for process boundaries |
| Dynamic Loading | ❌ | **Not built.** The `plugin-runtime.zod.ts` vocabulary that declared it was removed in v17 (#4834, ADR-0049) — it had no runtime reader in any repo. Plugins are composed at boot; the set is fixed until restart |
