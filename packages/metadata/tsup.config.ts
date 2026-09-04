// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/node.ts',
    'src/migrations/index.ts',
    // `@objectstack/metadata/errors` — the shared driver-error discriminators
    // (#4728/#4825/#4867). Its own entry so a consumer that needs only the
    // predicate does not load the manager, the loaders and their deps.
    'src/errors.ts',
    // `@objectstack/metadata/view-container` — the shared "which object does
    // this aggregated container bind to?" derivation (#14399/#14680). Its own
    // entry for the same reason `errors` has one: objectql's ADR-0076 lean
    // entry needs the pure function, not the manager, the loaders or their deps.
    'src/view-container.ts',
  ],
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: !process.env.OS_SKIP_DTS,
  format: ['esm', 'cjs'],
  target: 'es2020',
});
