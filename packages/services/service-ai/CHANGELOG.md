# @objectstack/service-ai

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4

## 4.0.3

### Patch Changes

- ee39bff: fix ai.
  - @objectstack/spec@4.0.3
  - @objectstack/core@4.0.3

## 4.0.2

### Patch Changes

- 5f659e9: fix ai
- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2

## 4.1.0

### Minor Changes

- **Route auth/permissions metadata**: Every route definition (`RouteDefinition`) now declares `auth` and `permissions` fields, enabling HTTP server adapters to enforce authentication and authorization automatically.
- **User context on RouteRequest**: `RouteRequest` now carries an optional `user: RouteUserContext` object populated by the auth middleware, providing `userId`, `displayName`, `roles`, and `permissions`.
- **Conversation ownership enforcement**: Conversation routes (create, list, add message, delete) are scoped to the authenticated user when a user context is present and the conversation has a `userId`. For backward compatibility, requests without user context and conversations created without a `userId` remain accessible under the existing behavior.
- **Enhanced tool-call loop error handling**: `chatWithTools` now tracks tool execution errors across iterations and supports an `onToolError` callback (`'continue'` | `'abort'`) for fine-grained error control.
- **`streamChatWithTools`**: New streaming tool-call loop that yields SSE events while automatically resolving intermediate tool calls.
- **New `RouteUserContext` type**: Exported from the package for use by HTTP adapters and middleware.

## 4.0.0

### Major Changes

- ad4e04b: service ai

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0

## 3.3.1

### Patch Changes

- Initial release of AI Service plugin
  - LLM adapter layer with provider abstraction (memory adapter included)
  - Conversation management service with in-memory persistence
  - Tool registry for metadata/business tool registration
  - REST/SSE route self-registration (`/api/v1/ai/*`)
  - Kernel plugin registering as `'ai'` service conforming to `IAIService` contract
