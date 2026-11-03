// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28697] The metadata plugin's body registration (`registerArtifactBodyCollections`,
 * reached here through `MetadataPlugin.registerUnclaimedTopLevel`, the call a
 * config boot makes with a stack no schema parse judged) refuses an item whose
 * body already wears a `_packageId` other than the package it registers it
 * under — by the one judge (`judgeCollectionItemOwnerStamp`), over the build
 * door's collections, before the sink stores anything.
 *
 * Why it matters: `applyProtection` stamps an unset key only, so the body's own
 * stamp used to be what this door stored, and the engine's boot sync
 * (`ObjectQLPlugin.loadMetadataFromService`) files every `app` / `view` /
 * `flow` / `hook` it reads back under that stamp.
 */

import { describe, it, expect } from 'vitest';
import { judgeCollectionItemOwnerStamp } from '@objectstack/spec/kernel';
import { MetadataPlugin } from './plugin.js';

const STACK = 'com.probe.stack';
const OTHER = 'com.probe.a';
const body = (id: string, namespace: string) => ({ id, name: namespace, namespace, version: '1.0.0', type: 'app' });

/** A two-body config stack whose top-level `extra` no body declares: the residual, owned by `STACK`. */
const withResidual = (extra: Record<string, unknown>) => ({
    manifest: body(STACK, 'probestack'),
    packages: [{ manifest: body(OTHER, 'probea') }, { manifest: body('com.probe.b', 'probeb') }],
    ...extra,
});

async function registerResidual(stack: unknown): Promise<{ error: any; stored: Array<{ type: string; name: string; item: any }> }> {
    const stored: Array<{ type: string; name: string; item: any }> = [];
    let error: any;
    try {
        await MetadataPlugin.registerUnclaimedTopLevel(
            { register: async (type, name, item) => { stored.push({ type, name, item }); }, warn: () => undefined },
            stack,
            { door: 'config', label: 'probe' },
        );
    } catch (e) {
        error = e;
    }
    return { error, stored };
}

const app = (stamp?: unknown) => ({ name: 'probe_app', label: 'Probe', ...(stamp === undefined ? {} : { _packageId: stamp }) });
const flow = (stamp?: unknown) => ({ name: 'probe_flow', label: 'Probe', type: 'autolaunched', ...(stamp === undefined ? {} : { _packageId: stamp }) });
const container = (stamp?: unknown) => ({
    object: 'probe_thing',
    list: { type: 'grid', columns: [{ field: 'name' }] },
    ...(stamp === undefined ? {} : { _packageId: stamp }),
});

describe('[#28697] the metadata door refuses a body stamp naming another package, before it stores anything', () => {
    it.each([
        ['apps', 'app', 'probe_app', app],
        ['flows', 'flow', 'probe_flow', flow],
        ['views', 'view', 'probe_thing', container],
    ] as const)('a residual %s entry wearing another package\'s id: VALIDATION_ERROR / 400 at `_packageId`, nothing stored', async (key, type, name, make) => {
        const { error, stored } = await registerResidual(withResidual({ [key]: [make(OTHER)] }));
        expect(error, 'the registration must be refused').toBeInstanceOf(Error);
        expect(error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, httpStatus: 400 });
        expect(error.issues).toEqual([{ path: '_packageId', code: 'custom', message: expect.any(String) }]);
        expect(error.message).toBe(judgeCollectionItemOwnerStamp(make(OTHER), type, name, STACK, 'register')!.message);
        expect(stored).toEqual([]);
    });

    it('CONTROL: an absent stamp and a stamp equal to the owner are stored, stamped with the owner', async () => {
        for (const stamp of [undefined, STACK]) {
            const { error, stored } = await registerResidual(withResidual({ apps: [app(stamp)], flows: [flow(stamp)] }));
            expect(error, `stamp ${String(stamp)}`).toBeUndefined();
            expect(stored.map((s) => [s.type, s.name, s.item._packageId])).toEqual([
                ['app', 'probe_app', STACK],
                ['flow', 'probe_flow', STACK],
            ]);
        }
    });

    it('CONTROL: a collection the build door does not judge (`objectExtensions`) is stored as before', async () => {
        const ext = { name: 'probe_ext', extend: 'probe_thing', fields: {}, _packageId: OTHER };
        const { error } = await registerResidual(withResidual({ objectExtensions: [ext] }));
        expect(error).toBeUndefined();
    });
});
