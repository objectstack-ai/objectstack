# @objectstack/embedder-openai

## 8.0.0

### Patch Changes

- d5a8161: feat(spec): resilientFetch — timeout + backoff for outbound HTTP (P1-1)

  Outbound calls in the connectors/embedder were naked `fetch` with no timeout or
  retry, so a slow or rate-limited external API could hang an agent turn with no
  recovery.

  New shared `resilientFetch` (`@objectstack/spec/shared`):

  - per-attempt timeout via `AbortController` (default 30s);
  - exponential backoff with jitter, up to 3 attempts, on network errors / 429 / 5xx;
  - honours a `Retry-After` header on 429;
  - never retries a caller-initiated abort (intentional cancellation).

  Wired into `connector-rest`, `connector-slack`, and `embedder-openai`.
  `connector-mcp` talks through the MCP SDK transport, so it gets a 30s per-request
  `timeout` on `callTool` / `listTools` instead.

  A stateful per-host **circuit breaker** is deliberately left as a follow-up:
  timeout + backoff already removes the hang/no-recovery risk.

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0

## 7.6.0

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1

## 7.4.0

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

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1

## 6.7.0

### Minor Changes

- 430067b: Introduce `IEmbedder` protocol and extract `@objectstack/embedder-openai` plugin.

  **What's new**

  - **`IEmbedder` contract** (`@objectstack/spec/contracts/embedder.ts`) — protocol-level interface for text → vector providers. One contract covers cloud APIs (OpenAI / 阿里通义 / 智谱 / 硅基流动 / 火山 Doubao / MiniMax), local Ollama daemons, and in-process embedders.
  - **`@objectstack/embedder-openai`** — new package. Drop-in for any OpenAI-shape endpoint via `baseUrl`. Ships preset constants for 8 mainstream providers (`createOpenAIEmbedder({ preset: 'siliconflow', ... })`) and pre-baked dimensions for 16+ popular models.

  **Breaking changes (`@objectstack/knowledge-turso`)**

  - `OpenAIEmbeddingProvider` is **removed** — install `@objectstack/embedder-openai` and use `OpenAIEmbedder` instead (identical option shape).
  - `EmbeddingProvider` type alias kept as a deprecated re-export of `IEmbedder` for smoother migration; will be removed in a future major.
  - `HashEmbeddingProvider` is now an alias for the renamed `HashEmbedder` class — no functional change.

  **Migration**

  ```diff
  - import { OpenAIEmbeddingProvider } from '@objectstack/knowledge-turso';
  + import { OpenAIEmbedder } from '@objectstack/embedder-openai';

  - const embedding = new OpenAIEmbeddingProvider({ apiKey });
  + const embedding = new OpenAIEmbedder({ apiKey });
  ```

  For 国内 providers, use presets:

  ```ts
  import { createOpenAIEmbedder } from "@objectstack/embedder-openai";
  const embedding = createOpenAIEmbedder({
    preset: "siliconflow", // or 'dashscope', 'zhipu', 'doubao', 'ollama', …
    apiKey: process.env.SILICONFLOW_API_KEY!,
    model: "BAAI/bge-m3",
  });
  ```

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
