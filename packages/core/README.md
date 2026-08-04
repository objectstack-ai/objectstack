# @objectstack/core

> ObjectStack microkernel — dependency injection, plugin lifecycle, event bus, and service registry for metadata-driven runtimes.

[![npm](https://img.shields.io/npm/v/@objectstack/core.svg)](https://www.npmjs.com/package/@objectstack/core)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](../../LICENSING.md)

## Overview

`@objectstack/core` is the foundation every ObjectStack runtime is built on. It hosts two kernels, a plugin lifecycle, a typed service registry, a structured logger, and a plugin-to-plugin event bus:

- **`ObjectKernel`** — full-featured production kernel with hot reload, health monitoring, dependency resolution, and namespace isolation.
- **`LiteKernel`** — minimal kernel for serverless, edge, and test environments.

All other ObjectStack runtime packages (`runtime`, `rest`, `plugin-*`, `driver-*`, `service-*`) plug into a kernel instance.

## Installation

```bash
pnpm add @objectstack/core
```

## Quick Start

```typescript
import { ObjectKernel } from '@objectstack/core';

const kernel = new ObjectKernel();

kernel.use({
  name: 'my-plugin',
  version: '1.0.0',
  async init(ctx) {
    ctx.logger.info('plugin initializing…');
    ctx.registerService('greeter', { hello: (n: string) => `hi ${n}` });
  },
  async start(ctx) {
    const svc = ctx.getService<{ hello: (s: string) => string }>('greeter')!;
    ctx.logger.info(svc.hello('world'));
  },
});

await kernel.bootstrap();
// …
await kernel.shutdown();
```

### LiteKernel (serverless/edge/tests)

```typescript
import { LiteKernel } from '@objectstack/core';

const kernel = new LiteKernel();
await kernel.bootstrap();
```

## Key Exports

| Export | Kind | Description |
|:---|:---|:---|
| `ObjectKernel` | class | Production kernel with DI, lifecycle, event bus, hot reload, health monitor. |
| `LiteKernel` | class | Minimal kernel for constrained runtimes. |
| `Plugin` | interface | Plugin contract (`init`, `start`, `stop`, lifecycle hooks). |
| `PluginContext` | interface | `{ logger, registerService, getService, eventBus, kernel }`. |
| `ObjectLogger` | class | Structured logger over pino; swappable backends. |
| `QA` | namespace | Built-in kernel self-tests. |
| `PackageManager` | class | Per-package DI namespace resolver. |

## Plugin lifecycle

```
use()  → init()  → start()  → [running]  → stop()  → unload()
```

- **`init(ctx)`** — register services, wire dependencies. Do not make network calls.
- **`start(ctx)`** — resolve other services, begin work. Called after every plugin's `init()`.
- **`stop(ctx)`** — graceful shutdown, flush, close connections.
- **`kernel.unload(name)`** — runtime removal; pairs with `AppPlugin.onDisable()`.

## Kernel choice

| Kernel | Use when |
|:---|:---|
| `ObjectKernel` | Default. Production servers, Studio, tests that need plugin composition. |
| `LiteKernel` | Cloudflare Workers, Vercel Edge, Vitest unit tests, footprint-sensitive sandboxes. |

`EnhancedObjectKernel` has been **removed**. Migrate to `ObjectKernel`.

## Observability

- `ObjectLogger` is backed by pino; control verbosity with `LOG_LEVEL=info|debug|trace`.
- `kernel.getHealth()` returns per-plugin health snapshots.
- EventBus: `ctx.eventBus.on('plugin.started', …)`, `.emit(…)`.

## When to use

- ✅ Building an ObjectStack application (always).
- ✅ Authoring a plugin, driver, or service.

## When not to use

- ❌ You only need the schemas — import [`@objectstack/spec`](../spec) alone.
- ❌ You only need a REST client — import [`@objectstack/client`](../client).

## Related Packages

- [`@objectstack/spec`](../spec) — protocol definitions.
- [`@objectstack/runtime`](../runtime) — `DriverPlugin` / `AppPlugin` scaffolds.
- [`@objectstack/rest`](../rest) — auto-generated REST layer.

## Links

- 📖 Docs: <https://objectstack.ai/docs>
- 📚 API Reference: <https://objectstack.ai/docs/references/kernel>
- 🤖 Skill: [`skills/objectstack-platform/SKILL.md`](../../skills/objectstack-platform/SKILL.md)

## License

Apache-2.0. See [LICENSING.md](../../LICENSING.md).
