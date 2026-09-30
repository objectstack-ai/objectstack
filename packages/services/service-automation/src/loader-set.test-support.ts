// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20761] Test-only stand-in for THE LOADER'S SET — the one server-held fact
 * of which flows are packaged, which the engine reads through
 * `AutomationEngine.setPackagedFlowSource` (production: the automation plugin's
 * `packagedFlowReader`, over the metadata protocol's `packagedArtifactOwner`).
 *
 * ⛔ Not exported from `index.ts` and outside the tsup entry, so it is compiled
 * by the test program and shipped by nothing.
 *
 * The suites that attach it pin the §7.3 subflow guards, the arming gate and
 * the activation door — the LOGIC that runs once a flow is known to be
 * packaged — and each of their `registerFlow` calls with a package's stamps
 * plays the part of the boot pull, which registers exactly the bodies the
 * artifact loader stamped. So the set here is "the flows registered with a
 * code package's stamps", read off the engine's own flow map, which is what
 * the loader's set looks like to an engine the boot pull filled.
 *
 * ⚠️ That equivalence is what this helper ASSUMES, never what it proves. That
 * the engine reads the attached set — and NOT a definition's stamps — is
 * pinned on its own, in `packaged-flow-source.test.ts`, with an explicit set
 * that disagrees with the stamps in both directions.
 */

import { isCodeArtifactBody } from '@objectstack/metadata-core';
import type { AutomationEngine } from './engine.js';

/**
 * Attach a loader's set to `engine` that holds every flow it has registered
 * with a code package's stamps. Returns the engine, so a construction can
 * stay one expression.
 */
export function withLoaderSetFromPull<E extends AutomationEngine>(engine: E): E {
    engine.setPackagedFlowSource((name) => {
        const flow = (engine as unknown as { flows: Map<string, unknown> }).flows.get(name);
        if (!isCodeArtifactBody(flow)) return undefined;
        return String((flow as { _packageId: unknown })._packageId);
    });
    return engine;
}
