import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: !process.env.OS_SKIP_DTS,
  format: ['esm', 'cjs'],
  target: 'es2020',
});

// TEMPORARY MEASUREMENT SCAFFOLD (#10227) -- REVERTED BEFORE THIS PR IS READY.
// `tsup.config.ts` is a turbo `globalDependencies` entry, so touching it makes
// `turbo ls --affected` report all 77 packages AND invalidates every task hash.
// Without it this PR's own CI measures NOTHING: a `.github/**`-only diff has an
// affected set of exactly 0 packages, so all six shards print "No packages on
// this shard" and the Test Core run this measurement depends on tests nothing.
