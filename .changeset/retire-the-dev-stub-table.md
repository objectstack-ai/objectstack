---
'@objectstack/plugin-dev': minor
---

feat(plugin-dev)!: the stub table is retired — DevPlugin assembles real plugins and registers no service implementations of its own (ADR-0115, #4093, #4104).

DevPlugin used to fill every core-service slot no real plugin occupied with a dev stub. Every one of those stubs is gone. A slot nothing fills now stays EMPTY, exactly as in production: routes answer 404/501, discovery reports `unavailable`, and in-process consumers must handle absence — which production already required of them. FROM → TO per retired slot:

| Slot | The stub did | Instead |
|:---|:---|:---|
| `security.permissions` | allow-all `checkObjectPermission()` | install `@objectstack/plugin-security` (already part of the default assembly) |
| `security.rls` | compiled no row filter | same — `plugin-security` |
| `security.fieldMasker` | returned results unmasked | same — `plugin-security` |
| `auth` | `verify()` accepted everyone as admin | install `@objectstack/plugin-auth` (already part of the default assembly) |
| `data` | accepted writes, stored nothing | install `@objectstack/objectql` (already part of the default assembly) |
| `ui` | shapeless `{}` placeholder | nothing consumed it; handle the absent slot |
| `ai` | placeholder chat/complete answers | install a real AI service |
| `automation` | `execute()` reported success without running | install an automation engine plugin |
| `notification` | claimed "sent", delivered nothing | install a notification service |
| `file-storage` | in-memory files lost on restart | `@objectstack/service-storage` — now auto-wired by DevPlugin when installed (local-disk adapter) |
| `realtime` | in-process pub/sub copy | `@objectstack/service-realtime` — now auto-wired by DevPlugin when installed (its default in-memory adapter) |
| `search` | in-memory substring index | no consumer resolves this slot; a future search service ships its own dev strategy |
| `workflow` | unvalidated state transitions | no consumer resolves this slot; a future workflow service ships its own dev strategy |
| `metadata` | a second hand-written copy of core's `createMemoryMetadata` | no behavior change — the kernel pre-injects core's fallback for empty core slots (`CORE_FALLBACK_FACTORIES`), and ObjectQL registers the real metadata service in the default assembly |
| `cache` / `queue` / `job` / `i18n` | re-registered core's `createMemory*` fallbacks | no behavior change — the kernel pre-injects the same core fallbacks automatically; install `@objectstack/service-cache` / `service-queue` / `service-job` for real engines, and i18n auto-wires from the stack's translations (unchanged) |

Also new, from the same ADR:

- **Production guard** (first shipped with the security-trio subset): `DevPlugin.init()` throws when `NODE_ENV === 'production'` — the assembly is built around a well-known default auth secret and a seeded dev admin. Escape hatch: `OS_ALLOW_DEV_PLUGIN=1`.
- **Assembly auto-wire**: `@objectstack/service-storage` and `@objectstack/service-realtime` are wired as optional child plugins when installed (both ship with DevPlugin's dependencies), so dev keeps working file storage and realtime through real implementations.
- `options.services` keys for the retired stubs are accepted and ignored; `'file-storage'` / `'realtime'` now toggle the real service wiring.

One-line fix for an upgrading stack: if something you called in dev now throws "service not found" or 404s, that call was consuming a fabricated answer — install the real service for that slot (table above), or make the caller tolerate absence the way it already must in production.
