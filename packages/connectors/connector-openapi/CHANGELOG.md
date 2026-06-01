# @objectstack/connector-openapi

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1

## 7.4.0

### Minor Changes

- 71d8ae1: Add `@objectstack/connector-openapi` — generate an ObjectStack connector from a declarative OpenAPI 3.x document (ADR-0023). One operation becomes one connector action; a single generic handler drives a self-contained static-auth HTTP transport (mirroring `@objectstack/connector-rest`). The generated `type: 'api'` connector registers via `engine.registerConnector(def, handlers)` with no new engine surface, and supports an `include` allowlist for trimming large specs.

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/core@7.4.0
