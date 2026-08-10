// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// Minimal ambient surface for the node globals the standalone harnesses under
// `test/` touch (`seed-check.ts`, `mcp-actions.e2e.ts` — both run under `tsx`).
// This app's tsconfig deliberately omits `@types/node`, matching
// examples/app-showcase; tsx/node provide the real `process` at runtime.

declare const process: {
  env: Record<string, string | undefined>;
  exit(code?: number): never;
};
