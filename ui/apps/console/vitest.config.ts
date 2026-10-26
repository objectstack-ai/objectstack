import path from 'path';
import { defineConfig, mergeConfig } from 'vitest/config';
import rootConfig from '../../vitest.config.mts';
// The `.ts` extension and `import.meta.dirname` below are load-bearing, not
// style: Vite's `configLoader: 'native'` hands this file to Node's own ESM
// loader, which neither guesses extensions nor defines `__dirname`
// (objectui#3384).
import viteConfig from './vite.config.ts';

export default mergeConfig(
  mergeConfig(rootConfig, viteConfig),
  defineConfig({
    test: {
      // The root config no longer sets global setupFiles (they moved into the
      // per-project `unit`/`dom` split). Console tests render components, so
      // they need the DOM setup explicitly.
      setupFiles: [path.resolve(import.meta.dirname, '../../vitest.setup.dom.tsx')],
    },
  })
);
