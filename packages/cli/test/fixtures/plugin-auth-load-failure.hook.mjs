// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An installed `@objectstack/plugin-auth` made to fail its load in the one
 * process that imports this hook, the way a missing or broken install fails it
 * — the stub `serve-plugin-auth-load-failure-refusal.integration.test.ts`
 * needs. Loaded with `node --import <this file's URL>?mode=missing|broken`, so
 * it is in place before `os serve` imports anything; a `resolve` hook and not a
 * file operation, for the reason `unbuilt-spec-dist.hook.mjs` gives (several
 * agents share one container, and nothing here touches the disk).
 *
 * Only the package's ROOT entry is denied — the specifier `os serve`'s
 * AuthPlugin auto-registration imports. Its subpaths stay reachable on purpose:
 * `@objectstack/runtime` imports `@objectstack/plugin-auth/rate-limit-storage`
 * and `/client-address` statically, so denying them would crash the CLI before
 * the boot reaches the auth tier, which is a different failure from the one
 * under test.
 *
 * Both modes make node produce its OWN error, so the refusal is asserted against
 * a sentence this file did not write:
 *
 *   - `missing` hands `nextResolve` an absolute path that does not exist, and
 *     node answers its real `Cannot find module '…'` (`ERR_MODULE_NOT_FOUND`) —
 *     the error the CLI used to swallow without a word;
 *   - `broken` resolves the entry to a module whose static named import has no
 *     export behind it, and node answers its real link-time `SyntaxError`
 *     (`does not provide an export named …`) — the shape of the broken install
 *     the publish smoke once caught, which the CLI used to warn about and boot.
 */

import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** This file lives in `packages/cli/test/fixtures`, so `packages/cli` is two up. */
const CLI_PKG = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const DENIED = '@objectstack/plugin-auth';

const MODE = new URL(import.meta.url).searchParams.get('mode');
if (MODE !== 'missing' && MODE !== 'broken') {
  throw new Error(`plugin-auth-load-failure.hook.mjs: import it with ?mode=missing or ?mode=broken, not ${JSON.stringify(MODE)}`);
}

/** Where a missing install's root entry is looked for; the last segment is deliberately not a real one. */
const MISSING_TARGET = resolve(CLI_PKG, 'node_modules/@objectstack/plugin-auth/dist/__missing-install-simulation__/index.mjs');

/** The broken install's root entry: a module that cannot link. */
const BROKEN_URL = 'objectstack-test:plugin-auth-broken-install';
const BROKEN_SOURCE = "import { createLocalAccountIssuer } from 'node:path';\nexport class AuthPlugin {}\nvoid createLocalAccountIssuer;\n";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === DENIED) {
      if (MODE === 'missing') return nextResolve(MISSING_TARGET, context);
      return { url: BROKEN_URL, format: 'module', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === BROKEN_URL) return { format: 'module', source: BROKEN_SOURCE, shortCircuit: true };
    return nextLoad(url, context);
  },
});
