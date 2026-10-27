# @objectstack/metadata-core

Repository contracts for the ObjectStack metadata lifecycle. Defines the
**types, canonicalization, errors and pluggable `MetadataRepository`
interface** described in [ADR-0008](../../docs/adr/0008-metadata-repository-and-change-log.md).

This package is **definitions only** — it has no I/O, no file system
access, no database driver. Implementations live in:

- `@objectstack/metadata-core` (`InMemoryRepository` — included here for
  tests and edge runtimes)
- `@objectstack/metadata` (`FileSystemRepository`, `LayeredRepository`)
- `@objectstack/metadata-postgres` (M1+)

**TypeScript:** use `moduleResolution` `node16`, `nodenext` or `bundler`. The legacy `node10` resolution (`"node"`) ignores `exports`, so it cannot resolve this package's subpath imports and is not supported. See [Module resolution](https://objectstack.ai/docs/plugins/development#module-resolution).

## Exports

```typescript
import {
  // Types
  MetaRef, MetadataItem, MetadataItemHeader, MetadataEvent, MetadataOp,
  PutOptions, PutResult, DeleteOptions, ListFilter, WatchFilter,

  // Zod schemas (for runtime validation)
  MetaRefSchema, MetadataItemSchema, MetadataEventSchema,

  // Interface
  MetadataRepository,

  // Canonicalization
  canonicalize, hashSpec,

  // Errors
  ConflictError, NotFoundError, SchemaValidationError,

  // Reference impl
  InMemoryRepository,
} from '@objectstack/metadata-core';
```

See ADR-0008 §2 for the full architectural rationale.

`@objectstack/metadata-core/testing` (the repository contract suites) is
**ESM-only**: it imports `vitest`, whose own `require()` entry throws, so
the subpath declares only an `import` condition. Load it with `import`;
`require()` is refused with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
