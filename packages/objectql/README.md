# @objectstack/objectql

The **Data Engine** for ObjectStack. It acts as a semantic layer between your application code and the underlying database.

## Features

- **Universal API**: A consistent query interface (`find`, `insert`, `update`, `delete`) regardless of the storage backend.
- **Schema Validation**: Enforces Zod schemas defined in `@objectstack/spec`.
- **Query Resolution**: Translates ObjectStack queries into driver-specific commands.
- **Driver Architecture**: Pluggable storage (Memory, MongoDB, SQL, etc.).
- **Schema Registry**: Centralized object/FQN management with multi-package ownership model.
- **Kernel Factory**: One-liner kernel bootstrap with `createObjectQLKernel()`.
- **Database Introspection**: Convert existing database schemas into ObjectStack metadata via `convertIntrospectedSchemaToObjects()`.
- **Metadata Facade**: Injectable `IMetadataService`-compatible wrapper over SchemaRegistry.

## Usage

### Querying Data

```typescript
import { ObjectQL } from '@objectstack/objectql';

const engine = kernel.getService('objectql');
const users = await engine.find('user', {
    where: { role: 'admin' },
    top: 10
});
```

### Kernel Factory

Create a fully wired ObjectKernel in one call:

```typescript
import { createObjectQLKernel } from '@objectstack/objectql';

const kernel = await createObjectQLKernel({
  plugins: [myDriverPlugin, myAuthPlugin],
});
await kernel.bootstrap();
```

### Database Introspection

Convert existing database tables into ObjectStack object definitions:

```typescript
import { convertIntrospectedSchemaToObjects } from '@objectstack/objectql';

const schema = await driver.introspectSchema();
const objects = convertIntrospectedSchemaToObjects(schema, {
  excludeTables: ['migrations', '_prisma_migrations'],
});

for (const obj of objects) {
  engine.registerObject(obj);
}
```

### Schema Registry

```typescript
import { SchemaRegistry, computeFQN } from '@objectstack/objectql';

// Register an object under a namespace
SchemaRegistry.registerObject(taskDef, 'com.acme.todo', 'todo');

// Resolve FQN
computeFQN('todo', 'task'); // => 'todo__task'
computeFQN('base', 'user'); // => 'user' (reserved namespace)
```

## Exported Components

| Export | Description |
| :--- | :--- |
| `ObjectQL` | Data engine implementing `IDataEngine` |
| `ObjectRepository` | Scoped repository bound to object + context |
| `ScopedContext` | Identity-scoped execution context with `object()` accessor |
| `SchemaRegistry` | Global schema registry (FQN, ownership, package management) |
| `MetadataFacade` | Async `IMetadataService`-compatible wrapper |
| `ObjectQLPlugin` | Kernel plugin that registers ObjectQL services |
| `ObjectStackProtocolImplementation` | Protocol implementation shim |
| `createObjectQLKernel()` | Async factory returning a pre-wired `ObjectKernel` |
| `toTitleCase()` | Convert `snake_case` to `Title Case` |
| `convertIntrospectedSchemaToObjects()` | DB schema → `ServiceObject[]` converter |

### Introspection Types

| Type | Description |
| :--- | :--- |
| `IntrospectedSchema` | Top-level schema with `tables` map |
| `IntrospectedTable` | Table metadata (columns, foreign keys, primary keys) |
| `IntrospectedColumn` | Column metadata (name, type, nullable, maxLength, …) |
| `IntrospectedForeignKey` | Foreign key relationship metadata |

## Migrating from `@objectql/core`

If you are migrating from the downstream `@objectql/core` package, see the
[Migration Guide](../../content/docs/deployment/migration-from-objectql.mdx) for
step-by-step instructions.

**Quick summary:**

```diff
- import { ObjectQL, SchemaRegistry, ObjectRepository } from '@objectql/core';
- import { createObjectQLKernel } from '@objectql/core';
- import { toTitleCase, convertIntrospectedSchemaToObjects } from '@objectql/core';
+ import { ObjectQL, SchemaRegistry, ObjectRepository } from '@objectstack/objectql';
+ import { createObjectQLKernel } from '@objectstack/objectql';
+ import { toTitleCase, convertIntrospectedSchemaToObjects } from '@objectstack/objectql';
```

## License

Apache-2.0. See [LICENSING.md](../../LICENSING.md).
