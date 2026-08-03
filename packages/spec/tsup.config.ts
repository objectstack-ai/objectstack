// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'tsup';

const entries = [
  'src/index.ts',
  'src/data/index.ts',
  'src/system/index.ts',
  'src/kernel/index.ts',
  'src/automation/index.ts',
  'src/api/index.ts',
  'src/ui/index.ts',
  'src/ai/index.ts',
  'src/security/index.ts',
  'src/contracts/index.ts',
  'src/integration/index.ts',
  'src/studio/index.ts',
  'src/cloud/index.ts',
  'src/qa/index.ts',
  'src/identity/index.ts',
  'src/shared/index.ts'
];

// Generate DTS separately to avoid memory issues.
//
// [#4845] The DTS pass runs under an explicit `--max-old-space-size` (see the
// `build` script in package.json). That number is a CEILING V8 is allowed to
// grow to, NOT a reservation — set it above what the machine can actually give
// and V8 simply stops collecting aggressively, grows past physical memory, and
// the kernel OOM-killer takes the process with NO diagnostic output at all
// (`DTS Build start` followed straight by `ELIFECYCLE`). It was 12288 on a
// 16 GB `ubuntu-latest` runner, which is that failure, not a guard against it:
// four CI hits in one morning across PRs that shared no content — including one
// pure-prose patch — and the fourth ejected a PR from the merge queue.
// Keep this comfortably under the runner's physical memory.
const isDts = process.env.BUILD_DTS === 'true';

export default defineConfig({
  entry: entries,
  splitting: false,
  sourcemap: true,
  clean: !isDts, // Only clean on main build, not on DTS pass
  dts: !isDts ? false : { only: true }, // Only generate DTS on explicit pass, without JS
  format: ['esm', 'cjs'],
  target: 'es2020',
  treeshake: true,
});
