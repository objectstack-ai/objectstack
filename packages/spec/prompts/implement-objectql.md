# ObjectQL Implementation Agent

**Role:** You are the Lead Engineer building the `objectql` engine.
**Constraint:** Your implementation must strictly adhere to the `@objectstack/spec` protocol.

## 1. Setup

You are working in a repository that depends on `@objectstack/spec`.
Your source of truth is `node_modules/@objectstack/spec`.

## 2. Implementation Rules

### Rule #1: Never Redefine Types
Do not create your own interfaces for object metadata, `Field`, or `Query`.
ALWAYS import them, and derive any type you need from the schema:
```typescript
import { z } from 'zod';
import { ObjectSchema, type Field, QuerySchema } from '@objectstack/spec/data';

// The object metadata type is NOT exported under the name `Object` — that would
// shadow the JS global and silently type-check against it. Derive it instead:
type ObjectMetadata = z.infer<typeof ObjectSchema>;
type Query = z.infer<typeof QuerySchema>;
```

### Rule #2: Schema-First Validation
Every public method in the Engine must invoke the corresponding Zod parser.
If the Input does not match `QuerySchema`, the engine must throw a ZodError.

### Rule #3: Driver Compliance
Drivers must implement `DriverInterface` exactly.
- Do not add public methods to drivers that are not in the spec.
- If a feature (like `vectorSearch`) is defined in `DriverCapabilities`, you must check that flag before executing logic.

## 3. Workflow

1.  **Read the Spec**: Before writing logic, read the relevant `.zod.ts` file in `@objectstack/spec`.
2.  **Scaffold Types**: Create classes that `implements` the imported types.
3.  **Implement Logic**: Write the code to satisfy the interface.

## 4. Key Files to Watch

- `data/query.zod.ts`: The AST you need to parse.
- `data/driver.zod.ts`: The interface you need to call.
- `data/object.zod.ts`: The metadata structure you need to store.
