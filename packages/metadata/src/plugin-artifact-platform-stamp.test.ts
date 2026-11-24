// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#37013] The platform's provenance (`_provenance: 'platform'`) is set only by
 * the metadata service's own platform registration. The artifact door's body
 * registration (`registerArtifactBodyCollections`, reached here through
 * `MetadataPlugin.registerUnclaimedTopLevel`, the call both the artifact and
 * the config door make for a stack's residual) refuses an item that carries
 * it — with or without a manifest id — before the sink stores anything, and
 * names the key and the fix.
 */

import { describe, it, expect } from 'vitest';
import { MetadataPlugin } from './plugin.js';

const STACK = 'com.probe.stack';
const body = (id: string | undefined, namespace: string) =>
    ({ ...(id === undefined ? {} : { id }), name: namespace, namespace, version: '1.0.0', type: 'app' });

/** A two-body stack whose top-level `extra` no body declares: the residual, owned by the manifest's id (or none). */
const withResidual = (manifestId: string | undefined, extra: Record<string, unknown>) => ({
    manifest: body(manifestId, 'probestack'),
    packages: [{ manifest: body('com.probe.a', 'probea') }, { manifest: body('com.probe.b', 'probeb') }],
    ...extra,
});

async function registerResidual(stack: unknown): Promise<{ error: any; stored: Array<{ type: string; name: string; item: any }> }> {
    const stored: Array<{ type: string; name: string; item: any }> = [];
    let error: any;
    try {
        await MetadataPlugin.registerUnclaimedTopLevel(
            { register: async (type, name, item) => { stored.push({ type, name, item }); }, warn: () => undefined },
            stack,
            { door: 'artifact', label: 'probe' },
        );
    } catch (e) {
        error = e;
    }
    return { error, stored };
}

const skill = (provenance?: string) => ({
    name: 'probe_skill',
    label: 'Probe',
    instructions: 'probe',
    ...(provenance === undefined ? {} : { _provenance: provenance }),
});

describe('[#37013] the artifact door refuses an item carrying the platform\'s provenance, before it stores anything', () => {
    it.each([
        ['with a manifest id', STACK],
        ['without a manifest id', undefined],
    ] as const)('%s: VALIDATION_ERROR / 400 at `_provenance`, with the fix, nothing stored', async (_label, manifestId) => {
        const { error, stored } = await registerResidual(withResidual(manifestId, { skills: [skill('platform')] }));
        expect(error, 'the registration must be refused').toBeInstanceOf(Error);
        expect(error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, httpStatus: 400 });
        expect(error.issues).toEqual([{ path: '_provenance', code: 'custom', message: expect.stringContaining('remove `_provenance`') }]);
        expect(stored).toEqual([]);
    });

    it('CONTROL: an item with no provenance, or the package\'s, is stored', async () => {
        for (const provenance of [undefined, 'package']) {
            const { error, stored } = await registerResidual(withResidual(STACK, { skills: [skill(provenance)] }));
            expect(error, `provenance ${String(provenance)}`).toBeUndefined();
            expect(stored.map((s) => [s.type, s.name, s.item._provenance])).toEqual([['skill', 'probe_skill', 'package']]);
        }
    });
});
