# Platform — bootstrap examples and composition notes (moved verbatim from SKILL.md)

### Minimal Example

<!-- os:check -->
```typescript
import { defineStack } from '@objectstack/spec';
import { Field } from '@objectstack/spec/data';

export default defineStack({
  manifest: {
    id: 'com.example.todo',
    version: '1.0.0',
    type: 'app',
    name: 'Todo Manager',
  },
  objects: [
    {
      name: 'task',
      label: 'Task',
      fields: {
        title:    Field.text({ required: true }),
        status:   Field.select({ options: [
          { label: 'Open', value: 'open' },
          { label: 'Done', value: 'done' },
        ], defaultValue: 'open' }),
        due_date: Field.date(),
      },
    },
  ],
});
```

### Map Format (Key → Name)

All named collections support **map format** where the key becomes the `name` field:

```typescript
export default defineStack({
  // Array format (traditional)
  objects: [
    { name: 'task', fields: { title: Field.text() } },
  ],

  // Map format (key becomes name) — preferred for readability
  objects: {
    task: { fields: { title: Field.text() } },
    project: { fields: { name: Field.text() } },
  },
});
```

### Barrel Import Pattern

Use barrel exports to keep config clean:

```typescript
// src/objects/index.ts
export { default as task } from './task.object';
export { default as project } from './project.object';

// objectstack.config.ts
import * as objects from './src/objects';
import * as apps from './src/apps';
import * as views from './src/views';
import * as flows from './src/flows';

export default defineStack({
  manifest: { id: 'com.example.pm', namespace: 'pm', version: '1.0.0', type: 'app', name: 'PM' },
  objects: Object.values(objects),
  apps: Object.values(apps),
  views: Object.values(views),
  flows: Object.values(flows),
});
```

### Scaffolding Command

```bash
# Interactive — prompts for a name
npx create-objectstack

# Direct — skip prompts (blank is the default, and the only, template)
npx create-objectstack my-app
```

### Plugin Loading Order Matters

Plugins initialize in registration order. Key dependencies:

| Plugin | Depends On | Reason |
|:-------|:-----------|:-------|
| ObjectQLPlugin | (none) | Core data engine, should load first |
| DriverPlugin | (none) | Registers driver service |
| AppPlugin | ObjectQLPlugin | Registers objects/metadata with engine |
| AuthPlugin | ObjectQLPlugin | Needs user/session objects |
| RESTPlugin | ObjectQLPlugin, AppPlugin | Generates routes from registered objects |
| AIServicePlugin | ObjectQLPlugin, AppPlugin | Needs metadata for tool generation. **Cloud / EE only** — `@objectstack/service-ai` moved to cloud (cloud ADR-0025); the open edition has no in-UI AI plugin and uses `@objectstack/mcp` (BYO-AI) |

### Programmatic Bootstrap (Without CLI)

```typescript
import { Runtime, DriverPlugin, AppPlugin } from '@objectstack/runtime';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { InMemoryDriver } from '@objectstack/driver-memory';
import appConfig from './objectstack.config';

const runtime = new Runtime();
runtime.use(new ObjectQLPlugin());
runtime.use(new DriverPlugin(new InMemoryDriver()));
runtime.use(new AppPlugin(appConfig));
await runtime.start();

const kernel = runtime.getKernel();
// kernel is now ready — use it with an adapter
```

## Multi-App Composition

Host several apps in one runtime by registering an `AppPlugin` per app — this is
how real multi-app composition happens (`packages/cli/src/commands/serve.ts`).
Each app contributes its objects under their canonical `name`; names are
globally unique and equal the physical table name, so use them directly in
queries, hooks, formulas, and REST URLs.

A merge-at-authoring-time alternative, `composeStacks()`, exists in
`@objectstack/spec` (`stack.zod.ts`) with `objectConflict` /
`manifest` strategies. No app in this repo uses it — read the schema before
reaching for it.

## Complete Working Example

A minimal but complete project from scratch:

**`package.json`**:
```json
{
  "name": "my-todo-app",
  "type": "module",
  "scripts": {
    "dev": "objectstack dev",
    "start": "objectstack start",
    "build": "objectstack build",
    "validate": "objectstack validate"
  },
  "dependencies": {
    "@objectstack/spec": "^17.0.0",
    "@objectstack/runtime": "^17.0.0",
    "@objectstack/driver-memory": "^17.0.0",
    "@objectstack/plugin-hono-server": "^17.0.0"
  },
  "devDependencies": {
    "@objectstack/cli": "^17.0.0",
    "typescript": "^5.3.0"
  }
}
```

**`src/objects/task.object.ts`** — one `ObjectSchema.create({ … })` call. Field
types, `indexes:` and the rest of the object surface are **objectstack-data**'s;
the scaffolder's own `note.object.ts` is the shape to copy.

**`src/objects/index.ts`**:
```typescript
export { default as task } from './task.object';
```

**`objectstack.config.ts`**:
```typescript
import { defineStack } from '@objectstack/spec';
import * as objects from './src/objects';

export default defineStack({
  manifest: {
    id: 'com.example.todo',
    version: '1.0.0',
    type: 'app',
    name: 'Todo Manager',
  },
  objects: Object.values(objects),
});
```

```bash
# Run it
os dev --ui
# → Server at http://localhost:3000 (default port; dev auto-hops if taken)
# → REST API at http://localhost:3000/api
# → Console at http://localhost:3000/_console/
```
