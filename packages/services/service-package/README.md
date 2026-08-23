# @objectstack/service-package

> Runtime package publishing, retrieval, and lifecycle management for ObjectStack — the storage layer behind the dynamic marketplace.

[![npm](https://img.shields.io/npm/v/@objectstack/service-package.svg)](https://www.npmjs.com/package/@objectstack/service-package)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](../../../LICENSING.md)

## Overview

`service-package` persists ObjectStack packages — the unit of metadata distribution consisting of a `manifest` plus its `objects`, `views`, `apps`, `flows`, `agents`, `tools`, and `translations` — into the `sys_packages` system table so they can be published, listed, and delivered to runtime kernels that load them. In this repo the loading half is `@objectstack/cloud-connection`, whose `MarketplaceInstallLocalPlugin` installs a marketplace package into the local kernel through the `manifest` service.

Typical consumers:

- **Marketplace servers** that host first-party and third-party packages.
- **Self-hosted platforms** that want an internal registry for tenants' custom metadata.
- **CI pipelines** that publish package artifacts from a Git repository.

## Installation

```bash
pnpm add @objectstack/service-package
```

## Quick Start

```typescript
import { ObjectKernel } from '@objectstack/core';
import { PackageServicePlugin, type PackageService } from '@objectstack/service-package';

const kernel = new ObjectKernel();

// Register after a driver/ObjectQL plugin so `ctx.getService('objectql')` resolves.
kernel.use(new PackageServicePlugin());

await kernel.bootstrap();

const packages = kernel.getService<PackageService>('package')!;

await packages.publish({
  manifest: {
    id: 'crm',
    version: '1.2.0',
    name: 'CRM Package',
    /* …full ObjectStackManifest… */
  },
  metadata: {
    objects: [/* … */],
    views:   [/* … */],
    apps:    [/* … */],
  },
});

const latest = await packages.get('crm'); // defaults to 'latest'
const all    = await packages.list();
await packages.delete('crm', '1.0.0');
```

## Key Exports

| Export | Kind | Description |
|:---|:---|:---|
| `PackageServicePlugin` | class (default) | Kernel plugin that installs the service and ensures the `sys_packages` table exists. |
| `PackageService` | interface | Service contract registered under `'package'`: `publish`, `get`, `list`, `delete`. |
| `PackageRecord` | type | Stored row shape: `id`, `version`, `manifest`, `metadata`, `hash`, `created_at`, `updated_at`. |
| `PackageMetadata` | type | Artifact container for `objects`, `views`, `apps`, `flows`, `agents`, `tools`, `translations`. |

## Behavior

- **Upsert by (id, version)** — re-publishing the same version overwrites `manifest`, `metadata`, `hash`, and `updated_at`.
- **Integrity hash** — SHA-256 of `{ manifest, metadata }` is computed on publish and stored alongside the row.
- **`get(id, 'latest')`** resolves to the most recently inserted version. Use an explicit version string for pinned lookups.
- **`list()`** returns the latest version per package, ordered by `created_at DESC`.
- **System bypass** — the service uses `IDataEngine.execute()` directly (raw SQL), so security/RLS middleware is not applied to registry storage; callers are responsible for authorizing publish/delete at their API layer.

## Storage Schema

`service-package` creates (idempotently) the following table on `start()`:

```sql
CREATE TABLE IF NOT EXISTS sys_packages (
  id         TEXT NOT NULL,
  version    TEXT NOT NULL,
  manifest   TEXT NOT NULL,
  metadata   TEXT NOT NULL,
  hash       TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id, version)
);

CREATE INDEX IF NOT EXISTS idx_packages_latest
  ON sys_packages(id, created_at DESC);
```

## Requirements

- A driver plugin that registers an `IDataEngine` under the service name `'objectql'` with `execute()` support — typically [`@objectstack/driver-sql`](../../drivers/driver-sql). `@objectstack/driver-memory` can be used for tests but does not persist across restarts. (ObjectStack Cloud additionally ships `@objectstack/driver-turso` for edge/multi-tenant.)

## When to use

- ✅ Building a marketplace backend or internal package registry.
- ✅ Distributing metadata-only packages to many runtime instances.
- ✅ Versioned audit trail of schema/UI/flow changes.

## When not to use

- ❌ Not a package manager for npm/TypeScript source packages — use npm.
- ❌ Not a runtime plugin loader — pair with `@objectstack/cloud-connection`'s
  `MarketplaceInstallLocalPlugin`, or a custom loader, for that.

## Related Packages

- [`@objectstack/core`](../../core) — kernel hosting this plugin.
- [`@objectstack/spec`](../../spec) — provides `ObjectStackManifest` and `IDataEngine` contracts.
- [`@objectstack/driver-sql`](../../drivers/driver-sql) — supplies the `'objectql'` service. (ObjectStack Cloud also ships `@objectstack/driver-turso`.)

## Links

- 📖 Docs: <https://objectstack.ai/docs>
- 📚 API Reference: <https://objectstack.ai/docs/references>
- 🧭 Protocol: <https://objectstack.ai/docs/protocol>
- 🧪 Examples: [`examples/`](../../../examples)

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).
