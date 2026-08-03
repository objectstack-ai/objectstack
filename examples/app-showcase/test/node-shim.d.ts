// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// Minimal ambient surface for the node builtins the tests touch. The
// showcase tsconfig deliberately omits `@types/node` (see the ambient
// `process` note in objectstack.config.ts); vitest provides the real
// implementations at runtime.

declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): Array<{ name: string; isDirectory(): boolean }>;
}

declare const process: { cwd(): string };
