// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// Minimal ambient surface for the node builtins this package touches. The
// showcase tsconfig deliberately omits `@types/node` (see the ambient
// `process` note in objectstack.config.ts); the real implementations come from
// the runtime — vitest for `test/`, the Playwright runner for `e2e/`.
//
// It lives in `types/`, not `test/`, because both trees depend on it: `test/`
// for `existsSync`/`readFileSync`/`readdirSync` and the `process.cwd()` global,
// `e2e/` for `mkdirSync`/`writeFileSync`/`dirname` in global-setup.ts. Under the
// old `test/` name, narrowing it for the test layer would have broken the e2e
// program with nothing in the path to warn the author.
//
// Declare only the members actually imported. Staying narrower than
// `@types/node` is the point: it IS installed at the workspace root and would
// resolve if this package named it in `compilerOptions.types`, at the cost of
// the whole node global surface the package is deliberately without.

declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): Array<{ name: string; isDirectory(): boolean }>;
  export function mkdirSync(path: string, options: { recursive: true }): string | undefined;
  export function writeFileSync(path: string, data: string): void;
}

declare module 'node:path' {
  export function dirname(path: string): string;
}

// `test/vitest-console-teardown-race.test.ts` drives a real vitest process over
// a fixture, because the defect it pins (a console RPC rejected during worker
// teardown) is only observable as the child's EXIT CODE — it happens after every
// test in the file has finished, so no in-process assertion can see it.
// Narrowed to the synchronous form and to the three result members that pin
// reads: it must not grow into the whole `child_process` surface.
declare module 'node:child_process' {
  export function spawnSync(
    command: string,
    args: readonly string[],
    options: {
      encoding: 'utf8';
      timeout?: number;
      env?: Record<string, string | undefined>;
    },
  ): { status: number | null; stdout: string | null; stderr: string | null };
}

// `env` joins `cwd()` for the same pin: the nested run must NOT inherit this
// process's own `VITEST_*` variables, or the child believes a pool spawned it.
declare const process: { cwd(): string; env: Record<string, string | undefined> };
