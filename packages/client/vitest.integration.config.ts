import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    globals: true,
    environment: 'node',
    testTimeout: 30000, // 30 seconds for integration tests
    hookTimeout: 30000,
    pool: 'forks',
    // Run integration test files one at a time: they all drive the SAME live
    // server and the same test data, so running files in parallel races.
    //
    // Vitest 4 removed `test.poolOptions` ("Pool Rework" in the migration
    // guide) — the `poolOptions.forks.singleFork: true` that used to live here
    // was never read, it only produced a DEPRECATED warning, so this suite has
    // been running with the default parallelism all along (#5564).
    //
    // `fileParallelism: false` is the top-level option that actually enforces
    // it: per the docs it "will override `maxWorkers` option to 1", which is
    // the parallelism half of what the guide maps `singleFork` to.
    //
    // The guide's other half — `isolate: false` — is deliberately NOT carried
    // over: it was equally inert here, nothing in this suite depends on
    // sharing a module registry across files, and turning it off would let
    // module state leak between files, which is the very class of cross-file
    // interference this declaration exists to prevent.
    fileParallelism: false
  }
});
