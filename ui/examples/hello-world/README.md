# Hello World — ObjectUI

A minimal example showing the **JSON → UI** flow: define a UI in JSON, render it with `SchemaRenderer`.

## What it demonstrates

1. **Schema** (`schema.json`) — a `Page` containing a `Card` with text and a button
2. **Renderer** (`App.tsx`) — passes the schema to `<SchemaRenderer>` which resolves each `type` from the component registry

## Files

```
examples/hello-world/
├── schema.json      # JSON UI definition
├── App.tsx          # React entry point
├── package.json
└── README.md
```

## How to run

```bash
# From the monorepo root
pnpm install

# Use App.tsx inside your own Vite/Next.js app.
```

## Learn more

- [BYO Backend Console](../byo-backend-console/) — add ObjectUI to an existing product with your own REST/GraphQL backend (~100 lines: custom `DataSource` + router)
- [Console Starter](../console-starter/) — fork it to stand up a brand-new ObjectStack console, with the full plugin set already wired
- [Schema Catalog](../schema-catalog/) — canonical JSON schemas used across docs & tests
