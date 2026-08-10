# ObjectStack Architecture

> **v5.0 (2026): `project` → `environment`.** The runtime concept formerly called *Project* (per-tenant business workspace; Org/Project/Branch hierarchy) is now called *Environment* throughout the codebase: CLI flags (`--environment`/`-e`), HTTP paths (`/api/v1/environments/:environmentId/...`), headers (`X-Environment-Id`), env vars (`OS_ENVIRONMENT_ID`), exported symbols (`createSystemEnvironmentPlugin`, `SYSTEM_ENVIRONMENT_ID`), DB columns (`environment_id`), and JSON schemas (`EnvironmentArtifact`) all use the new term with no aliases or deprecation shims. The word "project" elsewhere in this document still refers to the npm/monorepo sense (i.e., the framework as a software project). See `.changeset/v5-project-to-environment-rename.md` for the full breaking-change list and ADR-0006 for the rationale.


> **Architecture Document** - Updated January 2026
> 
> This document provides a comprehensive overview of ObjectStack's microkernel architecture, package distribution, and design principles.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Microkernel Design](#microkernel-design)
3. [Package Structure](#package-structure)
4. [Layer Architecture](#layer-architecture)
5. [Plugin System](#plugin-system)
6. [Dependency Graph](#dependency-graph)
7. [Design Decisions](#design-decisions)
8. [Additional Resources](#additional-resources)

---

## Architecture Overview

ObjectStack is built on a **microkernel architecture** inspired by operating system design principles. The system separates core functionality (the kernel) from business logic (plugins), enabling:

- **Modularity**: Each component is independently developed, tested, and deployed
- **Extensibility**: New features added through plugins without modifying core
- **Testability**: Components can be mocked and tested in isolation
- **Technology Independence**: Swap implementations without breaking contracts

### Core Principles

1. **Protocol-First Design**: All interactions defined through Zod schemas
2. **Separation of Concerns**: Three distinct layers (QL, OS, UI)
3. **Dependency Injection**: Services registered and consumed through DI container
4. **Event-Driven Communication**: Plugins communicate via hooks/events
5. **Reverse Domain Naming**: Global uniqueness through domain notation

---

## Microkernel Design

### The ObjectKernel

**Location**: `packages/core/src/kernel.ts`

The ObjectKernel is the heart of the system, providing:

```
┌─────────────────────────────────────────────────────┐
│              ObjectKernel (Core)                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  Plugin Lifecycle Manager                     │  │
│  │  • Dependency Resolution (Topological Sort)   │  │
│  │  • Init → Start → Destroy Phases              │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  Service Registry (DI Container)              │  │
│  │  • registerService(name, service)             │  │
│  │  • getService<T>(name): T                     │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  Event Bus (Hook System)                      │  │
│  │  • hook(name, handler)                        │  │
│  │  • trigger(name, ...args)                     │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  Logger (Pino-based)                          │  │
│  │  • Server: JSON logs to stdout                │  │
│  │  • Browser: Console with pretty formatting   │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
              │
    ┌─────────┴─────────┬──────────┬──────────┐
    │                   │          │          │
┌───▼────┐      ┌───────▼──┐   ┌──▼───┐  ┌───▼────┐
│ObjectQL│      │  Driver  │   │ Hono │  │  App   │
│ Plugin │      │  Plugin  │   │Server│  │ Plugin │
└────────┘      └──────────┘   └──────┘  └────────┘
```

### Plugin Lifecycle

```
State Machine:
┌────────┐
│  idle  │  ← Initial state
└───┬────┘
    │ kernel.use(plugin)
    ▼
┌────────┐
│  init  │  ← Register services, subscribe to hooks
└───┬────┘
    │ kernel.bootstrap()
    ▼
┌────────┐
│ start  │  ← Connect to databases, start servers
└───┬────┘
    │
    ▼
┌─────────┐
│ running │
└───┬─────┘
    │ kernel.shutdown()
    ▼
┌─────────┐
│ destroy │  ← Clean up resources
└─────────┘
```

---

## Package Structure

ObjectStack is organized as a **monorepo** with distinct package layers:

### Core Packages

#### `@objectstack/spec`
**Location**: `packages/spec/`  
**Role**: Protocol Definitions (The "Constitution")

- Zod schemas for all protocols (ObjectQL, Kernel/System, ObjectUI)
- TypeScript type definitions
- JSON Schema generation
- Constants and enums
- **Zero runtime dependencies** (except Zod)

```typescript
// packages/spec/src/
├── data/           # ObjectQL schemas (Object, Field, Query, etc.)
├── ui/             # ObjectUI schemas (App, View, Dashboard, etc.)
├── system/         # System schemas (Manifest, Driver, Plugin, etc.)
├── automation/     # Workflow, Flow, Trigger schemas
├── ai/             # Agent, RAG, Model schemas
├── api/            # API contract schemas
├── auth/           # Authentication & Authorization schemas
└── shared/         # Common utilities
```

#### `@objectstack/core`
**Location**: `packages/core/`  
**Role**: Microkernel Runtime

- `ObjectKernel` - Plugin lifecycle manager
- `PluginContext` - Runtime context for plugins
- `Logger` - Universal logging (Pino-based)
- Service Registry (DI Container)
- Event Bus (Hook System)

**Dependencies**: `@objectstack/spec`, `pino`, `zod`

#### `@objectstack/types`
**Location**: `packages/types/`  
**Role**: Shared Runtime Interfaces

- Type definitions used across packages
- Runtime environment types
- Minimal, focused on shared contracts

**Dependencies**: `@objectstack/spec`

### Engine Packages

#### `@objectstack/objectql`
**Location**: `packages/objectql/`  
**Role**: ObjectQL Query Engine

- ObjectQL core engine
- Schema registry
- Query compilation
- Driver management
- Protocol implementation

**Dependencies**: `@objectstack/core`, `@objectstack/spec`, `@objectstack/types`

#### `@objectstack/metadata`
**Location**: `packages/metadata/`  
**Role**: Metadata Loading & Persistence

- Metadata serialization/deserialization (JSON, YAML, TypeScript)
- File system operations (load, save, watch)
- Validation using Zod schemas
- ETag-based caching
- Import/export tools
- SchemaRegistry persistence bridge

**Dependencies**: `@objectstack/spec`, `@objectstack/core`, `@objectstack/types`, `glob`, `js-yaml`, `chokidar`

#### `@objectstack/runtime`
**Location**: `packages/runtime/`  
**Role**: Runtime Utilities & Plugins

- `DriverPlugin` - Generic driver wrapper
- `AppPlugin` - Application loader
- HTTP Server utilities
- REST API server
- Middleware system

**Dependencies**: `@objectstack/core`, `@objectstack/spec`, `@objectstack/types`

### Client Packages

#### `@objectstack/client`
**Location**: `packages/client/`  
**Role**: Official TypeScript Client SDK for ObjectStack Protocol

**Features**:
- **Auto-Discovery**: Connects to ObjectStack server and auto-configures API endpoints
- **Typed Metadata**: Retrieve Object and View definitions with full TypeScript support
- **Metadata Caching**: ETag-based conditional requests for efficient metadata caching
- **Data Operations**: 
  - Advanced queries with filtering, sorting, and field selection
  - CRUD operations (create, read, update, delete)
  - Batch operations with transaction support (batch create/update/upsert/delete)
  - Query builder with type-safe filters
- **View Storage**: Save, load, share, and manage custom UI view configurations
- **Error Handling**: Standardized error codes with retry guidance
- **HTTP Caching**: ETag support for optimized metadata requests

**API Surface**:
- `client.connect()`: Initialize client with server discovery
- `client.meta.*`: Metadata operations (getObject, getCached, getView)
- `client.data.*`: Data operations (find, get, query, create, batch, update, delete)
- `client.views.*`: View storage operations (create, get, list, update, delete, share)

**Dependencies**: `@objectstack/core`, `@objectstack/spec`

#### `@objectstack/client-react`
**Location**: `packages/client-react/`  
**Role**: React Hooks for ObjectStack Client SDK

**Features**:
- **Data Hooks**: `useQuery`, `useMutation`, `usePagination`, `useInfiniteQuery`
- **Metadata Hooks**: `useObject`, `useView`, `useFields`, `useMetadata`
- **Context Management**: `ObjectStackProvider`, `useClient`
- **Type Safety**: Full TypeScript generics support for type-safe data
- **Auto-refetch**: Automatic data refetching and caching
- **Loading States**: Built-in loading and error state management

**Dependencies**: `@objectstack/client`, `@objectstack/core`, `@objectstack/spec`  
**Peer Dependencies**: `react`

### Driver & Plugin Packages

Drivers (`IDataDriver` implementations) live in `packages/drivers/*`; every other
official plugin lives in `packages/plugins/*`.

#### `@objectstack/driver-memory`
**Location**: `packages/drivers/driver-memory/`  
**Role**: In-Memory Driver (Reference Implementation)

- Complete ObjectQL driver implementation
- Used for testing and prototyping
- Demonstrates driver contract

**Dependencies**: `@objectstack/core`, `@objectstack/spec`

#### `@objectstack/plugin-hono-server`
**Location**: `packages/plugins/plugin-hono-server/`  
**Role**: HTTP Server Plugin

- Hono-based HTTP server
- REST API endpoints
- Middleware support

**Dependencies**: `@objectstack/core`, `@objectstack/spec`, `@objectstack/types`, `hono`

### Tools Packages

#### `@objectstack/cli`
**Location**: `packages/cli/`  
**Role**: Command Line Interface

- Project scaffolding
- Code generation
- Development tools
- Build & deployment utilities

**Dependencies**: `@objectstack/spec`, `commander`, `chalk`, `tsx`, `zod`

---

## Layer Architecture

ObjectStack follows a **Three-Layer Protocol Stack**:

```
┌──────────────────────────────────────────────────┐
│          Layer 3: ObjectUI (View)                │
│  ┌────────────────────────────────────────────┐  │
│  │  Apps, Views, Dashboards, Reports          │  │
│  │  "How do users interact?"                  │  │
│  └────────────────────────────────────────────┘  │
│  Packages: @objectstack/client-react            │
└────────────────┬─────────────────────────────────┘
                 │ REST API / GraphQL
┌────────────────▼─────────────────────────────────┐
│         Layer 2: Kernel (Control)                │
│  ┌────────────────────────────────────────────┐  │
│  │  Auth, Permissions, Workflows, Events      │  │
│  │  "Who can do what, when?"                  │  │
│  └────────────────────────────────────────────┘  │
│  Packages: @objectstack/runtime,                │
│            @objectstack/plugin-hono-server      │
└────────────────┬─────────────────────────────────┘
                 │ ObjectQL Protocol
┌────────────────▼─────────────────────────────────┐
│         Layer 1: ObjectQL (Data)                 │
│  ┌────────────────────────────────────────────┐  │
│  │  Objects, Fields, Queries, Drivers         │  │
│  │  "What is the data structure?"             │  │
│  └────────────────────────────────────────────┘  │
│  Packages: @objectstack/objectql,               │
│            @objectstack/driver-*                │
└──────────────────────────────────────────────────┘

Foundation:
┌──────────────────────────────────────────────────┐
│       @objectstack/core (Microkernel)            │
│       @objectstack/spec (Protocols)              │
│       @objectstack/types (Shared Types)          │
└──────────────────────────────────────────────────┘
```

### Layer Boundaries

| Layer | Knows About | Doesn't Know About |
|-------|-------------|-------------------|
| **ObjectQL** | Schema, fields, queries, drivers | Users, permissions, UI |
| **Kernel** | Auth, workflows, events | Data structure, UI layout |
| **ObjectUI** | Layout, navigation, actions | Business logic, storage |

---

## Plugin System

### Plugin Interface

```typescript
interface Plugin {
  name: string;           // Reverse domain notation
  version?: string;       // Semantic version
  dependencies?: string[]; // Plugin names this depends on
  
  init(ctx: PluginContext): Promise<void> | void;
  start?(ctx: PluginContext): Promise<void> | void;
  destroy?(): Promise<void> | void;
}
```

### Built-in Plugins

#### ObjectQLPlugin
**Name**: `com.objectstack.engine.objectql`  
**Location**: `packages/objectql/src/plugin.ts`

```typescript
Services Registered:
- 'objectql': ObjectQL engine instance
- 'protocol': Protocol implementation shim

Lifecycle:
- init: Register ObjectQL as service
- start: Discover and register drivers and apps
```

#### DriverPlugin
**Name**: `com.objectstack.driver.{name}`  
**Location**: `packages/runtime/src/driver-plugin.ts`

```typescript
Services Registered:
- 'driver.{name}': Driver instance

Lifecycle:
- init: Register driver service
- start: Log driver started
```

#### AppPlugin
**Name**: `com.objectstack.app.{name}`  
**Location**: `packages/runtime/src/app-plugin.ts`

```typescript
Services Registered:
- 'app.{name}': Manifest instance

Lifecycle:
- init: Register app manifest as service
```

### Plugin Capability Declaration

**Location**: `packages/spec/src/kernel/plugin-capability.zod.ts`

Plugins declare capabilities through structured manifests:

```typescript
interface PluginCapabilityManifest {
  implements?: PluginCapability[];      // Protocols implemented
  provides?: PluginInterface[];         // Services exposed
  requires?: PluginDependency[];        // Required plugins
  extensionPoints?: ExtensionPoint[];   // Extension hooks
  extensions?: Extension[];             // Extensions contributed
}
```

---

## Dependency Graph

### Core Dependencies

```
@objectstack/spec (Zod schemas, zero runtime deps except zod)
    ↑
    ├── @objectstack/types
    │       ↑
    │       └── (Shared by many packages)
    │
    ├── @objectstack/core (Kernel + Logger)
    │       ↑
    │       ├── @objectstack/objectql (Query Engine)
    │       │
    │       ├── @objectstack/metadata (Metadata I/O)
    │       │       ↑
    │       │       ├── @objectstack/runtime (Uses for manifest loading)
    │       │       ├── @objectstack/cli (Uses for code generation)
    │       │       └── @objectstack/objectql (Uses for registry persistence)
    │       │
    │       ├── @objectstack/runtime (Plugins & HTTP)
    │       │       ↑
    │       │       └── (Used by server plugins)
    │       │
    │       ├── @objectstack/client
    │       │       ↑
    │       │       └── @objectstack/client-react
    │       │
    │       └── @objectstack/driver-memory
    │
    ├── @objectstack/cli (Standalone tool)
```

### Dependency Rules

1. **`@objectstack/spec` has ZERO dependencies** (except Zod)
   - Pure protocol definitions
   - Can be used standalone for type-checking

2. **`@objectstack/core` depends only on `@objectstack/spec`**
   - Minimal kernel
   - No knowledge of ObjectQL or UI

3. **`@objectstack/objectql` depends on `core` and `spec`**
   - Pluggable into kernel
   - Independent of UI layer

4. **Plugins depend on `core` and optionally `objectql`**
   - Never depend on other plugins directly
   - Use service registry for runtime coupling

5. **No circular dependencies**
   - Enforced through topological sort
   - Build-time validation

---

## Design Decisions

### 1. Microkernel vs Monolithic

**Decision**: Use microkernel architecture

**Rationale**:
- Business logic isolated in plugins
- Core remains stable
- Easy to swap implementations
- Better testability

**Tradeoffs**:
- More complex setup
- Plugin discovery overhead
- Learning curve for plugin API

### 2. Zod-First Schema Definition

**Decision**: All schemas defined with Zod

**Rationale**:
- Runtime validation
- TypeScript inference
- JSON Schema generation
- Single source of truth

**Implementation**:
```typescript
// Define once with Zod
export const FieldSchema = z.object({ ... });

// TypeScript types inferred
export type Field = z.infer<typeof FieldSchema>;

// JSON Schema generated at build time
```

### 3. Reverse Domain Naming

**Decision**: Use reverse domain notation for plugins

**Rationale**:
- Global uniqueness
- Industry standard (OSGi, Eclipse, Android)
- Clear ownership
- Hierarchical organization

**Examples**:
- `com.objectstack.engine.objectql`
- `com.objectstack.driver.postgres`
- `com.acme.crm.customer-management`

### 4. Service Registry Pattern

**Decision**: Use DI container for service discovery

**Rationale**:
- Loose coupling
- Runtime flexibility
- Easy mocking for tests
- No hard dependencies

**Alternative Considered**: Direct imports
**Rejected Because**: Creates tight coupling

### 5. Event-Driven Communication

**Decision**: Use hook/event system for inter-plugin communication

**Rationale**:
- Decoupled communication
- Multiple subscribers
- Async handling
- Extensibility

**Standard Events**:
```typescript
// Kernel lifecycle
'kernel:init'
'kernel:ready'
'kernel:shutdown'

// Data lifecycle
'data:record:beforeCreate'
'data:record:afterCreate'
'data:record:beforeUpdate'
'data:record:afterUpdate'
```

### 6. Three-Layer Protocol Stack

**Decision**: Separate QL, OS, UI into distinct layers

**Rationale**:
- Separation of concerns
- Technology independence
- Parallel development
- Incremental migration

**See Also**: [content/docs/concepts/architecture.mdx](content/docs/concepts/architecture.mdx)

### 7. Monorepo Structure

**Decision**: Use pnpm workspaces

**Rationale**:
- Shared dependencies
- Atomic commits
- Easier refactoring
- Consistent versioning

**Build Order**:
1. `@objectstack/spec`
2. `@objectstack/types`, `@objectstack/core`
3. `@objectstack/objectql`, `@objectstack/runtime`
4. Plugins and clients

### 8. Plugin vs Package

**Decision**: Not all packages are plugins

**Rationale**:
- `@objectstack/spec` - Pure data, no runtime
- `@objectstack/cli` - Standalone tool
- `@objectstack/core` - Kernel, not a plugin

**Plugin Packages**: Implement `Plugin` interface and can be registered with kernel

---

## Package Naming Conventions

### Package-Level Identifiers (Distribution)

**Format**: `@objectstack/{category}-{name}`  
**Style**: `kebab-case`  
**Examples**:
- `@objectstack/driver-memory`
- `@objectstack/plugin-hono-server`
- `@objectstack/client-react`

### Plugin Identifiers (Runtime)

**Format**: `{domain}.{category}.{name}`  
**Style**: `kebab-case`  
**Examples**:
- `com.objectstack.engine.objectql`
- `com.objectstack.driver.postgres`
- `com.acme.crm.customer-management`

### Code-Level Identifiers

**Configuration Keys**: `camelCase`
```typescript
{ maxLength: 120, defaultValue: 'hello' }
```

**Data Values**: `snake_case`
```typescript
{ name: 'first_name', object: 'project_task' }
```

---

## Additional Resources

### Architecture Decision Records (ADRs)

Important architectural decisions are documented as ADRs in `docs/adr/`.

**Metadata service architecture.** This section used to link
`docs/adr/0001-metadata-service-architecture.md`, deleted on 2026-02-11 in `9da8e3e72`
(together with ADR-0002 and the ADR `README.md`). The link is deliberately not repointed
at another record, because the decision it carried — *both ObjectQL and MetadataPlugin can
provide the metadata service, MetadataPlugin taking precedence and ObjectQL acting as
fallback* — is no longer what the code does. Today:

- **MetadataPlugin is the sole provider** of the `metadata` service
  (`packages/metadata/src/plugin.ts`). `ObjectQLPlugin` registers `objectql`, `data`,
  `manifest` and `lifecycle` — never `metadata`.
- **ObjectQL is a consumer.** In `start()` it reads the `metadata` service, syncs
  definitions into its own registry and subscribes to metadata events, and degrades to
  that internal registry when no such service is present
  (`packages/objectql/src/plugin.ts`).
- **The shared-interface principle survived, as a spec contract**: `IMetadataService` in
  `packages/spec/src/contracts/metadata-service.ts`, with the slot declared as
  `CoreServiceName 'metadata'` in `packages/spec/src/system/core-services.zod.ts`.
- **Repository, change-log and subscription mechanics** are recorded in
  [ADR-0008: Metadata Repository, Change Log & Subscription](docs/adr/0008-metadata-repository-and-change-log.md).

The single-provider decision itself has **no ADR record today** — ADR-0001 was deleted and
nothing replaced it. Re-homing it is a maintainer call; until then the contract and the two
plugin files above are the live source of truth.

### Component-Specific Documentation

`docs/METADATA_FLOW.md` no longer exists in this repository and no replacement was ever
written; the closest live description of how metadata flows from definition to runtime is
the "Metadata service architecture" walkthrough immediately above.

---

## Future Considerations

### Planned Enhancements

1. **Plugin Versioning & Compatibility**
   - SemVer range matching
   - Breaking change detection
   - Deprecation warnings

2. **Plugin Registry & Hub**
   - Centralized plugin discovery
   - Quality scoring
   - Security scanning

3. **Hot Reload**
   - Runtime plugin reload
   - State preservation
   - Development mode

4. **Multi-Tenancy**
   - Kernel per tenant
   - Resource isolation
   - Shared plugin instances

5. **Enhanced Logging**
   - Structured logging
   - Distributed tracing
   - Performance metrics

---

## Related Documentation

- [Development Roadmap](./ROADMAP.md) - Next-phase optimization & improvement plan
- [Three-Layer Stack](./content/docs/concepts/architecture.mdx) - How the Data, System, and UI protocols work together as one cohesive system
- [Design Principles](./content/docs/concepts/design-principles.mdx)

Six more links used to live in this list — a Quick Reference Guide, a Package Dependency
Graph, a Studio Roadmap, and three `content/docs/developers/*` guides (MicroKernel
Architecture, Plugin Ecosystem, Writing Plugins). None of those files exist anywhere in
this repository today (Studio itself now lives in the separate `objectui` repository, so
no relative link from here can reach a Studio roadmap), and no replacement was ever
written, so the entries are removed rather than repointed at a guess.

---

**Last Updated**: February 2026  
**Maintainers**: ObjectStack Core Team  
**Status**: Living Document
