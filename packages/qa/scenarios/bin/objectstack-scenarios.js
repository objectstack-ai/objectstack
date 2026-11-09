#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// `bin.objectstack-scenarios` in package.json: npm packs this file because it
// is the `bin` target. It runs the BUILT CLI (`dist/bin.js`, from
// `src/bin.ts`), never a `.ts` source; a refusal or failure prints its message
// and exits 1, as `run-scenarios` does.
import { runCli } from '../dist/bin.js';

runCli(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
