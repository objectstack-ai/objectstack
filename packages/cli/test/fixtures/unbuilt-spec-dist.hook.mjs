// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A BUILT checkout, made to answer like an unbuilt one for `@objectstack/spec`
 * and nothing else — the environment `run-dev-unbuilt-workspace.e2e.test.ts`
 * needs and CI cannot otherwise have (#12964).
 *
 * Loaded with `node --import`, so it is in place before `@oclif/core` walks the
 * command directory. It is a `resolve` hook and NOT a file operation on purpose:
 * this repo is worked by several agents in one container at a time, and a test
 * that renamed `packages/spec/dist` for a few seconds would break every other
 * run in the box. Nothing here touches the disk.
 *
 * ## Why it re-points the specifier instead of throwing
 *
 * The classifier this feeds (`looksLikeStaleWorkspaceDist`) reads node's OWN
 * sentence, so the sentence has to be node's. Two shapes were measured before
 * this one was kept:
 *
 *   - `{ url, shortCircuit: true }` at a non-existent URL skips
 *     `finalizeResolution`, so the failure surfaces from the LOAD step as
 *     `ENOENT: no such file or directory, open '…'`. That is not the corpus and
 *     the classifier correctly declines it — a green run that proves nothing.
 *   - throwing a hand-built `ERR_MODULE_NOT_FOUND` would make the test assert
 *     against a string this file authored, which is the one thing a fixture for
 *     a text classifier must not do.
 *
 * Handing `nextResolve` an ABSOLUTE PATH that does not exist runs node's real
 * resolution against it, and node produces its real
 * `Cannot find module '…' imported from …`.
 *
 * ## Why the path is spelled through `packages/cli/node_modules`
 *
 * That is where an unbuilt tree's sentence points, and it is not cosmetic: pnpm
 * symlinks the workspace package in, and node only reports the pre-realpath
 * spelling when resolution FAILS (a successful resolve reports
 * `packages/spec/dist/index.mjs`, with no `@objectstack` in it at all). The
 * classifier keys on `node_modules/@objectstack/<pkg>` — deliberately, so it
 * never diagnoses a third party — so a realpath spelling would classify as
 * nothing and this fixture would silently stop simulating anything.
 */

import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** This file lives in `packages/cli/test/fixtures`, so `packages/cli` is two up. */
const CLI_PKG = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Where an unbuilt `@objectstack/spec` is looked for. The last segment is
 * deliberately not a real one — `dist/` itself is present in a built checkout,
 * and the whole point is a path that is missing.
 */
const UNBUILT_TARGET = resolve(CLI_PKG, 'node_modules/@objectstack/spec/dist/__unbuilt-simulation__/index.mjs');

/** Every `@objectstack/spec` subpath, so the simulation is not one entry deep. */
const DENIED = '@objectstack/spec';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === DENIED || specifier.startsWith(`${DENIED}/`)) {
      return nextResolve(UNBUILT_TARGET, context);
    }
    return nextResolve(specifier, context);
  },
});
