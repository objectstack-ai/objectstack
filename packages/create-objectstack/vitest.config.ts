import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';
import { memoryBackedTmpEnv } from '../../vitest.memory-tmp.mts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // The scaffolder's tests pin their output against the spec's own exported
  // rule (`MANIFEST_ID_PATTERN`). Resolved through `dist/`, that verdict would
  // be a function of build state rather than of the source in this checkout —
  // and the dangerous direction is silent, because a stale `dist` runs GREEN.
  // Anchored per subpath: the object form matches by PREFIX and would resolve
  // `@objectstack/spec/kernel` to `…/src/index.ts/kernel`
  // (`pnpm check:test-source-alias`).
  resolve: {
    alias: [
      {
        find: /^@objectstack\/spec\/kernel$/,
        replacement: path.resolve(HERE, '../spec/src/kernel/index.ts'),
      },
    ],
  },
  test: {
    // A late console.* must not redden a green suite (#10374): vitest's worker
    // forwards console output over RPC and discards the promise, and a write
    // landing after teardown's rpcDone() snapshot is rejected into an unhandled
    // error — a fully green run that exits 1. Disarming removes the mechanism.
    // Mechanism + measured costs: examples/app-showcase/vitest.config.ts.
    // Enforced repo-wide by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // `src/templates/` is PAYLOAD: copied byte-for-byte into a scaffolded
    // project and never compiled here (tsconfig.json excludes it too). The
    // blank template ships its own `note.test.ts`, which boots THAT project's
    // stack through `@objectstack/verify` — a dependency of the scaffolded
    // project, not of this package. It runs where it lands: the Scaffold E2E
    // workflow scaffolds a project, installs it from the registry and runs
    // its `test` script.
    exclude: [...configDefaults.exclude, 'src/templates/**'],
    environment: 'node',
    // Every scaffold these tests write lands under `os.tmpdir()`, children
    // included. Under the disk load of a Test Core shard (#27306), measured
    // beside four `dd … conv=fsync` writers: all 301 cases still passed, but
    // the `afterAll` that removes the scaffolded trees in
    // `created-summary.test.ts` and `scaffold-skills-single-copy.test.ts` ran
    // past its 10 s hook budget, and a file-level failure with no failed
    // case is the red main saw (runs 40713919581, 40718500281: `pnpm run
    // test exited (1)`, no test named). Rationale: vitest.memory-tmp.mts.
    env: memoryBackedTmpEnv(),
  },
});
