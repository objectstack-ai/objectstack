import path from 'path';
import { defineConfig, mergeConfig } from 'vitest/config';
import rootConfig from '../../vitest.config.mts';
// The `.ts` extension and `import.meta.dirname` below are load-bearing, not
// style: Vite's `configLoader: 'native'` hands this file to Node's own ESM
// loader, which neither guesses extensions nor defines `__dirname`
// (objectui#3384).
import viteConfig from './vite.config.ts';

// The console BUILD bakes its identity as a `define` on
// `import.meta.env.VITE_APP_VERSION` (objectui#12970) — and vitest does not
// scope such a define to the project that declares it. While it resolves a
// project's config it moves every `import.meta.env.*` / `process.env.*` define
// into the main process's `process.env` (`deleteDefineConfig` in vitest's
// cli-api chunk), which the workers of EVERY project inherit. So the console's
// git sha surfaced in app-shell's `getConsoleBuild()` and turned
// `buildIdentity-12970`'s "reads null" case red in full runs, depending on
// shard layout (#26126). Those defines stay in the build and stop here; no
// console test reads them.
const LEAKS_INTO_PROCESS_ENV = /^(import\.meta\.env|process\.env)\./;
const testDefine = Object.fromEntries(
  Object.entries(viteConfig.define ?? {}).filter(([key]) => !LEAKS_INTO_PROCESS_ENV.test(key))
);

export default mergeConfig(
  mergeConfig(rootConfig, { ...viteConfig, define: testDefine }),
  defineConfig({
    test: {
      // The root config no longer sets global setupFiles (they moved into the
      // per-project `unit`/`dom` split). Console tests render components, so
      // they need the DOM setup explicitly.
      setupFiles: [path.resolve(import.meta.dirname, '../../vitest.setup.dom.tsx')],
    },
  })
);
