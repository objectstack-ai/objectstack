/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Second build pass: `dist/core.js`, the `@object-ui/plugin-chatbot/core`
 * subpath (objectui#13410). See `src/core.ts` for why the subpath exists.
 *
 * A pass of its own because the main build emits UMD, and a lib build with
 * more than one entry cannot. Its typings come from the main pass, whose
 * `dts` plugin already emits every `src` module, `dist/core.d.ts` included.
 * ⛔ `emptyOutDir: false`: this pass runs second and must not delete them.
 */
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/core.ts'),
      formats: ['es'],
      fileName: () => 'core.js',
    },
    rollupOptions: {
      external: (id) => !/^[./]/.test(id) && !id.startsWith(__dirname),
    },
  },
});
