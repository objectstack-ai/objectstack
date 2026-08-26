// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 10_000,
    alias: [
      // The human-user predicate agreement pin drives plugin-security's
      // `bootstrapPlatformAdmin` to read its hand-spelled `isHumanUser`. A pin
      // is a verdict about the SOURCE in this checkout, so the specifier
      // resolves to `src/` rather than to a `dist/` that may predate the edit
      // under test. Anchored (`^…$`, array form) so the entry cannot swallow
      // subpath specifiers.
      {
        find: /^@objectstack\/plugin-security$/,
        replacement: path.resolve(here, '../plugin-security/src/index.ts'),
      },
    ],
  },
});
