# Embedding ObjectQL as a library (`@objectstack/objectql/core`)

Minimal example of using the **ObjectQL data engine on its own** — no kernel, no
plugins, no metadata-management protocol. This is the path for a thin host (e.g.
a gateway, an edge worker, a CLI tool) that wants the query/CRUD engine and the
*same* object definitions as a full ObjectStack backend, without the platform.

## The point (ADR-0076 core tiering — Proposed; the `/core` boundary itself has shipped)

Import from the **lean entry**:

```ts
import { ObjectQL } from '@objectstack/objectql/core';
```

`@objectstack/objectql/core` exposes the engine, registry, hooks, and validation
only. It does **not** pull in `ObjectQLPlugin`, the kernel factory, or
`@objectstack/metadata-protocol` (the metadata-management layer), so none
of that lands in your bundle. (The batteries-included `@objectstack/objectql`
entry still re-exports everything for full hosts.)

The object here is an ordinary `ObjectSchema.create({...})` — identical to what
you would ship in a `*.object.ts` to a full backend. **One object model, two
hosts; only the installed capability set differs.**

## Run

```bash
pnpm --filter @objectstack/example-embed-objectql test   # smoke
```

See [`src/index.ts`](./src/index.ts) for the ~40-line embed.
