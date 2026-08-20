# Project Bootstrap Patterns

Guide for bootstrapping ObjectStack projects with defineStack().

## Basic Stack Configuration

There is **no `driver:` key** on `defineStack()`. Drivers are plugins: wrap
them in `DriverPlugin` and put them in `plugins:`.

A `driver:` entry is **not** a harmless no-op. The top level of a stack
definition rejects undeclared keys, so the stack does not load:

```
defineStack validation failed (1 issue):

  ✗ (root): Unrecognized key(s) on this stack definition: `driver`. …
    The declared keys are enumerated by `ObjectStackDefinitionSchema`
    (@objectstack/spec, stack.zod.ts) and in the stack-definition
    reference docs.
```

TypeScript refuses it earlier still, at compile time:

```
error TS2353: Object literal may only specify known properties,
and 'driver' does not exist in type 'ObjectStackDefinitionInput'.
```

The `manifest` requires `id`, `version`, `type`, and `name`
(`ManifestSchema` is strict — a missing required field throws at
`defineStack()` time).

```typescript
import { defineStack } from '@objectstack/spec';
import { DriverPlugin } from '@objectstack/runtime';
import { InMemoryDriver } from '@objectstack/driver-memory';

export default defineStack({
  manifest: {
    id: 'com.example.crm',        // required — reverse domain style
    version: '1.0.0',             // required — semver
    type: 'app',                  // required
    name: 'My CRM',               // required — human-readable
    description: 'Customer relationship management system',
  },
  plugins: [
    new DriverPlugin(new InMemoryDriver()),
  ],
  objects: [
    /* ... */
  ],
});
```

For production, swap the driver:

```typescript
import { SqlDriver } from '@objectstack/driver-sql';

new DriverPlugin(new SqlDriver({
  client: 'pg',                      // 'pg' | 'mysql' | 'better-sqlite3'
  connection: process.env.DATABASE_URL!,
}))
```

## Driver Selection

| Driver | Package | Use Case |
|:-------|:--------|:---------|
| `InMemoryDriver` | `@objectstack/driver-memory` | Development, testing |
| `SqlDriver` | `@objectstack/driver-sql` | Production — PostgreSQL / MySQL / SQLite via Knex |
| `MongoDBDriver` | `@objectstack/driver-mongodb` | Production — document store |
| `SqliteWasmDriver` | `@objectstack/driver-sqlite-wasm` | Browser / WebContainer |
| `TursoDriver` | `@objectstack/driver-turso` | **Cloud / EE only** — not in the open framework; the open-core CLI fails loudly on `libsql://` URLs |

## HTTP Layer

| Package | Export | Use Case |
|:--------|:-------|:---------|
| `@objectstack/plugin-hono-server` | `HonoServerPlugin` | ObjectStack hosts the server (what `os dev` / `os serve` register) |
| `@objectstack/hono` | `createHonoApp({ kernel, prefix })` | Embed ObjectStack routes in your own Hono app / deploy target |

There are no `@objectstack/adapter-*` packages.

## Incorrect vs Correct

### ❌ Incorrect — `driver:` Key (Rejected at Load)

```typescript
export default defineStack({
  manifest: { id: 'com.example.app', version: '1.0.0', type: 'app', name: 'App' },
  driver: new DriverPlugin(new InMemoryDriver()),  // ❌ Not a defineStack key — defineStack throws
  objects: [/* ... */],
});
```

### ✅ Correct — Driver as a Plugin

```typescript
export default defineStack({
  manifest: { id: 'com.example.app', version: '1.0.0', type: 'app', name: 'App' },
  plugins: [new DriverPlugin(new InMemoryDriver())],  // ✅ plugins: collection
  objects: [/* ... */],
});
```

### ❌ Incorrect — Incomplete Manifest

```typescript
export default defineStack({
  manifest: {
    name: 'my-crm',          // ❌ Missing id, version, type — defineStack throws
  },
  objects: [/* ... */],
});
```

### ✅ Correct — Manifest with All Required Fields

```typescript
export default defineStack({
  manifest: {
    id: 'com.example.crm',
    version: '1.0.0',
    type: 'app',
    name: 'My CRM',
  },
  objects: [/* ... */],
});
```

## Best Practices

1. **Choose appropriate driver** — Match to deployment environment
2. **Use environment variables** — Don't hardcode credentials
3. **Complete the manifest** — `id`, `version`, `type`, `name` are required
4. **Put drivers in `plugins:`** — There is no `driver:` key
5. **Organize objects** — Group by domain/module

---

See parent skill for complete documentation: [../SKILL.md](../SKILL.md)
