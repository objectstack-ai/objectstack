// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: !process.env.OS_SKIP_DTS,
  format: ['esm', 'cjs'],
  target: 'es2020',
  // Mark driver packages as external so they are resolved at runtime, not bundled
  external: [
    '@objectstack/driver-memory',
    '@objectstack/driver-sql',
    '@objectstack/driver-sqlite-wasm',
    '@objectstack/driver-mongodb',
    // OPTIONAL install, loaded through `turso-driver-factory.ts`'s lazy
    // `import()` (#5820). External so esbuild never tries to resolve/bundle a
    // package that is deliberately not a dependency of this one.
    '@objectstack/driver-turso',
    '@objectstack/metadata',
    '@objectstack/objectql',
  ],
});
