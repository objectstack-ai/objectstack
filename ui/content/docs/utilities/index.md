---
title: "Utilities & Tools"
description: "Command-line tools and utilities for ObjectUI development"
---

# Utilities & Tools

ObjectUI provides a comprehensive suite of command-line tools and utilities to streamline your development workflow. These tools help you scaffold projects, create plugins, integrate with data sources, and develop with enhanced tooling support.

## Quick Navigation

Browse available utilities:

### Development Tools

- **[CLI](/docs/utilities/cli)** - Project scaffolding and development server
- **[Create Plugin](/docs/utilities/create-plugin)** - Plugin template generator
- **[Runner](/docs/utilities/runner)** - Universal application runtime

### Data Integration

- **[ObjectStack Adapter](/docs/utilities/data-objectstack)** - Connect to ObjectStack backend

### Editor Extensions

- **[VS Code Extension](/docs/utilities/vscode-extension)** - Schema editor and IntelliSense

## Official Utilities

### CLI

**[@object-ui/cli](/docs/utilities/cli)** - Command-line interface for scaffolding and running ObjectUI applications.

- Project scaffolding from JSON schemas
- Built-in development server (Express + Vite)
- JSON/YAML schema support
- Hot module reloading

```bash
npm install -g @object-ui/cli
objectui --help
```

[Read full documentation →](/docs/utilities/cli)

---

### Create Plugin

**[@object-ui/create-plugin](/docs/utilities/create-plugin)** - Interactive CLI tool for creating ObjectUI plugins.

- Plugin template generation
- Interactive configuration prompts
- Best practices scaffolding
- TypeScript support

```bash
npm install -g @object-ui/create-plugin
create-plugin my-awesome-plugin
```

[Read full documentation →](/docs/utilities/create-plugin)

---

### Runner

**[@object-ui/runner](/docs/utilities/runner)** - Universal runtime for running ObjectUI applications.

- Standalone demo application
- Plugin testing environment
- Development playground
- Example implementations

```bash
cd packages/runner
pnpm dev
```

[Read full documentation →](/docs/utilities/runner)

---

### ObjectStack Adapter

**[@object-ui/data-objectstack](/docs/utilities/data-objectstack)** - Data adapter for connecting to ObjectStack backends.

- ObjectStack client integration
- Automatic data binding
- CRUD operations support
- Query builder integration

```bash
npm install @object-ui/data-objectstack @objectstack/client
```

[Read full documentation →](/docs/utilities/data-objectstack)

---

### VS Code Extension

**[object-ui](/docs/utilities/vscode-extension)** - Visual Studio Code extension for ObjectUI schema development.

- Schema preview
- JSON validation
- IntelliSense and auto-completion
- Syntax highlighting
- Export to React components
- Schema formatting

```bash
# Install from VS Code Marketplace
code --install-extension objectui.object-ui
```

[Read full documentation →](/docs/utilities/vscode-extension)

---

## How Utilities Work

### CLI Workflow

The ObjectUI CLI provides a streamlined workflow for building applications:

```bash
# 1. Create a new project
objectui init my-app

# 2. Start the development server
cd my-app
objectui dev

# 3. Build for production
objectui build
```

### Plugin Development Workflow

Creating plugins is simplified with the create-plugin utility:

```bash
# 1. Generate plugin scaffold
create-plugin my-plugin

# 2. Implement your component
cd my-plugin/src
# Edit index.tsx

# 3. Test your plugin
pnpm dev

# 4. Publish to npm
pnpm publish
```

### Data Integration

Connect to ObjectStack backends with the data adapter. `@object-ui/data-objectstack`
is **headless** — it exports no React components and no hooks. You create a plain
`DataSource` with `createObjectStackAdapter` and inject it at the renderer boundary
through `@object-ui/react`'s `SchemaRendererProvider`:

```tsx
import { createObjectStackAdapter } from '@object-ui/data-objectstack';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import type { ObjectGridBlockNode } from '@object-ui/types';

const dataSource = createObjectStackAdapter({
  baseUrl: 'https://api.example.com',
  token: 'your-api-token', // optional when auth is handled elsewhere
});

// The block's props go in its `properties` bag, as `@objectstack/spec` declares them.
const schema: ObjectGridBlockNode = {
  type: 'object-grid',
  properties: {
    objectName: 'account',
    columns: ['name', 'owner', 'created'],
  },
};

export function App() {
  return (
    <SchemaRendererProvider dataSource={dataSource}>
      <SchemaRenderer schema={schema} />
    </SchemaRendererProvider>
  );
}
```

`new ObjectStackAdapter(config)` is the class form of the same factory, and
`SchemaRenderer` also takes an explicit `dataSource` prop when you would rather
inject per render than through context. See
[ObjectStack Data Adapter](/docs/utilities/data-objectstack) for the full config,
the API reference, and how a schema node's own `dataSource` key (the spec's
per-element binding — *what* to query, not *how* to reach the backend) differs
from the adapter above.

## Features

All ObjectUI utilities share these characteristics:

- ✅ **Easy to Use** - Simple CLI interfaces
- ✅ **Best Practices** - Follow framework conventions
- ✅ **Type-Safe** - Full TypeScript support
- ✅ **Well Documented** - Comprehensive guides
- ✅ **Actively Maintained** - Regular updates

## Next Steps

- **[CLI Documentation](/docs/utilities/cli)** - Learn how to use the ObjectUI CLI
- **[Create Plugin Guide](/docs/utilities/create-plugin)** - Build your first plugin
- **[VS Code Extension](/docs/utilities/vscode-extension)** - Set up your development environment
- **[Plugin Concepts](/docs/guide/plugins)** - Learn how plugins work in detail

## Need Help?

Can't find what you're looking for? Check out:

- [Guide](/docs/guide) - Core concepts and guides
- [Plugins](/docs/plugins) - Explore available plugins
- [GitHub](https://github.com/objectstack-ai/objectui) - Report issues or contribute
