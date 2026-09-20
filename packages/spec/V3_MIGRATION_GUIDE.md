# ObjectStack v3.0 Migration Guide

> **Target Release:** Q2 2026  
> **Breaking Changes:** Deprecated items removed, hub module consolidated  
> **Prerequisite:** Ensure your project is on v2.x with all deprecation warnings resolved

---

## Summary of Breaking Changes

| Category | Change | Impact |
|----------|--------|--------|
| Hub Module Removal | `Hub.*` namespace removed from barrel exports | Medium |
| Runtime Helper Removal | `createErrorResponse()`, `getHttpStatusForCategory()`, `definePlugin()` removed from spec, with no replacement export | Medium |
| Deprecated Field Removal | `location` (singular) removed from ActionSchema | Low |
| Deprecated Schema Aliases | `RealtimePresenceStatus`, `RealtimeAction`, `RateLimitSchema` removed | Low |

---

## 1. Hub Module Removal

### What Changed

The `hub/` directory has been removed. Previously it re-exported schemas from `system/` and `kernel/`:

```typescript
// ❌ v2.x — REMOVED in v3.0, shown so you can find it in your own code and
// delete it. ⛔ Do not copy this block: `@objectstack/spec/hub` is in no
// `exports` entry and the `Hub` namespace is off the root barrel, so neither
// line resolves for any consumer today. The ✅ replacement is below.
import { TenantSchema } from '@objectstack/spec/hub';
import { Hub } from '@objectstack/spec';
const tenant = Hub.TenantSchema.parse({ ... });
```

### How to Migrate

Import directly from the canonical module locations:

```typescript
// ✅ v3.0
import { TenantSchema } from '@objectstack/spec/system';
import { PluginRegistryEntrySchema } from '@objectstack/spec/kernel';
```

**Full Mapping:**

| v2.x Hub Import | v3.0 Direct Import |
|------------------|-------------------|
| `hub/tenant.zod` | `system/tenant.zod` |
| `hub/license.zod` | `system/license.zod` |
| `hub/registry-config.zod` | `system/registry-config.zod` |
| `hub/plugin-registry.zod` | `kernel/plugin-registry.zod` |
| `hub/plugin-security.zod` | `kernel/plugin-security.zod` |

---

## 2. Runtime Helper Removal

### What Changed

Three helper functions that carried runtime logic were **removed** from `@objectstack/spec`. The spec package should contain only schema definitions.

> **⚠️ Removed, ⛔ not relocated — there is no replacement import.** An earlier
> revision of this guide said these helpers had "moved to
> `@objectstack/core/errors`" and `@objectstack/core/plugin`. **That move never
> happened.** `@objectstack/core` publishes exactly two entry points —
> `@objectstack/core` and `@objectstack/core/logger` — so neither of those
> subpaths resolves for any consumer, and the three symbols themselves exist
> nowhere in the codebase. The v3.0 change deleted them outright.

### Functions Removed from Spec

| Function | Previous Location | v3.0 disposition |
|----------|-------------------|------------------|
| `createErrorResponse()` | `api/errors.zod.ts` | Removed — no replacement export |
| `getHttpStatusForCategory()` | `api/errors.zod.ts` | Removed — no replacement export |
| `definePlugin()` | `kernel/plugin.zod.ts` | Removed — no replacement export |

### How to Migrate

Delete the import and inline what you were using. There is no ✅ counterpart to
paste, because nothing was published to replace these:

- **`createErrorResponse()` / `getHttpStatusForCategory()`** — `ErrorResponseSchema` still
  describes the error envelope, so build the object you need and validate it against that
  schema directly.
- **`definePlugin()`** — a plugin is an ordinary object or class matching the `Plugin`
  interface exported from `@objectstack/core` (`init` / `start` / `destroy`); no wrapper
  function is involved.

```typescript
// ❌ v2.x — REMOVED in v3.0, shown so you can find these imports in your own
// code and delete them. ⛔ Do not copy this block.
import { createErrorResponse, getHttpStatusForCategory } from '@objectstack/spec/api';
import { definePlugin } from '@objectstack/spec/kernel';
```

> **Note:** `ErrorResponseSchema` remains in `@objectstack/spec`, exported from the
> `@objectstack/spec/api` entrypoint. The removal took the runtime helper functions only.
> ⛔ `PluginDefinitionSchema` is **not** among the survivors — it is exported from no
> entrypoint today.

---

## 3. Deprecated Field Removal

### ActionSchema: `location` → `locations`

```typescript
// ❌ v2.x (removed in v3.0)
const action = {
  name: 'approve',
  type: 'button',
  location: 'list_view',     // singular string
};

// ✅ v3.0
const action = {
  name: 'approve',
  type: 'button',
  locations: ['list_view'],  // array of strings
};
```

---

## 4. Deprecated Schema Aliases Removed

### Realtime Protocol

```typescript
// ❌ v2.x aliases (removed in v3.0)
import { RealtimePresenceStatus, RealtimeAction } from '@objectstack/spec/api';

// ✅ v3.0 canonical names
import { PresenceStatus, RealtimeRecordAction } from '@objectstack/spec/api';
```

### Rate Limiting

```typescript
// ❌ v2.x alias (removed in v3.0)
import { RateLimitSchema } from '@objectstack/spec/api';

// ✅ v3.0 canonical location
import { RateLimitConfigSchema } from '@objectstack/spec/shared';
```

---

## 5. Events Module Restructuring

### What Changed

`kernel/events.zod.ts` (765 lines) has been split into focused internal sub-modules. The barrel export remains backward-compatible — all event schemas continue to be available from the `@objectstack/spec/kernel` entrypoint. No migration is required.

```typescript
// ✅ Continue to import from the kernel entrypoint (no change needed)
import { EventBusConfigSchema, EventSchema, EventPriority } from '@objectstack/spec/kernel';
```

> **Note:** The `kernel/events/*` sub-modules are an internal source-code organization detail.
> External code should always import from `@objectstack/spec/kernel`.

---

## Migration Checklist

- [x] Replace all `Hub.*` imports with direct `system/` or `kernel/` imports
- [ ] Drop `createErrorResponse()` / `getHttpStatusForCategory()` — removed from spec in v3.0 and ⛔ **not** relocated; there is no replacement import (see §2)
- [ ] Drop `definePlugin()` — removed from spec in v3.0 and ⛔ **not** relocated; there is no replacement import (see §2)
- [x] Replace `location` with `locations` in ActionSchema definitions
- [x] Replace `RealtimePresenceStatus` with `PresenceStatus`
- [x] Replace `RealtimeAction` with `RealtimeRecordAction`
- [x] Replace `RateLimitSchema` with `RateLimitConfigSchema` from `@objectstack/spec/shared`
- [x] (No action needed) Events module restructuring is internal; imports from `@objectstack/spec/kernel` continue to work

---

## Automated Migration

Use the ObjectStack CLI to detect deprecated usage:

```bash
# Check for deprecated imports
objectstack validate --strict

# Run the migration codemod (when available)
objectstack migrate --from 2.x --to 3.0
```

---

**Last Updated:** 2026-02-11  
**Maintainers:** ObjectStack Core Team
