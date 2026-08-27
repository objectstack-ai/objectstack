// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * [#10772] This package had no vitest config until
 * `plugin-shutdown-stops-auto-enqueuer.test.ts` needed a REAL kernel to prove
 * that `await kernel.shutdown()` reaches `WebhookOutboxPlugin.destroy()`. That
 * is the package's first VALUE import of `@objectstack/core` — the plugin's own
 * `import type { Plugin, PluginContext }` is erased before resolution and so was
 * never a hazard — and an unaliased value import resolves through `exports` to
 * `core/dist`, which would make the verdict a function of build state rather
 * than of the source in the checkout.
 *
 * `pnpm check:test-source-alias` reds on exactly that and names this remedy:
 * alias it to source rather than widen `KNOWN_UNALIASED_TEST_IMPORTS`, which is
 * shrink-only.
 *
 * ANCHORED regex, array form, deliberately. A bare string `find` matches by
 * PREFIX, so with a FILE replacement it would also swallow the published
 * `@objectstack/core/logger` subpath and resolve it to
 * `…/core/src/index.ts/logger` — `ENOTDIR`, at run time, from a config that
 * reads as correct. Anchoring leaves that subpath to `exports`, where it
 * belongs.
 *
 * `test` is deliberately left unset: this package's `test` script is a bare
 * `vitest run` and was relying on the defaults, so declaring any of them here
 * would silently narrow what the suite collects.
 */
export default defineConfig({
    resolve: {
        alias: [
            { find: /^@objectstack\/core$/, replacement: path.resolve(__dirname, '../../core/src/index.ts') },
            // [#12642] The i18n provenance seam. This package's translation
            // barrel passes its committed `<locale>.source-hashes.generated.ts`
            // companions through `withSourceFallback`, whose home is this
            // subpath — so without the alias the suite's verdict would be about
            // `platform-objects/dist` build state rather than the checkout.
            // Anchored on the SUBPATH for the same reason the `core` entry
            // above is anchored on the root.
            { find: /^@objectstack\/platform-objects\/apps$/, replacement: path.resolve(__dirname, '../../platform-objects/src/apps/index.ts') },
        ],
    },
});
