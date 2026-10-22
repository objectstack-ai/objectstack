---
'@objectstack/cli': patch
---

fix(cli): `os create plugin` ships a starter test, so a new project's `npm test` passes

Clause-②: no
Metadata-protocol: none

A project made by `os create plugin NAME` declared `"test": "vitest"` and contained no test file, so its first `npm test` exited 1 with `No test files found, exiting with code 1`. The template now writes `src/index.test.ts`, which runs the checks the kernel runs on a plugin when it loads one: a `name`, an `init` function, and the protocol's `PluginSchema`. It boots no kernel; its header links the `@objectstack/verify` harness for tests that need one. The `test` script is now `vitest run`, one pass that exits.

The starter test lives in `src/`, which `tsc` compiles, so the template also writes `tsconfig.build.json`: it extends `tsconfig.json` and excludes `src/**/*.test.ts`, and `build` and `dev` now run `tsc -p tsconfig.build.json`. `typecheck` still reads `tsconfig.json`, so a type error in a test still fails it, while `dist/` holds no compiled test and `npm test` after `npm run build` runs each test once.

**An existing project made by an earlier `os create plugin`** still has no test file. Add a `*.test.ts` file, for example a copy of the `src/index.test.ts` that a new `os create plugin NAME` writes. If you put it under `src/`, also copy `tsconfig.build.json` and point the `build` and `dev` scripts at it (`tsc -p tsconfig.build.json`), or `tsc` compiles the test into `dist/` and vitest runs it twice.
