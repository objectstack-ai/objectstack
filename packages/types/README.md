# @objectstack/types

Shared runtime type definitions for the ObjectStack ecosystem.

## Overview

This package provides common TypeScript interfaces and types used across the ObjectStack runtime environment. It serves as a minimal, dependency-light package that defines the core contracts between different parts of the system.

## Purpose

The `@objectstack/types` package exists to:

1. **Break Circular Dependencies** - Provides shared types without creating circular imports between packages
2. **Define Runtime Contracts** - Establishes interfaces that plugins and kernel must satisfy
3. **Enable Type Safety** - Ensures type compatibility across the ObjectStack ecosystem
4. **Minimal Footprint** - Ultra-lightweight with minimal dependencies

## 🤖 AI Development Context

**Role**: Shared Type Definitions
**Usage**:
- Use this to import interfaces like `IKernel`, `RuntimePlugin`.
- Helps avoid circular dependencies.
- **Do not** add implementation code here, only types.

## Installation

```bash
pnpm add @objectstack/types
```

## Type Definitions

### IKernel

Core interface for the ObjectStack kernel that plugins interact with.

```typescript
export interface IKernel {
  /**
   * ObjectQL instance (optional to support initialization phase)
   */
  ql?: any;
  
  /**
   * Start the kernel and all registered plugins
   */
  start(): Promise<void>;
  
  /**
   * Additional kernel methods and services
   */
  [key: string]: any;
}
```

**Usage:**

```typescript
import type { IKernel } from '@objectstack/types';

export class MyPlugin {
  async onStart(kernel: IKernel) {
    // Access ObjectQL if available
    if (kernel.ql) {
      await kernel.ql.find('user', {});
    }
  }
}
```

### RuntimeContext

Context object passed to runtime plugins during their lifecycle.

```typescript
export interface RuntimeContext {
  /**
   * Reference to the kernel instance
   */
  engine: IKernel;
}
```

**Usage:**

```typescript
import type { RuntimeContext } from '@objectstack/types';

export const myPlugin = {
  name: 'my-plugin',
  
  async install(ctx: RuntimeContext) {
    // Use kernel through context
    await ctx.engine.start();
  }
};
```

### RuntimePlugin

Interface for plugins that integrate with the ObjectStack runtime.

```typescript
export interface RuntimePlugin {
  /**
   * Unique plugin identifier
   */
  name: string;
  
  /**
   * Optional: Called when plugin is registered
   */
  install?: (ctx: RuntimeContext) => void | Promise<void>;
  
  /**
   * Optional: Called when kernel starts
   */
  onStart?: (ctx: RuntimeContext) => void | Promise<void>;
}
```

**Usage:**

```typescript
import type { RuntimePlugin, RuntimeContext } from '@objectstack/types';

export const myPlugin: RuntimePlugin = {
  name: 'my-custom-plugin',
  
  async install(ctx: RuntimeContext) {
    console.log('Plugin installed');
    // Register services, hooks, etc.
  },
  
  async onStart(ctx: RuntimeContext) {
    console.log('Plugin started');
    // Initialize connections, start background tasks, etc.
  }
};
```

## Architecture

### Design Philosophy

The `@objectstack/types` package follows these principles:

1. **Interface Segregation** - Only define what's absolutely necessary
2. **Loose Coupling** - Enable interoperability without tight dependencies
3. **Progressive Enhancement** - Allow plugins to implement optional interfaces
4. **Type Safety** - Provide compile-time guarantees where possible

### Dependency Graph

```
@objectstack/types (Layer 0)
├── Dependencies: @objectstack/spec (protocols only)
└── Used By:
    ├── @objectstack/core (kernel implementation)
    ├── @objectstack/runtime (plugin utilities)
    ├── @objectstack/objectql (query engine)
    └── All plugins
```

The types package sits at the foundation of the architecture, depended upon by nearly all other packages but depending on very few itself.

## Use Cases

### 1. Plugin Development

When building plugins, import types for proper typing:

```typescript
import type { RuntimePlugin, RuntimeContext } from '@objectstack/types';

export const authPlugin: RuntimePlugin = {
  name: 'auth',
  
  async install(ctx: RuntimeContext) {
    // Setup authentication
  },
  
  async onStart(ctx: RuntimeContext) {
    // Start auth service
  }
};
```

### 2. Kernel Extensions

When extending the kernel with custom functionality:

```typescript
import type { IKernel } from '@objectstack/types';

export class CustomKernel implements IKernel {
  ql?: any;
  
  async start(): Promise<void> {
    // Custom kernel implementation
  }
}
```

### 3. Runtime Integration

When integrating with the ObjectStack runtime:

```typescript
import type { RuntimeContext } from '@objectstack/types';

export function setupRuntime(ctx: RuntimeContext) {
  const kernel = ctx.engine;
  
  // Access kernel functionality
  kernel.start();
}
```

## TypeScript Configuration

This package is designed to work with TypeScript 5.0+:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true
  }
}
```

## Best Practices

### 1. Use Type-Only Imports

When importing types, use the `type` keyword to ensure they're erased at runtime:

```typescript
import type { IKernel, RuntimePlugin } from '@objectstack/types';
```

### 2. Don't Import Implementation

This package contains **only types**. Never import implementation details:

```typescript
// ✅ Good - type-only import
import type { RuntimePlugin } from '@objectstack/types';

// ❌ Bad - trying to import the implementation. There is none, so a value
// import does not work:
//   import { RuntimePlugin } from '@objectstack/types';
```

### 3. Extend Interfaces When Needed

Plugins can extend these interfaces for custom requirements:

```typescript
import type { RuntimePlugin, RuntimeContext } from '@objectstack/types';

interface MyPluginContext extends RuntimeContext {
  customProperty: string;
}

export const myPlugin: RuntimePlugin = {
  name: 'my-plugin',
  
  async install(ctx: RuntimeContext) {
    const myCtx = ctx as MyPluginContext;
    // Use custom context
  }
};
```

### 4. Maintain Backward Compatibility

The types in this package should be stable. Use optional properties for new features:

```typescript
export interface RuntimePlugin {
  name: string;
  install?: (ctx: RuntimeContext) => void | Promise<void>;
  onStart?: (ctx: RuntimeContext) => void | Promise<void>;
  // New optional methods are OK
  onDestroy?: () => void | Promise<void>;
}
```

## Version Compatibility

This package follows semantic versioning:

- **Patch**: Documentation updates, internal refactoring
- **Minor**: New optional properties/methods
- **Major**: Breaking changes to existing interfaces

## FAQ

### Why a separate types package?

To avoid circular dependencies between `@objectstack/core` and plugins, we extract shared interfaces into a neutral package.

### Can I use this in my plugin?

Yes! This package is designed to be used by all ObjectStack plugins and extensions.

### Do I need this for application development?

Usually not. Application developers typically use `@objectstack/spec` for type definitions. This package is primarily for plugin and runtime developers.

### What's the difference from @objectstack/spec?

- **@objectstack/spec**: Protocol definitions, schemas, and data types (what you configure)
- **@objectstack/types**: Runtime interfaces and contracts (how the system runs)

## Migration Guide

### From Direct Kernel Access

Before:

```typescript
import { ObjectKernel } from '@objectstack/core';

function myFunction(kernel: ObjectKernel) {
  // Tight coupling to concrete class
}
```

After:

```typescript
import type { IKernel } from '@objectstack/types';

function myFunction(kernel: IKernel) {
  // Loose coupling to interface
}
```

### From Inline Types

Before:

```typescript
interface MyPlugin {
  name: string;
  install: (ctx: any) => Promise<void>;
}
```

After:

```typescript
import type { RuntimePlugin } from '@objectstack/types';

const myPlugin: RuntimePlugin = {
  name: 'my-plugin',
  install: async (ctx) => {
    // Implementation
  }
};
```

## Related Packages

- [@objectstack/spec](../spec) - Protocol definitions and Zod schemas
- [@objectstack/core](../core) - Kernel implementation
- [@objectstack/runtime](../runtime) - Runtime utilities and helpers

## Contributing

When adding new types to this package:

1. Keep interfaces minimal and focused
2. Use optional properties for extensibility
3. Document all public types with JSDoc
4. Avoid breaking changes
5. Consider backward compatibility

## License

Apache-2.0. See [LICENSING.md](../../LICENSING.md).
