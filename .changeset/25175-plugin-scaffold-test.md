---
'@objectstack/cli': patch
---

fix(cli): `os init -t plugin` ships a starter test, so a new project's `npm test` passes

Clause-②: no
Metadata-protocol: none

A project made by `os init NAME -t plugin` declared `"test": "vitest run"` and contained no test file, so its first `npm test` exited 1 with `No test files found, exiting with code 1`. The template now writes `package.test.ts` beside `objectstack.config.ts`. The test imports the package's stack, which runs `defineStack()` and its protocol check as the file loads, and asserts that the stack declares itself a `plugin` and contains every object `src/objects/index.ts` exports. A fresh project's `npm test` reports `Test Files 1 passed`. The test boots no engine. Its header links the `@objectstack/verify` harness for tests that need one.

**An existing project made by an earlier `os init -t plugin`** still has no test file. Add a `*.test.ts` file, for example a copy of the `package.test.ts` that a new `os init NAME -t plugin` writes.
