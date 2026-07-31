// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A function's DECLARATION survives the built-artifact path (#4396).
 *
 * `objectstack build` splits every callable in two: the JSON artifact keeps a
 * serialisable `functions` entry, the sibling `objectstack-runtime.*.mjs` keeps
 * the callable. The merge that puts them back together used to be a plain
 * overwrite, which kept the handler and dropped everything the entry declared —
 * so `effect: 'writes'` worked from source and silently vanished on every built
 * deployment, taking the run's honest `unmeasured` count with it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeRuntimeModule } from './load-artifact-bundle.js';
import { collectBundleFunctionEntries } from './app-plugin.js';

let dir: string;
let artifactPath: string;

beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'os-artifact-fns-'));
    artifactPath = join(dir, 'objectstack.json');
    writeFileSync(
        join(dir, 'objectstack-runtime.mjs'),
        'export const functions = {\n'
        + '  scoreLead: () => ({ score: 1 }),\n'
        + '  syncBilling: () => ({ ok: true }),\n'
        + '};\n',
    );
});

afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('mergeRuntimeModule — declared functions', () => {
    it('re-attaches the module callable to the declaration the JSON carried', async () => {
        const bundle: any = {
            runtimeModule: './objectstack-runtime.mjs',
            // What `lowerCallables` emits: a ref string for a bare handler, a
            // declaration record for a declared one.
            functions: {
                scoreLead: 'scoreLead',
                syncBilling: { handler: 'syncBilling', effect: 'writes' },
            },
        };

        await mergeRuntimeModule(bundle, artifactPath);

        expect(typeof bundle.functions.scoreLead).toBe('function');
        expect(typeof bundle.functions.syncBilling.handler).toBe('function');
        expect(bundle.functions.syncBilling.effect).toBe('writes');

        // ...and the collector downstream reads both back.
        const entries = collectBundleFunctionEntries(bundle);
        expect(entries.scoreLead.effect).toBe('pure');
        expect(entries.syncBilling.effect).toBe('writes');
        expect((entries.syncBilling.handler as () => unknown)()).toEqual({ ok: true });
    });

    it('leaves a bundle with no runtimeModule alone', async () => {
        const handler = () => ({ ok: true });
        const bundle: any = { functions: { syncBilling: { handler, effect: 'writes' } } };
        await mergeRuntimeModule(bundle, artifactPath);
        expect(bundle.functions.syncBilling).toEqual({ handler, effect: 'writes' });
    });
});
