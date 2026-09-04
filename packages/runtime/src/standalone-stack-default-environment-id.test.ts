// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#13366] The default environment id a standalone boot stamps, pinned at the
// place it is OBSERVABLE: the two plugins `createStandaloneStack` hands it to.
//
// Why this file exists at all. The v5.0 `project` to `environment` rename
// shipped the CLI default `env_local` — `packages/cli/CHANGELOG.md` records
// "Default local env id: `proj_local` -> `env_local`" and
// `content/docs/deployment/cli.mdx` documents `env_local` — but the runtime's
// own fallback kept stamping `proj_local`. Nothing pinned it, in either
// spelling, so `declared != enforced` held on a published default for a whole
// major line without one test going red. That is the gap this closes: the
// literal now has an assertion attached to the code path that emits it.
//
// It reads the id off `result.plugins` rather than off a copy of the constant,
// because the value is only interesting where it LANDS. `MetadataPlugin` takes
// it as `options.environmentId` and `ObjectQLPlugin` as a row-scope key; a
// pin that re-declared the string would stay green through a change that
// stopped passing it to either.
//
// ⛔ These cases must NOT be read as "the CLI default". `os dev` / `os start`
// export `OS_ENVIRONMENT_ID` into the child boot, so a CLI-spawned kernel never
// reaches this fallback — the CLI's own default is pinned separately (the
// `runtime.env_local.json` publication tests in packages/cli). What this file
// owns is the DIRECT-EMBEDDER path: `createStandaloneStack()` with no config
// and no env var, which is the surface a `createStandaloneStack` host observes.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStandaloneStack } from './standalone-stack.js';

const BOOT_TIMEOUT = 60_000;

// The two plugin ids the stack composes. Matched by the plugin's own declared
// `name`, not by array position: the composition order is documented as a
// dependency-graph outcome elsewhere in this package, and an index would pin
// that instead of this.
const METADATA_PLUGIN = 'com.objectstack.metadata';
const OBJECTQL_PLUGIN = 'com.objectstack.engine.objectql';

/**
 * The id as each plugin actually received it.
 *
 * `MetadataPlugin` keeps it under `options.environmentId`; `ObjectQLPlugin`
 * copies it to its own `environmentId` field. Both are TypeScript-private —
 * hence the casts — and reading them is deliberate: they are the last point at
 * which the stamped value is still identifiable before it dissolves into row
 * scoping and an artifact-validation envelope.
 */
function stampedIds(plugins: any[]): { metadata: unknown; objectql: unknown } {
    const metadata = plugins.find((p) => p?.name === METADATA_PLUGIN);
    const objectql = plugins.find((p) => p?.name === OBJECTQL_PLUGIN);
    expect(metadata, `stack must carry ${METADATA_PLUGIN}`).toBeDefined();
    expect(objectql, `stack must carry ${OBJECTQL_PLUGIN}`).toBeDefined();
    return {
        metadata: (metadata as any).options?.environmentId,
        objectql: (objectql as any).environmentId,
    };
}

describe('[#13366] createStandaloneStack — default environment id', () => {
    let dir: string;
    let savedEnvId: string | undefined;
    let savedHome: string | undefined;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'os-standalone-envid-'));
        savedEnvId = process.env.OS_ENVIRONMENT_ID;
        savedHome = process.env.OS_HOME;
        delete process.env.OS_ENVIRONMENT_ID;
        process.env.OS_HOME = dir;
    });

    afterEach(() => {
        if (savedEnvId === undefined) delete process.env.OS_ENVIRONMENT_ID;
        else process.env.OS_ENVIRONMENT_ID = savedEnvId;
        if (savedHome === undefined) delete process.env.OS_HOME;
        else process.env.OS_HOME = savedHome;
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
    });

    it('stamps `env_local` when neither the config nor OS_ENVIRONMENT_ID names one', async () => {
        const stack = await createStandaloneStack({ databaseUrl: 'memory://standalone-envid-default' });
        // The literal, at both landing sites. `proj_local` here is the pre-#13366
        // value and is what this case exists to keep from coming back.
        expect(stampedIds(stack.plugins)).toEqual({ metadata: 'env_local', objectql: 'env_local' });
    }, BOOT_TIMEOUT);

    it('OS_ENVIRONMENT_ID still overrides the default', async () => {
        process.env.OS_ENVIRONMENT_ID = 'env_from_the_environment';
        const stack = await createStandaloneStack({ databaseUrl: 'memory://standalone-envid-env' });
        expect(stampedIds(stack.plugins)).toEqual({
            metadata: 'env_from_the_environment',
            objectql: 'env_from_the_environment',
        });
    }, BOOT_TIMEOUT);

    it('an explicit `cfg.environmentId` still outranks OS_ENVIRONMENT_ID', async () => {
        process.env.OS_ENVIRONMENT_ID = 'env_from_the_environment';
        const stack = await createStandaloneStack({
            environmentId: 'env_from_the_config',
            databaseUrl: 'memory://standalone-envid-cfg',
        });
        expect(stampedIds(stack.plugins)).toEqual({
            metadata: 'env_from_the_config',
            objectql: 'env_from_the_config',
        });
    }, BOOT_TIMEOUT);
});
