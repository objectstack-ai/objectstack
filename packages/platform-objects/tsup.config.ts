// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'tsup';

import { dropSourcesContent } from '../../scripts/tsup-drop-sources-content.mjs';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'identity/index': 'src/identity/index.ts',
    'security/index': 'src/security/index.ts',
    'audit/index': 'src/audit/index.ts',
    'integration/index': 'src/integration/index.ts',
    'metadata/index': 'src/metadata/index.ts',
    'system/index': 'src/system/index.ts',
    'apps/index': 'src/apps/index.ts',
    'pages/index': 'src/pages/index.ts',
    'metadata-translations/index': 'src/metadata-translations/index.ts',
    plugin: 'src/plugin.ts',
  },
  format: ['cjs', 'esm'],
  dts: !process.env.OS_SKIP_DTS,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  esbuildOptions: dropSourcesContent,
});
